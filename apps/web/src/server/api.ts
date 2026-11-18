// サーバー（apps/server）との通信。セッションは Cookie（HttpOnly）で持つので、呼び出しにはすべて Cookie を付ける。
// サーバーの場所は VITE_API_ORIGIN（ステージングのビルドで指定する）。なければ本番、開発中は手元の wrangler dev。

export const API_ORIGIN: string =
  (import.meta.env.VITE_API_ORIGIN as string | undefined) ||
  (import.meta.env.DEV ? 'http://localhost:8787' : 'https://api.builder.ds2.uk');

/** サーバーが返したエラー（code はサーバーの ApiErrorCode） */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  /** エラーに付いてきたもの（発議前の確認の項目など） */
  readonly body: Record<string, unknown>;
  constructor(code: string, message: string, status: number, body: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.body = body;
  }
  /** ログインしていない・運営者でなくなった */
  get loggedOut(): boolean {
    return this.code === 'unauthenticated' || this.code === 'forbidden';
  }
}

/** サーバーにつながらない（オフライン・サーバーが落ちている） */
export class OfflineError extends Error {
  constructor() {
    super('サーバーにつながりません。通信の状態を確かめてください');
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_ORIGIN + path, { credentials: 'include', ...init });
  } catch {
    throw new OfflineError();
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as
    (T & { error?: string; message?: string }) | null;
  if (!res.ok) {
    throw new ApiError(
      body?.error ?? `http_${res.status}`,
      body?.message ?? 'サーバーで問題が起きました。しばらくしてからやり直してください',
      res.status,
      (body ?? {}) as Record<string, unknown>,
    );
  }
  return body as T;
}

export type Me = { id: string; name: string; avatarUrl: string | null; onLeave: boolean };

export const fetchMe = () => call<Me>('/auth/me');

export const logoutRequest = () => call<void>('/auth/logout', { method: 'POST' });

/** Discord でログインする入口。ログイン後は return（HashRouter の #/ 以降）に戻る */
export const loginUrl = (returnTo: string) =>
  `${API_ORIGIN}/auth/login?return=${encodeURIComponent(returnTo)}`;

export type { ProposalStatus } from '@rule-builder/core';
import type { ProposalStatus } from '@rule-builder/core';

/** 運営の改正案（サーバーの一覧の1件） */
export type ServerProposal = {
  id: string;
  amendingNumber: { kind: string; year: number; number: number };
  enforcementDate: string;
  rules: { name: string; op: 'create' | 'amend' | 'repeal' }[];
  status: ProposalStatus | string;
  createdAt: string;
  createdBy: { id: string; name: string };
  updatedAt: string;
  updatedBy: { id: string; name: string; avatarUrl: string | null };
  /** 題名（発議後） */
  title?: string;
  /** 進行中の投票の締切 */
  voteClosesAt?: string | null;
  /** 可決後に確定した改正ルール番号 */
  finalNumber?: string | null;
};

export const fetchProposals = () =>
  call<{ proposals: ServerProposal[] }>('/proposals').then((r) => r.proposals);

/** 同期（WebSocket）の接続先 */
export function syncTarget(id: string) {
  const u = new URL(API_ORIGIN);
  return {
    host: u.host,
    protocol: (u.protocol === 'https:' ? 'wss' : 'ws') as 'ws' | 'wss',
    prefix: `/proposals/${id}/sync`,
  };
}

// ---------- 発議・採決（F-50〜F-59） ----------
// 型は apps/server/src/flow/state.ts と apps/server/src/opsbot/types.ts の写し（変更するときは両方を直す）。

export type RuleVoteSummary = {
  voteId: number;
  method: 'secret' | 'quick';
  startedAt: string;
  closesAt: string;
  status: 'open' | 'closed';
  result: { passed: boolean; yes: number; no: number; abstain: number; cancelled?: boolean } | null;
};

export type OpsbotProposal = {
  state: string;
  title: string;
  provisionalNumber: string;
  finalNumber: string | null;
  publicUrl: string;
  contentHash: string | null;
  proposedBy: string;
  proposedAt: string;
  modVote: RuleVoteSummary | null;
  participantDiscussion: { startedAt: string; startedBy: string } | null;
  participantVoteAvailableAt: string | null;
  participantVote: RuleVoteSummary | null;
  decidedAt: string | null;
  enactedAt: string | null;
};

export type ReflectStage =
  'number' | 'pending' | 'waiting' | 'enact' | 'cleanup' | 'notify' | 'done' | 'blocked';

export type FlowView = {
  status: ProposalStatus;
  locked: boolean;
  title: string;
  publicUrl: string | null;
  simulated: boolean;
  opsbot: OpsbotProposal | null;
  frozen: { at: string; by: string; contentHash: string } | null;
  pr: { number: number; url: string } | null;
  reflect: {
    stage: ReflectStage;
    finalNumber: string | null;
    amendingId: string | null;
    enforcementDate: string;
    pendingSha: string | null;
    enactSha: string | null;
    cleanupSha: string | null;
    attempts: number;
    lastError: string | null;
    blocked: { message: string; paths: string[] } | null;
    portalUrl: string | null;
    nextAttemptAt: string | null;
  } | null;
  rulesRepo: string;
  polledAt: string | null;
};

export type PreflightCheck = {
  key: 'entries' | 'enforcement' | 'lint' | 'refs' | 'base';
  label: string;
  ok: boolean;
  details: string[];
};

const post = <T>(path: string, body: unknown = {}) =>
  call<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export const fetchFlow = (id: string) => call<FlowView>(`/proposals/${id}/flow`);

export type FlowAction =
  | { kind: 'submit'; refsRemaining: number }
  | { kind: 'mod-vote'; method: 'secret' | 'quick'; quickConfirmed: boolean }
  | { kind: 'participant-discussion'; startedAt: string }
  | { kind: 'participant-vote' }
  | { kind: 'withdraw' }
  | { kind: 'retry' }
  | { kind: 'sim-vote'; passed: boolean };

export function flowAction(id: string, action: FlowAction): Promise<FlowView> {
  const { kind, ...body } = action;
  return post<FlowView>(`/proposals/${id}/flow/${kind}`, body);
}

/** 公開リンクで見せる改正案（GET /public/:publicId。ログイン不要） */
export type PublicEntry = {
  op: 'create' | 'amend' | 'repeal';
  ruleId: string;
  name: string;
  baseMarkdown: string;
  markdown: string;
};

export type PublicView = {
  status: ProposalStatus;
  title: string;
  amendingNumber: { kind: string; year: number; number: number };
  enforcementDate: string;
  entries: PublicEntry[];
  voteDeadline: string | null;
  participantVoteAvailableAt: string | null;
  portalUrl: string | null;
};

export const fetchPublic = (publicId: string) =>
  call<PublicView>(`/public/${encodeURIComponent(publicId)}`, { credentials: 'omit' });
