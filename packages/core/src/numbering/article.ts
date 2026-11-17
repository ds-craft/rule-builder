// 条番号（第2条の2）と章・節・款の番号。

/** 条番号。{ main: 2, branches: [2] } は「第2条の2」。 */
export type ArticleNum = { main: number; branches: number[] };

export function formatArticleNum(num: ArticleNum): string {
  return `第${num.main}条` + num.branches.map((b) => `の${b}`).join('');
}

const ARTICLE_NUM_RE = /^第(\d+)条((?:の\d+)*)$/;

export function parseArticleNum(s: string): ArticleNum | null {
  const m = ARTICLE_NUM_RE.exec(s);
  if (!m) return null;
  const branches = m[2] ? m[2].split('の').slice(1).map(Number) : [];
  return { main: Number(m[1]), branches };
}

/** 条番号の大小比較（第2条 < 第2条の2 < 第2条の2の1 < 第2条の3 < 第3条）。 */
export function compareArticleNum(a: ArticleNum, b: ArticleNum): number {
  const xs = [a.main, ...a.branches];
  const ys = [b.main, ...b.branches];
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    const x = xs[i];
    const y = ys[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x !== y) return x - y;
  }
  return 0;
}

export function articleNumEquals(a: ArticleNum, b: ArticleNum): boolean {
  return compareArticleNum(a, b) === 0;
}

export type DivisionLevel = 'chapter' | 'section' | 'subsection';

export const DIVISION_UNIT: Record<DivisionLevel, string> = {
  chapter: '章',
  section: '節',
  subsection: '款',
};

/** 見出しの # の数。 */
export const DIVISION_HASHES: Record<DivisionLevel, number> = {
  chapter: 2,
  section: 3,
  subsection: 4,
};

export function formatDivisionNum(level: DivisionLevel, num: number): string {
  return `第${num}${DIVISION_UNIT[level]}`;
}
