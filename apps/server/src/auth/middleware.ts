// 運営者のセッションの確認。判定から15分を過ぎていれば OpsBot に問い合わせてやり直し、Cookie を更新する。
// OpsBot に問い合わせられないときは通さない（fail closed）。運営者でなくなっていたらセッションを消す。

import type { Context, MiddlewareHandler } from 'hono';
import { apiError, type ApiErrorCode } from '../http/errors.ts';
import { opsbot } from '../opsbot/client.ts';
import type { MemberStatus } from '../opsbot/types.ts';
import type { AppEnv } from '../types.ts';
import { clearSession, readSession, RECHECK_MS, writeSession, type Session } from './session.ts';

export type AuthResult =
  { ok: true; session: Session } | { ok: false; error: ApiErrorCode; message: string };

/** OpsBot の判定結果をセッションに反映する */
export function sessionFrom(lid: string, status: MemberStatus, iat: number, now: number): Session {
  return {
    v: 1,
    lid,
    uid: status.userId,
    name: status.displayName,
    avatar: status.avatarUrl,
    role: 'unei',
    onLeave: status.onLeave,
    iat,
    chk: now,
  };
}

export async function authenticate(c: Context<AppEnv>, now = Date.now()): Promise<AuthResult> {
  const session = await readSession(c, now);
  if (!session) {
    return { ok: false, error: 'unauthenticated', message: 'ログインしてください' };
  }
  if (now - session.chk < RECHECK_MS && session.chk <= now + 60_000) return { ok: true, session };

  let status: MemberStatus;
  try {
    status = await opsbot(c.env).getMemberStatus(session.lid);
  } catch (e) {
    console.error('OpsBot に運営者の判定を問い合わせられませんでした', e);
    return {
      ok: false,
      error: 'unavailable',
      message: '運営者かどうかを確かめられませんでした。しばらくしてからやり直してください',
    };
  }
  if (!status.isUnei) {
    clearSession(c);
    return {
      ok: false,
      error: 'forbidden',
      message: '運営者のロールが確認できなくなったため、ログアウトしました',
    };
  }
  const next = sessionFrom(session.lid, status, session.iat, now);
  await writeSession(c, next, now);
  if (next.uid !== session.uid || next.name !== session.name || next.avatar !== session.avatar) {
    c.executionCtx.waitUntil(saveUser(c.env, next, now).catch(() => {}));
  }
  return { ok: true, session: next };
}

/** 運営者のセッションがなければ断る */
export const requireUnei: MiddlewareHandler<AppEnv> = async (c, next) => {
  const r = await authenticate(c);
  if (!r.ok) return apiError(r.error, r.message);
  c.set('session', r.session);
  await next();
};

/** 編集者名・アイコンの表示用に利用者を記録する */
export async function saveUser(env: Env, s: Session, now = Date.now()) {
  await env.DB.prepare(
    `INSERT INTO users (id, display_name, avatar_url, last_login_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, avatar_url = excluded.avatar_url,
       last_login_at = excluded.last_login_at`,
  )
    .bind(s.uid, s.name, s.avatar, new Date(now).toISOString())
    .run();
}

export async function audit(
  env: Env,
  actor: string,
  action: string,
  target: string | null = null,
  detail: unknown = null,
  now = Date.now(),
) {
  await env.DB.prepare(
    'INSERT INTO audit_log (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(
      new Date(now).toISOString(),
      actor,
      action,
      target,
      detail == null ? null : JSON.stringify(detail),
    )
    .run();
}
