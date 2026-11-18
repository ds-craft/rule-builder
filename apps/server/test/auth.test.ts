import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberStatus } from '../src/opsbot/types.ts';
import { createD1 } from './helpers/sqlite.ts';

// partyserver は cloudflare:workers を読み込むため、node では差し替える
const room = vi.hoisted(() => ({ fetch: vi.fn(), publicView: vi.fn() }));
vi.mock('partyserver', () => ({ getServerByName: vi.fn(async () => room) }));

const { createApp } = await import('../src/app.ts');
const { RECHECK_MS, SESSION_TTL_MS } = await import('../src/auth/session.ts');

const APP = 'https://builder.ds2.uk';
const API = 'https://api.builder.ds2.uk';
const UNEI = '100000000000000001';
const SUB = '100000000000000002';
const OTHER = '100000000000000003';

type Members = Record<string, MemberStatus>;

function setup() {
  const members: Members = {
    [UNEI]: status(UNEI, true),
    [SUB]: { ...status(UNEI, true), viaSubaccount: true },
    [OTHER]: status(OTHER, false),
  };
  const opsbot = {
    getMemberStatus: vi.fn(async (id: string) => {
      const m = members[id];
      if (!m) throw new Error('unknown');
      return m;
    }),
  };
  const db = createD1();
  const env = {
    DB: db,
    OPSBOT: opsbot,
    ProposalRoom: {},
    APP_ORIGIN: APP,
    API_ORIGIN: API,
    DISCORD_CLIENT_ID: 'client',
    DISCORD_CLIENT_SECRET: 'secret',
    SESSION_SECRET: 'test-session-secret',
    ALLOW_DEV_LOGIN: '',
  };
  const waits: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => waits.push(p),
    passThroughOnException() {},
    props: {},
  };
  const app = createApp();
  const request = (path: string, init: RequestInit = {}) =>
    app.request(`${API}${path}`, init, env as unknown as Env, ctx as unknown as ExecutionContext);
  return { env, db, opsbot, members, request, waits };
}

function status(userId: string, isUnei: boolean): MemberStatus {
  return {
    isUnei,
    onLeave: false,
    userId,
    viaSubaccount: false,
    displayName: isUnei ? '運営の人' : '参加者',
    avatarUrl: null,
  };
}

/** Set-Cookie から Cookie ヘッダーの値を作る */
function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

function cookieAttrs(res: Response, name: string): string {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? '';
}

/** Discord の OAuth の応答を差し替える */
function mockDiscord(userId: string) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.endsWith('/api/oauth2/token')) return Response.json({ access_token: 'tok' });
    if (url.endsWith('/api/users/@me')) return Response.json({ id: userId });
    if (url.endsWith('/api/oauth2/token/revoke')) return new Response(null, { status: 200 });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

/** Discord でログインまで通し、Cookie を返す */
async function login(t: ReturnType<typeof setup>, userId = UNEI, ret = '/file/open') {
  const start = await t.request(`/auth/login?return=${encodeURIComponent(ret)}`);
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const discord = mockDiscord(userId);
  try {
    const res = await t.request(`/auth/callback?code=abc&state=${state}`, {
      headers: { cookie: cookiesFrom(start) },
    });
    return { res, cookie: cookiesFrom(res), discord };
  } finally {
    discord.restore();
  }
}

