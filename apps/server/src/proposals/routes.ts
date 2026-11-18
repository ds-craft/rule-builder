// 運営の改正案（F-44）：一覧と、改正案の同期（WebSocket）、発議・採決（F-50〜F-59）。どれも運営者のセッションが要る。
// 発議・採決の手続は改正案の ProposalRoom の中で動く（flow/controller.ts）。ここでは入力を確かめて渡すだけ。

import { PROPOSAL_STATUSES } from '@rule-builder/core';
import { Hono, type Context } from 'hono';
import { requireUnei } from '../auth/middleware.ts';
import type { FlowActor, FlowResult } from '../flow/state.ts';
import { apiError } from '../http/errors.ts';
import { encodeUser, USER_HEADER, type RoomUser } from '../room/user.ts';
import { proposalRoom } from '../room/namespace.ts';
import type { AppEnv } from '../types.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATUSES = new Set<string>(PROPOSAL_STATUSES);

export type ProposalListItem = {
  id: string;
  amendingNumber: { kind: string; year: number; number: number };
  enforcementDate: string;
  rules: { name: string; op: 'create' | 'amend' | 'repeal' }[];
  status: string;
  createdAt: string;
  createdBy: { id: string; name: string };
  updatedAt: string;
  updatedBy: { id: string; name: string; avatarUrl: string | null };
  /** 題名（発議後） */
  title: string;
  /** 進行中の投票の締切 */
  voteClosesAt: string | null;
  /** 可決後に確定した改正ルール番号 */
  finalNumber: string | null;
};

type Row = {
  id: string;
  amending_kind: string;
  amending_year: number;
  amending_number: number;
  enforcement_date: string;
  rules: string;
  status: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  created_name: string | null;
  updated_name: string | null;
  updated_avatar: string | null;
  title: string;
  vote_closes_at: string | null;
  final_number: string | null;
};

function toItem(r: Row): ProposalListItem {
  let rules: ProposalListItem['rules'];
  try {
    rules = JSON.parse(r.rules) as ProposalListItem['rules'];
  } catch {
    rules = [];
  }
  return {
    id: r.id,
    amendingNumber: { kind: r.amending_kind, year: r.amending_year, number: r.amending_number },
    enforcementDate: r.enforcement_date,
    rules,
    status: r.status,
    createdAt: r.created_at,
    createdBy: { id: r.created_by, name: r.created_name ?? '' },
    updatedAt: r.updated_at,
    updatedBy: { id: r.updated_by, name: r.updated_name ?? '', avatarUrl: r.updated_avatar },
    title: r.title ?? '',
    voteClosesAt: r.vote_closes_at ?? null,
    finalNumber: r.final_number ?? null,
  };
}

export const proposalRoutes = new Hono<AppEnv>();

proposalRoutes.use('*', requireUnei);

/** サーバー上の全件（状態で絞り込み）。更新日時の新しい順 */
proposalRoutes.get('/', async (c) => {
  const status = c.req.query('status') || null;
  if (status !== null && !STATUSES.has(status))
    return apiError('bad_request', '状態の指定が正しくありません');
  const res = await c.env.DB.prepare(
    `SELECT p.*, cu.display_name AS created_name, uu.display_name AS updated_name, uu.avatar_url AS updated_avatar
     FROM proposals p
     LEFT JOIN users cu ON cu.id = p.created_by
     LEFT JOIN users uu ON uu.id = p.updated_by
     WHERE (? IS NULL OR p.status = ?)
     ORDER BY p.updated_at DESC
     LIMIT 500`,
  )
    .bind(status, status)
    .all<Row>();
  return c.json({ proposals: (res.results ?? []).map(toItem) });
});

/** 改正案の同期（Yjs の同期プロトコルと awareness）。まだない改正案は、画面が中身を送ると作られる */
proposalRoutes.get('/:id/sync', async (c) => {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return apiError('bad_request', 'WebSocket で接続してください');
  }
  const id = c.req.param('id');
  if (!UUID.test(id)) return apiError('bad_request', '改正案の ID が正しくありません');
  const s = c.get('session');
  const user: RoomUser = {
    uid: s.uid,
    name: s.name,
    avatar: s.avatar,
    chk: s.chk,
    readOnly: false,
  };
  const stub = await proposalRoom(c.env, id);
  // 画面から届いた同名のヘッダーは必ず上書きする
  const req = new Request(c.req.raw);
  req.headers.set(USER_HEADER, encodeUser(user));
  return stub.fetch(req);
});

