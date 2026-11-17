// Markdown → 内部モデル。
// portal の _includes/rule-scripts.html の判定と同じ規則で行単位に読む。
// 移植元: ds-craft/portal _includes/rule-scripts.html（fb5a7ef）
// 解釈できない行は RawLine として位置ごと保持し、警告を出す（読み込みを止めない）。

import type {
  Article,
  ContinuationLines,
  Division,
  DivisionChild,
  Inline,
  Item,
  Paragraph,
  RuleDoc,
  SubItem,
  Supplementary,
  SupplementaryProvision,
  TopBlock,
} from '../model/types.ts';
import { DIVISION_HASHES, parseArticleNum, type DivisionLevel } from '../numbering/article.ts';
import {
  GOU_RE,
  kouNumber,
  lineKind,
  parseGouNumber,
  parseKouNumber,
  parseSaibunNumber,
} from '../numbering/numbers.ts';
import { parseFrontMatter, type Warning } from './frontMatter.ts';
import { parseInline } from './inline.ts';

export type { Warning };

export const GENERAL_MARKER = '{: data-general="true"}';
export const DELETED_SUFFIX = '　削除';

export type ParseResult = { doc: RuleDoc; warnings: Warning[] };

type Line = { text: string; no: number };

type Token =
  | { t: 'heading'; hashes: number; text: string; general: boolean; no: number }
  | { t: 'lines'; lines: Line[] };

/** 改行コードを LF にそろえる（読み込み時の正規化。docs/normalization.md）。 */
export function normalizeNewlines(src: string): string {
  return src.replace(/\r\n?/g, '\n');
}

export function parseRule(source: string): ParseResult {
  const src = normalizeNewlines(source);
  const all = src.split('\n');
  if (all[all.length - 1] === '') all.pop();
  const warnings: Warning[] = [];

  // front matter
  let bodyStart = 0;
  let fmLines: string[] = [];
  if (all[0] === '---') {
    const end = all.indexOf('---', 1);
    if (end > 0) {
      fmLines = all.slice(1, end);
      bodyStart = end + 1;
    } else {
      warnings.push({ line: 1, message: 'front matter の終わり（---）がありません' });
    }
  } else {
    warnings.push({ line: 1, message: 'front matter がありません' });
  }
  const { meta, warnings: fmWarnings } = parseFrontMatter(fmLines);
  warnings.push(...fmWarnings);

  const tokens = tokenize(all.slice(bodyStart), bodyStart + 1);
  const body = new BodyBuilder(warnings).build(tokens);
  return { doc: { meta, body }, warnings };
}