describe('ログイン（/auth/login → /auth/callback）', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('Discord の認可画面へ、identify だけ・state 付きで送る', async () => {
    const res = await t.request('/auth/login');
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get('location')!);
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(url.searchParams.get('scope')).toBe('identify');
    expect(url.searchParams.get('redirect_uri')).toBe(`${API}/auth/callback`);
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const attrs = cookieAttrs(res, 'rb_oauth');
    expect(attrs).toMatch(/HttpOnly/i);
    expect(attrs).toMatch(/Secure/i);
    expect(attrs).toMatch(/SameSite=Lax/i);
  });

  it('運営者ならセッションを作り、元の画面に戻す', async () => {
    const { res, discord } = await login(t, UNEI, '/file/open');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${APP}/#/file/open`);
    const attrs = cookieAttrs(res, 'rb_session');
    expect(attrs).toMatch(/HttpOnly/i);
    expect(attrs).toMatch(/Secure/i);
    expect(attrs).toMatch(/SameSite=Lax/i);
    expect(attrs).toMatch(/Max-Age=604800/);
    expect(t.opsbot.getMemberStatus).toHaveBeenCalledWith(UNEI);
    expect(discord.calls.some((u) => u.endsWith('/token/revoke'))).toBe(true);
    const user = t.db.raw.prepare('SELECT * FROM users').get() as Record<string, unknown>;
    expect(user).toMatchObject({ id: UNEI, display_name: '運営の人' });
    const log = t.db.raw.prepare('SELECT actor, action FROM audit_log').all();
    expect(log).toEqual([{ actor: UNEI, action: 'login' }]);
  });

  it('運営者でなければ断り、セッションを作らない', async () => {
    const { res } = await login(t, OTHER);
    expect(res.headers.get('location')).toBe(`${APP}/#/file/home?login=denied`);
    expect(cookieAttrs(res, 'rb_session')).toMatch(/Max-Age=0/);
  });

  it('サブ垢でログインしたらメイン垢として扱う', async () => {
    const { cookie } = await login(t, SUB);
    const me = await t.request('/auth/me', { headers: { cookie } });
    expect(await me.json()).toMatchObject({ id: UNEI });
  });

  it('state が合わなければ断る', async () => {
    const start = await t.request('/auth/login');
    const res = await t.request('/auth/callback?code=abc&state=wrong', {
      headers: { cookie: cookiesFrom(start) },
    });
    expect(res.headers.get('location')).toBe(`${APP}/#/file/home?login=error`);
    expect(t.opsbot.getMemberStatus).not.toHaveBeenCalled();
  });

  it('state の Cookie がなければ断る', async () => {
    const res = await t.request('/auth/callback?code=abc&state=x');
    expect(res.headers.get('location')).toBe(`${APP}/#/file/home?login=error`);
  });

  it('Discord の画面で取り消したら、その旨を画面に戻す', async () => {
    const start = await t.request('/auth/login');
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const res = await t.request(`/auth/callback?error=access_denied&state=${state}`, {
      headers: { cookie: cookiesFrom(start) },
    });
    expect(res.headers.get('location')).toBe(`${APP}/#/file/home?login=cancelled`);
  });

  it('OpsBot に問い合わせられなければ断る', async () => {
    t.opsbot.getMemberStatus.mockRejectedValueOnce(new Error('down'));
    const { res } = await login(t, UNEI);
    expect(res.headers.get('location')).toBe(`${APP}/#/file/home?login=error`);
    expect(cookieAttrs(res, 'rb_session')).toBe('');
  });

  it('戻り先は画面の中の場所だけにする', async () => {
    for (const bad of ['//evil.example', 'https://evil.example', '/file/home"><script>']) {
      const { res } = await login(t, UNEI, bad);
      expect(res.headers.get('location')).toBe(`${APP}/#/file/home`);
    }
  });

  it('開発用のログインは本番の設定では使えない', async () => {
    t.env.ALLOW_DEV_LOGIN = 'true';
    const res = await t.request(`/auth/dev-login?uid=${UNEI}`);
    expect(res.status).toBe(404);
  });
});

