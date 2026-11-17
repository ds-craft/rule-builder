// 書式チェック（F-18）。ポータルで表示が崩れる書き方・空の行・条番号の欠番や重複・リンク切れを調べる。
// 調べる単位は「行」（LintLine）。エディタは自分の文書から行を作って lintLines を呼び（位置をキーにする）、
// 書き出しなどモデルしかない所では lintRule を使う。
// 修正（全角にする）は文字数を変えないので、呼び出し側は行の文字を同じ位置のまま置き換えられる。

import { inlineText } from '../markdown/inline.ts';
import { divisionHeadingText } from '../markdown/serialize.ts';
import { numberingIssues } from '../model/ops.ts';
import type { Article, DivisionChild, Inline, RuleDoc, TopBlock } from '../model/types.ts';
import { formatArticleNum, type ArticleNum } from '../numbering/article.ts';
import { saibunNumber, SAIBUN_ORDER } from '../numbering/numbers.ts';
import { parseRuleHref, ruleAnchors } from '../links/anchors.ts';

export type LintLevel = 'error' | 'warn' | 'info';

export type LintRule = 'line-start' | 'emphasis' | 'separator' | 'empty' | 'numbering' | 'link';

/** 修正ボタンで行うこと（どれも「全角にする」） */
export type LintFix = 'line-start' | 'emphasis' | 'separator';

export type LintLineKind =
  /** 条の項・号・号の細分（Markdown では行頭に番号が付く） */
  | 'law'
  /** 前文・附則などの行や、番号のない続きの行（文言がそのまま Markdown の行頭になる） */
  | 'plain'
  /** 条の見出し（（ ）の中） */
  | 'caption'
  /** 章・節の名前、附則・別表の見出し */
  | 'heading';

export type LintLine = {
  /** 呼び出し側が場所を探すためのキー */
  key: string;
  kind: LintLineKind;
  /** 位置の表示（「第2条 第3項」） */
  label: string;
  /** plain の行の字下げ（行頭の空白） */
  indent?: string;
  inlines: readonly Inline[];
};

/** 条（番号の欠番・重複を調べる） */
export type LintArticle = { key: string; label: string; num: ArticleNum | null };

export type LintIssue = {
  rule: LintRule;
  level: LintLevel;
  /** 行のキー（場所が無ければ null） */
  key: string | null;
  label: string;
  message: string;
  /** 問題のある行の文言 */
  context?: string;
  fix?: LintFix;
};

/** リンク先を調べるためのルールの一覧（取得できていなければ渡さない＝ほかのルールへのリンクは調べない） */
export type LintRuleIndex = ReadonlyMap<
  string,
  { name: string; anchors: ReadonlySet<string> | null }
>;

export type LintOptions = {
  /** このルールのID（自分自身への R…html のリンクを見分ける） */
  ruleId: string;
  /** このルールのアンカー */
  anchors: ReadonlySet<string> | (() => ReadonlySet<string>);
  rules?: LintRuleIndex;
};

export const FIX_LABEL: Record<LintFix, string> = {
  'line-start': '全角にする',
  emphasis: '全角にする',
  separator: '全角にする',
};

// ---------- 判定 ----------

