// ポータルの見出しのアンカーと、条文へのリンク（F-17）の飛び先。
// アンカーは portal と同じ規則（見出しの文言の空白を - に）で作る。
// 移植元: ds-craft/portal _includes/rule-scripts.html（fb5a7ef）

import { articleHeadingText, divisionHeadingText } from '../markdown/serialize.ts';
import type { ArticleNum } from '../numbering/article.ts';
import type { DivisionChild, RuleDoc, TopBlock } from '../model/types.ts';

export function portalAnchor(text: string): string {
  return text.trim().replace(/\s+/g, '-');
}

export type RuleHeading = {
  /** 目次の深さ（章・前文・附則・別表が1） */
  level: number;
  /** 見出しの文言（「第3章 処罰」「第8条（窃盗の禁止）」） */
  text: string;
  anchor: string;
  /** 条の見出しなら条番号（番号のない条は null） */
  article?: ArticleNum | null;
};

/** ルールの見出しを文書の順に（リンク先の候補・アンカーの一覧に使う） */
export function ruleHeadings(doc: Pick<RuleDoc, 'body'>): RuleHeading[] {
  const out: RuleHeading[] = [];
  const push = (level: number, text: string, article?: ArticleNum | null) => {
    const h: RuleHeading = { level, text, anchor: portalAnchor(text) };
    if (article !== undefined) h.article = article;
    out.push(h);
  };
  const LEVEL = { chapter: 1, section: 2, subsection: 3 } as const;
  let depth = 0;
  const child = (b: TopBlock | DivisionChild) => {
    switch (b.type) {
      case 'preamble':
        depth = 1;
        return push(1, '前文');
      case 'supplementary':
        depth = 1;
        push(1, '附則');
        for (const p of b.provisions) push(2, p.heading);
        return;
      case 'appendix':
        depth = 1;
        return push(1, b.heading);
      case 'division':
        depth = LEVEL[b.level];
        push(depth, divisionHeadingText(b));
        b.children.forEach(child);
        return;
      case 'article':
        return push(depth + 1, articleHeadingText(b), b.num);
    }
  };
  doc.body.forEach(child);
  return out;
}

/** ルールのアンカーの一覧 */
export function ruleAnchors(doc: Pick<RuleDoc, 'body'>): Set<string> {
  return new Set(ruleHeadings(doc).map((h) => h.anchor));
}

const RULE_HREF_RE = /^(R\d{7})\.html(?:#(.*))?$/;

/** リンクの飛び先。ルールの中の見出し（#…）か、ほかのルール（R0701002.html#…）。それ以外（外部のページ）は null */
export function parseRuleHref(href: string): { ruleId: string | null; anchor: string } | null {
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  if (href.startsWith('#')) return { ruleId: null, anchor: decode(href.slice(1)) };
  const m = RULE_HREF_RE.exec(href);
  if (!m) return null;
  return { ruleId: m[1]!, anchor: decode(m[2] ?? '') };
}

/** リンクの href を作る。同じルールの中は #… のみ、ほかのルールは R0701002.html#… */
export function ruleHref(target: { ruleId: string | null; anchor: string }, self: string): string {
  const same = target.ruleId === null || target.ruleId === self;
  const hash = target.anchor ? '#' + target.anchor : '';
  return same ? hash : `${target.ruleId}.html${hash}`;
}
