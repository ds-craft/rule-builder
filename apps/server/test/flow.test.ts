// 発議・採決・自動反映の手続（flow/controller.ts）。模擬の OpsBot・メモリ上の GitHub・node:sqlite の D1 で通しで確かめる。
import { parseRule, type AmendingNumber, type Proposal } from '@rule-builder/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { FlowController, NOTIFY_AFTER_FAILURES, type FlowHost } from '../src/flow/controller.ts';
import type { FlowView } from '../src/flow/state.ts';
import { RulesRepo } from '../src/github/client.ts';
import { SimOpsBot } from '../src/opsbot/sim.ts';
import { FakeGitHub } from './helpers/fakeGitHub.ts';
import { read, remoteFiles } from './helpers/fixtures.ts';
import { createD1 } from './helpers/sqlite.ts';

const BEFORE = read('commits', 'R0801002-before-R0701001.md');
const AFTER = read('commits', 'R0801002-after-R0701001.md');
const MESSAGE = read('commits', 'R0801002-message.txt').trimEnd() + '\n';

const ID = '6f1c1e0a-2b3c-4d5e-8f90-0a1b2c3d4e5f';
const ACTOR = { uid: '100000000000000001', name: '運営の人' };
const REPO = 'ds-craft/rules-staging';

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: ID,
    amendingNumber: { kind: 'ルール', year: 8, number: 2 },
    enforcementDate: '2026-07-28',
    summary: '運営の短縮投票に関する基本ルール改正',
    status: 'draft',
    updatedAt: '',
    entries: [
      {
        entryId: 'a',
        op: 'amend',
        ruleId: 'R0701001',
        baseSha: 'base',
        baseMarkdown: BEFORE,
        doc: parseRule(AFTER).doc,
      },
    ],
    ...over,
  };
}

function setup(opts: { authors?: string[]; now?: number; p?: Proposal } = {}) {
  const db = createD1();
  db.raw.exec(`INSERT INTO proposals (id, created_at, created_by, updated_at, updated_by)
    VALUES ('${ID}', '2026-11-01', '${ACTOR.uid}', '2026-11-01', '${ACTOR.uid}')`);
  const gh = new FakeGitHub(REPO, remoteFiles(), opts.authors ?? ['令和8年ルール第1号']);
  const repo = new RulesRepo({ repo: REPO, fetch: gh.fetch, token: async () => 'token' });
  const clock = { now: opts.now ?? Date.parse('2026-11-18T12:00:00Z') };
  const rpc = new SimOpsBot(db as unknown as D1Database, 24, () => clock.now);
  const meta = new Map<string, string>();
  const t = {
    db,
    gh,
    clock,
    rpc,
    meta,
    p: opts.p ?? proposal(),
    broadcasts: [] as FlowView[],
    renumbered: [] as AmendingNumber[],
    flow: null as unknown as FlowController,
  };
  const host: FlowHost = {
    id: ID,
    appOrigin: 'https://staging.builder.ds2.uk',
    portalOrigin: 'https://www.ds2.uk',
    db: db as unknown as D1Database,
    rpc,
    repo,
    now: () => clock.now,
    getMeta: (k) => meta.get(k) ?? null,
    setMeta: (k, v) => void meta.set(k, v),
    readProposal: () => t.p,
    renumberDocument: (next) => void t.renumbered.push(next),
    broadcast: (v) => void t.broadcasts.push(v),
    randomId: () => 'abcdefghijklmnopqrstuv',
  };
  // ProposalRoom と同じく、呼ぶたびに作り直す（状態は room_meta から読む）
  Object.defineProperty(t, 'flow', { get: () => new FlowController(host) });
  return t;
}

type T = ReturnType<typeof setup>;

const HOUR = 3_600_000;

/** 発議 → 運営投票（可決）→ 参加者協議 → 24時間 → 参加者投票（可決）まで進める */
async function toPassed(t: T) {
  expect((await t.flow.submit(ACTOR, 0)).ok).toBe(true);
  expect((await t.flow.startModVote(ACTOR, 'secret', false)).ok).toBe(true);
  await t.flow.tick(); // 開始直後のアラーム（Draft PR を作る）
  expect((await t.flow.simDecide(ACTOR, true)).ok).toBe(true);
  expect(
    (await t.flow.recordParticipantDiscussion(ACTOR, new Date(t.clock.now).toISOString())).ok,
  ).toBe(true);
  t.clock.now += 24 * HOUR + 1000;
  expect((await t.flow.startParticipantVote(ACTOR)).ok).toBe(true);
  return t.flow.simDecide(ACTOR, true);
}

