// 改正案の操作（作成・開く・下書きファイル・サーバーへの移行・ルールの追加・番号の提案）。
// 運営者としてログインしていれば、開いた改正案はサーバーとつなぐ（同期・在席）。

import {
  addEntry,
  createProposalDoc,
  decodeDraft,
  encodeDraft,
  formatRuleId,
  readProposalMeta,
  type AmendingNumber,
  type NewEntry,
  type RuleDoc,
  type RuleKind,
  type RuleMeta,
} from '@rule-builder/core';
import * as Y from 'yjs';
import { fetchMainSha, fetchRuleList, fetchRuleMarkdown, type RuleList } from '../github/rules.ts';
import { fetchProposals, type ServerProposal } from '../server/api.ts';
import { listRecent, onServerIds, type RecentProposal } from '../storage/recent.ts';
import { loadMe, useAuth, userColor } from './auth.ts';
import { CLOSE_FORBIDDEN, CLOSE_REAUTH, ProposalSession } from './session.ts';
import { useApp } from './store.ts';

/** 運営者の判定をやり直す間隔の下限（接続が切れるたびに問い合わせないため） */
const RECHECK_GAP_MS = 30_000;
let lastRecheck = 0;

/** ログイン中ならサーバーとつなぐ。接続が切られたら、運営者かどうかを確かめ直す */
function attach(session: ProposalSession) {
  const { status, user } = useAuth.getState();
  if (status !== 'user' || !user) return;
  session.connect({
    uid: user.id,
    name: user.name,
    avatar: user.avatarUrl,
    color: userColor(user.id),
  });
  session.onConnectionClose((code) => {
    const now = Date.now();
    const urgent = code === CLOSE_FORBIDDEN;
    if (!urgent && (code === CLOSE_REAUTH || now - lastRecheck < RECHECK_GAP_MS)) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    lastRecheck = now;
    void loadMe();
  });
}

async function openWithServer(session: ProposalSession) {
  attach(session);
  await useApp.getState().openSession(session);
}

export type NewProposalInput = {
  amendingNumber: AmendingNumber;
  enforcementDate: string;
  summary?: string;
};

/** 改正案を作って開く。最初のルール（制定・改正）があれば一緒に入れる */
export async function createProposal(
  input: NewProposalInput,
  first?: NewEntry,
): Promise<ProposalSession> {
  const ydoc = createProposalDoc(input);
  if (first) addEntry(ydoc, first);
  const session = new ProposalSession(ydoc);
  await openWithServer(session);
  return session;
}

export class ProposalNotFound extends Error {}

/**
 * 改正案を開く。この端末の控えがあればすぐ開き、なければサーバーから届くのを待つ。
 * 届かなければ（ない・つながらない） ProposalNotFound を投げる。
 */
export async function openProposal(id: string): Promise<void> {
  const current = useApp.getState().session;
  if (current?.id === id) return;
  const session = new ProposalSession(new Y.Doc(), { id });
  await session.whenLocalReady();
  attach(session);
  if (readProposalMeta(session.ydoc).id !== id) {
    await session.whenSynced();
    if (readProposalMeta(session.ydoc).id !== id) {
      await session.destroy();
      throw new ProposalNotFound(
        useAuth.getState().status === 'user'
          ? '改正案を開けませんでした。リンクが正しいか、通信の状態を確かめてください'
          : '改正案を開くには、ログインしてください',
      );
    }
  }
  await useApp.getState().openSession(session);
}

/** 下書きファイルを開く。同じ改正案がこのブラウザにあれば、その内容に合わせて取り込む（Yjs で両方の変更が残る） */
export async function openDraftFile(text: string): Promise<'opened' | 'merged'> {
  const incoming = decodeDraft(text);
  const id = readProposalMeta(incoming).id;
  const recent = await listRecent();
  if (recent.some((r) => r.id === id)) {
    const current = useApp.getState().session;
    if (current?.id === id) {
      Y.applyUpdate(current.ydoc, Y.encodeStateAsUpdate(incoming));
      incoming.destroy();
      useApp.getState().refresh();
      return 'merged';
    }
    const session = await ProposalSession.load(id);
    Y.applyUpdate(session.ydoc, Y.encodeStateAsUpdate(incoming));
    incoming.destroy();
    await openWithServer(session);
    return 'merged';
  }
  await openWithServer(new ProposalSession(incoming));
  return 'opened';
}

/** このブラウザだけに控えてある改正案（サーバーの一覧にないもの） */
export async function localOnlyProposals(server?: ServerProposal[]): Promise<RecentProposal[]> {
  const [recent, list] = await Promise.all([listRecent(), server ?? fetchProposals()]);
  const ids = new Set([...list.map((p) => p.id), ...onServerIds()]);
  return recent.filter((r) => !ids.has(r.id));
}

/**
 * このブラウザだけにある改正案をサーバーに移す（下書きファイルの読み込みと同じく、控えをサーバーの文書に合わせる）。
 * 移せた件数を返す。開いている改正案はすでにつながっているので、送り終わるのを待つだけ。
 */
export async function migrateToServer(ids: string[]): Promise<number> {
  let n = 0;
  for (const id of ids) {
    const current = useApp.getState().session;
    if (current?.id === id) {
      if (await current.flush()) n++;
      continue;
    }
    const session = await ProposalSession.load(id);
    attach(session);
    session.touch();
    const ok = await session.flush();
    await session.destroy();
    if (ok) n++;
  }
  return n;
}

/** 下書きファイル（.json）をダウンロードする */
export function downloadDraft(): string | null {
  const session = useApp.getState().session;
  if (!session) return null;
  const meta = session.meta();
  const name = `proposal-${formatRuleId(meta.amendingNumber)}.json`;
  const blob = new Blob([JSON.stringify(encodeDraft(session.ydoc), null, 2)], {
    type: 'application/json',
  });
  downloadBlob(name, blob);
  return name;
}

