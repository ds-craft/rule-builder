// 内部モデル（RuleDoc の body） ⇔ エディタの文書（ProseMirror の JSON）。
// 章・節・款の番号は並び順から振り直す（常に通し番号。手順書 Phase 4-1）。

import type {
  Article,
  ArticleNum,
  ContinuationLines,
  Division,
  DivisionChild,
  DivisionLevel,
  Inline,
  Item,
  Paragraph,
  SubItem,
  TopBlock,
} from '@rule-builder/core';
import type { LineKind } from './schema.ts';

export type PMMark = { type: string; attrs?: Record<string, unknown> };
export type PMNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
};

// ---------- モデル → エディタ ----------

function inlinesToPM(inlines: readonly Inline[], marks: PMMark[] = []): PMNode[] {
  const out: PMNode[] = [];
  for (const n of inlines) {
    if (n.kind === 'text') {
      if (n.value)
        out.push(
          marks.length ? { type: 'text', text: n.value, marks } : { type: 'text', text: n.value },
        );
    } else {
      const mark: PMMark = { type: 'link', attrs: { href: n.href, title: n.title ?? null } };
      out.push(...inlinesToPM(n.children, [...marks, mark]));
    }
  }
  return out;
}

const textNode = (s: string): PMNode[] => (s ? [{ type: 'text', text: s }] : []);

function line(kind: LineKind, inlines: readonly Inline[]): PMNode {
  return { type: 'lawLine', attrs: { kind }, content: inlinesToPM(inlines) };
}

/** 行の先頭の空白（字下げ）を indent に分ける */
function plainLine(inlines: readonly Inline[]): PMNode {
  const first = inlines[0];
  let indent = '';
  let rest = inlines;
  if (first?.kind === 'text') {
    indent = /^[　 ]*/.exec(first.value)![0];
    const value = first.value.slice(indent.length);
    rest = value ? [{ kind: 'text', value }, ...inlines.slice(1)] : inlines.slice(1);
  }
  return { type: 'plainLine', attrs: { indent }, content: inlinesToPM(rest) };
}

function articleToPM(a: Article): PMNode {
  const lines: PMNode[] = [];
  const cont = (c: ContinuationLines | undefined) => c?.forEach((l) => lines.push(line('cont', l)));
  for (const p of a.paragraphs) {
    lines.push(line('kou', p.text));
    cont(p.cont);
    for (const item of p.items) {
      lines.push(line('gou', item.text));
      cont(item.cont);
      for (const sub of item.subitems) {
        lines.push(line('saibun', sub.text));
        cont(sub.cont);
      }
    }
  }
  return {
    type: 'article',
    attrs: { num: a.num, general: a.general, deleted: a.deleted },
    content: [{ type: 'articleCaption', content: textNode(a.caption) }, ...lines],
  };
}

function childToPM(c: DivisionChild, out: PMNode[]) {
  switch (c.type) {
    case 'division':
      out.push({
        type: 'division',
        attrs: { level: c.level, sep: c.sep ?? null },
        content: textNode(c.title),
      });
      c.children.forEach((x) => childToPM(x, out));
      return;
    case 'article':
      out.push(articleToPM(c));
      return;
    case 'prose':
      out.push({ type: 'prose', content: c.lines.map(plainLine) });
      return;
    case 'raw':
      out.push({ type: 'raw', attrs: { reason: c.reason }, content: textNode(c.source) });
      return;
  }
}

export function bodyToPM(body: readonly TopBlock[]): PMNode {
  const out: PMNode[] = [];
  for (const b of body) {
    switch (b.type) {
      case 'preamble':
        out.push({ type: 'preamble', content: (b.lines.length ? b.lines : [[]]).map(plainLine) });
        break;
      case 'supplementary':
        out.push({
          type: 'supplementary',
          content: [
            ...b.lines.map(plainLine),
            ...b.provisions.map((p): PMNode => ({
              type: 'provision',
              attrs: { general: p.general },
              content: [
                { type: 'provisionHeading', content: textNode(p.heading) },
                ...p.lines.map(plainLine),
              ],
            })),
          ],
        });
        break;
      case 'appendix':
        out.push({
          type: 'appendix',
          content: [
            { type: 'appendixHeading', content: textNode(b.heading) },
            ...b.lines.map(plainLine),
          ],
        });
        break;
      default:
        childToPM(b, out);
    }
  }
  return { type: 'doc', content: out };
}

// ---------- エディタ → モデル ----------

export function pmToInlines(nodes: readonly PMNode[] | undefined): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes ?? []) {
    const text = n.text ?? '';
    const link = n.marks?.find((m) => m.type === 'link');
    if (!link) {
      const last = out[out.length - 1];
      if (last?.kind === 'text') last.value += text;
      else out.push({ kind: 'text', value: text });
      continue;
    }
    const href = String(link.attrs?.href ?? '');
    const title = link.attrs?.title == null ? undefined : String(link.attrs.title);
    const last = out[out.length - 1];
    if (last?.kind === 'link' && last.href === href && last.title === title) {
      const t = last.children[last.children.length - 1];
      if (t?.kind === 'text') t.value += text;
      else last.children.push({ kind: 'text', value: text });
    } else {
      const l: Inline = { kind: 'link', href, children: [{ kind: 'text', value: text }] };
      if (title !== undefined) l.title = title;
      out.push(l);
    }
  }
  return out;
}