function tokenize(lines: string[], firstNo: number): Token[] {
  const tokens: Token[] = [];
  let run: Line[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    const no = firstNo + i;
    const h = /^(#{1,6}) (.*)$/.exec(text);
    if (h) {
      run = null;
      let general = false;
      if (lines[i + 1] === GENERAL_MARKER) {
        general = true;
        i++;
      }
      tokens.push({ t: 'heading', hashes: h[1]!.length, text: h[2]!, general, no });
    } else if (text === '') {
      run = null;
    } else {
      if (!run) {
        run = [];
        tokens.push({ t: 'lines', lines: run });
      }
      run.push({ text, no });
    }
  }
  return tokens;
}

const LEVEL_BY_UNIT: Record<string, DivisionLevel> = {
  章: 'chapter',
  節: 'section',
  款: 'subsection',
};
const DIVISION_RE = /^第(\d+)(章|節|款)(?:([ 　])(.*))?$/;
const ARTICLE_HEAD_RE = /^(第\d+条(?:の\d+)*)(?:（(.*)）)?$/;

class BodyBuilder {
  private body: TopBlock[] = [];
  /** 開いている章・節・款（外側から） */
  private divisions: Division[] = [];
  /** 本文の行の受け手 */
  private receiver:
    | { kind: 'lines'; lines: Inline[][] }
    | { kind: 'article'; article: Article; started: boolean }
    | null = null;
  private supplementary: Supplementary | null = null;

  private warnings: Warning[];

  constructor(warnings: Warning[]) {
    this.warnings = warnings;
  }

  build(tokens: Token[]): TopBlock[] {
    for (const tok of tokens) {
      if (tok.t === 'heading') this.heading(tok);
      else this.lines(tok.lines);
    }
    return this.body;
  }

  private warn(no: number | undefined, message: string) {
    this.warnings.push({ line: no, message });
  }

  /** 章・節・款・条・本文を入れる先 */
  private container(): DivisionChild[] | TopBlock[] {
    const d = this.divisions[this.divisions.length - 1];
    return d ? d.children : this.body;
  }

  private raw(source: string, reason: string, no: number) {
    this.warn(no, `${reason}: ${source}`);
    this.container().push({ type: 'raw', source, reason });
  }

  private heading(tok: Extract<Token, { t: 'heading' }>) {
    const { hashes, text, general, no } = tok;
    const source = '#'.repeat(hashes) + ' ' + text;
    this.receiver = null;
    if (general && hashes !== 5) this.warn(no, '一般向けの印は条の見出しの直後にだけ付けられます');

    if (hashes === 2) {
      this.divisions = [];
      this.supplementary = null;
      if (text === '前文') {
        const lines: Inline[][] = [];
        this.body.push({ type: 'preamble', lines });
        this.receiver = { kind: 'lines', lines };
        return;
      }
      if (text === '附則') {
        this.supplementary = { type: 'supplementary', lines: [], provisions: [] };
        this.body.push(this.supplementary);
        this.receiver = { kind: 'lines', lines: this.supplementary.lines };
        return;
      }
      if (text.startsWith('別表')) {
        const lines: Inline[][] = [];
        this.body.push({ type: 'appendix', heading: text, lines });
        this.receiver = { kind: 'lines', lines };
        return;
      }
    }

    if (hashes >= 2 && hashes <= 4) {
      const m = DIVISION_RE.exec(text);
      const level = m ? LEVEL_BY_UNIT[m[2]!] : undefined;
      if (!m || !level || DIVISION_HASHES[level] !== hashes) {
        this.raw(source, '見出しを解釈できません', no);
        return;
      }
      if (this.supplementary) {
        this.raw(source, '附則の中に章・節・款は置けません', no);
        return;
      }
      const division: Division = {
        type: 'division',
        level,
        num: Number(m[1]),
        title: m[4] ?? '',
        children: [],
      };
      if (m[3] !== undefined && m[3] !== ' ') division.sep = m[3];
      // 親：自分より浅い見出しの章・節
      while (this.divisions.length) {
        const top = this.divisions[this.divisions.length - 1]!;
        if (DIVISION_HASHES[top.level] < hashes) break;
        this.divisions.pop();
      }
      this.container().push(division);
      this.divisions.push(division);
      return;
    }

    if (hashes === 5) {
      if (this.supplementary) {
        const provision: SupplementaryProvision = { heading: text, general, lines: [] };
        this.supplementary.provisions.push(provision);
        this.receiver = { kind: 'lines', lines: provision.lines };
        return;
      }
      const article = parseArticleHeading(text, general);
      if (!article) {
        this.raw(source, '条の見出しを解釈できません', no);
        return;
      }
      this.container().push(article);
      this.receiver = { kind: 'article', article, started: false };
      return;
    }

    this.raw(source, '見出しを解釈できません', no);
  }

  private lines(lines: Line[]) {
    const r = this.receiver;
    if (!r) {
      // 条の見出しがない本文（施行令の本則など）
      const prose: Inline[][] = lines.map((l) => parseInline(l.text));
      this.container().push({ type: 'prose', lines: prose });
      // 続けて現れた行の並び（空行で区切られたもの）は別の本文のかたまりにする
      return;
    }
    if (r.kind === 'lines') {
      if (r.lines.length > 0) {
        this.warn(lines[0]!.no, '空行を詰めました');
      }
      r.lines.push(...lines.map((l) => parseInline(l.text)));
      return;
    }
    if (r.article.deleted) {
      for (const l of lines) this.raw(l.text, '削除した条に本文があります', l.no);
      return;
    }
    if (r.started) this.warn(lines[0]!.no, '条の中の空行を詰めました');
    r.started = true;
    parseArticleBody(r.article, lines, this.warnings);
  }
}

export function parseArticleHeading(text: string, general: boolean): Article | null {
  if (text.endsWith(DELETED_SUFFIX)) {
    const num = parseArticleNum(text.slice(0, -DELETED_SUFFIX.length));
    if (num) return { type: 'article', num, caption: '', general, deleted: true, paragraphs: [] };
  }
  const m = ARTICLE_HEAD_RE.exec(text);
  if (m) {
    const num = parseArticleNum(m[1]!);
    if (!num) return null;
    return { type: 'article', num, caption: m[2] ?? '', general, deleted: false, paragraphs: [] };
  }
  const c = /^（(.*)）$/.exec(text);
  if (c) {
    return { type: 'article', num: null, caption: c[1]!, general, deleted: false, paragraphs: [] };
  }
  return null;
}

/** 条の本文の行を項・号・細分に分ける。既存の項があれば続きに足す。 */
function parseArticleBody(article: Article, lines: Line[], warnings: Warning[]) {
  const hasKou = lines.some((l) => lineKind(l.text) === 'kou') || article.paragraphs.length > 1;
  let lastCont: { cont?: ContinuationLines } | null = null;
  const pushCont = (target: { cont?: ContinuationLines }, l: Line) => {
    (target.cont ??= []).push(parseInline(l.text));
  };

  for (const l of lines) {
    const kind = lineKind(l.text);
    const paragraphs = article.paragraphs;
    const para = paragraphs[paragraphs.length - 1];
    if (kind === 'kou') {
      const n = parseKouNumber(l.text[0]!);
      if (n !== paragraphs.length + 1) {
        warnings.push({
          line: l.no,
          message: `項の番号が順番どおりではありません（${l.text[0]}。${kouNumberSafe(paragraphs.length + 1)}として読みます）`,
        });
      }
      const rest = l.text.slice(1);
      if (!rest.startsWith('　'))
        warnings.push({ line: l.no, message: '項の番号の後に全角空白がありません' });
      const p: Paragraph = { text: parseInline(rest.replace(/^　/, '')), items: [] };
      paragraphs.push(p);
      lastCont = p;
    } else if (kind === 'gou') {
      const m = GOU_RE.exec(l.text)!;
      const label = m[0].slice(0, -1);
      let target = para;
      if (!target) {
        warnings.push({ line: l.no, message: '号の前に本文がありません' });
        target = { text: [], items: [] };
        paragraphs.push(target);
      }
      const n = parseGouNumber(label);
      if (n !== target.items.length + 1) {
        warnings.push({ line: l.no, message: `号の番号が順番どおりではありません（${label}）` });
      }
      const item: Item = { text: parseInline(l.text.slice(m[0].length)), subitems: [] };
      target.items.push(item);
      lastCont = item;
    } else if (kind === 'saibun') {
      const item = para?.items[para.items.length - 1];
      if (!item) {
        warnings.push({
          line: l.no,
          message: '号の細分の前に号がありません（本文として読みます）',
        });
        if (lastCont) pushCont(lastCont, l);
        else paragraphs.push({ text: parseInline(l.text.replace(/^　/, '')), items: [] });
        continue;
      }
      if (parseSaibunNumber(l.text[0]!) !== item.subitems.length + 1) {
        warnings.push({
          line: l.no,
          message: `号の細分の番号が順番どおりではありません（${l.text[0]}）`,
        });
      }
      const sub: SubItem = { text: parseInline(l.text.slice(2)) };
      item.subitems.push(sub);
      lastCont = sub;
    } else if (!para) {
      if (hasKou) {
        warnings.push({ line: l.no, message: '項の前に本文があります（第1項として読みます）' });
      }
      // 項が1つの条：本文行を第1項にする（行頭の全角空白は番号の代わり）
      if (!l.text.startsWith('　')) {
        warnings.push({ line: l.no, message: '本文の行頭に全角空白がありません' });
      }
      const p: Paragraph = { text: parseInline(l.text.replace(/^　/, '')), items: [] };
      paragraphs.push(p);
      lastCont = p;
    } else {
      // 番号のない続きの行
      pushCont(lastCont ?? para, l);
    }
  }
}

function kouNumberSafe(n: number): string {
  try {
    return kouNumber(n);
  } catch {
    return `第${n}項`;
  }
}
