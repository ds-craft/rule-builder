// 内部モデル → portal と同じ DOM 構造のための並び。
// 移植元: ds-craft/portal _includes/rule-scripts.html（fb5a7ef）
//   - h2 で section（前文は section.preamble、それ以外は section.chapter）を区切り、h5 で article.article を区切る
//   - 条の見出しがない本文（施行令の本則等）も chapter の中では article として扱う
//   - 行頭の番号から項・号・号の細分を判定し、本文は文脈で書式を変える
//     前文・附則・見出しのない本文は plain、項が1つの条は single、項が2つ以上の条では kou-cont

import {
  articleBodyLines,
  articleHeadingText,
  divisionHeadingText,
  inlineText,
  lineKind,
  parseInline,
  portalAnchor,
  serializeInline,
  type Article,
  type DivisionChild,
  type Inline,
  type RuleDoc,
  type TopBlock,
} from '@rule-builder/core';

export type LawLineKind = 'kou' | 'gou' | 'saibun' | 'plain' | 'single' | 'kou-cont';

export type LawLine = {
  kind: LawLineKind;
  inlines: Inline[];
  /** 文書内で一意なキー（検索結果から移動するため） */
  key: string;
};

export type LawHeading = {
  tag: 'h2' | 'h3' | 'h4' | 'h5';
  text: string;
  /** portal と同じ規則で作るアンカー（見出しの文言の空白を - に） */
  anchor: string;
  /** 目次から移動するための、文書内で一意なキー */
  key: string;
  general?: boolean;
};

export type LawArticle = {
  type: 'article';
  heading: LawHeading | null;
  lines: LawLine[];
  /** 一般向け条文か（見出しのない条文は常に表示） */
  general: boolean;
  /** 元のモデル（条のときだけ） */
  article?: Article;
};

export type LawSectionItem = { type: 'heading'; heading: LawHeading } | LawArticle;

export type LawSection = {
  className: 'preamble' | 'chapter';
  heading: LawHeading | null;
  items: LawSectionItem[];
  /** 前文の行（section 直下の段落） */
  lines: LawLine[];
};

export { portalAnchor };

type Builder = { sections: LawSection[]; count: number };

function heading(b: Builder, tag: LawHeading['tag'], text: string, general?: boolean): LawHeading {
  const h: LawHeading = { tag, text, anchor: portalAnchor(text), key: `h${b.count++}` };
  if (general !== undefined) h.general = general;
  return h;
}

/** 行の文字列を portal と同じく種類分けする。本文の行頭の空白は字下げを CSS で付けるため除く */
let lineSeq = 0;

function classify(src: string, textKind: LawLineKind): LawLine {
  const kind = lineKind(src);
  const key = `l${lineSeq++}`;
  if (kind === 'text') {
    return { kind: textKind, inlines: parseInline(src.replace(/^[　 ]+/, '')), key };
  }
  return { kind, inlines: parseInline(src), key };
}

export function layoutRule(doc: RuleDoc): LawSection[] {
  lineSeq = 0;
  const b: Builder = { sections: [], count: 0 };
  let section: LawSection | null = null;
  const ensureSection = (): LawSection => {
    if (!section) {
      section = { className: 'chapter', heading: null, items: [], lines: [] };
      b.sections.push(section);
    }
    return section;
  };
  const newSection = (className: LawSection['className'], text: string): LawSection => {
    section = { className, heading: heading(b, 'h2', text), items: [], lines: [] };
    b.sections.push(section);
    return section;
  };
  const proseArticle = (lines: Inline[][]) => {
    ensureSection().items.push({
      type: 'article',
      heading: null,
      general: true,
      lines: lines.map((l) => classify(serializeInline(l), 'plain')),
    });
  };

  const child = (c: DivisionChild | TopBlock) => {
    switch (c.type) {
      case 'preamble': {
        const s = newSection('preamble', '前文');
        s.lines = c.lines.map((l) => classify(serializeInline(l), 'plain'));
        return;
      }
      case 'supplementary': {
        newSection('chapter', '附則');
        if (c.lines.length) proseArticle(c.lines);
        for (const p of c.provisions) {
          // 附則の中の見出し付きの本文は条として扱わない（plain）
          ensureSection().items.push({
            type: 'article',
            heading: heading(b, 'h5', p.heading, p.general),
            general: p.general,
            lines: p.lines.map((l) => classify(serializeInline(l), 'plain')),
          });
        }
        return;
      }
      case 'appendix': {
        newSection('chapter', c.heading);
        if (c.lines.length) proseArticle(c.lines);
        return;
      }
      case 'division': {
        if (c.level === 'chapter') newSection('chapter', divisionHeadingText(c));
        else {
          ensureSection().items.push({
            type: 'heading',
            heading: heading(b, c.level === 'section' ? 'h3' : 'h4', divisionHeadingText(c)),
          });
        }
        c.children.forEach(child);
        return;
      }
      case 'article': {
        const src = articleBodyLines(c);
        const hasKou = src.some((l) => lineKind(l) === 'kou');
        const textKind: LawLineKind = hasKou ? 'kou-cont' : 'single';
        ensureSection().items.push({
          type: 'article',
          heading: heading(b, 'h5', articleHeadingText(c), c.general),
          general: c.general,
          lines: src.map((l) => classify(l, textKind)),
          article: c,
        });
        return;
      }
      case 'prose':
        proseArticle(c.lines);
        return;
      case 'raw':
        proseArticle([[{ kind: 'text', value: c.source }]]);
        return;
    }
  };
  doc.body.forEach(child);
  return b.sections;
}

export type TocItem = {
  level: number;
  key: string;
  text: string;
  anchor: string;
  /** 条なら文書の中で何番目の条か */
  articleIndex?: number;
};

/** 目次（章・節・款・条と前文・附則）。 */
export function tocItems(sections: LawSection[]): TocItem[] {
  const out: TocItem[] = [];
  let articleIndex = 0;
  for (const s of sections) {
    if (s.heading)
      out.push({ level: 1, key: s.heading.key, text: s.heading.text, anchor: s.heading.anchor });
    let depth = s.heading ? 1 : 0;
    for (const it of s.items) {
      const h = it.heading;
      if (!h) continue;
      if (it.type === 'heading') depth = h.tag === 'h3' ? 2 : 3;
      const level = it.type === 'heading' ? depth : depth + 1;
      const item: TocItem = {
        level: Math.max(1, level),
        key: h.key,
        text: h.text,
        anchor: h.anchor,
      };
      if (it.type === 'article' && it.article) item.articleIndex = articleIndex++;
      out.push(item);
    }
  }
  return out;
}

export type SearchHit = {
  lineKey: string;
  label: string;
  before: string;
  match: string;
  after: string;
};

/** 文書内の検索（F-19）。位置（見出し）と前後の文を返す。 */
export function searchLines(sections: LawSection[], query: string): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const hits: SearchHit[] = [];
  const scan = (lines: LawLine[], label: string) => {
    for (const l of lines) {
      const t = inlineText(l.inlines);
      let i = t.indexOf(q);
      while (i >= 0) {
        hits.push({
          lineKey: l.key,
          label,
          before: t.slice(Math.max(0, i - 16), i),
          match: q,
          after: t.slice(i + q.length, i + q.length + 24),
        });
        i = t.indexOf(q, i + q.length);
      }
    }
  };
  for (const s of sections) {
    let label = s.heading?.text ?? '本文';
    scan(s.lines, label);
    for (const it of s.items) {
      if (it.type === 'heading') {
        label = it.heading.text;
        continue;
      }
      scan(it.lines, it.heading?.text ?? label);
    }
  }
  return hits;
}