const plainText = (n: PMNode) => (n.content ?? []).map((c) => c.text ?? '').join('');

function plainLineToInlines(n: PMNode): Inline[] {
  const indent = String(n.attrs?.indent ?? '');
  const inl = pmToInlines(n.content);
  if (!indent) return inl;
  const first = inl[0];
  if (first?.kind === 'text')
    return [{ kind: 'text', value: indent + first.value }, ...inl.slice(1)];
  return [{ kind: 'text', value: indent }, ...inl];
}

function articleFromPM(n: PMNode): Article {
  const [caption, ...lines] = n.content ?? [];
  const paragraphs: Paragraph[] = [];
  let lastCont: { cont?: ContinuationLines } | null = null;
  for (const l of lines) {
    const kind = (l.attrs?.kind ?? 'kou') as LineKind;
    const text = pmToInlines(l.content);
    const para = paragraphs[paragraphs.length - 1];
    if (kind === 'kou' || !para) {
      // 項の前の号などは normalize.ts で直しているが、念のため項として扱う
      const p: Paragraph = { text, items: [] };
      paragraphs.push(p);
      lastCont = p;
    } else if (kind === 'gou') {
      const item: Item = { text, subitems: [] };
      para.items.push(item);
      lastCont = item;
    } else if (kind === 'saibun') {
      let item = para.items[para.items.length - 1];
      if (!item) {
        item = { text: [], subitems: [] };
        para.items.push(item);
      }
      const sub: SubItem = { text };
      item.subitems.push(sub);
      lastCont = sub;
    } else {
      const target = lastCont ?? para;
      (target.cont ??= []).push(text);
    }
  }
  const attrs = n.attrs ?? {};
  return {
    type: 'article',
    num: (attrs.num as ArticleNum | null) ?? null,
    caption: caption ? plainText(caption) : '',
    general: !!attrs.general,
    deleted: !!attrs.deleted,
    paragraphs,
  };
}

const DEPTH: Record<DivisionLevel, number> = { chapter: 0, section: 1, subsection: 2 };

export function bodyFromPM(doc: PMNode): TopBlock[] {
  const body: TopBlock[] = [];
  /** 開いている章・節・款（外側から） */
  let stack: Division[] = [];
  /** 親ごとの見出しの数（番号を振る） */
  const counters = new Map<Division | null, Record<DivisionLevel, number>>();
  const container = (): DivisionChild[] | TopBlock[] => stack[stack.length - 1]?.children ?? body;
  const nextNum = (parent: Division | null, level: DivisionLevel) => {
    const c = counters.get(parent) ?? { chapter: 0, section: 0, subsection: 0 };
    counters.set(parent, c);
    return ++c[level];
  };

  for (const n of doc.content ?? []) {
    switch (n.type) {
      case 'division': {
        const level = (n.attrs?.level ?? 'chapter') as DivisionLevel;
        while (stack.length && DEPTH[stack[stack.length - 1]!.level] >= DEPTH[level]) stack.pop();
        const parent = stack[stack.length - 1] ?? null;
        const d: Division = {
          type: 'division',
          level,
          num: nextNum(parent, level),
          title: plainText(n),
          children: [],
        };
        const sep = n.attrs?.sep;
        if (typeof sep === 'string' && sep !== ' ') d.sep = sep;
        container().push(d);
        stack.push(d);
        break;
      }
      case 'article':
        container().push(articleFromPM(n));
        break;
      case 'prose':
        container().push({ type: 'prose', lines: (n.content ?? []).map(plainLineToInlines) });
        break;
      case 'raw':
        container().push({
          type: 'raw',
          source: plainText(n),
          reason: String(n.attrs?.reason ?? ''),
        });
        break;
      case 'preamble':
        stack = [];
        body.push({ type: 'preamble', lines: (n.content ?? []).map(plainLineToInlines) });
        break;
      case 'supplementary': {
        stack = [];
        const kids = n.content ?? [];
        body.push({
          type: 'supplementary',
          lines: kids.filter((k) => k.type === 'plainLine').map(plainLineToInlines),
          provisions: kids
            .filter((k) => k.type === 'provision')
            .map((p) => {
              const [h, ...ls] = p.content ?? [];
              return {
                heading: h ? plainText(h) : '',
                general: !!p.attrs?.general,
                lines: ls.map(plainLineToInlines),
              };
            }),
        });
        break;
      }
      case 'appendix': {
        stack = [];
        const [h, ...ls] = n.content ?? [];
        body.push({
          type: 'appendix',
          heading: h ? plainText(h) : '',
          lines: ls.map(plainLineToInlines),
        });
        break;
      }
    }
  }
  return body;
}
