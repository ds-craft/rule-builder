// 参照の確認（F-15）。文中の条・項・号への参照を抜き出し、条番号の対応表（旧→新）と照らして書き換えの候補を作る。
// 自動では書き換えない（候補を出すだけ）。

import { parseRule } from '../markdown/parse.ts';
import { inlineText, parseInline } from '../markdown/inline.ts';
import type { Inline } from '../model/types.ts';
import { formatArticleNum, parseArticleNum, type ArticleNum } from '../numbering/article.ts';
import type { Renumbering } from '../model/ops.ts';
import { parseRuleHref, ruleHeadings } from '../links/anchors.ts';

export type ReferenceKind =
  /** 第N条（の M）。続く「第N項」「第N号」も含めて1つの参照 */
  | 'article'
  /** 第N項・第N号（条を書かない、同じ条の中の参照） */
  | 'paragraph'
  | 'item'
  /** 前条・次条・前項・次項・前号・前各号・同条・同項 */
  | 'relative'
  /** ほかのルールの条・章（「禁止事項及び処罰に関するルール第3章」） */
  | 'external';

export type Reference = {
  kind: ReferenceKind;
  /** 文の中の位置（文字の位置） */
  index: number;
  /** 参照の文字列（「第3条第2項」「前条」） */
  text: string;
  /** article のとき：条の部分（「第3条」「第5条の9」）。書き換えるのはこの部分だけ */
  article?: string;
  /** relative のとき：前条・次条など */
  relative?: string;
  /** external のとき：ルールの名前（「…ルール」「本ルール」は含めない） */
  ruleName?: string;
};

const ARTICLE = '第(\\d+)条((?:の\\d+)*)';
const SUFFIX = '(?:第\\d+項)?(?:第\\d+号)?';
const REF_RE = new RegExp(
  `${ARTICLE}${SUFFIX}|第\\d+章|第\\d+節|第\\d+款|第\\d+項(?:第\\d+号)?|第\\d+号|前各号|前各項|前条|次条|前項|次項|前号|次号|同条|同項|同号`,
  'g',
);

/** 参照の直前に来ると、ほかのルール（または附則）の条を指す言葉 */
const EXTERNAL_BEFORE = /(ルール|施行令|規則|特例|附則)$/;
/** このルール自身を指す言葉 */
const SELF_BEFORE = /((?:^|[^\p{Script=Han}])本|この)(ルール|施行令)$/u;

/** 文中の参照を抜き出す */
export function findReferences(text: string): Reference[] {
  const out: Reference[] = [];
  for (const m of text.matchAll(REF_RE)) {
    const s = m[0];
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    if (s.startsWith('第') && /[章節款]$/.test(s)) {
      // 章・節は、ほかのルールの名前が前にあるときだけ参照として扱う
      if (EXTERNAL_BEFORE.test(before) && !SELF_BEFORE.test(before)) {
        out.push({ kind: 'external', index: m.index, text: s, ruleName: ruleNameBefore(before) });
      }
      continue;
    }
    if (m[1] !== undefined) {
      const article = `第${m[1]}条${m[2] ?? ''}`;
      if (EXTERNAL_BEFORE.test(before) && !SELF_BEFORE.test(before)) {
        out.push({
          kind: 'external',
          index: m.index,
          text: s,
          article,
          ruleName: ruleNameBefore(before),
        });
      } else {
        out.push({ kind: 'article', index: m.index, text: s, article });
      }
      continue;
    }
    if (/^第\d+項/.test(s)) out.push({ kind: 'paragraph', index: m.index, text: s });
    else if (/^第\d+号/.test(s)) out.push({ kind: 'item', index: m.index, text: s });
    else out.push({ kind: 'relative', index: m.index, text: s, relative: s });
  }
  return out;
}

/** 参照の前にあるルールの名前（句読点・括弧の後から） */
function ruleNameBefore(before: string): string {
  const m = /[^、。，．（）「」『』\s]*$/.exec(before);
  return m ? m[0] : '';
}

/** 条番号の対応表（「第3条」→「第4条」） */
export function renumberMap(list: readonly Renumbering[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of list) map.set(formatArticleNum(r.from), formatArticleNum(r.to));
  return map;
}

export type RenumberTarget = {
  /** 書き換える部分（条の部分だけ）の文の中の位置 */
  index: number;
  old: string;
  neu: string;
  /** 参照の全体（「第3条第2項」） */
  reference: string;
};

/** 条番号が変わる参照（書き換えの候補） */
export function renumberTargets(text: string, map: ReadonlyMap<string, string>): RenumberTarget[] {
  const out: RenumberTarget[] = [];
  for (const r of findReferences(text)) {
    if (r.kind !== 'article' || !r.article) continue;
    const neu = map.get(r.article);
    if (neu === undefined || neu === r.article) continue;
    out.push({ index: r.index, old: r.article, neu, reference: r.text });
  }
  return out;
}

/** アンカーの先頭の条番号（「第8条（窃盗の禁止）」→ 第8条）。条の見出しでなければ null */
export function anchorArticle(anchor: string): ArticleNum | null {
  const m = /^第\d+条(?:の\d+)*/.exec(anchor);
  return m ? parseArticleNum(m[0]) : null;
}

/** 前後の文（候補の表示用） */
export function contextAround(
  text: string,
  index: number,
  length: number,
  width = 14,
): { before: string; match: string; after: string } {
  return {
    before: text.slice(Math.max(0, index - width), index),
    match: text.slice(index, index + length),
    after: text.slice(index + length, index + length + width),
  };
}

// ---------- ほかのルールからのリンク ----------

export type IncomingLink = {
  /** リンクを持つルール */
  ruleId: string;
  ruleName: string;
  /** リンクのある見出し（「第15条（…）」。見出しより前なら空） */
  heading: string;
  /** リンクの文字 */
  text: string;
  anchor: string;
};

/**
 * ほかのルールから、このルールの見出しへのリンクを探す（見出しが変わるとリンクが切れる）。
 * @param anchors 探すアンカー（改正で無くなる見出し）
 */
export function findIncomingLinks(
  ruleId: string,
  anchors: ReadonlySet<string>,
  others: readonly { id: string; name: string; markdown: string }[],
): IncomingLink[] {
  const out: IncomingLink[] = [];
  if (anchors.size === 0) return out;
  for (const o of others) {
    if (o.id === ruleId || !o.markdown.includes(`${ruleId}.html#`)) continue;
    let heading = '';
    for (const line of o.markdown.split('\n')) {
      const h = /^#{2,5} (.+)$/.exec(line);
      if (h) {
        heading = h[1]!;
        continue;
      }
      for (const link of linksIn(line)) {
        const t = parseRuleHref(link.href);
        if (t?.ruleId !== ruleId || !anchors.has(t.anchor)) continue;
        out.push({ ruleId: o.id, ruleName: o.name, heading, text: link.text, anchor: t.anchor });
      }
    }
  }
  return out;
}

function linksIn(line: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  const walk = (inl: readonly Inline[]) => {
    for (const n of inl) {
      if (n.kind === 'link') out.push({ href: n.href, text: inlineText(n.children) });
    }
  };
  walk(parseInline(line));
  return out;
}

/** 改正前の版にあって今の版に無いアンカー */
export function removedAnchors(baseMarkdown: string, current: ReadonlySet<string>): Set<string> {
  const base = ruleHeadings(parseRule(baseMarkdown).doc).map((h) => h.anchor);
  return new Set(base.filter((a) => !current.has(a)));
}
