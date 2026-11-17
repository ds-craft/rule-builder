// 書式チェックと参照の確認の件数（リボン・ステータスバー・作業ウィンドウで使う）。
// 紙面のエディタ（閲覧モードで隠れているときも残っている）のプラグインの状態から数える。

import {
  countIssues,
  findIncomingLinks,
  parseRule,
  ruleAnchors,
  type IncomingLink,
  type RuleDoc,
} from '@rule-builder/core';
import { create } from 'zustand';
import { entryRuleId, useLinkIndex, type IndexedRule } from '../github/linkIndex.ts';
import { currentEntry, useApp, type OpenEntry } from '../state/store.ts';
import { useActiveEditor } from './activeEditor.ts';
import { lintIssues } from './lint.ts';
import { refItems } from './refs.ts';

const anchorCache = new WeakMap<RuleDoc, Set<string>>();

/** ルールのアンカー（本文の写しごとに覚えておく） */
export function docAnchors(doc: RuleDoc): Set<string> {
  let a = anchorCache.get(doc);
  if (!a) {
    a = ruleAnchors(doc);
    anchorCache.set(doc, a);
  }
  return a;
}

const baseCache = new Map<string, Set<string>>();

/** 改正前の版のアンカー */
function baseAnchors(markdown: string): Set<string> {
  let a = baseCache.get(markdown);
  if (!a) {
    a = ruleAnchors(parseRule(markdown).doc);
    baseCache.set(markdown, a);
  }
  return a;
}

/** 閉じた「ほかのルールのリンク」の警告（ルールのID と アンカー と リンク元） */
export const useDismissed = create<{ keys: string[] }>(() => ({ keys: [] }));

export const incomingKey = (l: IncomingLink) => `${l.ruleId}|${l.anchor}|${l.heading}|${l.text}`;

const incomingCache = new WeakMap<
  RuleDoc,
  { rules: readonly IndexedRule[]; result: IncomingLink[] }
>();

/** 改正で見出しが変わり、ほかのルールからのリンクが切れるもの（7-3.6） */
export function incomingWarnings(
  entry: OpenEntry | null,
  rules: readonly IndexedRule[],
): IncomingLink[] {
  // 廃止したルールもポータルに残るので、リンクは切れない
  if (!entry || entry.op !== 'amend' || rules.length === 0) return [];
  const hit = incomingCache.get(entry.doc);
  if (hit && hit.rules === rules) return hit.result;
  const current = docAnchors(entry.doc);
  const removed = new Set([...baseAnchors(entry.baseMarkdown)].filter((a) => !current.has(a)));
  const result = findIncomingLinks(
    entryRuleId(entry),
    removed,
    rules.map((r) => ({ id: r.id, name: r.name, markdown: r.markdown })),
  );
  incomingCache.set(entry.doc, { rules, result });
  return result;
}

/** 開いているルールの件数（書式の問題・参照の確認） */
export function checkCounts(): { lint: number; refs: number } {
  const editor = useActiveEditor.getState().editor;
  const entry = currentEntry(useApp.getState());
  const lint = editor && !editor.isDestroyed ? countIssues(lintIssues(editor.state)) : 0;
  const refs = editor && !editor.isDestroyed ? refItems(editor.state).length : 0;
  const dismissed = useDismissed.getState().keys;
  const incoming = incomingWarnings(entry, useLinkIndex.getState().rules).filter(
    (l) => !dismissed.includes(incomingKey(l)),
  ).length;
  return { lint, refs: refs + incoming };
}
