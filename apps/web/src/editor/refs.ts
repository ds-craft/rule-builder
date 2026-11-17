// 参照の確認（F-15）のエディタ側。条番号が変わる操作のたびに、文中の参照とリンク先の書き換えの候補を作る。
// 候補はプラグインの状態に持ち、文書が変わるたびに位置をずらす（文言が変わった候補は消す）。自動では書き換えない。
//   - 続けて番号が変わったときは、まだ書き換えていない候補の新しい番号も続けて変える（第3条→第4条→第5条）
//   - 「前条」「次条」は、条の挿入・削除・移動で指す条が変わるときに「確認」として出す

import {
  anchorArticle,
  findReferences,
  formatArticleNum,
  parseRuleHref,
  renumberMap,
  renumberTargets,
  type ArticleNum,
  type Renumbering,
} from '@rule-builder/core';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { Mappable } from '@tiptap/pm/transform';
import { articleLabel } from './lines.ts';
import { articleRefs } from './structure.ts';

export type RefItem =
  /** 文中の参照（「第3条」を「第4条」に） */
  | {
      id: number;
      type: 'text';
      from: number;
      to: number;
      old: string;
      neu: string;
      inLink: boolean;
    }
  /** リンクの飛び先（#第3条（…） を #第4条（…） に）。from・to はリンクの文字の範囲 */
  | { id: number; type: 'href'; from: number; to: number; oldHref: string; newHref: string }
  /** 確認（「前条」の指す条が変わるなど）。pos は行の位置 */
  | { id: number; type: 'note'; pos: number; message: string };

export type RefsState = { items: RefItem[] };

type RefsMeta =
  | { add: { oldDoc: PMNode; mapping: Mappable; list: readonly Renumbering[]; ruleId: string } }
  | { remove: number[] }
  | { clear: true };

export const refsKey = new PluginKey<RefsState>('rb-refs');

let seq = 0;

function linkMark(marks: readonly Mark[]): Mark | null {
  return marks.find((m) => m.type.name === 'link') ?? null;
}

/** 文書の中の文字の行（位置と文言） */
function textblocks(doc: PMNode): { pos: number; node: PMNode }[] {
  const out: { pos: number; node: PMNode }[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (node.type.name !== 'raw') out.push({ pos, node });
      return false;
    }
    return true;
  });
  return out;
}

/** 行の中のリンク（続いた同じリンクの文字をまとめた範囲） */
function linksIn(pos: number, node: PMNode): { from: number; to: number; mark: Mark }[] {
  const out: { from: number; to: number; mark: Mark }[] = [];
  node.forEach((child, off) => {
    const m = linkMark(child.marks);
    const from = pos + 1 + off;
    const last = out[out.length - 1];
    if (m && last && last.to === from && last.mark.eq(m)) last.to = from + child.nodeSize;
    else if (m) out.push({ from, to: from + child.nodeSize, mark: m });
  });
  return out;
}

function stillValid(doc: PMNode, it: RefItem): boolean {
  if (it.type === 'note') return it.pos <= doc.content.size;
  if (it.from >= it.to || it.to > doc.content.size) return false;
  if (it.type === 'text') return doc.textBetween(it.from, it.to) === it.old;
  const n = doc.nodeAt(it.from);
  return !!n && linkMark(n.marks)?.attrs.href === it.oldHref;
}

function mapItem(it: RefItem, mapping: Mappable): RefItem | null {
  if (it.type === 'note') {
    const r = mapping.mapResult(it.pos, -1);
    return { ...it, pos: r.pos };
  }
  const from = mapping.map(it.from, 1);
  const to = mapping.map(it.to, -1);
  return from < to ? { ...it, from, to } : null;
}

