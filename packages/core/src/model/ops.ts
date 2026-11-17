// 条番号の操作（純粋関数）。条の挿入・削除・移動・番号変更で、どの条がどの番号になるかを決める。
// 文書の中の条の並び（番号の配列）だけを扱い、本文の組み替えはエディタ側で行う。
// 戻り値の renumbered（旧→新の対応表）は、参照の確認（Phase 7）で使う。

import {
  articleNumEquals,
  compareArticleNum,
  formatArticleNum,
  type ArticleNum,
} from '../numbering/article.ts';
import type { Article, TopBlock } from './types.ts';

/** 文書の中の条の番号の並び（番号のない条は null） */
export type ArticleNums = readonly (ArticleNum | null)[];

/** 番号が変わる条（index は操作前の並びでの位置） */
export type Renumbering = { index: number; from: ArticleNum; to: ArticleNum };

/** 文書の中の条を順に並べる（章・節の中も含む） */
export function listArticles(body: readonly TopBlock[]): Article[] {
  const out: Article[] = [];
  const walk = (blocks: readonly TopBlock[]) => {
    for (const b of blocks) {
      if (b.type === 'article') out.push(b);
      else if (b.type === 'division') walk(b.children);
    }
  };
  walk(body);
  return out;
}

const num = (main: number, branches: number[] = []): ArticleNum => ({ main, branches });
const exists = (nums: ArticleNums, n: ArticleNum) => nums.some((x) => x && articleNumEquals(x, n));

/** index より前で、番号のある最後の条 */
function prevNum(nums: ArticleNums, index: number): ArticleNum | null {
  for (let i = index - 1; i >= 0; i--) if (nums[i]) return nums[i]!;
  return null;
}

/**
 * 「後に挿入」の位置。枝番号の条（第2条の2 など）の後ろに入れ、枝番号の条の間に割り込まない。
 * @param anchor カーソルのある条の位置
 * @returns 新しい条を入れる位置（その位置の条の前に入る）
 */
export function insertPositionAfter(nums: ArticleNums, anchor: number): number {
  const a = nums[anchor];
  let at = anchor + 1;
  if (!a) return at;
  while (at < nums.length) {
    const n = nums[at];
    if (!n || n.main !== a.main || n.branches.length === 0) break;
    at++;
  }
  return at;
}

export type InsertPlan = {
  /** 枝番号にする場合の番号（前に条がなければ null） */
  branch: ArticleNum | null;
  /** 後ろをずらす場合の番号 */
  shift: ArticleNum;
  /** 後ろをずらす場合に番号が変わる条 */
  shifted: Renumbering[];
  /** 末尾への追加（ずれる条がないので聞かずに入れる） */
  atEnd: boolean;
};

/** 位置 at に条を入れるときの番号の候補 */
export function planInsert(nums: ArticleNums, at: number): InsertPlan {
  const prev = prevNum(nums, at);
  let branch: ArticleNum | null = null;
  if (prev) {
    branch = num(prev.main, [(prev.branches[0] ?? 1) + 1]);
    while (exists(nums, branch)) branch = num(branch.main, [branch.branches[0]! + 1]);
  }
  const shift = num((prev?.main ?? 0) + 1);
  const shifted: Renumbering[] = [];
  nums.forEach((n, index) => {
    if (index < at || !n || n.main < shift.main) return;
    shifted.push({ index, from: n, to: num(n.main + 1, n.branches) });
  });
  return { branch, shift, shifted, atEnd: shifted.length === 0 };
}

export type DeletePlan = {
  /** 「後ろの条を詰める」場合に番号が変わる条 */
  closed: Renumbering[];
};

/** index の条を削除するときに、後ろを詰めた場合の番号 */
export function planDelete(nums: ArticleNums, index: number): DeletePlan {
  const d = nums[index];
  const closed: Renumbering[] = [];
  if (!d) return { closed };
  nums.forEach((n, i) => {
    if (i === index || !n) return;
    if (d.branches.length > 0) {
      // 枝番号の条を消したときは、同じ条の後ろの枝番号を詰める
      if (n.main === d.main && (n.branches[0] ?? 0) > d.branches[0]!) {
        closed.push({
          index: i,
          from: n,
          to: num(n.main, [n.branches[0]! - 1, ...n.branches.slice(1)]),
        });
      }
    } else if (n.main > d.main) {
      closed.push({ index: i, from: n, to: num(n.main - 1, n.branches) });
    }
  });
  return { closed };
}

/** 隣り合う2つの条の番号を入れ替える */
export function planSwap(nums: ArticleNums, i: number, j: number): Renumbering[] {
  const a = nums[i];
  const b = nums[j];
  if (!a || !b) return [];
  return [
    { index: i, from: a, to: b },
    { index: j, from: b, to: a },
  ];
}

/** 条番号を直接変えるときの確認。問題なければ null、あれば利用者向けの文言 */
export function checkRenumber(nums: ArticleNums, index: number, to: ArticleNum): string | null {
  if (
    !Number.isInteger(to.main) ||
    to.main < 1 ||
    to.branches.some((b) => !Number.isInteger(b) || b < 2)
  ) {
    return '条番号が正しくありません（枝番号は2以上）';
  }
  if (nums.some((n, i) => i !== index && n && articleNumEquals(n, to))) {
    return `${formatArticleNum(to)}はすでにあります`;
  }
  return null;
}

/** 条番号の欠番・重複・順序の乱れ（書式チェックで使う） */
export type NumberingIssue = {
  index: number;
  kind: 'duplicate' | 'gap' | 'order';
  message: string;
};

export function numberingIssues(nums: ArticleNums): NumberingIssue[] {
  const out: NumberingIssue[] = [];
  const seen = new Set<string>();
  let prev: ArticleNum | null = null;
  nums.forEach((n, index) => {
    if (!n) return;
    const label = formatArticleNum(n);
    if (seen.has(label)) out.push({ index, kind: 'duplicate', message: `${label}が2つあります` });
    seen.add(label);
    if (prev && n.branches.length === 0 && prev.main + 1 < n.main) {
      out.push({ index, kind: 'gap', message: `第${prev.main + 1}条がありません（欠番）` });
    }
    if (prev && compareArticleNum(prev, n) > 0) {
      out.push({
        index,
        kind: 'order',
        message: `${label}が${formatArticleNum(prev)}の後にあります（順番が前後しています）`,
      });
    }
    prev = n;
  });
  return out;
}

/** 対応表の表示用（「第3条 → 第4条」） */
export function describeRenumbering(r: Renumbering): string {
  return `${formatArticleNum(r.from)} → ${formatArticleNum(r.to)}`;
}
