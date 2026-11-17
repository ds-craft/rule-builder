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

// 番号・案内表示・「）」・「一般向け」は、行の中に要素（ウィジェット）を置かず、行の属性（data-no・data-ph）と
// CSS の ::before・::after で描く（shell.css）。行の中に編集できない要素があると、日本語変換と干渉する。
//   - 空の行の案内表示を出し入れすると、変換の始まりで1文字目が二重に入る（Chrome・Brave の Microsoft IME）
//   - 行頭の番号の要素の隣で変換中の文字をすべて消すと、カーソルが外れる（Android の Gboard）
// 属性の付け替えは行の要素の書き換えだけで済み、変換中の文字の DOM には触れない。

type Attrs = Record<string, string>;

const line = (pos: number, node: PMNode, attrs: Attrs) =>
  Decoration.node(pos, pos + node.nodeSize, attrs);

/** 番号（行頭）と、空の行の案内表示 */
function marks(node: PMNode, no: string, ph: string): Attrs {
  const attrs: Attrs = {};
  if (no) attrs['data-no'] = no;
  if (ph && node.content.size === 0) {
    attrs['data-ph'] = ph;
    // 案内表示は行の中の入れ物（.lt）の ::before で描くので、文言は CSS の変数で渡す
    attrs.style = `--ph: "${ph}"`;
  }
  return attrs;
}

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
        const name = { chapter: '章', section: '節', subsection: '款' }[level] + 'の名前を入力';
        decos.push(
          line(pos, block, marks(block, formatDivisionNum(level, count[level]) + sep, name)),
        );
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
            // 「）」と「一般向け」は CSS で描く（.caption-wrap::after・.article[data-general] h5::after）
            const label = articleLabel(num);
            decos.push(
              line(
                cpos,
                child,
                deleted
                  ? { 'data-no': `${label}　削除` }
                  : marks(child, label + '（', '見出しを入力'),
              ),
            );
            return;
          }
          if (child.type.name !== 'lawLine') return;
          const info = infos[i++]!;
          decos.push(
            line(cpos, child, {
              class: `law-line--${info.cls}`,
              ...marks(child, info.label && info.label + '　', PLACEHOLDER[info.cls] ?? ''),
            }),
          );
        });
        return;
      }
      default:
        // 前文・附則・別表・本文の行
        block.descendants((child, childOffset) => {
          const cpos = pos + 1 + childOffset;
          if (child.type.name === 'appendixHeading') {
            decos.push(line(cpos, child, marks(child, '', '別表の見出しを入力')));
            return false;
          }
          if (child.type.name !== 'plainLine') return true;
          decos.push(
            line(cpos, child, {
              class: `law-line--${plainLineClass((child.attrs.indent as string) + child.textContent)}`,
              ...marks(child, '', 'ここに入力'),
            }),
          );
          return false;
        });
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
