// エディタのプラグイン：番号・字下げの装飾、不正な行の並びの自動補正、元に戻すの区切り。

import { formatDivisionNum, type ArticleNum, type DivisionLevel } from '@rule-builder/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { UndoManager } from 'yjs';
import { articleLabel, articleLineInfos, lineKindsOf, plainLineClass } from './lines.ts';
import type { LineKind } from './schema.ts';

const PLACEHOLDER: Record<string, string> = {
  single: 'ここに条文を入力',
  kou: 'ここに項を入力',
  'kou-cont': 'ここに入力',
  gou: 'ここに号を入力',
  saibun: 'ここに号の細分を入力',
};

function span(cls: string, text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = cls;
  el.contentEditable = 'false';
  el.textContent = text;
  return el;
}

const widget = (pos: number, cls: string, text: string, side = -1) =>
  Decoration.widget(pos, () => span(cls, text), {
    side,
    key: `${cls}:${text}`,
    ignoreSelection: true,
  });

const placeholder = (pos: number, text: string) =>
  Decoration.widget(pos, () => span('ph', text), {
    side: 1,
    key: `ph:${text}`,
    ignoreSelection: true,
  });

function buildDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  const count: Record<DivisionLevel, number> = { chapter: 0, section: 0, subsection: 0 };

  doc.forEach((block, offset) => {
    const pos = offset;
    switch (block.type.name) {
      case 'division': {
        const level = block.attrs.level as DivisionLevel;
        count[level]++;
        if (level === 'chapter') count.section = count.subsection = 0;
        if (level === 'section') count.subsection = 0;
        const sep = (block.attrs.sep as string | null) ?? ' ';
        decos.push(widget(pos + 1, 'no', formatDivisionNum(level, count[level]) + sep));
        if (block.content.size === 0) {
          decos.push(
            placeholder(
              pos + 1,
              { chapter: '章', section: '節', subsection: '款' }[level] + 'の名前を入力',
            ),
          );
        }
        return;
      }
      case 'article': {
        const infos = articleLineInfos(lineKindsOf(block));
        const num = block.attrs.num as ArticleNum | null;
        const deleted = !!block.attrs.deleted;
        let i = 0;
        block.forEach((child, childOffset) => {
          const cpos = pos + 1 + childOffset;
          if (child.type.name === 'articleCaption') {
            const label = articleLabel(num);
            if (deleted) {
              decos.push(widget(cpos + 1, 'no', `${label}　削除`));
              return;
            }
            decos.push(widget(cpos + 1, 'no', label + '（'));
            if (child.content.size === 0) decos.push(placeholder(cpos + 1, '見出しを入力'));
            decos.push(widget(cpos + 1 + child.content.size, 'no paren-close', '）', 1));
            if (block.attrs.general) {
              decos.push(widget(cpos + 1 + child.content.size, 'genmark', '一般向け', 2));
            }
            return;
          }
          if (child.type.name !== 'lawLine') return;
          const info = infos[i++]!;
          decos.push(
            Decoration.node(cpos, cpos + child.nodeSize, { class: `law-line--${info.cls}` }),
          );
          if (info.label) decos.push(widget(cpos + 1, 'no', info.label + '　'));
          if (child.content.size === 0)
            decos.push(placeholder(cpos + 1, PLACEHOLDER[info.cls] ?? ''));
        });
        return;
      }
      default:
        // 前文・附則・別表・本文の行
        block.descendants((child, childOffset) => {
          if (child.type.name !== 'plainLine') return true;
          const cpos = pos + 1 + childOffset;
          decos.push(
            Decoration.node(cpos, cpos + child.nodeSize, {
              class: `law-line--${plainLineClass((child.attrs.indent as string) + child.textContent)}`,
            }),
          );
          if (child.content.size === 0) decos.push(placeholder(cpos + 1, 'ここに入力'));
          return false;
        });
        if (block.type.name === 'appendix' && block.firstChild?.content.size === 0) {
          decos.push(placeholder(pos + 2, '別表の見出しを入力'));
        }
    }
  });
  return DecorationSet.create(doc, decos);
}

export const numberingKey = new PluginKey<DecorationSet>('rb-numbering');

/** 項・号・細分・章・節・条の番号と、字下げのクラス・プレースホルダーを描く */
export function numberingPlugin() {
  return new Plugin<DecorationSet>({
    key: numberingKey,
    state: {
      init: (_, state) => buildDecorations(state.doc),
      apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old),
    },
    props: {
      decorations: (state) => numberingKey.getState(state),
    },
  });
}

/** 条の中の行の並びを直す変更（項の前の号は項に、号のない細分は号にする）。直すものが無ければ null */
export function normalizeLines(state: EditorState): Transaction | null {
  let tr: Transaction | null = null;
  state.doc.forEach((block, offset) => {
    if (block.type.name !== 'article') return;
    let hasPara = false;
    let hasItem = false;
    block.forEach((child, childOffset) => {
      if (child.type.name !== 'lawLine') return;
      const kind = child.attrs.kind as LineKind;
      let fixed: LineKind = kind;
      if (!hasPara) fixed = 'kou';
      else if (kind === 'saibun' && !hasItem) fixed = 'gou';
      if (fixed === 'kou') {
        hasPara = true;
        hasItem = false;
      } else if (fixed === 'gou') hasItem = true;
      if (fixed !== kind) {
        tr ??= state.tr;
        tr.setNodeMarkup(offset + 1 + childOffset, undefined, { ...child.attrs, kind: fixed });
      }
    });
  });
  return tr;
}

export function normalizePlugin() {
  return new Plugin({
    key: new PluginKey('rb-normalize'),
    appendTransaction(trs, _old, state) {
      if (!trs.some((t) => t.docChanged)) return null;
      return normalizeLines(state);
    },
  });
}

/** 行が変わったら「元に戻す」の区切りを入れる（同じ行で続けて打った分だけを1回にまとめる） */
export function undoBoundaryPlugin(getUndoManager: () => UndoManager | null) {
  return new Plugin({
    key: new PluginKey('rb-undo-boundary'),
    view() {
      return {
        update(view, prev) {
          const a = prev.selection.$from;
          const b = view.state.selection.$from;
          if (a.start() !== b.start()) getUndoManager()?.stopCapturing();
        },
      };
    },
  });
}

/** カーソルのある行と条を強調する（プロトタイプの .law-line:focus-within・.cur-article） */
export function currentLinePlugin() {
  return new Plugin({
    key: new PluginKey('rb-current-line'),
    props: {
      decorations(state) {
        const { $from } = state.selection;
        if (!state.selection.empty || $from.depth < 1) return null;
        const decos: Decoration[] = [];
        if ($from.parent.isTextblock && $from.depth >= 1) {
          decos.push(Decoration.node($from.before(), $from.after(), { class: 'is-current' }));
        }
        if ($from.node(1).type.name === 'article' && $from.depth >= 2) {
          decos.push(Decoration.node($from.before(1), $from.after(1), { class: 'cur-article' }));
        }
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}
