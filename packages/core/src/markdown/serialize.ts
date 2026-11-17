// 内部モデル → Markdown。見出し・空行の入れ方は現行ファイルに合わせる。
//   - 見出しの前後に空行1つ。項・号は空行なしで連続
//   - 項は「①　」、号は「一　」、細分は「イ　」。項が1つの条の本文は行頭に全角空白

import type {
  Article,
  ContinuationLines,
  Division,
  DivisionChild,
  Inline,
  RuleDoc,
  TopBlock,
} from '../model/types.ts';
import { DIVISION_HASHES, formatArticleNum, formatDivisionNum } from '../numbering/article.ts';
import { gouNumber, kouNumber, saibunNumber } from '../numbering/numbers.ts';
import { serializeFrontMatter } from './frontMatter.ts';
import { serializeInline } from './inline.ts';
import { DELETED_SUFFIX, GENERAL_MARKER } from './parse.ts';

export function serializeRule(doc: RuleDoc): string {
  const chunks: string[] = [];
  for (const block of doc.body) topBlock(block, chunks);
  const body = chunks.join('\n\n');
  return serializeFrontMatter(doc.meta) + (body ? '\n' + body + '\n' : '');
}

const lines = (ls: readonly Inline[][]) => ls.map(serializeInline).join('\n');

function push(chunks: string[], s: string) {
  if (s !== '') chunks.push(s);
}

function topBlock(block: TopBlock, chunks: string[]) {
  switch (block.type) {
    case 'preamble':
      chunks.push('## 前文');
      push(chunks, lines(block.lines));
      return;
    case 'supplementary':
      chunks.push('## 附則');
      push(chunks, lines(block.lines));
      for (const p of block.provisions) {
        chunks.push(`##### ${p.heading}` + (p.general ? '\n' + GENERAL_MARKER : ''));
        push(chunks, lines(p.lines));
      }
      return;
    case 'appendix':
      chunks.push(`## ${block.heading}`);
      push(chunks, lines(block.lines));
      return;
    default:
      divisionChild(block, chunks);
  }
}

function divisionChild(block: DivisionChild, chunks: string[]) {
  switch (block.type) {
    case 'division':
      chunks.push(divisionHeading(block));
      for (const c of block.children) divisionChild(c, chunks);
      return;
    case 'article':
      chunks.push(articleHeading(block) + (block.general ? '\n' + GENERAL_MARKER : ''));
      push(chunks, articleBody(block));
      return;
    case 'prose':
      push(chunks, lines(block.lines));
      return;
    case 'raw':
      chunks.push(block.source);
      return;
  }
}

export function divisionHeading(d: Division): string {
  const title = d.title ? (d.sep ?? ' ') + d.title : '';
  return '#'.repeat(DIVISION_HASHES[d.level]) + ' ' + formatDivisionNum(d.level, d.num) + title;
}

/** 条の見出しの文言（##### の後）。 */
export function articleHeadingText(a: Article): string {
  if (!a.num) return `（${a.caption}）`;
  const num = formatArticleNum(a.num);
  if (a.deleted) return num + DELETED_SUFFIX;
  return num + (a.caption ? `（${a.caption}）` : '');
}

function articleHeading(a: Article): string {
  return '##### ' + articleHeadingText(a);
}

function articleBody(a: Article): string {
  const out: string[] = [];
  const cont = (c: ContinuationLines | undefined) => {
    if (c) out.push(...c.map(serializeInline));
  };
  const single = a.paragraphs.length === 1;
  a.paragraphs.forEach((p, i) => {
    out.push((single ? '　' : kouNumber(i + 1) + '　') + serializeInline(p.text));
    cont(p.cont);
    p.items.forEach((item, j) => {
      out.push(gouNumber(j + 1) + '　' + serializeInline(item.text));
      cont(item.cont);
      item.subitems.forEach((sub, k) => {
        out.push(saibunNumber(k + 1) + '　' + serializeInline(sub.text));
        cont(sub.cont);
      });
    });
  });
  return out.join('\n');
}
