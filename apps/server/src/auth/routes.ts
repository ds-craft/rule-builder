// ログイン（F-40）：/auth/login → Discord の認可画面 → /auth/callback → 画面に戻る。
// state は署名付き Cookie で照合する。運営者でなければログインを断る（閲覧はログイン不要の公開リンクで行う）。

import { Hono, type Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { apiError } from '../http/errors.ts';
import { opsbot } from '../opsbot/client.ts';
import type { MemberStatus } from '../opsbot/types.ts';
import type { AppEnv } from '../types.ts';
import { authorizeUrl, exchangeCode, fetchUserId, revokeToken } from './discord.ts';
import { audit, authenticate, saveUser, sessionFrom } from './middleware.ts';
import { clearSession, writeSession } from './session.ts';

const STATE_COOKIE = 'rb_oauth';
const STATE_TTL_S = 10 * 60;

/** ログイン後に戻る画面の場所（HashRouter の #/ 以降）。それ以外は既定の場所にする */
export function safeReturn(ret: string | undefined): string {
  if (!ret || ret.length > 200) return '/file/home';
  if (!/^\/[A-Za-z0-9/_\-.?=&%]*$/.test(ret) || ret.startsWith('//')) return '/file/home';
  return ret;
}

const appUrl = (env: Env, path: string) => `${env.APP_ORIGIN}/#${path}`;

/** ログインの結果を画面に知らせる（#/file/home?login=denied など） */
const loginResult = (env: Env, result: 'denied' | 'error' | 'cancelled') =>
  appUrl(env, `/file/home?login=${result}`);

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 運営者ならセッションを作って画面に戻す。運営者でなければ断る */
async function finishLogin(c: Context<AppEnv>, lid: string, ret: string) {
  let status: MemberStatus;
  try {
    status = await opsbot(c.env).getMemberStatus(lid);
  } catch (e) {
    console.error('OpsBot に運営者の判定を問い合わせられませんでした', e);
    return c.redirect(loginResult(c.env, 'error'));
  }
  const now = Date.now();
  if (!status.isUnei) {
    clearSession(c);
    await audit(c.env, lid, 'login_denied', null, null, now);
    return c.redirect(loginResult(c.env, 'denied'));
  }
  const session = sessionFrom(lid, status, now, now);
  await writeSession(c, session, now);
  await saveUser(c.env, session, now);
  await audit(c.env, session.uid, 'login', null, status.viaSubaccount ? { via: lid } : null, now);
  return c.redirect(appUrl(c.env, ret));
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.get('/login', async (c) => {
  const state = randomState();
  const ret = safeReturn(c.req.query('return'));
  await setSignedCookie(c, STATE_COOKIE, JSON.stringify({ state, ret }), c.env.SESSION_SECRET, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/auth',
    maxAge: STATE_TTL_S,
  });
  return c.redirect(authorizeUrl(c.env, state));
});

authRoutes.get('/callback', async (c) => {
  const saved = await getSignedCookie(c, c.env.SESSION_SECRET, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/auth', secure: true, httpOnly: true, sameSite: 'Lax' });
  let expected: { state: string; ret: string } | null;
  try {
    expected = saved ? (JSON.parse(saved) as { state: string; ret: string }) : null;
  } catch {
    expected = null;
  }
  const state = c.req.query('state') ?? '';
  if (!expected || typeof expected.state !== 'string' || !timingSafeEqual(state, expected.state)) {
    return c.redirect(loginResult(c.env, 'error'));
  }
  if (c.req.query('error')) return c.redirect(loginResult(c.env, 'cancelled'));
  const code = c.req.query('code');
  if (!code) return c.redirect(loginResult(c.env, 'error'));

  let lid: string;
  try {
    const token = await exchangeCode(c.env, code);
    lid = await fetchUserId(token);
    c.executionCtx.waitUntil(revokeToken(c.env, token));
  } catch (e) {
    console.error('Discord でのログインに失敗しました', e);
    return c.redirect(loginResult(c.env, 'error'));
  }
  return finishLogin(c, lid, safeReturn(expected.ret));
});

/**
 * 開発用：Discord を通さずにログインする（E2E で2人の運営者を用意するため）。
 * ALLOW_DEV_LOGIN=true で、API_ORIGIN が localhost のときだけ使える（本番・ステージングの API_ORIGIN は https）。
 * 判定は OpsBot（手元では dev/opsbot-stub）が行う。
 * なお wrangler dev はリクエストの URL を routes のホスト名に書き換えるため、URL のホスト名では判定しない。
 */
authRoutes.get('/dev-login', async (c) => {
  const enabled =
    c.env.ALLOW_DEV_LOGIN === 'true' &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(c.env.API_ORIGIN);
  if (!enabled) return apiError('not_found', '見つかりません');
  const lid = c.req.query('uid') ?? '';
  if (!/^\d{17,20}$/.test(lid))
    return apiError('bad_request', 'uid は Discord ユーザー ID の形式で指定してください');
  return finishLogin(c, lid, safeReturn(c.req.query('return')));
});

authRoutes.get('/me', async (c) => {
  const r = await authenticate(c);
  if (!r.ok) return apiError(r.error, r.message);
  const s = r.session;
  return c.json({ id: s.uid, name: s.name, avatarUrl: s.avatar, onLeave: s.onLeave });
});

authRoutes.post('/logout', async (c) => {
  clearSession(c);
  return c.body(null, 204);
});