/** Markdown の行頭の記法（箇条書き・番号付きの箇条書き・見出し・引用）。行頭の半角空白3つまでを許す */
const LINE_START_RE = /^[ \t]{0,3}(?:\d+\.(?=[ \t]|$)|[-+*](?=[ \t]|$)|#|>)/;
const EMPHASIS_RE = /[*_]/;
const SEP_NUM = `[①-⑳㉑-㉟㊱-㊿]|[一二三四五六七八九十百]+|[${SAIBUN_ORDER}]`;
/** 番号の後の半角空白（portal は番号の後の全角空白で号・細分と判定する） */
const SEPARATOR_RE = new RegExp(`^(?:${SEP_NUM}) `);

const fw = (c: string) => String.fromCharCode(c.charCodeAt(0) + 0xfee0);

/** 修正後の文言（文字数は変えない）。text は行の文言（plain の行は字下げを除いた部分） */
export function applyLintFix(fix: LintFix, text: string): string {
  switch (fix) {
    case 'line-start':
      return text.replace(/^([ \t]{0,3})(\d+\.|[-+*>]|#+)/, (_, sp: string, m: string) => {
        return (
          sp +
          m
            .replace(/[0-9]/g, fw)
            .replace('.', '．')
            .replace(/[-+*>#]/g, fw)
        );
      });
    case 'emphasis':
      return text.replace(/\*/g, '＊').replace(/_/g, '＿');
    case 'separator':
      return text.replace(SEPARATOR_RE, (m) => m.slice(0, -1) + '　');
  }
}

const ctx = (s: string) => (s.length > 60 ? s.slice(0, 60) + '…' : s);

function lintLine(line: LintLine, opts: LintOptions, out: LintIssue[]) {
  const text = inlineText(line.inlines);
  const base = { key: line.key, label: line.label, context: ctx(text) };
  const startsLine = line.kind === 'plain';
  const head = (line.indent ?? '') + text;
  if (startsLine && LINE_START_RE.test(head) && LINE_START_RE.test(text)) {
    out.push({
      ...base,
      rule: 'line-start',
      level: 'error',
      message: '行の先頭の記号が、ポータルで箇条書きや見出しとして表示されてしまいます',
      fix: 'line-start',
    });
  }
  if (EMPHASIS_RE.test(text)) {
    out.push({
      ...base,
      rule: 'emphasis',
      level: 'error',
      message: '「*」「_」は、ポータルで太字・斜体として表示されてしまいます',
      fix: 'emphasis',
    });
  }
  if (startsLine && !line.indent && SEPARATOR_RE.test(text)) {
    out.push({
      ...base,
      rule: 'separator',
      level: 'warn',
      message: '番号の後の空白が半角のため、ポータルで号・号の細分として字下げされません',
      fix: 'separator',
    });
  }
  if (!text.trim()) {
    if (line.kind === 'caption') {
      out.push({ ...base, rule: 'empty', level: 'info', message: '条の見出しがありません' });
    } else {
      out.push({
        ...base,
        rule: 'empty',
        level: 'warn',
        message: '何も書かれていない行があります',
      });
    }
  }
  lintLinks(line, line.inlines, opts, out);
}

function lintLinks(
  line: LintLine,
  inlines: readonly Inline[],
  opts: LintOptions,
  out: LintIssue[],
) {
  for (const n of inlines) {
    if (n.kind !== 'link') continue;
    const message = brokenLink(n.href, opts);
    if (message) {
      out.push({
        rule: 'link',
        level: 'warn',
        key: line.key,
        label: line.label,
        message,
        context: ctx(inlineText(n.children)),
      });
    }
  }
}

let anchorCache: ReadonlySet<string> | null = null;

/** リンク切れなら利用者向けの文言 */
function brokenLink(href: string, opts: LintOptions): string | null {
  const t = parseRuleHref(href);
  if (!t) return null;
  if (t.ruleId === null || t.ruleId === opts.ruleId) {
    if (!t.anchor) return null;
    anchorCache ??= typeof opts.anchors === 'function' ? opts.anchors() : opts.anchors;
    return anchorCache.has(t.anchor)
      ? null
      : `リンク先の見出し「${t.anchor}」がこのルールにありません`;
  }
  if (!opts.rules) return null;
  const rule = opts.rules.get(t.ruleId);
  if (!rule) return `リンク先のルール（${t.ruleId}）が見つかりません`;
  if (t.anchor && rule.anchors && !rule.anchors.has(t.anchor)) {
    return `リンク先の見出し「${t.anchor}」が「${rule.name}」にありません`;
  }
  return null;
}

const LEVEL_ORDER: Record<LintLevel, number> = { error: 0, warn: 1, info: 2 };

/** 行と条を調べる。結果は文書の順（同じ行の中はエラー・注意・情報の順） */
export function lintLines(
  lines: readonly LintLine[],
  articles: readonly LintArticle[],
  opts: LintOptions,
): LintIssue[] {
  anchorCache = null;
  const order = new Map<string, number>();
  lines.forEach((l, i) => order.set(l.key, i));
  articles.forEach((a) => {
    if (!order.has(a.key)) order.set(a.key, -1);
  });
  const all: LintIssue[] = [];
  for (const l of lines) lintLine(l, opts, all);
  for (const n of numberingIssues(articles.map((a) => a.num))) {
    const a = articles[n.index]!;
    all.push({
      rule: 'numbering',
      level: n.kind === 'duplicate' ? 'error' : 'warn',
      key: a.key,
      label: a.label,
      message: n.message,
    });
  }
  return all
    .map((issue, i) => ({ issue, i }))
    .sort(
      (a, b) =>
        (order.get(a.issue.key ?? '') ?? 0) - (order.get(b.issue.key ?? '') ?? 0) ||
        LEVEL_ORDER[a.issue.level] - LEVEL_ORDER[b.issue.level] ||
        a.i - b.i,
    )
    .map((x) => x.issue);
}

/** 件数に数える問題（「情報」は数えない） */
export function countIssues(issues: readonly LintIssue[]): number {
  return issues.filter((i) => i.level !== 'info').length;
}

// ---------- モデルから行を作る ----------

/** 条の中の位置の表示（「第2条 第3項 第1号 イ」）。項が1つの条の本文では項を出さない */
export function articleLineLabel(
  num: ArticleNum | null,
  singleParagraph: boolean,
  para: number,
  item = -1,
  sub = -1,
): string {
  let s = num ? formatArticleNum(num) : '条';
  if (para >= 0 && (!singleParagraph || item >= 0)) s += ` 第${para + 1}項`;
  if (item >= 0) s += ` 第${item + 1}号`;
  if (sub >= 0) {
    try {
      s += ` ${saibunNumber(sub + 1)}`;
    } catch {
      s += ' ？';
    }
  }
  return s;
}

/** モデルから書式チェックの行と条を作る（キーは文書の中の通し番号） */
export function ruleLintLines(doc: RuleDoc): { lines: LintLine[]; articles: LintArticle[] } {
  const lines: LintLine[] = [];
  const articles: LintArticle[] = [];
  let seq = 0;
  const key = () => `m${seq++}`;
  const plain = (label: string, ls: readonly Inline[][]) => {
    for (const l of ls) {
      const first = l[0];
      const indent = first?.kind === 'text' ? /^[　 ]*/.exec(first.value)![0] : '';
      const rest: Inline[] =
        first?.kind === 'text' && indent
          ? [{ kind: 'text', value: first.value.slice(indent.length) }, ...l.slice(1)]
          : [...l];
      lines.push({ key: key(), kind: 'plain', label, indent, inlines: rest });
    }
  };
  const article = (a: Article) => {
    const label = a.num ? formatArticleNum(a.num) : '条';
    const k = key();
    articles.push({ key: k, label, num: a.num });
    if (a.deleted) return;
    if (a.num) {
      lines.push({
        key: k,
        kind: 'caption',
        label: label + 'の見出し',
        inlines: a.caption ? [{ kind: 'text', value: a.caption }] : [],
      });
    }
    const single = a.paragraphs.length === 1;
    const law = (text: Inline[], p: number, i = -1, s = -1) =>
      lines.push({
        key: key(),
        kind: 'law',
        label: articleLineLabel(a.num, single, p, i, s),
        inlines: text,
      });
    const cont = (c: Inline[][] | undefined, p: number, i = -1, s = -1) =>
      c?.forEach((l) =>
        lines.push({
          key: key(),
          kind: 'plain',
          label: articleLineLabel(a.num, single, p, i, s),
          inlines: l,
        }),
      );
    a.paragraphs.forEach((para, p) => {
      law(para.text, p);
      cont(para.cont, p);
      para.items.forEach((item, i) => {
        law(item.text, p, i);
        cont(item.cont, p, i);
        item.subitems.forEach((sub, s) => {
          law(sub.text, p, i, s);
          cont(sub.cont, p, i, s);
        });
      });
    });
  };
  const child = (b: TopBlock | DivisionChild) => {
    switch (b.type) {
      case 'preamble':
        return plain('前文', b.lines);
      case 'supplementary':
        plain('附則', b.lines);
        for (const p of b.provisions) {
          lines.push({
            key: key(),
            kind: 'heading',
            label: '附則の見出し',
            inlines: [{ kind: 'text', value: p.heading }],
          });
          plain('附則', p.lines);
        }
        return;
      case 'appendix':
        lines.push({
          key: key(),
          kind: 'heading',
          label: '別表の見出し',
          inlines: [{ kind: 'text', value: b.heading }],
        });
        return plain('別表', b.lines);
      case 'division': {
        const title = divisionHeadingText({ ...b, title: '' });
        lines.push({
          key: key(),
          kind: 'heading',
          label: `${title}の名前`,
          inlines: b.title ? [{ kind: 'text', value: b.title }] : [],
        });
        b.children.forEach(child);
        return;
      }
      case 'article':
        return article(b);
      case 'prose':
        return plain('本文', b.lines);
      case 'raw':
        return;
    }
  };
  doc.body.forEach(child);
  return { lines, articles };
}

/** モデルのルールを調べる（書き出しの件数など、エディタの外で使う） */
export function lintRule(
  doc: RuleDoc,
  opts: Omit<LintOptions, 'anchors'> & { anchors?: LintOptions['anchors'] },
): LintIssue[] {
  const { lines, articles } = ruleLintLines(doc);
  return lintLines(lines, articles, { ...opts, anchors: opts.anchors ?? (() => ruleAnchors(doc)) });
}
