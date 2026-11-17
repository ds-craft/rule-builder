// インライン：[文言](href "title") をリンクに、それ以外はテキストとして保持する。
// `*`・`_` などの記法の文字はそのまま文字として持つ（書式チェックは lint で行う）。

import type { Inline } from '../model/types.ts';

const LINK_RE = /\[([^\]]*)\]\(([^\s)]*)(?:\s+"([^"]*)")?\)/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(LINK_RE)) {
    if (m.index > last) out.push({ kind: 'text', value: src.slice(last, m.index) });
    const link: Inline = { kind: 'link', href: m[2] ?? '', children: [] };
    if (m[1]) link.children.push({ kind: 'text', value: m[1] });
    if (m[3] !== undefined) link.title = m[3];
    out.push(link);
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ kind: 'text', value: src.slice(last) });
  return out;
}

export function serializeInline(inlines: readonly Inline[]): string {
  return inlines
    .map((n) => {
      if (n.kind === 'text') return n.value;
      const title = n.title !== undefined ? ` "${n.title}"` : '';
      return `[${serializeInline(n.children)}](${n.href}${title})`;
    })
    .join('');
}

/** 表示用の文字列（リンクは文言だけ）。 */
export function inlineText(inlines: readonly Inline[]): string {
  return inlines.map((n) => (n.kind === 'text' ? n.value : inlineText(n.children))).join('');
}

export function text(value: string): Inline[] {
  return value === '' ? [] : [{ kind: 'text', value }];
}
