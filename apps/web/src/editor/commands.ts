// 条文の行の操作。EditorState を受け取り、変更（Transaction）か利用者向けのエラー文言を返す。
// 実際の反映は呼び出し側が dispatch する（キー操作・リボン・右クリックで共通）。

import type { ArticleNum } from '@rule-builder/core';
import type { Fragment, Node as PMNode } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { articleLineInfos, lineKindsOf, locationLabel, type LineInfo } from './lines.ts';
import type { LineKind } from './schema.ts';

export type Result = { tr: Transaction } | { error: string };

export type LineRef = { node: PMNode; pos: number };

export type ArticleCursor = {
  article: PMNode;
  articlePos: number;
  lines: LineRef[];
  infos: LineInfo[];
  /** カーソルのある行の番号（見出しなら -1） */
  index: number;
};

/** カーソルのある条と行。条の外なら null */
export function articleCursor(state: EditorState): ArticleCursor | null {
  const $from = state.selection.$from;
  if ($from.depth < 1) return null;
  const article = $from.node(1);
  if (article.type.name !== 'article') return null;
  const articlePos = $from.before(1);
  const lines: LineRef[] = [];
  article.forEach((child, offset) => {
    if (child.type.name === 'lawLine') lines.push({ node: child, pos: articlePos + 1 + offset });
  });
  const linePos = $from.depth >= 2 ? $from.before(2) : -1;
  const index = lines.findIndex((l) => l.pos === linePos);
  return { article, articlePos, lines, infos: articleLineInfos(lineKindsOf(article)), index };
}

/** カーソルのある行の種類（条の行でなければ null） */
export function currentLineKind(state: EditorState): LineKind | null {
  const c = articleCursor(state);
  return c && c.index >= 0 ? c.infos[c.index]!.kind : null;
}

/** ステータスバーの位置の表示 */
export function cursorLocation(state: EditorState): string {
  const c = articleCursor(state);
  const $from = state.selection.$from;
  if (!c) {
    const top = $from.depth >= 1 ? $from.node(1).type.name : '';
    return (
      {
        preamble: '前文',
        supplementary: '附則',
        appendix: '別表',
        prose: '本文',
        division: '章・節の名前',
        raw: '解釈できなかった行',
      }[top] ?? '—'
    );
  }
  const single = c.infos.filter((i) => i.kind === 'kou').length <= 1;
  return locationLabel(
    c.article.attrs.num as ArticleNum | null,
    c.index >= 0 ? c.infos[c.index]! : null,
    single,
  );
}

const LEVEL: Record<LineKind, number> = { kou: 1, gou: 2, saibun: 3, cont: 4 };

/** 行 i の下にぶら下がる行（号・細分・続き）の次の位置 */
function blockEnd(c: ArticleCursor, i: number): number {
  const level = LEVEL[c.infos[i]!.kind];
  let j = i + 1;
  while (j < c.lines.length) {
    const k = c.infos[j]!.kind;
    if (k !== 'cont' && LEVEL[k] <= level) break;
    j++;
  }
  return j;
}

/** 行の番号 j の前の位置（j が末尾なら条の終わり） */
function posBeforeLine(c: ArticleCursor, j: number): number {
  const l = c.lines[j];
  return l ? l.pos : c.articlePos + c.article.nodeSize - 1;
}

function newLine(state: EditorState, kind: LineKind, content?: Fragment | PMNode | null): PMNode {
  return state.schema.nodes.lawLine!.create({ kind }, content);
}

function withCursorAt(tr: Transaction, pos: number): Transaction {
  return tr.setSelection(TextSelection.create(tr.doc, pos)).scrollIntoView();
}

const NOT_IN_ARTICLE = '条の中の行にカーソルを置いてください';

function setKind(state: EditorState, c: ArticleCursor, kind: LineKind): Transaction {
  const l = c.lines[c.index]!;
  return state.tr.setNodeMarkup(l.pos, undefined, { ...l.node.attrs, kind });
}

/** レベルを下げる（項 → 前の項の号、号 → 前の号の細分） */
export function demote(state: EditorState): Result {
  const c = articleCursor(state);
  if (!c || c.index < 0) return { error: NOT_IN_ARTICLE };
  const info = c.infos[c.index]!;
  if (info.kind === 'kou') {
    if (info.para === 0) return { error: '最初の項は号にできません（前に項が必要です）' };
    return { tr: setKind(state, c, 'gou') };
  }
  if (info.kind === 'gou') {
    if (info.item === 0) return { error: '最初の号は号の細分にできません（前に号が必要です）' };
    return { tr: setKind(state, c, 'saibun') };
  }
  return { error: 'これ以上レベルを下げられません' };
}

