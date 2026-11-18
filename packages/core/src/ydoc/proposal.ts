// 改正案の Yjs 文書。改正案1件＝1つの Y.Doc とし、Phase 9 でこのままサーバーと同期する。
//
//   meta（Y.Map）                 id・改正ルール番号・施行日・説明・状態・更新日時
//   entries（Y.Array<Y.Map>）     ルールごとの entryId・op・ruleId・baseSha・baseMarkdown・書誌情報（meta: Y.Map）
//   body:<entryId>（Y.XmlFragment） ルールごとの本文（エディタがそのまま編集する）
//
// 書き出し・対照表・書式チェックは、ここでモデルに変換してから行う（サーバーでも同じ処理を使う）。

import * as Y from 'yjs';
import { parseRule } from '../markdown/parse.ts';
import type {
  AmendingNumber,
  EntryOp,
  Proposal,
  ProposalEntry,
  ProposalMeta,
  ProposalStatus,
} from '../model/proposal.ts';
import type { FrontMatterFormat, RuleDoc, RuleMeta, TopBlock } from '../model/types.ts';
import type { RuleKind } from '../numbering/ruleId.ts';
import { bodyFromPM, bodyToPM } from './pmJson.ts';
import { readFragmentJSON, writeFragmentJSON } from './yxml.ts';

export const bodyField = (entryId: string) => `body:${entryId}`;

const metaMap = (ydoc: Y.Doc) => ydoc.getMap<unknown>('meta');
const entriesArray = (ydoc: Y.Doc) => ydoc.getArray<Y.Map<unknown>>('entries');

export function newId(): string {
  return crypto.randomUUID();
}

// ---------- 改正案の情報 ----------

export type ProposalInit = {
  id?: string;
  amendingNumber: AmendingNumber;
  enforcementDate: string;
  summary?: string;
};

export function createProposalDoc(init: ProposalInit, now = new Date()): Y.Doc {
  const ydoc = new Y.Doc();
  ydoc.transact(() => {
    const m = metaMap(ydoc);
    m.set('id', init.id ?? newId());
    setAmending(m, init.amendingNumber);
    m.set('enforcementDate', init.enforcementDate);
    m.set('summary', init.summary ?? '');
    m.set('status', 'draft');
    m.set('updatedAt', now.toISOString());
  });
  return ydoc;
}

function setAmending(m: Y.Map<unknown>, a: AmendingNumber) {
  m.set('kind', a.kind);
  m.set('year', a.year);
  m.set('number', a.number);
}

export function readProposalMeta(ydoc: Y.Doc): ProposalMeta {
  const m = metaMap(ydoc);
  return {
    id: String(m.get('id') ?? ''),
    amendingNumber: {
      kind: (m.get('kind') as RuleKind) ?? 'ルール',
      year: Number(m.get('year') ?? 0),
      number: Number(m.get('number') ?? 0),
    },
    enforcementDate: String(m.get('enforcementDate') ?? ''),
    summary: String(m.get('summary') ?? ''),
    status: (m.get('status') as ProposalStatus) ?? 'draft',
    updatedAt: String(m.get('updatedAt') ?? ''),
  };
}

export type ProposalMetaPatch = Partial<
  Pick<ProposalMeta, 'amendingNumber' | 'enforcementDate' | 'summary'>
>;

export function updateProposalMeta(ydoc: Y.Doc, patch: ProposalMetaPatch) {
  ydoc.transact(() => {
    const m = metaMap(ydoc);
    if (patch.amendingNumber) setAmending(m, patch.amendingNumber);
    if (patch.enforcementDate !== undefined) m.set('enforcementDate', patch.enforcementDate);
    if (patch.summary !== undefined) m.set('summary', patch.summary);
  });
}

/** 更新日時を記録する（本文や情報が変わったとき） */
export function touchProposal(ydoc: Y.Doc, now = new Date()) {
  metaMap(ydoc).set('updatedAt', now.toISOString());
}

// ---------- ルールの書誌情報 ----------

function writeRuleMeta(m: Y.Map<unknown>, meta: RuleMeta) {
  m.set('kind', meta.kind);
  m.set('year', meta.year);
  m.set('number', meta.number);
  m.set('name', meta.name);
  m.set('enforcementDate', meta.enforcementDate);
  m.set('order', meta.order);
  m.set('extra', JSON.stringify(meta.extra));
  m.set('format', meta.format ? JSON.stringify(meta.format) : null);
}

function readRuleMeta(m: Y.Map<unknown> | undefined): RuleMeta {
  const get = (k: string) => m?.get(k);
  const format = get('format');
  const meta: RuleMeta = {
    kind: (get('kind') as RuleKind) ?? 'ルール',
    year: Number(get('year') ?? 0),
    number: Number(get('number') ?? 0),
    name: String(get('name') ?? ''),
    enforcementDate: String(get('enforcementDate') ?? ''),
    order: typeof get('order') === 'number' ? (get('order') as number) : null,
    extra: JSON.parse(String(get('extra') ?? '{}')) as Record<string, string>,
  };
  if (typeof format === 'string') meta.format = JSON.parse(format) as FrontMatterFormat;
  return meta;
}

