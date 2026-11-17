// 条の中の行の番号・字下げの種類を、行の並びから求める（番号は文書に持たない）。

import {
  formatArticleNum,
  gouNumber,
  kouNumber,
  lineKind,
  saibunNumber,
  type ArticleNum,
} from '@rule-builder/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { LineKind } from './schema.ts';

export type LineInfo = {
  kind: LineKind;
  /** portal の字下げのクラス（law-line--…） */
  cls: 'kou' | 'single' | 'gou' | 'saibun' | 'kou-cont';
  /** 行頭に出す番号（無ければ空） */
  label: string;
  /** 何番目の項・号・細分か（0 始まり。該当しなければ -1） */
  para: number;
  item: number;
  sub: number;
};

const safe = (f: (n: number) => string, n: number) => {
  try {
    return f(n);
  } catch {
    return '？';
  }
};

/** 条の行（lawLine）の並びから、各行の番号と種類を求める。 */
export function articleLineInfos(kinds: readonly LineKind[]): LineInfo[] {
  const single = kinds.filter((k) => k === 'kou').length <= 1;
  let para = -1;
  let item = -1;
  let sub = -1;
  return kinds.map((kind): LineInfo => {
    switch (kind) {
      case 'kou':
        para++;
        item = -1;
        sub = -1;
        return {
          kind,
          cls: single ? 'single' : 'kou',
          label: single ? '' : safe(kouNumber, para + 1),
          para,
          item,
          sub,
        };
      case 'gou':
        item++;
        sub = -1;
        return { kind, cls: 'gou', label: safe(gouNumber, item + 1), para, item, sub };
      case 'saibun':
        sub++;
        return { kind, cls: 'saibun', label: safe(saibunNumber, sub + 1), para, item, sub };
      default:
        return { kind, cls: single ? 'single' : 'kou-cont', label: '', para, item, sub };
    }
  });
}

export function lineKindsOf(article: PMNode): LineKind[] {
  const out: LineKind[] = [];
  article.forEach((child) => {
    if (child.type.name === 'lawLine') out.push(child.attrs.kind as LineKind);
  });
  return out;
}

export function articleLabel(num: ArticleNum | null): string {
  return num ? formatArticleNum(num) : '';
}

/** 前文・附則などの行の字下げの種類（portal と同じく行頭の番号で判定し、それ以外は plain）。 */
export function plainLineClass(text: string): 'plain' | 'kou' | 'gou' | 'saibun' {
  const k = lineKind(text);
  return k === 'text' ? 'plain' : k;
}

/** 位置の表示（「第2条 第3項 第1号」）。 */
export function locationLabel(
  article: ArticleNum | null,
  info: LineInfo | null,
  singleParagraph: boolean,
): string {
  let s = articleLabel(article) || '条';
  if (!info) return s + 'の見出し';
  // プロトタイプと同じ：項が1つの条の本文では項を出さない。号・細分では項から出す
  const inItem =
    info.kind === 'gou' || info.kind === 'saibun' || (info.kind === 'cont' && info.item >= 0);
  const inSub = info.kind === 'saibun' || (info.kind === 'cont' && info.sub >= 0);
  if (info.para >= 0 && (!singleParagraph || inItem)) s += ` 第${info.para + 1}項`;
  if (inItem) s += ` 第${info.item + 1}号`;
  if (inSub) s += ` ${safe(saibunNumber, info.sub + 1)}`;
  return s;
}