/** レベルを上げる（細分 → 号、号 → 項） */
export function promote(state: EditorState): Result {
  const c = articleCursor(state);
  if (!c || c.index < 0) return { error: NOT_IN_ARTICLE };
  const kind = c.infos[c.index]!.kind;
  if (kind === 'saibun') return { tr: setKind(state, c, 'gou') };
  if (kind === 'gou') {
    // 号 → 項：この号の細分は新しい項の号になる
    const tr = setKind(state, c, 'kou');
    for (let j = c.index + 1; j < c.lines.length && c.infos[j]!.kind === 'saibun'; j++) {
      const l = c.lines[j]!;
      tr.setNodeMarkup(l.pos, undefined, { ...l.node.attrs, kind: 'gou' });
    }
    return { tr };
  }
  return { error: 'これ以上レベルを上げられません' };
}

/** 行の種類を変える（ギャラリー）。1段ずつ上げ下げしたのと同じ結果にする */
export function changeKind(state: EditorState, target: 'kou' | 'gou' | 'saibun'): Result {
  const c = articleCursor(state);
  if (!c || c.index < 0) return { error: NOT_IN_ARTICLE };
  const order = ['kou', 'gou', 'saibun'];
  let cur = order.indexOf(c.infos[c.index]!.kind);
  const goal = order.indexOf(target);
  if (cur < 0) return { error: 'この行の種類は変えられません' };
  let s = state;
  let tr: Transaction | null = null;
  while (cur !== goal) {
    const r = cur < goal ? demote(s) : promote(s);
    if ('error' in r) return r;
    tr = tr ?? state.tr;
    r.tr.steps.forEach((step) => tr!.step(step));
    s = s.apply(r.tr);
    cur += cur < goal ? 1 : -1;
  }
  return tr ? { tr } : { error: '' };
}

/** 項を追加する（今の項の後に） */
export function addParagraph(state: EditorState): Result {
  const c = articleCursor(state);
  if (!c) return { error: '条の中にカーソルを置いてください' };
  if (c.article.attrs.deleted) return { error: '削除した条には追加できません' };
  let at = c.lines.length;
  if (c.index >= 0) {
    // 今の項の終わり（次の項の前）
    at = c.index + 1;
    while (at < c.lines.length && c.infos[at]!.kind !== 'kou') at++;
  }
  const pos = posBeforeLine(c, at);
  const tr = state.tr.insert(pos, newLine(state, 'kou'));
  return { tr: withCursorAt(tr, pos + 1) };
}

/** 号を追加する（項にカーソルがあればその項の最初の号、号なら今の号の後） */
export function addItem(state: EditorState): Result {
  const c = articleCursor(state);
  if (!c || c.index < 0) return { error: '項の中にカーソルを置いてください' };
  const info = c.infos[c.index]!;
  let at: number;
  if (info.kind === 'kou' || (info.kind === 'cont' && info.item < 0)) {
    at = c.index + 1;
    while (at < c.lines.length && c.infos[at]!.kind === 'cont') at++;
  } else {
    at = c.index + 1;
    while (at < c.lines.length && !['gou', 'kou'].includes(c.infos[at]!.kind)) at++;
  }
  const pos = posBeforeLine(c, at);
  const tr = state.tr.insert(pos, newLine(state, 'gou'));
  return { tr: withCursorAt(tr, pos + 1) };
}

/** Enter：同じ種類の次の行を作る。空の号・細分ではレベルを上げる */
export function enterInLine(state: EditorState): Result | null {
  if (!state.selection.empty) {
    // 選択していた文字を消してから改めて Enter
    const tr = state.tr.deleteSelection();
    const r = enterInLine(state.apply(tr));
    if (!r || 'error' in r) return { tr };
    r.tr.steps.forEach((step) => tr.step(step));
    return { tr: withCursorAt(tr, r.tr.selection.from) };
  }
  const c = articleCursor(state);
  if (!c) return null;
  if (c.index < 0) {
    // 見出しで Enter：最初の行へ（無ければ作る）
    const first = c.lines[0];
    if (first) return { tr: withCursorAt(state.tr, first.pos + 1) };
    const pos = posBeforeLine(c, 0);
    return { tr: withCursorAt(state.tr.insert(pos, newLine(state, 'kou')), pos + 1) };
  }
  const line = c.lines[c.index]!;
  const kind = c.infos[c.index]!.kind;
  if (line.node.content.size === 0 && (kind === 'gou' || kind === 'saibun')) return promote(state);
  const cut = state.selection.from;
  const lineEnd = line.pos + line.node.nodeSize - 1;
  const tail = state.doc.slice(cut, lineEnd).content;
  // 今の行の下にぶら下がる号・細分は今の行に残し、新しい行はその後ろに置く（プロトタイプと同じ）
  const insertAt = posBeforeLine(c, blockEnd(c, c.index));
  const tr = state.tr.insert(insertAt, newLine(state, kind, tail)).delete(cut, lineEnd);
  return { tr: withCursorAt(tr, insertAt - (lineEnd - cut) + 1) };
}