describe('発議（F-50・F-51）', () => {
  let t: T;
  beforeEach(() => {
    t = setup();
  });

  it('発議前の確認を満たさなければ、項目つきで断る', async () => {
    t.p = proposal({ enforcementDate: '' });
    const r = await t.flow.submit(ACTOR, 2);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('bad_request');
    const failed = r.checks!.filter((c) => !c.ok).map((c) => c.key);
    expect(failed).toEqual(['enforcement', 'refs']);
    expect(t.flow.status()).toBe('draft');
  });

  it('元にした版のあとで公開中のルールが変わっていたら発議できない', async () => {
    t.gh.pushManual({ 'rules/R0701001.md': BEFORE + '\n追記\n' });
    const r = await t.flow.submit(ACTOR, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.checks!.find((c) => c.key === 'base')!.ok).toBe(false);
  });

  it('発議すると運営内協議になり、公開リンクを発行する（編集はできるまま）', async () => {
    const r = await t.flow.submit(ACTOR, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view).toMatchObject({
      status: 'unei_discussion',
      locked: false,
      title: '基本ルールの一部を改正するルール',
      publicUrl: 'https://staging.builder.ds2.uk/#/public/abcdefghijklmnopqrstuv',
      simulated: true,
    });
    const row = t.db.raw
      .prepare('SELECT status, public_id, title FROM proposals WHERE id = ?')
      .get(ID);
    expect(row).toMatchObject({ status: 'unei_discussion', public_id: 'abcdefghijklmnopqrstuv' });
    expect(t.broadcasts.at(-1)?.status).toBe('unei_discussion');
  });
});