// ---------- ルール（entries） ----------

export type EntryInfo = {
  entryId: string;
  op: EntryOp;
  ruleId: string;
  baseSha: string;
  baseMarkdown: string;
  meta: RuleMeta;
};

export type NewEntry =
  | { op: 'create'; doc: RuleDoc }
  | { op: 'amend'; ruleId: string; baseSha: string; baseMarkdown: string }
  | { op: 'repeal'; ruleId: string; baseSha: string; baseMarkdown: string };

/** ルールを足し、entryId を返す。改正では原文を読み込み、条に改正前の目印を付ける */
export function addEntry(ydoc: Y.Doc, entry: NewEntry, entryId = newId()): string {
  ydoc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('entryId', entryId);
    m.set('op', entry.op);
    const rm = new Y.Map<unknown>();
    let body: TopBlock[] | null = null;
    if (entry.op === 'create') {
      writeRuleMeta(rm, entry.doc.meta);
      body = entry.doc.body;
    } else {
      m.set('ruleId', entry.ruleId);
      m.set('baseSha', entry.baseSha);
      m.set('baseMarkdown', entry.baseMarkdown);
      const base = parseRule(entry.baseMarkdown).doc;
      writeRuleMeta(rm, base.meta);
      if (entry.op === 'amend') body = base.body;
    }
    m.set('meta', rm);
    entriesArray(ydoc).push([m]);
    if (body) {
      writeFragmentJSON(
        ydoc.getXmlFragment(bodyField(entryId)),
        bodyToPM(body, { baseKeys: entry.op === 'amend' }),
      );
    }
  });
  return entryId;
}

export function removeEntry(ydoc: Y.Doc, entryId: string) {
  ydoc.transact(() => {
    const arr = entriesArray(ydoc);
    const i = arr.toArray().findIndex((m) => m.get('entryId') === entryId);
    if (i >= 0) arr.delete(i, 1);
    const f = ydoc.getXmlFragment(bodyField(entryId));
    if (f.length) f.delete(0, f.length);
  });
}

function entryInfo(m: Y.Map<unknown>): EntryInfo {
  return {
    entryId: String(m.get('entryId')),
    op: m.get('op') as EntryOp,
    ruleId: String(m.get('ruleId') ?? ''),
    baseSha: String(m.get('baseSha') ?? ''),
    baseMarkdown: String(m.get('baseMarkdown') ?? ''),
    meta: readRuleMeta(m.get('meta') as Y.Map<unknown> | undefined),
  };
}

export function readEntries(ydoc: Y.Doc): EntryInfo[] {
  return entriesArray(ydoc).toArray().map(entryInfo);
}

export function entryFragment(ydoc: Y.Doc, entryId: string): Y.XmlFragment {
  return ydoc.getXmlFragment(bodyField(entryId));
}

export type RuleMetaPatch = Partial<Omit<RuleMeta, 'format'>>;

export function updateRuleMeta(ydoc: Y.Doc, entryId: string, patch: RuleMetaPatch) {
  const m = entriesArray(ydoc)
    .toArray()
    .find((x) => x.get('entryId') === entryId);
  const rm = m?.get('meta') as Y.Map<unknown> | undefined;
  if (!rm) return;
  ydoc.transact(() => {
    for (const [k, v] of Object.entries(patch)) {
      rm.set(k, k === 'extra' ? JSON.stringify(v) : v);
    }
  });
}

/** ルールの本文と書誌情報をモデルとして読む（廃止のルールは原文） */
export function readEntryDoc(ydoc: Y.Doc, info: EntryInfo): RuleDoc {
  if (info.op === 'repeal') return parseRule(info.baseMarkdown).doc;
  return { meta: info.meta, body: bodyFromPM(readFragmentJSON(entryFragment(ydoc, info.entryId))) };
}

export function readProposal(ydoc: Y.Doc): Proposal {
  const entries = readEntries(ydoc).map((e): ProposalEntry => {
    if (e.op === 'repeal') {
      return {
        entryId: e.entryId,
        op: 'repeal',
        ruleId: e.ruleId,
        baseSha: e.baseSha,
        baseMarkdown: e.baseMarkdown,
      };
    }
    const doc = readEntryDoc(ydoc, e);
    if (e.op === 'create') return { entryId: e.entryId, op: 'create', doc };
    return {
      entryId: e.entryId,
      op: 'amend',
      ruleId: e.ruleId,
      baseSha: e.baseSha,
      baseMarkdown: e.baseMarkdown,
      doc,
    };
  });
  return { ...readProposalMeta(ydoc), entries };
}