describe('セッション（/auth/me・判定のやり直し）', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('ログインしていなければ 401', async () => {
    const res = await t.request('/auth/me');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'unauthenticated' });
  });

  it('署名が合わない Cookie は使えない', async () => {
    const { cookie } = await login(t);
    const forged = cookie.replace(
      /rb_session=([^;]*)/,
      (_, v: string) => `rb_session=${v.slice(0, -4)}AAAA`,
    );
    expect((await t.request('/auth/me', { headers: { cookie: forged } })).status).toBe(401);
  });

  it('15分以内は OpsBot に問い合わせない', async () => {
    const { cookie } = await login(t);
    t.opsbot.getMemberStatus.mockClear();
    vi.setSystemTime(Date.now() + RECHECK_MS - 1000);
    const res = await t.request('/auth/me', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: UNEI,
      name: '運営の人',
      avatarUrl: null,
      onLeave: false,
    });
    expect(t.opsbot.getMemberStatus).not.toHaveBeenCalled();
  });

  it('15分を過ぎたら判定をやり直し、Cookie を更新する', async () => {
    const { cookie } = await login(t);
    t.opsbot.getMemberStatus.mockClear();
    vi.setSystemTime(Date.now() + RECHECK_MS);
    const res = await t.request('/auth/me', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(t.opsbot.getMemberStatus).toHaveBeenCalledWith(UNEI);
    const next = cookiesFrom(res);
    expect(next).toMatch(/^rb_session=/);
    // 更新した Cookie なら、続けて15分は問い合わせない
    t.opsbot.getMemberStatus.mockClear();
    await t.request('/auth/me', { headers: { cookie: next } });
    expect(t.opsbot.getMemberStatus).not.toHaveBeenCalled();
  });

  it('運営ロールを外されていたらログアウトさせる', async () => {
    const { cookie } = await login(t);
    t.members[UNEI] = status(UNEI, false);
    vi.setSystemTime(Date.now() + RECHECK_MS);
    const res = await t.request('/auth/me', { headers: { cookie } });
    expect(res.status).toBe(403);
    expect(cookieAttrs(res, 'rb_session')).toMatch(/Max-Age=0/);
  });

  it('判定をやり直せないときは通さない（fail closed）', async () => {
    const { cookie } = await login(t);
    t.opsbot.getMemberStatus.mockRejectedValue(new Error('down'));
    vi.setSystemTime(Date.now() + RECHECK_MS);
    const res = await t.request('/auth/me', { headers: { cookie } });
    expect(res.status).toBe(503);
  });

  it('ログインから7日で切れる', async () => {
    const { cookie } = await login(t);
    vi.setSystemTime(Date.now() + SESSION_TTL_MS);
    expect((await t.request('/auth/me', { headers: { cookie } })).status).toBe(401);
  });

  it('ログアウトで Cookie を消す', async () => {
    const { cookie } = await login(t);
    const res = await t.request('/auth/logout', {
      method: 'POST',
      headers: { cookie, origin: APP },
    });
    expect(res.status).toBe(204);
    expect(cookieAttrs(res, 'rb_session')).toMatch(/Max-Age=0/);
  });
});

describe('Origin の確認（CSRF 対策）と CORS', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('状態を変える API は、画面以外の Origin からは断る', async () => {
    const { cookie } = await login(t);
    for (const origin of [null, 'https://evil.example']) {
      const headers: Record<string, string> = { cookie };
      if (origin) headers.origin = origin;
      const res = await t.request('/auth/logout', { method: 'POST', headers });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'bad_origin' });
    }
  });

  it('WebSocket の接続も、画面以外の Origin からは断る', async () => {
    const { cookie } = await login(t);
    const res = await t.request('/proposals/00000000-0000-4000-8000-000000000000/sync', {
      headers: { cookie, upgrade: 'websocket', origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
    expect(room.fetch).not.toHaveBeenCalled();
  });

  it('画面からの呼び出しには Cookie つきの CORS を返す', async () => {
    const res = await t.request('/auth/me', { headers: { origin: APP } });
    expect(res.headers.get('access-control-allow-origin')).toBe(APP);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    const other = await t.request('/auth/me', { headers: { origin: 'https://evil.example' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });
});
