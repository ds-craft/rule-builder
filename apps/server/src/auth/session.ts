// セッション（F-40）：署名付き Cookie（HttpOnly・Secure・SameSite=Lax、ログインから7日）。
// 中身はユーザー ID・権限・判定時刻。判定から15分を過ぎたら、次の API 呼び出しか WebSocket 接続のときに
// OpsBot に問い合わせて判定をやり直す（middleware.ts）。
// 手元（http://localhost）でもブラウザは Secure の Cookie を受け付けるので、常に Secure を付ける。

import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { AppEnv } from '../types.ts';

export const SESSION_COOKIE = 'rb_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 運営者かどうかの判定をやり直すまでの時間 */
export const RECHECK_MS = 15 * 60 * 1000;

export type Session = {
  v: 1;
  /** ログインに使った Discord ユーザー ID（サブ垢ならサブ垢の ID。判定のやり直しはこの ID で行う） */
  lid: string;
  /** 本人の ID（サブ垢ならメイン垢の ID）。編集者として記録する ID */
  uid: string;
  name: string;
  avatar: string | null;
  role: 'unei';
  onLeave: boolean;
  /** ログインした時刻（ms）。ここから7日で切れる */
  iat: number;
  /** 運営者かどうかを判定した時刻（ms） */
  chk: number;
};

type AnyContext = Context<AppEnv>;

const SNOWFLAKE = /^\d{17,20}$/;

function parseSession(text: string | false | undefined, now: number): Session | null {
  if (!text) return null;
  try {
    const s = JSON.parse(text) as Partial<Session>;
    if (s.v !== 1 || s.role !== 'unei') return null;
    if (typeof s.lid !== 'string' || !SNOWFLAKE.test(s.lid)) return null;
    if (typeof s.uid !== 'string' || !SNOWFLAKE.test(s.uid)) return null;
    if (typeof s.iat !== 'number' || typeof s.chk !== 'number') return null;
    if (now - s.iat >= SESSION_TTL_MS || s.iat > now + 60_000) return null;
    return {
      v: 1,
      lid: s.lid,
      uid: s.uid,
      name: String(s.name ?? ''),
      avatar: typeof s.avatar === 'string' ? s.avatar : null,
      role: 'unei',
      onLeave: s.onLeave === true,
      iat: s.iat,
      chk: s.chk,
    };
  } catch {
    return null;
  }
}

/** 署名を確かめて読む。署名が合わない・期限切れなら null */
export async function readSession(c: AnyContext, now = Date.now()): Promise<Session | null> {
  const text = await getSignedCookie(c, c.env.SESSION_SECRET, SESSION_COOKIE);
  return parseSession(text, now);
}

export async function writeSession(c: AnyContext, s: Session, now = Date.now()) {
  const maxAge = Math.max(0, Math.floor((s.iat + SESSION_TTL_MS - now) / 1000));
  await setSignedCookie(c, SESSION_COOKIE, JSON.stringify(s), c.env.SESSION_SECRET, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge,
  });
}

export function clearSession(c: AnyContext) {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
}