/** 行頭で Backspace：号・細分はレベルを上げる。空の行は消して前の行の末尾へ */
export function backspaceAtLineStart(state: EditorState): Result | null {
  const sel = state.selection;
  if (!sel.empty || sel.$from.parentOffset !== 0) return null;
  const c = articleCursor(state);
  if (c && c.index >= 0) {
    const line = c.lines[c.index]!;
    const kind = c.infos[c.index]!.kind;
    if (kind === 'gou' || kind === 'saibun') return promote(state);
    if (line.node.content.size === 0) {
      if (c.lines.length < 2) return { error: '' };
      return { tr: deleteLineTo(state, line) };
    }
    // 最初の行の先頭では見出しと結合しない
    if (c.index === 0) return { error: '' };
    return null;
  }
  // 前文・附則などの空の行
  const $from = sel.$from;
  if ($from.parent.type.name === 'plainLine' && $from.parent.content.size === 0) {
    const container = $from.node($from.depth - 1);
    const plainCount = countChildren(container, 'plainLine');
    if (plainCount < 2 && ['preamble', 'prose'].includes(container.type.name)) return { error: '' };
    return { tr: deleteLineTo(state, { node: $from.parent, pos: $from.before() }) };
  }
  return null;
}

function countChildren(node: PMNode, type: string): number {
  let n = 0;
  node.forEach((c) => {
    if (c.type.name === type) n++;
  });
  return n;
}

/** 行を消し、前の行の末尾にカーソルを置く */
function deleteLineTo(state: EditorState, line: LineRef): Transaction {
  const tr = state.tr.delete(line.pos, line.pos + line.node.nodeSize);
  const $prev = tr.doc.resolve(Math.max(0, Math.min(line.pos, tr.doc.content.size)));
  const sel = TextSelection.findFrom($prev, -1, true) ?? TextSelection.findFrom($prev, 1, true);
  if (sel) tr.setSelection(sel);
  return tr.scrollIntoView();
}

/** 一般向けの切り替え */
export function toggleGeneral(state: EditorState): Result {
  const c = articleCursor(state);
  if (!c) return { error: '条の中にカーソルを置いてください' };
  const tr = state.tr.setNodeMarkup(c.articlePos, undefined, {
    ...c.article.attrs,
    general: !c.article.attrs.general,
  });
  return { tr };
}

// ---------- 貼り付け ----------

const PASTE_KOU = /^[①-⑳㉑-㉟㊱-㊿][　 ]?/;
const PASTE_GOU = /^[一二三四五六七八九十]+[　 ]/;
const PASTE_SAIBUN =
  /^[イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセス][　 ]/;

/** 貼り付けた行を、行頭の番号から項・号・細分に分ける */
export function classifyPastedLines(
  text: string,
): { kind: 'kou' | 'gou' | 'saibun'; text: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l) => {
      if (PASTE_GOU.test(l)) return { kind: 'gou' as const, text: l.replace(PASTE_GOU, '') };
      if (PASTE_SAIBUN.test(l))
        return { kind: 'saibun' as const, text: l.replace(PASTE_SAIBUN, '') };
      return { kind: 'kou' as const, text: l.replace(PASTE_KOU, '').replace(/^　/, '') };
    });
}

/** 複数行の貼り付け。条の行・前文などの行で使える。それ以外は null（1行にして入れる） */
export function pasteLines(state: EditorState, text: string): Result | null {
  const rows = classifyPastedLines(text);
  if (rows.length === 0) return null;
  const { schema } = state;
  const $from = state.selection.$from;
  const parent = $from.parent;
  const mk = (t: string) => (t ? schema.text(t) : undefined);

  if (parent.type.name === 'lawLine') {
    const c = articleCursor(state)!;
    const line = c.lines[c.index]!;
    const nodes = rows.map((r) => newLine(state, r.kind, mk(r.text)));
    let tr = state.tr;
    let insertAt: number;
    if (line.node.content.size === 0) {
      tr = tr.delete(line.pos, line.pos + line.node.nodeSize);
      insertAt = line.pos;
    } else {
      insertAt = line.pos + line.node.nodeSize;
    }
    let size = 0;
    for (const n of nodes) {
      tr = tr.insert(insertAt + size, n);
      size += n.nodeSize;
    }
    return { tr: withCursorAt(tr, insertAt + size - 1) };
  }
  if (parent.type.name === 'plainLine') {
    const pos = $from.after();
    let tr = state.tr;
    let size = 0;
    for (const raw of text.split(/\r?\n/).filter((l) => l.trim())) {
      const indent = /^[　 ]*/.exec(raw)![0];
      const t = raw.slice(indent.length);
      const n = schema.nodes.plainLine!.create(
        { indent: indent || '　' },
        t ? schema.text(t) : undefined,
      );
      tr = tr.insert(pos + size, n);
      size += n.nodeSize;
    }
    return { tr: withCursorAt(tr, pos + size - 1) };
  }
  return null;
}
