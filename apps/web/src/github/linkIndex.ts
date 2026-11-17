// 公開中のルールの見出しの一覧（条文へのリンクの飛び先・リンク切れ・ほかのルールからのリンクの確認に使う）。
// ルールの一覧と本文は rules.ts がキャッシュしているので、ここでは見出しを読むだけ。取得できなくても編集は続けられる。

import {
  formatRuleId,
  parseRule,
  ruleHeadings,
  type LintRuleIndex,
  type RuleHeading,
} from '@rule-builder/core';
import { create } from 'zustand';
import type { OpenEntry } from '../state/store.ts';
import { fetchRuleList, fetchRuleMarkdown } from './rules.ts';

export type IndexedRule = {
  id: string;
  name: string;
  repealed: boolean;
  markdown: string;
  headings: RuleHeading[];
  anchors: Set<string>;
};

type LinkIndexState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  rules: IndexedRule[];
};

export const useLinkIndex = create<LinkIndexState>(() => ({ status: 'idle', rules: [] }));

let loading: Promise<void> | null = null;

/** 一覧を読み込む（読み込み済み・読み込み中なら何もしない） */
export function loadLinkIndex(): Promise<void> {
  if (useLinkIndex.getState().status === 'ready') return Promise.resolve();
  loading ??= (async () => {
    useLinkIndex.setState({ status: 'loading' });
    try {
      const list = await fetchRuleList();
      const rules = await Promise.all(
        list.rules.map(async (r): Promise<IndexedRule> => {
          const markdown = await fetchRuleMarkdown(list.sha, r.path);
          const headings = ruleHeadings(parseRule(markdown).doc);
          return {
            id: r.id,
            name: r.meta.name,
            repealed: r.repealed,
            markdown,
            headings,
            anchors: new Set(headings.map((h) => h.anchor)),
          };
        }),
      );
      useLinkIndex.setState({ status: 'ready', rules });
    } catch {
      useLinkIndex.setState({ status: 'error' });
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** 改正案のルールのID（新規制定は書誌情報から） */
export function entryRuleId(e: Pick<OpenEntry, 'op' | 'ruleId' | 'doc'>): string {
  return e.op === 'create' ? formatRuleId(e.doc.meta) : e.ruleId;
}

/**
 * 書式チェックでリンク先を調べるための一覧。改正案の中のルールは改正後の見出しを使う。
 * 公開中のルールの一覧が無ければ undefined（ほかのルールへのリンクは調べない）。
 */
export function lintRuleIndex(
  rules: readonly IndexedRule[] | null,
  entries: readonly OpenEntry[],
  anchorsOf: (e: OpenEntry) => Set<string>,
): LintRuleIndex | undefined {
  if (!rules) return undefined;
  const map = new Map<string, { name: string; anchors: ReadonlySet<string> | null }>();
  for (const r of rules) map.set(r.id, { name: r.name, anchors: r.anchors });
  for (const e of entries) {
    if (e.op === 'repeal') continue;
    map.set(entryRuleId(e), { name: e.doc.meta.name, anchors: anchorsOf(e) });
  }
  return map;
}
