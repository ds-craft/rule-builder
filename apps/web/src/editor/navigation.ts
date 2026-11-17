// 目次・検索結果（render/layout.ts のキー）から、エディタの文書の位置を求める。
// layout.ts と同じ順に見出し（h0, h1, …）と行（l0, l1, …）を数える。

import type { Node as PMNode } from '@tiptap/pm/model';

export type EditorTargets = { headings: number[]; lines: number[] };

export function editorTargets(doc: PMNode): EditorTargets {
  const headings: number[] = [];
  const lines: number[] = [];
  const plainLines = (node: PMNode, pos: number) => {
    node.forEach((child, off) => {
      if (child.type.name === 'plainLine') lines.push(pos + 1 + off);
    });
  };
  doc.forEach((block, pos) => {
    switch (block.type.name) {
      case 'preamble':
      case 'supplementary':
        headings.push(pos);
        plainLines(block, pos);
        block.forEach((child, off) => {
          if (child.type.name !== 'provision') return;
          const p = pos + 1 + off;
          headings.push(p + 1);
          plainLines(child, p);
        });
        return;
      case 'appendix':
        headings.push(pos + 1);
        plainLines(block, pos);
        return;
      case 'division':
        headings.push(pos);
        return;
      case 'article':
        block.forEach((child, off) => {
          if (child.type.name === 'articleCaption') headings.push(pos + 1 + off);
          else lines.push(pos + 1 + off);
        });
        return;
      case 'prose':
        plainLines(block, pos);
        return;
      case 'raw':
        lines.push(pos);
        return;
    }
  });
  return { headings, lines };
}

/** キー（h3・l12）から位置を求める */
export function targetPos(doc: PMNode, key: string): number | null {
  const t = editorTargets(doc);
  const n = Number(key.slice(1));
  const list = key[0] === 'h' ? t.headings : t.lines;
  return list[n] ?? null;
}