// ---------- 発議・採決（F-50〜F-59） ----------

const actorOf = (c: Context<AppEnv>): FlowActor => {
  const s = c.get('session');
  return { uid: s.uid, name: s.name };
};

const flowResponse = (c: Context<AppEnv>, r: FlowResult) =>
  r.ok ? c.json(r.view) : apiError(r.error, r.message, r.checks ? { checks: r.checks } : {});

async function body(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const b = await c.req.json().catch(() => ({}));
  return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
}

const roomOf = async (c: Context<AppEnv>) => {
  const id = c.req.param('id');
  if (!id || !UUID.test(id)) return null;
  return proposalRoom(c.env, id);
};

const refsOf = (b: Record<string, unknown>) => {
  const n = Number(b.refsRemaining ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** 手続の状態（投票中なら OpsBot に問い合わせ直す） */
proposalRoutes.get('/:id/flow', async (c) => {
  const room = await roomOf(c);
  if (!room) return apiError('bad_request', '改正案の ID が正しくありません');
  return c.json(await room.flowView(true));
});

/** 発議前の確認（サーバーでのやり直し） */
proposalRoutes.post('/:id/flow/preflight', async (c) => {
  const room = await roomOf(c);
  if (!room) return apiError('bad_request', '改正案の ID が正しくありません');
  try {
    return c.json({ checks: await room.flowPreflight(refsOf(await body(c))) });
  } catch (e) {
    console.error(e);
    return apiError(
      'unavailable',
      '公開中のルールを読めませんでした。しばらくしてからやり直してください',
    );
  }
});

proposalRoutes.post('/:id/flow/submit', async (c) => {
  const room = await roomOf(c);
  if (!room) return apiError('bad_request', '改正案の ID が正しくありません');
  return flowResponse(c, await room.flowSubmit(actorOf(c), refsOf(await body(c))));
});

proposalRoutes.post('/:id/flow/mod-vote', async (c) => {
  const room = await roomOf(c);
  if (!room) return apiError('bad_request', '改正案の ID が正しくありません');
  const b = await body(c);
  const method = b.method === 'quick' ? 'quick' : b.method === 'secret' ? 'secret' : null;
  if (!method) return apiError('bad_request', '投票の方式（通常・短縮）を選んでください');
  return flowResponse(
    c,
    await room.flowStartModVote(actorOf(c), method, b.quickConfirmed === true),
  );
});

proposalRoutes.post('/:id/flow/participant-discussion', async (c) => {
  const room = await roomOf(c);
  if (!room) return apiError('bad_request', '改正案の ID が正しくありません');
  const b = await body(c);
  const startedAt = typeof b.startedAt === 'string' ? b.startedAt : new Date().toISOString();
  if (Number.isNaN(Date.parse(startedAt)))
    return apiError('bad_request', '開始時刻が正しくありません');
  return flowResponse(c, await room.flowRecordParticipantDiscussion(actorOf(c), startedAt));
});

proposalRoutes.post('/:id/flow/participant-vote', async (c) => {
  const room = await roomOf(c);
  if (!room) return apiError('bad_request', '改正案の ID が正しくありません');
  return flowResponse(c, await room.flowStartParticipantVote(actorOf(c)));
});

proposalRoutes.post('/:id/flow/withdraw', async (c) => {
  const room = await roomOf(c);
  if (!room) return apiError('bad_request', '改正案の ID が正しくありません');
  return flowResponse(c, await room.flowWithdraw(actorOf(c)));
});

/** 止めた反映をやり直す（F-57） */
proposalRoutes.post('/:id/flow/retry', async (c) => {
  const room = await roomOf(c);
  if (!room) return apiError('bad_request', '改正案の ID が正しくありません');
  return flowResponse(c, await room.flowRetryReflect(actorOf(c)));
});

/** 模擬の OpsBot の投票の結果を決める（OPSBOT_PROPOSALS が "sim" のときだけ） */
proposalRoutes.post('/:id/flow/sim-vote', async (c) => {
  if (c.env.OPSBOT_PROPOSALS !== 'sim') return apiError('not_found', '見つかりません');
  const room = await roomOf(c);
  if (!room) return apiError('bad_request', '改正案の ID が正しくありません');
  const b = await body(c);
  return flowResponse(c, await room.flowSimDecide(actorOf(c), b.passed === true));
});
