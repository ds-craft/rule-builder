// 構造の操作（条・章・節・前文・附則）。番号の決め方は packages/core の ops.ts に従い、
// ここでは本文の組み替えと番号の属性の書き換えを1つの Transaction にまとめる（1回の「元に戻す」で戻る）。

import {
  insertPositionAfter,
  type ArticleNum,
  type ArticleNums,
  type DivisionLevel,
  type Renumbering,
} from '@rule-builder/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';

export type ArticleRef = { node: PMNode; pos: number; index: number };

/** 文書の中の条（並び順） */
export function articleRefs(doc: PMNode): ArticleRef[] {
  const out: ArticleRef[] = [];
  doc.forEach((node, pos) => {
    if (node.type.name === 'article') out.push({ node, pos, index: out.length });
  });
  return out;
}

export function articleNums(doc: PMNode): ArticleNums {
  return articleRefs(doc).map((a) => (a.node.attrs.num as ArticleNum | null) ?? null);
}

/** カーソルのある最上位のブロック */
function topBlockAt(state: EditorState): { node: PMNode; pos: number; index: number } | null {
  const $from = state.selection.$from;
  if ($from.depth < 1) return null;
  return { node: $from.node(1), pos: $from.before(1), index: $from.index(0) };
}

/** カーソルのある条（無ければ null） */
export function currentArticle(state: EditorState): ArticleRef | null {
  const top = topBlockAt(state);
  if (!top || top.node.type.name !== 'article') return null;
  return articleRefs(state.doc).find((a) => a.pos === top.pos) ?? null;
}

/** 附則・別表より前の、本則の終わり */
function bodyEnd(doc: PMNode): number {
  let end = doc.content.size;
  doc.forEach((node, pos) => {
    if (
      end === doc.content.size &&
      (node.type.name === 'supplementary' || node.type.name === 'appendix')
    ) {
      end = pos;
    }
  });
  return end;
}

export type InsertTarget = {
  /** 新しい条を入れる位置（文書の中の位置） */
  pos: number;
  /** 新しい条が何番目の条になるか */
  at: number;
  /** 基準にした条の番号（ダイアログの文言用） */
  anchor: ArticleNum | null;
};

/** 条を入れる位置。カーソルが条にあればその前後、章の見出しならその章の最初、前文なら前文の後 */
export function insertTarget(state: EditorState, where: 'before' | 'after'): InsertTarget {
  const refs = articleRefs(state.doc);
  const nums = refs.map((a) => (a.node.attrs.num as ArticleNum | null) ?? null);
  const cur = currentArticle(state);
  if (cur) {
    if (where === 'before') return { pos: cur.pos, at: cur.index, anchor: nums[cur.index] ?? null };
    const at = insertPositionAfter(nums, cur.index);
    const last = refs[at - 1]!;
    return { pos: last.pos + last.node.nodeSize, at, anchor: nums[at - 1] ?? null };
  }
  const top = topBlockAt(state);
  const end = bodyEnd(state.doc);
  let pos = end;
  if (top && ['division', 'preamble', 'prose', 'raw'].includes(top.node.type.name)) {
    pos = Math.min(top.pos + top.node.nodeSize, end);
  }
  const at = refs.filter((a) => a.pos < pos).length;
  return { pos, at, anchor: at > 0 ? (nums[at - 1] ?? null) : null };
}

function newArticle(state: EditorState, num: ArticleNum): PMNode {
  const { schema } = state;
  return schema.nodes.article!.create({ num, general: false, deleted: false }, [
    schema.nodes.articleCaption!.create(),
    schema.nodes.lawLine!.create({ kind: 'kou' }),
  ]);
}

/** 番号の属性を書き換える（位置は操作前の条の並びで指定し、tr の変更に合わせてずらす） */
function applyRenumbering(tr: Transaction, refs: ArticleRef[], renumbered: readonly Renumbering[]) {
  for (const r of renumbered) {
    const ref = refs[r.index];
    if (!ref) continue;
    const pos = tr.mapping.map(ref.pos);
    const node = tr.doc.nodeAt(pos);
    if (node?.type.name === 'article')
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, num: r.to });
  }
}

const cursorInto = (tr: Transaction, pos: number) =>
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos))).scrollIntoView();

/** 条を挿入する */
export function insertArticle(
  state: EditorState,
  target: InsertTarget,
  num: ArticleNum,
  renumbered: readonly Renumbering[],
): Transaction {
  const refs = articleRefs(state.doc);
  const tr = state.tr;
  applyRenumbering(tr, refs, renumbered);
  const pos = tr.mapping.map(target.pos);
  tr.insert(pos, newArticle(state, num));
  return cursorInto(tr, pos + 2);
}

/** 条を削除する。keep：「第5条　削除」として残す、close：消して後ろを詰める */
export function deleteArticle(
  state: EditorState,
  ref: ArticleRef,
  mode: 'keep' | 'close',
  renumbered: readonly Renumbering[],
): Transaction {
  const refs = articleRefs(state.doc);
  const tr = state.tr;
  if (mode === 'keep') {
    const { schema } = state;
    const kept = schema.nodes.article!.create(
      {
        ...ref.node.attrs,
        deleted: true,
        general: false,
        deletedContent: JSON.stringify(ref.node.toJSON()),
      },
      [schema.nodes.articleCaption!.create()],
    );
    tr.replaceWith(ref.pos, ref.pos + ref.node.nodeSize, kept);
    return cursorInto(tr, ref.pos + 1);
  }
  tr.delete(ref.pos, ref.pos + ref.node.nodeSize);
  applyRenumbering(tr, refs, renumbered);
  return cursorInto(tr, Math.min(tr.mapping.map(ref.pos), tr.doc.content.size));
}

