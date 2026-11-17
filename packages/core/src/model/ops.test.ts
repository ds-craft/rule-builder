import { describe, expect, it } from 'vitest';
import { formatArticleNum, parseArticleNum, type ArticleNum } from '../numbering/article.ts';
import {
  checkRenumber,
  describeRenumbering,
  insertPositionAfter,
  numberingIssues,
  planDelete,
  planInsert,
  planSwap,
} from './ops.ts';

const ns = (...labels: string[]): ArticleNum[] => labels.map((l) => parseArticleNum(l)!);
const f = (n: ArticleNum | null) => (n ? formatArticleNum(n) : null);

describe('条の挿入', () => {
  const nums = ns('第1条', '第2条', '第2条の2', '第3条', '第4条');

  it('後に挿入は枝番号の条の間に割り込まない', () => {
    expect(insertPositionAfter(nums, 1)).toBe(3);
    expect(insertPositionAfter(nums, 2)).toBe(3);
    expect(insertPositionAfter(nums, 0)).toBe(1);
  });

  it('枝番号は空いている次の番号', () => {
    expect(f(planInsert(nums, 3).branch)).toBe('第2条の3');
    expect(f(planInsert(nums, 1).branch)).toBe('第1条の2');
  });

  it('後ろをずらす：第3条以降が1つずつ繰り下がる', () => {
    const p = planInsert(nums, 3);
    expect(f(p.shift)).toBe('第3条');
    expect(p.shifted.map(describeRenumbering)).toEqual(['第3条 → 第4条', '第4条 → 第5条']);
    expect(p.atEnd).toBe(false);
  });

  it('ずれる条の枝番号はそのまま', () => {
    const p = planInsert(ns('第1条', '第2条', '第2条の2'), 1);
    expect(p.shifted.map(describeRenumbering)).toEqual(['第2条 → 第3条', '第2条の2 → 第3条の2']);
  });

  it('先頭への挿入は第1条にし、全部ずらす（枝番号はない）', () => {
    const p = planInsert(nums, 0);
    expect(p.branch).toBeNull();
    expect(f(p.shift)).toBe('第1条');
    expect(p.shifted).toHaveLength(5);
  });

  it('末尾への追加はずれる条がない', () => {
    const p = planInsert(nums, 5);
    expect(f(p.shift)).toBe('第5条');
    expect(p.atEnd).toBe(true);
  });

  it('空の文書には第1条', () => {
    expect(f(planInsert([], 0).shift)).toBe('第1条');
  });
});

describe('条の削除', () => {
  it('後ろを詰める（プロトタイプと同じく、番号が大きい条だけを1つずつ繰り上げる）', () => {
    const p = planDelete(ns('第1条', '第2条', '第3条', '第3条の2'), 1);
    expect(p.closed.map(describeRenumbering)).toEqual(['第3条 → 第2条', '第3条の2 → 第2条の2']);
  });

  it('枝番号の条は同じ条の後ろの枝番号だけ詰める', () => {
    const p = planDelete(ns('第2条', '第2条の2', '第2条の3', '第3条'), 1);
    expect(p.closed.map(describeRenumbering)).toEqual(['第2条の3 → 第2条の2']);
  });
});

describe('移動・番号の変更・番号の点検', () => {
  it('番号の入れ替え', () => {
    expect(planSwap(ns('第1条', '第2条'), 0, 1).map(describeRenumbering)).toEqual([
      '第1条 → 第2条',
      '第2条 → 第1条',
    ]);
  });

  it('同じ番号があれば止める', () => {
    const nums = ns('第1条', '第2条');
    expect(checkRenumber(nums, 0, { main: 2, branches: [] })).toBe('第2条はすでにあります');
    expect(checkRenumber(nums, 0, { main: 1, branches: [2] })).toBeNull();
    expect(checkRenumber(nums, 0, { main: 1, branches: [1] })).not.toBeNull();
  });

  it('欠番・重複・順序の乱れ', () => {
    const issues = numberingIssues(ns('第1条', '第3条', '第3条', '第2条'));
    expect(issues.map((i) => i.message)).toEqual([
      '第2条がありません（欠番）',
      '第3条が2つあります',
      '第2条が第3条の後にあります（順番が前後しています）',
    ]);
  });
});
