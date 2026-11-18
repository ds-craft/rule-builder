import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createD1 } from './helpers/sqlite.ts';

const room = vi.hoisted(() => ({ fetch: vi.fn(), publicView: vi.fn() }));
const getServerByName = vi.hoisted(() => vi.fn(async () => room));
vi.mock('partyserver', () => ({ getServerByName }));

const { createApp } = await import('../src/app.ts');
const { writeSession } = await import('../src/auth/session.ts');
const { decodeUser, USER_HEADER } = await import('../src/room/user.ts');

const APP = 'https://builder.ds2.uk';
const API = 'https://api.builder.ds2.uk';
const UNEI = '100000000000000001';
const ID = '6f1c1e0a-2b3c-4d5e-8f90-0a1b2c3d4e5f';

function setup() {
  const db = createD1();
  const env = {
    DB: db,
    OPSBOT: { getMemberStatus: vi.fn() },
    ProposalRoom: {},
    APP_ORIGIN: APP,
    API_ORIGIN: API,
    DISCORD_CLIENT_ID: 'client',
    DISCORD_CLIENT_SECRET: 'secret',
    SESSION_SECRET: 'test-session-secret',
    ALLOW_DEV_LOGIN: '',
  };
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} };
  const app = createApp();
  const request = (path: string, init: RequestInit = {}) =>
    app.request(`${API}${path}`, init, env as unknown as Env, ctx as unknown as ExecutionContext);
  return { env, db, request };
}

/** 運営者のセッションの Cookie を作る */
async function sessionCookie(env: ReturnType<typeof setup>['env']) {
  const { Hono } = await import('hono');
  const app = new Hono<{ Bindings: Env }>();
  app.get('/', async (c) => {
    const now = Date.now();
    await writeSession(
      c as never,
      {
        v: 1,
        lid: UNEI,
        uid: UNEI,
        name: '運営の人',
        avatar: null,
        role: 'unei',
        onLeave: false,
        iat: now,
        chk: now,
      },
      now,
    );
    return c.body(null);
  });
  const res = await app.request('/', {}, env as unknown as Env);
  return res.headers.getSetCookie()[0]!.split(';')[0]!;
}

describe('運営の改正案の一覧（GET /proposals）', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
    room.fetch.mockReset();
  });

  it('ログインしていなければ 401', async () => {
    expect((await t.request('/proposals')).status).toBe(401);
  });

  it('更新日時の新しい順に、編集者名つきで返す', async () => {
    t.db.raw.exec(`
      INSERT INTO users (id, display_name, avatar_url, last_login_at) VALUES ('${UNEI}', '運営の人', 'https://a/x.png', '2026-11-01');
      INSERT INTO proposals (id, amending_kind, amending_year, amending_number, enforcement_date, rules, created_at, created_by, updated_at, updated_by)
        VALUES ('a', 'ルール', 8, 4, '2026-12-01', '[{"name":"基本ルール","op":"amend"}]', '2026-11-01', '${UNEI}', '2026-11-02', '${UNEI}'),
               ('b', 'ルール', 8, 5, '', '[]', '2026-11-01', '${UNEI}', '2026-11-03', '${UNEI}');
    `);
    const res = await t.request('/proposals', { headers: { cookie: await sessionCookie(t.env) } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { proposals: { id: string }[] };
    expect(body.proposals.map((p) => p.id)).toEqual(['b', 'a']);
    expect(body.proposals[1]).toEqual({
      id: 'a',
      amendingNumber: { kind: 'ルール', year: 8, number: 4 },
      enforcementDate: '2026-12-01',
      rules: [{ name: '基本ルール', op: 'amend' }],
      status: 'draft',
      createdAt: '2026-11-01',
      createdBy: { id: UNEI, name: '運営の人' },
      updatedAt: '2026-11-02',
      updatedBy: { id: UNEI, name: '運営の人', avatarUrl: 'https://a/x.png' },
    });
  });

  it('知らない状態での絞り込みは断る', async () => {
    const res = await t.request('/proposals?status=x', {
      headers: { cookie: await sessionCookie(t.env) },
    });
    expect(res.status).toBe(400);
  });
});

describe('改正案の同期（GET /proposals/:id/sync）', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
    room.fetch.mockReset();
    room.fetch.mockResolvedValue(new Response('upgraded', { status: 200 }));
  });

  const ws = (cookie?: string, extra: Record<string, string> = {}) => ({
    headers: { upgrade: 'websocket', origin: APP, ...(cookie ? { cookie } : {}), ...extra },
  });

  it('ログインしていなければ部屋に通さない', async () => {
    const res = await t.request(`/proposals/${ID}/sync`, ws());
    expect(res.status).toBe(401);
    expect(room.fetch).not.toHaveBeenCalled();
  });

  it('運営者なら、確かめた本人を付けて部屋に渡す（画面から届いた同名のヘッダーは上書きする）', async () => {
    const cookie = await sessionCookie(t.env);
    const forged = encodeURIComponent(
      JSON.stringify({ uid: 'x', name: 'なりすまし', chk: Date.now() }),
    );
    await t.request(`/proposals/${ID}/sync`, ws(cookie, { [USER_HEADER]: forged }));
    expect(getServerByName).toHaveBeenCalledWith(t.env.ProposalRoom, ID);
    const req = room.fetch.mock.calls[0]![0] as Request;
    expect(decodeUser(req.headers.get(USER_HEADER))).toMatchObject({
      uid: UNEI,
      name: '運営の人',
      readOnly: false,
    });
  });

  it('WebSocket でなければ断る', async () => {
    const res = await t.request(`/proposals/${ID}/sync`, {
      headers: { cookie: await sessionCookie(t.env) },
    });
    expect(res.status).toBe(400);
  });

  it('改正案の ID の形でなければ断る', async () => {
    const res = await t.request('/proposals/..%2F..%2Fx/sync', ws(await sessionCookie(t.env)));
    expect(res.status).toBe(400);
    expect(room.fetch).not.toHaveBeenCalled();
  });
});

describe('公開リンク（GET /public/:publicId）', () => {
  let t: ReturnType<typeof setup>;
  const PUB = 'AbCdEfGhIjKlMnOpQrStUv';
  beforeEach(() => {
    t = setup();
    room.publicView.mockReset();
    room.publicView.mockResolvedValue({ status: 'deliberation', entries: [] });
    t.db.raw.exec(`
      INSERT INTO proposals (id, status, public_id, created_at, created_by, updated_at, updated_by)
        VALUES ('${ID}', 'deliberation', '${PUB}', 'x', 'u', 'x', 'u'),
               ('draft-id', 'draft', 'DraftDraftDraftDraftDr', 'x', 'u', 'x', 'u');
    `);
  });

  it('発議済みの改正案はログインなしで見られる（noindex・短いキャッシュ）', async () => {
    const res = await t.request(`/public/${PUB}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(getServerByName).toHaveBeenCalledWith(t.env.ProposalRoom, ID);
  });

  it('下書きは公開リンクがあっても見られない', async () => {
    const res = await t.request('/public/DraftDraftDraftDraftDr');
    expect(res.status).toBe(404);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('改正案 ID や推測した ID では見られない', async () => {
    expect((await t.request(`/public/${ID}`)).status).toBe(404);
    expect((await t.request('/public/AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
    expect(room.publicView).not.toHaveBeenCalled();
  });
});