/** 「削除」として残した条を元に戻す（削除したときの内容があればそれを、無ければ空の項を入れる） */
export function undeleteArticle(state: EditorState, ref: ArticleRef): Transaction {
  const { schema } = state;
  let restored: PMNode | null = null;
  const saved = ref.node.attrs.deletedContent as string | null;
  if (saved) {
    try {
      const n = schema.nodeFromJSON(JSON.parse(saved));
      restored = n.type.create(
        { ...n.attrs, num: ref.node.attrs.num, deleted: false, deletedContent: null },
        n.content,
      );
    } catch {
      restored = null;
    }
  }
  restored ??= schema.nodes.article!.create(
    { ...ref.node.attrs, deleted: false, deletedContent: null },
    [schema.nodes.articleCaption!.create(), schema.nodes.lawLine!.create({ kind: 'kou' })],
  );
  const tr = state.tr.replaceWith(ref.pos, ref.pos + ref.node.nodeSize, restored);
  return cursorInto(tr, ref.pos + 2);
}

export type MoveResult =
  | { error: string }
  | { tr: Transaction; crossed: 'division'; message: string }
  | { tr: Transaction; crossed: 'article'; other: ArticleRef; moved: ArticleRef };

/** 条を上下に1つ動かす。隣が章・節の見出しなら、その見出しを越えて前後の章・節へ移る */
export function moveArticle(state: EditorState, ref: ArticleRef, dir: -1 | 1): MoveResult {
  const doc = state.doc;
  const i = doc.resolve(ref.pos).index(0);
  const j = i + dir;
  if (j < 0 || j >= doc.childCount) return { error: 'これ以上移動できません' };
  const other = doc.child(j);
  if (!['article', 'division'].includes(other.type.name))
    return { error: 'これ以上移動できません' };
  let otherPos = 0;
  for (let k = 0; k < j; k++) otherPos += doc.child(k).nodeSize;
  const tr = state.tr;
  if (dir < 0) {
    // 前の兄弟の前へ
    tr.delete(ref.pos, ref.pos + ref.node.nodeSize);
    tr.insert(otherPos, ref.node);
    cursorInto(tr, otherPos + 2);
  } else {
    // 次の兄弟の後ろへ
    const after = otherPos + other.nodeSize;
    tr.insert(after, ref.node);
    tr.delete(ref.pos, ref.pos + ref.node.nodeSize);
    const newPos = after - ref.node.nodeSize;
    cursorInto(tr, newPos + 2);
  }
  if (other.type.name === 'division') {
    return {
      tr,
      crossed: 'division',
      message: dir < 0 ? '前の章・節に移動しました' : '次の章・節に移動しました',
    };
  }
  const refs = articleRefs(doc);
  const o = refs.find((a) => a.pos === otherPos)!;
  return { tr, crossed: 'article', other: o, moved: ref };
}

/** 条番号を書き換える（移動のあとの入れ替えや、番号の変更で使う） */
export function renumberArticles(
  state: EditorState,
  renumbered: readonly Renumbering[],
): Transaction {
  const tr = state.tr;
  applyRenumbering(tr, articleRefs(state.doc), renumbered);
  return tr;
}

/** 章・節を挿入する（カーソルのある最上位のブロックの後ろ） */
export function insertDivision(state: EditorState, level: DivisionLevel): Transaction {
  const top = topBlockAt(state);
  const end = bodyEnd(state.doc);
  let pos = end;
  if (top && top.node.type.name !== 'preamble') pos = Math.min(top.pos + top.node.nodeSize, end);
  else if (top?.node.type.name === 'preamble') pos = top.pos + top.node.nodeSize;
  // 前文の前には入れない
  const first = state.doc.firstChild;
  if (pos === 0 && first?.type.name === 'preamble') pos = first.nodeSize;
  const tr = state.tr.insert(pos, state.schema.nodes.division!.create({ level }));
  return cursorInto(tr, pos + 1);
}

export function hasPreamble(doc: PMNode): boolean {
  return doc.firstChild?.type.name === 'preamble';
}

/** 前文を追加する（文書の先頭） */
export function insertPreamble(state: EditorState): Transaction {
  const { schema } = state;
  const tr = state.tr.insert(
    0,
    schema.nodes.preamble!.create(null, schema.nodes.plainLine!.create()),
  );
  return cursorInto(tr, 2);
}

/** 附則に行を追加する（附則が無ければ「附則」の見出しごと作る） */
export function addSupplementaryLine(state: EditorState): Transaction {
  const { schema } = state;
  const doc = state.doc;
  let supp: { node: PMNode; pos: number } | null = null;
  doc.forEach((node, pos) => {
    if (!supp && node.type.name === 'supplementary') supp = { node, pos };
  });
  const line = schema.nodes.plainLine!.create();
  if (!supp) {
    const pos = bodyEnd(doc);
    const node = schema.nodes.supplementary!.create(null, [
      schema.nodes.provision!.create(null, [
        schema.nodes.provisionHeading!.create(null, schema.text('附則')),
        line,
      ]),
    ]);
    const tr = state.tr.insert(pos, node);
    return cursorInto(tr, pos + node.nodeSize - 2);
  }
  const s = supp as { node: PMNode; pos: number };
  // 最後の附則の見出しの中の末尾（見出しが無ければ附則の末尾）
  const last = s.node.lastChild;
  let insertAt = s.pos + s.node.nodeSize - 1;
  if (last?.type.name === 'provision') insertAt = s.pos + s.node.nodeSize - 2;
  const tr = state.tr.insert(insertAt, line);
  return cursorInto(tr, insertAt + 1);
}
