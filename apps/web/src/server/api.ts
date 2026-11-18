// サーバー（apps/server）との通信。セッションは Cookie（HttpOnly）で持つので、呼び出しにはすべて Cookie を付ける。
// サーバーの場所は VITE_API_ORIGIN（ステージングのビルドで指定する）。なければ本番、開発中は手元の wrangler dev。

export const API_ORIGIN: string =
  (import.meta.env.VITE_API_ORIGIN as string | undefined) ||
  (import.meta.env.DEV ? 'http://localhost:8787' : 'https://api.builder.ds2.uk');

/** サーバーが返したエラー（code はサーバーの ApiErrorCode） */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
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

export type ProposalStatus = 'draft';

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
