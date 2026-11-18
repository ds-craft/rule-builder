// 結合テスト：2人の運営者が同じ改正案を同時に編集する（F-41〜F-43）。wrangler dev の上で、本物の
// Durable Object・D1・Service Binding（OpsBot の代わり）を通す。
import {
  addEntry,
  createProposalDoc,
  entryFragment,
  readProposal,
  readProposalMeta,
  updateProposalMeta,
} from '@rule-builder/core';
import { afterEach, describe, expect, inject, it } from 'vitest';
import YProvider from 'y-partyserver/provider';
import * as Y from 'yjs';

const API = inject('apiOrigin');
const APP = 'http://localhost:5173';
const A = '100000000000000001';
const B = '100000000000000002';

const providers: YProvider[] = [];
afterEach(() => {
  for (const p of providers.splice(0)) p.destroy();
});

async function devLogin(uid: string): Promise<string> {
  const res = await fetch(`${API}/auth/dev-login?uid=${uid}`, { redirect: 'manual' });
  expect(res.status).toBe(302);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

/** Cookie と Origin を付ける WebSocket（ブラウザと同じ形で接続する） */
function socketWith(headers: Record<string, string>): typeof WebSocket {
  return class extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      // node（undici）の WebSocket はヘッダーを指定できる
      super(url, { protocols, headers } as unknown as string[]);
    }
  };
}

function connect(id: string, doc: Y.Doc, cookie: string | null, origin = APP) {
  const headers: Record<string, string> = { origin };
  if (cookie) headers.cookie = cookie;
  const p = new YProvider(new URL(API).host, id, doc, {
    prefix: `/proposals/${id}/sync`,
    WebSocketPolyfill: socketWith(headers),
    disableBc: true,
    maxBackoffTime: 500,
  });
  providers.push(p);
  return p;
}

const until = async (f: () => boolean | Promise<boolean>, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error('時間内に条件が満たされませんでした');
    await new Promise((r) => setTimeout(r, 100));
  }
};

const synced = (p: YProvider) => until(() => p.synced);

function newProposal() {
  const id = crypto.randomUUID();
  const doc = createProposalDoc({
    id,
    amendingNumber: { kind: 'ルール', year: 8, number: 9 },
    enforcementDate: '2026-12-01',
  });
  addEntry(doc, {
    op: 'create',
    doc: {
      meta: {
        kind: 'ルール',
        year: 8,
        number: 9,
        name: '結合テストのルール',
        enforcementDate: '令和8年12月1日',
        order: null,
        extra: {},
      },
      body: [],
    },
  });
  return { id, doc };
}

/** 本文の断片に段落を足す（エディタの入力の代わり） */
function appendText(doc: Y.Doc, text: string) {
  const entryId = readProposal(doc).entries[0]!.entryId;
  const frag = entryFragment(doc, entryId);
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(text)]);
  frag.push([p]);
}

const bodyText = (doc: Y.Doc) => {
  const entryId = readProposal(doc).entries[0]!.entryId;
  return entryFragment(doc, entryId).toString();
};

describe('改正案の同期', () => {
  it('2人が同じ改正案を開き、同時に入力しても内容が失われない', async () => {
    const [ca, cb] = await Promise.all([devLogin(A), devLogin(B)]);
    const { id, doc: da } = newProposal();
    const pa = connect(id, da, ca);
    await synced(pa);

    const db = new Y.Doc();
    const pb = connect(id, db, cb);
    await synced(pb);
    await until(() => readProposalMeta(db).id === id);
    expect(readProposal(db).entries[0]).toMatchObject({ op: 'create' });

    // 同時に入力する
    appendText(da, 'Aの入力');
    appendText(db, 'Bの入力');
    updateProposalMeta(da, { summary: 'Aの説明' });
    updateProposalMeta(db, { enforcementDate: '2027-01-01' });
    await until(
      () =>
        bodyText(da) === bodyText(db) &&
        bodyText(da).includes('Aの入力') &&
        bodyText(da).includes('Bの入力'),
    );
    await until(
      () =>
        readProposalMeta(db).summary === 'Aの説明' &&
        readProposalMeta(da).enforcementDate === '2027-01-01',
    );
  });

  it('互いのカーソル（awareness）が見える', async () => {
    const [ca, cb] = await Promise.all([devLogin(A), devLogin(B)]);
    const { id, doc: da } = newProposal();
    const pa = connect(id, da, ca);
    const pb = connect(id, new Y.Doc(), cb);
    await Promise.all([synced(pa), synced(pb)]);
    pa.awareness.setLocalStateField('user', { name: 'Aさん', color: '#c00' });
    await until(() =>
      [...pb.awareness.getStates().values()].some(
        (s) => (s.user as { name?: string } | undefined)?.name === 'Aさん',
      ),
    );
  });

  it('全員が閉じても内容が残り、あとから開いた人に届く。一覧も更新される', async () => {
    const ca = await devLogin(A);
    const { id, doc: da } = newProposal();
    const pa = connect(id, da, ca);
    await synced(pa);
    appendText(da, '残る入力');
    // 一覧（D1）は少し待ってから更新される
    await until(async () => {
      const res = await fetch(`${API}/proposals`, { headers: { cookie: ca } });
      const body = (await res.json()) as {
        proposals: { id: string; rules: unknown; updatedBy: { id: string } }[];
      };
      const row = body.proposals.find((p) => p.id === id);
      return row !== undefined && row.updatedBy.id === A;
    }, 20_000);
    pa.destroy();

    const cb = await devLogin(B);
    const later = new Y.Doc();
    const pb = connect(id, later, cb);
    await synced(pb);
    await until(() => readProposalMeta(later).id === id && bodyText(later).includes('残る入力'));
  });

  it('つながっていない間の編集は、つなぎ直すと合わさる', async () => {
    const [ca, cb] = await Promise.all([devLogin(A), devLogin(B)]);
    const { id, doc: da } = newProposal();
    const pa = connect(id, da, ca);
    const db = new Y.Doc();
    const pb = connect(id, db, cb);
    await Promise.all([synced(pa), synced(pb)]);
    await until(() => readProposalMeta(db).id === id);

    pb.disconnect();
    appendText(db, 'オフライン中の入力');
    appendText(da, 'その間のAの入力');
    await new Promise((r) => setTimeout(r, 300));
    expect(bodyText(da)).not.toContain('オフライン中の入力');

    pb.connect();
    await until(
      () =>
        bodyText(da) === bodyText(db) &&
        bodyText(da).includes('オフライン中の入力') &&
        bodyText(db).includes('その間のAの入力'),
    );
  });

  it('ログインしていない・他のサイトからの接続は通さない', async () => {
    const ca = await devLogin(A);
    const { id } = newProposal();
    const errors: string[] = [];
    const watch = (p: YProvider, label: string) =>
      p.on('connection-error', () => errors.push(label));
    const noLogin = connect(id, new Y.Doc(), null);
    watch(noLogin, 'no-login');
    const otherSite = connect(id, new Y.Doc(), ca, 'https://evil.example');
    watch(otherSite, 'other-site');
    await until(() => errors.includes('no-login') && errors.includes('other-site'));
    expect(noLogin.synced).toBe(false);
    expect(otherSite.synced).toBe(false);
  });
});
