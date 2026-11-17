// 改正案の操作（作成・開く・下書きファイル・ルールの追加・番号の提案）。

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
import { listRecent, type RecentProposal } from '../storage/recent.ts';
import { ProposalSession } from './session.ts';
import { useApp } from './store.ts';

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
  await useApp.getState().openSession(session);
  return session;
}

export async function openRecentProposal(id: string): Promise<void> {
  const current = useApp.getState().session;
  if (current?.id === id) return;
  const session = await ProposalSession.load(id);
  await useApp.getState().openSession(session);
}

/** 下書きファイルを開く。同じ改正案がこのブラウザにあれば、その内容に合わせて取り込む（Yjs で両方の変更が残る） */
export async function openDraftFile(text: string): Promise<'opened' | 'merged'> {
  const incoming = decodeDraft(text);
  const id = readProposalMeta(incoming).id;
  const recent = await listRecent();
  if (recent.some((r) => r.id === id)) {
    const current = useApp.getState().session;
    const session = current?.id === id ? current : await ProposalSession.load(id);
    Y.applyUpdate(session.ydoc, Y.encodeStateAsUpdate(incoming));
    incoming.destroy();
    await useApp.getState().openSession(session);
    useApp.getState().refresh();
    return 'merged';
  }
  await useApp.getState().openSession(new ProposalSession(incoming));
  return 'opened';
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
  recent: RecentProposal[];
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
  const [remote, recent] = await Promise.all([fetchRuleList().catch(() => null), listRecent()]);
  return { remote, recent };
}

/** 改正の元にした版が、今の main と比べて古いか（ルールの中身が変わっているか） */
export async function staleEntries(): Promise<string[]> {
  const { entries } = useApp.getState();
  const targets = entries.filter((e) => e.op !== 'create' && e.baseSha);
  if (!targets.length) return [];
  const sha = await fetchMainSha();
  const list = await fetchRuleList();
  const out: string[] = [];
  for (const e of targets) {
    if (e.baseSha === sha) continue;
    const r = list.rules.find((x) => x.id === e.ruleId);
    const now = r ? await fetchRuleMarkdown(sha, r.path) : '';
    if (now !== e.baseMarkdown) out.push(e.key);
  }
  return out;
}
