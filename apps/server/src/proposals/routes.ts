// 運営の改正案（F-44）：一覧と、改正案の同期（WebSocket）。どちらも運営者のセッションが要る。

import { Hono } from 'hono';
import { requireUnei } from '../auth/middleware.ts';
import { apiError } from '../http/errors.ts';
import { encodeUser, USER_HEADER, type RoomUser } from '../room/user.ts';
import { proposalRoom } from '../room/namespace.ts';
import type { AppEnv } from '../types.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATUSES = new Set(['draft']);

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
