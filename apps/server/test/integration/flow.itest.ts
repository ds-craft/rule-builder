// 結合テスト：発議から反映まで（手順書 10-9 の完了条件のうち、手元で確かめられる部分）。
// wrangler dev の上で、本物の Durable Object・D1 に、模擬の OpsBot（OPSBOT_PROPOSALS=sim）と
// メモリ上の GitHub（setup.ts）をつなぐ。令和8年ルール第2号の改正を通し、できたコミットが元のコミットと一致するかを見る。
import {
  addEntry,
  bodyToPM,
  createProposalDoc,
  entryFragment,
  parseRule,
  readProposal,
  writeFragmentJSON,
} from '@rule-builder/core';
import { afterEach, describe, expect, inject, it } from 'vitest';
import YProvider from 'y-partyserver/provider';
import * as Y from 'yjs';
import { read } from '../helpers/fixtures.ts';

const API = inject('apiOrigin');
const GITHUB = inject('githubOrigin');
const APP = 'http://localhost:5173';
const A = '100000000000000001';
const BEFORE = read('commits', 'R0801002-before-R0701001.md');
const AFTER = read('commits', 'R0801002-after-R0701001.md');
const MESSAGE = read('commits', 'R0801002-message.txt').trimEnd() + '\n';

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

function socketWith(headers: Record<string, string>): typeof WebSocket {
  return class extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, { protocols, headers } as unknown as string[]);
    }
  };
}

function connect(id: string, doc: Y.Doc, cookie: string) {
  const p = new YProvider(new URL(API).host, id, doc, {
    prefix: `/proposals/${id}/sync`,
    WebSocketPolyfill: socketWith({ origin: APP, cookie }),
    disableBc: true,
    maxBackoffTime: 500,
  });
  providers.push(p);
  return p;
}

const until = async (f: () => boolean | Promise<boolean>, ms = 20_000) => {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error('時間内に条件が満たされませんでした');
    await new Promise((r) => setTimeout(r, 200));
  }
};

/** 令和8年ルール第2号の改正（基本ルールの一部を改正するルール）を、改正前の版から作る */
function newProposal() {
  const id = crypto.randomUUID();
  const doc = createProposalDoc({
    id,
    amendingNumber: { kind: 'ルール', year: 8, number: 2 },
    enforcementDate: '2026-07-28',
    summary: '運営の短縮投票に関する基本ルール改正',
  });
  const entryId = addEntry(doc, {
    op: 'amend',
    ruleId: 'R0701001',
    baseSha: 'base',
    baseMarkdown: BEFORE,
  });
  // 改正前の本文を消してから、改正後の本文を書く（writeFragmentJSON は書き足す）
  const frag = entryFragment(doc, entryId);
  doc.transact(() => {
    frag.delete(0, frag.length);
    writeFragmentJSON(frag, bodyToPM(parseRule(AFTER).doc.body, { baseKeys: true }));
  });
  return { id, doc };
}

async function api(cookie: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, origin: APP, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('発議から反映まで（模擬の OpsBot・メモリ上の GitHub）', () => {
  it('令和8年ルール第2号：反映のコミットが元のコミットと内容・作者・日時・トレーラーとも一致する', async () => {
    const cookie = await devLogin(A);
    const { id, doc } = newProposal();
    const provider = connect(id, doc, cookie);
    const messages: string[] = [];
    provider.on('custom-message', (m: string) => messages.push(m));
    await until(() => provider.synced);

    // 中身が届くと D1 の一覧に載る（発議はサーバーに保存された改正案だけ）
    await until(async () => {
      const r = await api(cookie, '/proposals');
      return (r.body.proposals as { id: string }[]).some((p) => p.id === id);
    });

    const submitted = await api(cookie, `/proposals/${id}/flow/submit`, { refsRemaining: 0 });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body).toMatchObject({
      status: 'unei_discussion',
      locked: false,
      simulated: true,
    });
    await until(() => messages.some((m) => m.includes('"unei_discussion"')));

    // 公開リンクはログインなしで見られる
    const publicId = String(submitted.body.publicUrl).split('/').pop()!;
    const pub = await fetch(`${API}/public/${publicId}`);
    expect(pub.status).toBe(200);
    expect(pub.headers.get('x-robots-tag')).toBe('noindex');
    expect(await pub.json()).toMatchObject({
      status: 'unei_discussion',
      title: '基本ルールの一部を改正するルール',
    });

    const vote = await api(cookie, `/proposals/${id}/flow/mod-vote`, { method: 'secret' });
    expect(vote.status, JSON.stringify(vote.body)).toBe(200);
    expect(vote.body).toMatchObject({ status: 'mod_vote', locked: true });

    // 運営投票の開始後は、届いた編集をサーバーで捨てる
    const entryId = readProposal(doc).entries[0]!.entryId;
    const frag = entryFragment(doc, entryId);
    const extra = new Y.XmlElement('paragraph');
    extra.insert(0, [new Y.XmlText('固定のあとの入力')]);
    frag.push([extra]);
    await new Promise((r) => setTimeout(r, 1000));
    const other = new Y.Doc();
    const p2 = connect(id, other, cookie);
    await until(() => p2.synced);
    await until(() => readProposal(other).entries.length === 1);
    expect(entryFragment(other, entryId).toString()).not.toContain('固定のあとの入力');

    // Draft PR は開始直後のアラームで作る
    await until(async () => {
      const g = (await (await fetch(`${GITHUB}/__fake/main`)).json()) as {
        pulls: { head: string }[];
      };
      return g.pulls.some((p) => p.head === `proposal/${id}`);
    });

    expect(
      (await api(cookie, `/proposals/${id}/flow/sim-vote`, { passed: true })).body.status,
    ).toBe('participant_discussion');
    const disc = await api(cookie, `/proposals/${id}/flow/participant-discussion`, {
      startedAt: new Date().toISOString(),
    });
    expect(disc.status, JSON.stringify(disc.body)).toBe(200);
    // 結合テストでは参加者協議の長さを0時間にしている
    const pv = await api(cookie, `/proposals/${id}/flow/participant-vote`, {});
    expect(pv.status, JSON.stringify(pv.body)).toBe(200);
    expect(pv.body.status).toBe('participant_vote');

    const passed = await api(cookie, `/proposals/${id}/flow/sim-vote`, { passed: true });
    expect(passed.status, JSON.stringify(passed.body)).toBe(200);
    expect(passed.body).toMatchObject({ status: 'enacted' });

    const g = (await (await fetch(`${GITHUB}/__fake/main`)).json()) as {
      head: { message: string; author: unknown; committer: unknown };
      files: Record<string, string>;
    };
    expect(g.head.message).toBe(MESSAGE);
    expect(g.head.author).toEqual({
      name: '令和8年ルール第2号',
      email: '',
      date: '2026-07-28T00:00:00+09:00',
    });
    expect(g.head.committer).toEqual(g.head.author);
    expect(g.files['rules/R0701001.md']).toBe(AFTER);

    const list = await api(cookie, '/proposals?status=enacted');
    expect(list.body.proposals).toEqual(
      expect.arrayContaining([expect.objectContaining({ id, finalNumber: '令和8年ルール第2号' })]),
    );
  });

  it('下書きの改正案や推測した ID では公開リンクを見られない', async () => {
    expect((await fetch(`${API}/public/AAAAAAAAAAAAAAAAAAAAAA`)).status).toBe(404);
  });
});