/** 条番号の変更から新しい候補を作り、まだ書き換えていない候補の番号も続けて変える */
function addRenumbering(
  doc: PMNode,
  items: RefItem[],
  add: { oldDoc: PMNode; mapping: Mappable; list: readonly Renumbering[]; ruleId: string },
): RefItem[] {
  const map = renumberMap(add.list);
  const next = items.map((it): RefItem => {
    if (it.type === 'text') {
      const neu = map.get(it.neu);
      return neu ? { ...it, neu } : it;
    }
    if (it.type === 'href') {
      const newHref = renumberHref(it.newHref, map, add.ruleId);
      return newHref ? { ...it, newHref } : it;
    }
    return it;
  });
  const covered = (from: number, to: number, type: RefItem['type']) =>
    next.some((it) => it.type === type && it.type !== 'note' && it.from < to && from < it.to);

  if (map.size > 0) {
    for (const { pos, node } of textblocks(doc)) {
      const text = node.textContent;
      const links = linksIn(pos, node);
      for (const t of renumberTargets(text, map)) {
        const from = pos + 1 + t.index;
        const to = from + t.old.length;
        if (covered(from, to, 'text')) continue;
        const link = links.find((l) => l.from <= from && to <= l.to);
        // ほかのルールへのリンクの文字は、ほかのルールの条なので候補にしない
        const target = link && parseRuleHref(link.mark.attrs.href as string);
        if (target && target.ruleId !== null && target.ruleId !== add.ruleId) continue;
        next.push({ id: ++seq, type: 'text', from, to, old: t.old, neu: t.neu, inLink: !!link });
      }
      for (const l of links) {
        const href = l.mark.attrs.href as string;
        const newHref = renumberHref(href, map, add.ruleId);
        if (!newHref || covered(l.from, l.to, 'href')) continue;
        next.push({ id: ++seq, type: 'href', from: l.from, to: l.to, oldHref: href, newHref });
      }
    }
  }
  next.push(...relativeNotes(add.oldDoc, doc, add.mapping, next));
  return next;
}

/** リンクの飛び先が番号の変わる条なら、新しい飛び先（「第3条（目的）」→「第4条（目的）」） */
function renumberHref(
  href: string,
  map: ReadonlyMap<string, string>,
  ruleId: string,
): string | null {
  const t = parseRuleHref(href);
  if (!t || (t.ruleId !== null && t.ruleId !== ruleId) || !t.anchor) return null;
  const num = anchorArticle(t.anchor);
  if (!num) return null;
  const old = formatArticleNum(num);
  const neu = map.get(old);
  if (!neu || neu === old) return null;
  const prefix = href.slice(0, href.indexOf('#') + 1);
  return prefix + neu + t.anchor.slice(old.length);
}

/** 操作の前後で、条の対応（操作後の何番目の条が、操作前の何番目の条か。新しい条は -1） */
function matchArticles(oldDoc: PMNode, doc: PMNode, mapping: Mappable): number[] {
  const olds = articleRefs(oldDoc);
  const news = articleRefs(doc);
  const result = news.map(() => -1);
  const used = new Set<number>();
  const byPos = new Map(news.map((a) => [a.pos, a.index]));
  // 1. 位置で（動かしていない条）
  olds.forEach((o) => {
    const r = mapping.mapResult(o.pos, 1);
    const j = byPos.get(r.pos);
    if (
      !r.deleted &&
      j !== undefined &&
      result[j] === -1 &&
      news[j]!.node.content.eq(o.node.content)
    ) {
      result[j] = o.index;
      used.add(o.index);
    }
  });
  // 2. 中身で（移動した条）、3. 番号で（「削除」として残した条）
  const rest = (f: (o: (typeof olds)[number], n: (typeof news)[number]) => boolean) =>
    news.forEach((n, j) => {
      if (result[j] !== -1) return;
      const o = olds.find((o) => !used.has(o.index) && f(o, n));
      if (o) {
        result[j] = o.index;
        used.add(o.index);
      }
    });
  rest((o, n) => o.node.content.eq(n.node.content));
  rest((o, n) => sameNum(o.node.attrs.num, n.node.attrs.num));
  return result;
}

function sameNum(a: unknown, b: unknown): boolean {
  const x = a as ArticleNum | null;
  const y = b as ArticleNum | null;
  return !!x && !!y && formatArticleNum(x) === formatArticleNum(y);
}