describe('運営投票（F-52）', () => {
  let t: T;
  beforeEach(async () => {
    t = setup();
    await t.flow.submit(ACTOR, 0);
  });

  it('短縮投票は全運営者の同意の確認がなければ断る', async () => {
    const r = await t.flow.startModVote(ACTOR, 'quick', false);
    expect(r.ok).toBe(false);
    expect(t.flow.locked()).toBe(false);
  });

  it('開始すると内容を固定して読み取り専用にし、次の機会に Draft PR を作る', async () => {
    const r = await t.flow.startModVote(ACTOR, 'secret', false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.status).toBe('mod_vote');
    expect(r.view.locked).toBe(true);
    expect(r.view.frozen?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(r.view.opsbot?.contentHash).toBe(r.view.frozen?.contentHash);

    await t.flow.tick();
    const pr = t.gh.pulls[0]!;
    expect(pr).toMatchObject({ head: `proposal/${ID}`, draft: true, state: 'open' });
    expect(pr.body).toContain('```diff');
    expect(pr.body).toContain('マージしないでください');
    expect(t.gh.files(t.gh.refs.get(`proposal/${ID}`)!).get('rules/R0701001.md')).toBe(AFTER);
    // main はまだ変えない
    expect(t.gh.mainFiles().get('rules/R0701001.md')).toBe(BEFORE);
  });

  it('OpsBot が投票を始められなければ、固定を解いて運営内協議に戻す', async () => {
    t.rpc.startModVote = async (input) => ({
      ok: false,
      code: 'vote_failed',
      message: '投票場に投稿できなかったため、投票を開始できませんでした。',
      status: await t.rpc.getProposalStatus(input.proposalId),
    });
    const r = await t.flow.startModVote(ACTOR, 'secret', false);
    expect(r).toMatchObject({ ok: false, error: 'unavailable' });
    expect(t.flow.status()).toBe('unei_discussion');
    expect(t.flow.locked()).toBe(false);
  });

  it('否決なら否決で終える（参加者には回さない）', async () => {
    await t.flow.startModVote(ACTOR, 'secret', false);
    const r = await t.flow.simDecide(ACTOR, false);
    expect(r.ok && r.view.status).toBe('rejected');
    expect(
      (await t.flow.recordParticipantDiscussion(ACTOR, new Date(t.clock.now).toISOString())).ok,
    ).toBe(false);
  });

  it('投票中は締切に合わせて OpsBot に問い合わせる', async () => {
    await t.flow.startModVote(ACTOR, 'secret', false);
    await t.flow.tick();
    const next = t.flow.nextAt!;
    expect(next).toBeGreaterThan(t.clock.now);
    expect(next - t.clock.now).toBeLessThanOrEqual(10 * 60_000);
  });
});

describe('参加者協議と参加者投票（F-53・F-54）', () => {
  let t: T;
  beforeEach(async () => {
    t = setup();
    await t.flow.submit(ACTOR, 0);
    await t.flow.startModVote(ACTOR, 'secret', false);
    await t.flow.simDecide(ACTOR, true);
  });

  it('運営投票の可決で参加者協議（開始の記録前）になり、記録するまで参加者投票を始められない', async () => {
    expect(t.flow.status()).toBe('participant_discussion');
    expect((await t.flow.startParticipantVote(ACTOR)).ok).toBe(false);
  });

  it('参加者協議の開始から24時間たつまで参加者投票を始められない', async () => {
    await t.flow.recordParticipantDiscussion(ACTOR, new Date(t.clock.now).toISOString());
    t.clock.now += 23 * HOUR;
    const r = await t.flow.startParticipantVote(ACTOR);
    expect(r).toMatchObject({ ok: false, error: 'conflict' });
    t.clock.now += HOUR + 1000;
    expect((await t.flow.startParticipantVote(ACTOR)).ok).toBe(true);
    expect(t.flow.status()).toBe('participant_vote');
  });
});

describe('取り下げ（F-59）', () => {
  it('運営投票中に取り下げると下書きに戻り、公開リンクを止め、Draft PR を閉じる', async () => {
    const t = setup();
    await t.flow.submit(ACTOR, 0);
    await t.flow.startModVote(ACTOR, 'secret', false);
    await t.flow.tick();
    expect(t.gh.pulls[0]!.state).toBe('open');

    const r = await t.flow.withdraw(ACTOR);
    expect(r.ok && r.view).toMatchObject({ status: 'draft', locked: false, publicUrl: null });
    expect(
      t.db.raw.prepare('SELECT status, public_id FROM proposals WHERE id = ?').get(ID),
    ).toMatchObject({
      status: 'draft',
      public_id: null,
    });
    t.clock.now += 60_000;
    await t.flow.tick();
    expect(t.gh.pulls[0]!.state).toBe('closed');
    expect(t.gh.refs.has(`proposal/${ID}`)).toBe(false);

    // 発議し直すと、新しい公開リンクで運営内協議から
    expect((await t.flow.submit(ACTOR, 0)).ok).toBe(true);
  });
});

describe('可決後の反映（F-56・F-57・F-58）', () => {
  it('令和8年ルール第2号：反映のコミットが元のコミットと内容・作者・日時・トレーラーとも一致する', async () => {
    const t = setup();
    const r = await toPassed(t);
    expect(r.ok && r.view.status).toBe('enacted');

    const commit = t.gh.head();
    expect(commit.message).toBe(MESSAGE);
    expect(commit.author).toEqual({
      name: '令和8年ルール第2号',
      email: '',
      date: '2026-07-28T00:00:00+09:00',
    });
    expect(commit.committer).toEqual(commit.author);
    expect(t.gh.mainFiles().get('rules/R0701001.md')).toBe(AFTER);
    // 施行日が過去なので pending/ は使わない
    expect([...t.gh.mainFiles().keys()].some((p) => p.startsWith('pending/'))).toBe(false);

    const s = await t.rpc.getProposalStatus(ID);
    expect(s).toMatchObject({ state: 'enacted', finalNumber: '令和8年ルール第2号' });
    if (r.ok) expect(r.view.reflect?.portalUrl).toBe('https://www.ds2.uk/rule/R0701001.html');
    expect(
      t.db.raw.prepare('SELECT status, final_number FROM proposals WHERE id = ?').get(ID),
    ).toMatchObject({
      status: 'enacted',
      final_number: '令和8年ルール第2号',
    });

    // Draft PR は反映後に閉じる
    t.clock.now += 60_000;
    await t.flow.tick();
    expect(t.gh.pulls[0]!.state).toBe('closed');
  });

  it('GitHub がメールの空を受け付けなければ noreply にする', async () => {
    const t = setup();
    t.gh.rejectEmptyEmail = true;
    await toPassed(t);
    expect(t.gh.head().author).toMatchObject({
      name: '令和8年ルール第2号',
      email: 'noreply@ds2.uk',
    });
  });

  it('仮番号が埋まっていれば次の空き番号を取り、文書の番号も直す', async () => {
    const t = setup({ authors: ['令和8年ルール第1号', '令和8年ルール第2号'] });
    const r = await toPassed(t);
    expect(r.ok && r.view.reflect?.finalNumber).toBe('令和8年ルール第4号'); // 第3号は rules/R0801003.md
    expect(t.renumbered).toEqual([{ kind: 'ルール', year: 8, number: 4 }]);
    expect(t.gh.head().author?.name).toBe('令和8年ルール第4号');
    expect(
      t.db.raw.prepare('SELECT number FROM amending_numbers WHERE proposal_id = ?').get(ID),
    ).toMatchObject({ number: 4 });
  });

  it('施行日が未来なら pending/ に置いて施行日の0時を待ち、0時に反映して pending/ を消す', async () => {
    const t = setup({ p: proposal({ enforcementDate: '2026-12-01' }) });
    const r = await toPassed(t);
    expect(r.ok && r.view.status).toBe('passed');
    expect(r.ok && r.view.reflect?.stage).toBe('waiting');
    const files = t.gh.mainFiles();
    const info = JSON.parse(files.get('pending/R0801002/pending.json')!);
    expect(info).toMatchObject({
      amendingNumber: '令和8年ルール第2号',
      enforcementDate: '2026-12-01',
      rules: [{ id: 'R0701001', op: 'amend' }],
      publicUrl: 'https://staging.builder.ds2.uk/#/public/abcdefghijklmnopqrstuv',
    });
    expect(files.has('pending/R0801002/rules/R0701001.md')).toBe(true);
    expect(files.get('rules/R0701001.md')).toBe(BEFORE);
    // 施行前の掲載は GitHub App が作者（改正履歴に数えない）
    expect(t.gh.head().author?.name).toBe('rule-builder[bot]');

    const at = Date.parse('2026-12-01T00:00:00+09:00');
    expect(t.flow.nextAt).toBe(at);
    t.clock.now = at;
    await t.flow.tick();
    expect(t.flow.status()).toBe('enacted');
    const log = t.gh.log();
    expect(log[1]!.author).toMatchObject({
      name: '令和8年ルール第2号',
      date: '2026-12-01T00:00:00+09:00',
    });
    expect(log[0]!.author?.name).toBe('rule-builder[bot]');
    expect([...t.gh.mainFiles().keys()].some((p) => p.startsWith('pending/'))).toBe(false);
    expect(t.gh.mainFiles().get('rules/R0701001.md')).toBe(AFTER);
  });

  it('改正対象のファイルが元の版から変わっていたら止めて知らせ（F-57）、直したらやり直せる', async () => {
    const t = setup({ p: proposal({ enforcementDate: '2026-12-01' }) });
    await toPassed(t);
    t.gh.pushManual({ 'rules/R0701001.md': BEFORE + '\n手作業の変更\n' });
    t.clock.now = Date.parse('2026-12-01T00:00:00+09:00');
    await t.flow.tick();
    const v = await t.flow.view(false);
    expect(v.status).toBe('passed');
    expect(v.reflect?.stage).toBe('blocked');
    expect(v.reflect?.blocked?.paths).toEqual(['rules/R0701001.md']);
    expect(t.flow.nextAt).toBeNull();

    t.gh.pushManual({ 'rules/R0701001.md': BEFORE });
    const r = await t.flow.retryReflect(ACTOR);
    expect(r.ok && r.view.status).toBe('enacted');
  });

  it('GitHub への書き込みに失敗したら間を空けて再試行し、5回続いたら運営者に知らせる', async () => {
    const t = setup();
    const failures: string[] = [];
    const notify = t.rpc.notifyResult.bind(t.rpc);
    t.rpc.notifyResult = async (input) => {
      if (input.kind === 'failed') failures.push(input.message);
      return notify(input);
    };
    t.gh.failWrites = 100;
    const r = await toPassed(t);
    expect(r.ok && r.view.reflect?.attempts).toBe(1);
    for (let i = 1; i < NOTIFY_AFTER_FAILURES; i++) {
      t.clock.now = Date.parse((await t.flow.view(false)).reflect!.nextAttemptAt!);
      await t.flow.tick();
    }
    const v = await t.flow.view(false);
    expect(v.reflect?.attempts).toBe(NOTIFY_AFTER_FAILURES);
    expect(failures).toHaveLength(1);

    t.gh.failWrites = 0;
    t.clock.now = Date.parse(v.reflect!.nextAttemptAt!);
    await t.flow.tick();
    expect(t.flow.status()).toBe('enacted');
  });
});
