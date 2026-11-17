// 改正前（原文）と比べた条ごとの変更（F-05・F-1A：変更した条に青い線、追加した条に緑の線）。
// エディタの条には改正前の何番目の条かの目印（baseKey）を持たせており、それで対応づける。

import { parseRule } from '../markdown/parse.ts';
import { articleBodyLines, articleHeadingText } from '../markdown/serialize.ts';
import { listArticles } from '../model/ops.ts';
import type { Article } from '../model/types.ts';
import { articleFromPM, type PMNode } from '../ydoc/pmJson.ts';

export type ArticleChange = 'new' | 'changed' | null;

/** 条の中身を比べるための文字列（見出し・一般向け・本文） */
export function articleSignature(a: Article): string {
  return [articleHeadingText(a), a.general ? 'general' : '', ...articleBodyLines(a)].join('\n');
}

export type ChangeSummary = {
  /** エディタの文書の条の並び順に、変更の種類 */
  articles: ArticleChange[];
  /** 改正前にあって今は無い条の数（後ろを詰めて削除したもの） */
  removed: number;
  /** 変更した条の数（追加・変更・削除の合計。ステータスバー用） */
  count: number;
};

export function articleChanges(baseMarkdown: string, doc: PMNode): ChangeSummary {
  const base = listArticles(parseRule(baseMarkdown).doc.body).map(articleSignature);
  const seen = new Set<number>();
  const articles = (doc.content ?? [])
    .filter((n) => n.type === 'article')
    .map((n): ArticleChange => {
      const key = n.attrs?.baseKey;
      if (typeof key !== 'number' || base[key] === undefined) return 'new';
      seen.add(key);
      return articleSignature(articleFromPM(n)) === base[key] ? null : 'changed';
    });
  const removed = base.length - seen.size;
  return { articles, removed, count: articles.filter((x) => x !== null).length + removed };
}