/** 「前条」「次条」の指す条が変わる条 */
function relativeNotes(
  oldDoc: PMNode,
  doc: PMNode,
  mapping: Mappable,
  existing: readonly RefItem[],
): RefItem[] {
  const olds = articleRefs(oldDoc);
  const news = articleRefs(doc);
  const match = matchArticles(oldDoc, doc, mapping);
  const label = (n: PMNode | undefined) =>
    n ? articleLabel(n.attrs.num as ArticleNum | null) || '番号のない条' : 'なし';
  const out: RefItem[] = [];
  news.forEach((a, j) => {
    const i = match[j]!;
    if (i < 0 || a.node.attrs.deleted) return;
    const words = [
      { word: '前条', now: j - 1, before: i - 1 },
      { word: '次条', now: j + 1, before: i + 1 },
    ];
    for (const w of words) {
      const nowMatch = w.now >= 0 && w.now < news.length ? match[w.now]! : -2;
      const beforeExists = w.before >= 0 && w.before < olds.length;
      if (nowMatch === w.before || (!beforeExists && nowMatch === -2)) continue;
      // その言葉を含む最初の行
      let linePos = -1;
      a.node.forEach((child, off) => {
        if (linePos >= 0 || child.type.name !== 'lawLine') return;
        if (findReferences(child.textContent).some((r) => r.relative === w.word))
          linePos = a.pos + 1 + off;
      });
      if (linePos < 0) continue;
      const message = `「${w.word}」が指す条が変わります（${label(beforeExists ? olds[w.before]!.node : undefined)} → ${label(news[w.now]?.node)}）。文言を確かめてください`;
      if (existing.some((e) => e.type === 'note' && e.pos === linePos && e.message === message))
        continue;
      out.push({ id: ++seq, type: 'note', pos: linePos, message });
    }
  });
  return out;
}

export function refsPlugin() {
  return new Plugin<RefsState>({
    key: refsKey,
    state: {
      init: () => ({ items: [] }),
      apply(tr, old, _o, state) {
        let items = old.items;
        if (tr.docChanged) {
          items = items
            .map((it) => mapItem(it, tr.mapping))
            .filter((it): it is RefItem => !!it && stillValid(state.doc, it));
        }
        const meta = tr.getMeta(refsKey) as RefsMeta | undefined;
        if (meta && 'add' in meta) items = addRenumbering(state.doc, items, meta.add);
        if (meta && 'remove' in meta) items = items.filter((it) => !meta.remove.includes(it.id));
        if (meta && 'clear' in meta) items = [];
        return items === old.items ? old : { items };
      },
    },
  });
}

export function refItems(state: EditorState): RefItem[] {
  return refsKey.getState(state)?.items ?? [];
}

/** 条番号が変わる操作を記録する（操作を反映した後に呼ぶ） */
export function recordRenumbering(
  state: EditorState,
  add: { oldDoc: PMNode; mapping: Mappable; list: readonly Renumbering[]; ruleId: string },
): Transaction {
  return state.tr.setMeta(refsKey, { add } satisfies RefsMeta).setMeta('addToHistory', false);
}

export function removeRefs(tr: Transaction, ids: number[]): Transaction {
  return tr.setMeta(refsKey, { remove: ids } satisfies RefsMeta);
}

export function clearRefs(state: EditorState): Transaction {
  return state.tr.setMeta(refsKey, { clear: true } satisfies RefsMeta);
}

/** 候補を書き換える。文言が変わっていたら null */
export function applyRefs(state: EditorState, items: readonly RefItem[]): Transaction | null {
  const valid = items.filter((it) => it.type !== 'note' && stillValid(state.doc, it));
  if (valid.length === 0) return null;
  const tr = state.tr;
  const link = state.schema.marks.link!;
  // 後ろから書き換えると前の位置がずれない
  const sorted = [...valid].sort(
    (a, b) => (b as { from: number }).from - (a as { from: number }).from,
  );
  for (const it of sorted) {
    if (it.type === 'text') {
      const marks = state.doc.nodeAt(it.from)?.marks ?? [];
      tr.replaceWith(it.from, it.to, state.schema.text(it.neu, marks));
    } else if (it.type === 'href') {
      const old = linkMark(state.doc.nodeAt(it.from)?.marks ?? []);
      tr.removeMark(it.from, it.to, link);
      tr.addMark(
        it.from,
        it.to,
        link.create({ href: it.newHref, title: old?.attrs.title ?? null }),
      );
    }
  }
  return removeRefs(
    tr,
    valid.map((it) => it.id),
  );
}

/** 候補の前後の文（表示用） */
export function refContext(
  state: EditorState,
  it: RefItem,
): { before: string; match: string; after: string } | null {
  if (it.type === 'note') return null;
  const $from = state.doc.resolve(it.from);
  const text = $from.parent.textContent;
  const start = it.from - $from.start();
  const len = it.to - it.from;
  return {
    before: text.slice(Math.max(0, start - 14), start),
    match: text.slice(start, start + len),
    after: text.slice(start + len, start + len + 14),
  };
}
