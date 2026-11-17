// 変更箇所の表示（F-05・F-1A）。改正中のルールで、改正前と比べて変更した条に青い線、追加した条に緑の線を出す。
// 条の改正前の目印（baseKey）で対応づけ、条ごとに中身を比べる。変わっていない条は前回の結果を使う。

import {
  articleFromPM,
  articleSignature,
  type ArticleChange,
  type PMNode as PMJson,
} from '@rule-builder/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export type ChangeState = {
  articles: ArticleChange[];
  /** 改正前にあって今は無い条の数 */
  removed: number;
  decorations: DecorationSet;
};

export const changesKey = new PluginKey<ChangeState | null>('rb-changes');

const signatureCache = new WeakMap<PMNode, string>();

function signature(node: PMNode): string {
  let s = signatureCache.get(node);
  if (s === undefined) {
    s = articleSignature(articleFromPM(node.toJSON() as PMJson));
    signatureCache.set(node, s);
  }
  return s;
}

function compute(doc: PMNode, base: readonly string[]): ChangeState {
  const articles: ArticleChange[] = [];
  const decos: Decoration[] = [];
  const seen = new Set<number>();
  doc.forEach((node, pos) => {
    if (node.type.name !== 'article') return;
    const key = node.attrs.baseKey as number | null;
    let change: ArticleChange;
    if (typeof key !== 'number' || base[key] === undefined) change = 'new';
    else {
      seen.add(key);
      change = signature(node) === base[key] ? null : 'changed';
    }
    articles.push(change);
    if (change) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: change }));
  });
  return {
    articles,
    removed: base.length - seen.size,
    decorations: DecorationSet.create(doc, decos),
  };
}

/** base：改正前の条の中身（articleSignature）を条の順に。新規制定のルールでは null（何もしない） */
export function changesPlugin(base: readonly string[] | null) {
  return new Plugin<ChangeState | null>({
    key: changesKey,
    state: {
      init: (_, state) => (base ? compute(state.doc, base) : null),
      apply: (tr, old) => (base && tr.docChanged ? compute(tr.doc, base) : old),
    },
    props: {
      decorations: (state) => changesKey.getState(state)?.decorations ?? null,
    },
  });
}