export function downloadBlob(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** 公開中のルールの改正を、開いている改正案に足す。足したルールの位置を返す */
export async function addAmendEntry(ruleId: string): Promise<number> {
  const session = useApp.getState().session;
  if (!session) throw new Error('改正案を開いていません');
  const { sha, markdown } = await fetchRemoteRule(ruleId);
  addEntry(session.ydoc, { op: 'amend', ruleId, baseSha: sha, baseMarkdown: markdown });
  useApp.getState().refresh();
  return useApp.getState().entries.length - 1;
}

export async function addRepealEntry(ruleId: string): Promise<number> {
  const session = useApp.getState().session;
  if (!session) throw new Error('改正案を開いていません');
  const { sha, markdown } = await fetchRemoteRule(ruleId);
  addEntry(session.ydoc, { op: 'repeal', ruleId, baseSha: sha, baseMarkdown: markdown });
  useApp.getState().refresh();
  return useApp.getState().entries.length - 1;
}

export function addCreateEntry(doc: RuleDoc): number {
  const session = useApp.getState().session;
  if (!session) throw new Error('改正案を開いていません');
  addEntry(session.ydoc, { op: 'create', doc });
  useApp.getState().refresh();
  return useApp.getState().entries.length - 1;
}

export async function fetchRemoteRule(ruleId: string): Promise<{ sha: string; markdown: string }> {
  const list = await fetchRuleList();
  const r = list.rules.find((x) => x.id === ruleId);
  if (!r) throw new Error(`ルールが見つかりません: ${ruleId}`);
  return { sha: list.sha, markdown: await fetchRuleMarkdown(list.sha, r.path) };
}

/** 新しいルールの本文（第1条と附則） */
export function newRuleDoc(meta: RuleMeta): RuleDoc {
  return {
    meta,
    body: [
      {
        type: 'article',
        num: { main: 1, branches: [] },
        caption: '',
        general: false,
        deleted: false,
        paragraphs: [{ text: [], items: [] }],
      },
      {
        type: 'supplementary',
        lines: [],
        provisions: [
          {
            heading: '附則',
            general: false,
            lines: [[{ kind: 'text', value: `　この${meta.kind}は、公布の日から施行します。` }]],
          },
        ],
      },
    ],
  };
}

// ---------- 番号の提案（F-21） ----------

export type NumberSources = {
  remote: RuleList | null;
  /** 改正ルール番号が使われている改正案（この端末の控えと、サーバー上の運営の改正案） */
  recent: Pick<RecentProposal, 'amendingNumber'>[];
};

/**
 * 次の号の提案：同じ種別・年の既存ルール（廃止を含む）、最近使った改正案の改正ルール番号、
 * 開いている改正案の中のほかの新規ルールの番号の最大値＋1。
 */
export function suggestNumber(
  kind: RuleKind,
  year: number,
  src: NumberSources,
  excludeEntryId?: string,
): number {
  const used: number[] = [];
  for (const r of src.remote?.rules ?? []) {
    if (r.meta.kind === kind && r.meta.year === year) used.push(r.meta.number);
  }
  for (const p of src.recent) {
    if (p.amendingNumber.kind === kind && p.amendingNumber.year === year)
      used.push(p.amendingNumber.number);
  }
  for (const e of useApp.getState().entries) {
    if (
      e.op === 'create' &&
      e.key !== excludeEntryId &&
      e.doc.meta.kind === kind &&
      e.doc.meta.year === year
    ) {
      used.push(e.doc.meta.number);
    }
  }
  return (used.length ? Math.max(...used) : 0) + 1;
}

/** 並び順の提案：同じ種別の既存の最大値＋1 */
export function suggestOrder(kind: RuleKind, src: NumberSources): number {
  const orders = (src.remote?.rules ?? [])
    .filter((r) => !r.repealed && r.meta.kind === kind && r.meta.order !== null)
    .map((r) => r.meta.order!);
  const all = (src.remote?.rules ?? [])
    .filter((r) => r.meta.order !== null)
    .map((r) => r.meta.order!);
  return (orders.length ? Math.max(...orders) : all.length ? Math.max(...all) : 0) + 1;
}

/** 番号の提案に使う情報を集める（取得できなければ remote は null） */
export async function loadNumberSources(): Promise<NumberSources> {
  const [remote, recent, server] = await Promise.all([
    fetchRuleList().catch(() => null),
    listRecent(),
    useAuth.getState().status === 'user' ? fetchProposals().catch(() => []) : [],
  ]);
  return {
    remote,
    recent: [
      ...recent,
      ...server.map((p) => ({
        amendingNumber: p.amendingNumber as RecentProposal['amendingNumber'],
      })),
    ],
  };
}

/** 改正の元にした版が、今の main と比べて古いルール（中身が変わっているもの）と、今の main の SHA */
export async function staleEntries(): Promise<{ sha: string; keys: string[] }> {
  const { entries } = useApp.getState();
  const targets = entries.filter((e) => e.op !== 'create' && e.baseSha);
  if (!targets.length) return { sha: '', keys: [] };
  const sha = await fetchMainSha();
  const list = await fetchRuleList();
  const keys: string[] = [];
  for (const e of targets) {
    if (e.baseSha === sha) continue;
    const r = list.rules.find((x) => x.id === e.ruleId);
    const now = r ? await fetchRuleMarkdown(sha, r.path) : '';
    if (now !== e.baseMarkdown) keys.push(e.key);
  }
  return { sha, keys };
}
