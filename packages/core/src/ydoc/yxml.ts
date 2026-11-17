// Yjs の XML 断片 ⇔ エディタの文書（ProseMirror の JSON）。
// 形式はエディタが使う y-prosemirror（@tiptap/y-tiptap）と同じにする：
//   - ノードは Y.XmlElement（名前＝ノードの種類、属性＝ノードの属性。null の属性は持たない）
//   - 続いた文字は1つの Y.XmlText にまとめ、マークは書式（{ マーク名: マークの属性 }）として持つ
// サーバー（Phase 9・10）でも、エディタなしで改正案の本文を読み書きできるようにするため core に置く。

import * as Y from 'yjs';
import type { PMMark, PMNode } from './pmJson.ts';

function marksToAttributes(marks: readonly PMMark[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of marks ?? []) out[m.type] = m.attrs ?? {};
  return out;
}

function createElement(node: PMNode): Y.XmlElement {
  const el = new Y.XmlElement(node.type);
  for (const [k, v] of Object.entries(node.attrs ?? {})) {
    if (v !== null && v !== undefined && k !== 'ychange') el.setAttribute(k, v as string);
  }
  el.insert(0, createChildren(node.content ?? []));
  return el;
}

function createChildren(nodes: readonly PMNode[]): (Y.XmlElement | Y.XmlText)[] {
  const out: (Y.XmlElement | Y.XmlText)[] = [];
  let text: Y.XmlText | null = null;
  let length = 0;
  for (const n of nodes) {
    if (n.type === 'text') {
      if (!text) {
        text = new Y.XmlText();
        length = 0;
        out.push(text);
      }
      const value = n.text ?? '';
      text.insert(length, value, marksToAttributes(n.marks));
      length += value.length;
    } else {
      text = null;
      out.push(createElement(n));
    }
  }
  return out;
}

/** 文書の JSON（type: 'doc'）を空の断片に書き込む */
export function writeFragmentJSON(fragment: Y.XmlFragment, doc: PMNode) {
  const run = () => fragment.insert(0, createChildren(doc.content ?? []));
  if (fragment.doc) fragment.doc.transact(run);
  else run();
}

function readText(t: Y.XmlText): PMNode[] {
  const delta = t.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[];
  return delta
    .filter((d) => typeof d.insert === 'string' && d.insert !== '')
    .map((d) => {
      const node: PMNode = { type: 'text', text: d.insert as string };
      const marks = Object.entries(d.attributes ?? {}).map(([type, attrs]): PMMark => {
        // 同じ種類のマークが重なるとき y-prosemirror は「名前--ハッシュ」にする
        const name = type.split('--')[0]!;
        return attrs && typeof attrs === 'object' && Object.keys(attrs).length
          ? { type: name, attrs: attrs as Record<string, unknown> }
          : { type: name };
      });
      if (marks.length) node.marks = marks;
      return node;
    });
}

function readElement(el: Y.XmlElement): PMNode {
  const node: PMNode = { type: el.nodeName };
  const attrs = el.getAttributes() as Record<string, unknown>;
  if (Object.keys(attrs).length) node.attrs = attrs;
  const content = readChildren(el.toArray());
  if (content.length) node.content = content;
  return node;
}

function readChildren(items: (Y.XmlElement | Y.XmlText | Y.XmlHook)[]): PMNode[] {
  const out: PMNode[] = [];
  for (const it of items) {
    if (it instanceof Y.XmlText) out.push(...readText(it));
    else if (it instanceof Y.XmlElement) out.push(readElement(it));
  }
  return out;
}

/** 断片を文書の JSON（type: 'doc'）として読む */
export function readFragmentJSON(fragment: Y.XmlFragment): PMNode {
  return { type: 'doc', content: readChildren(fragment.toArray()) };
}
