// エディタの動き（キー操作・貼り付け・装飾・自動補正）をまとめた TipTap の拡張。

import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { changesPlugin } from './changes.ts';
import type { UndoManager } from 'yjs';
import {
  backspaceAtLineStart,
  demote,
  enterInLine,
  pasteLines,
  promote,
  type Result,
} from './commands.ts';
import {
  currentLinePlugin,
  normalizePlugin,
  numberingPlugin,
  undoBoundaryPlugin,
} from './plugins.ts';

export type RuleEditingOptions = {
  /** 利用者向けの知らせ（レベルを変えられないときなど） */
  notify: (message: string) => void;
  getUndoManager: () => UndoManager | null;
  /** Ctrl+Enter（後に条を挿入） */
  onInsertArticle: () => void;
  /** 改正前の条の中身（変更箇所の表示に使う。新規制定では null） */
  baseSignatures: string[] | null;
};

/** 構造の変更は「元に戻す」の1回分として区切る */
export function runResult(
  editor: Editor,
  r: Result | null,
  notify: (m: string) => void,
  undo?: UndoManager | null,
): boolean {
  if (!r) return false;
  if ('error' in r) {
    if (r.error) notify(r.error);
    return true;
  }
  undo?.stopCapturing();
  editor.view.dispatch(r.tr);
  undo?.stopCapturing();
  return true;
}

export const RuleEditing = Extension.create<RuleEditingOptions>({
  name: 'ruleEditing',

  addOptions() {
    return {
      notify: () => {},
      getUndoManager: () => null,
      onInsertArticle: () => {},
      baseSignatures: null,
    };
  },

  addProseMirrorPlugins() {
    const { notify } = this.options;
    const getUndo = this.options.getUndoManager;
    const editor = this.editor;
    return [
      numberingPlugin(),
      currentLinePlugin(),
      changesPlugin(this.options.baseSignatures),
      normalizePlugin(),
      undoBoundaryPlugin(getUndo),
      // 貼り付けは書式を落とす。複数行は行頭の番号から項・号・細分に分ける
      pastePlugin(editor, notify, getUndo),
    ];
  },

  addKeyboardShortcuts() {
    const { notify, getUndoManager } = this.options;
    // 日本語変換中の Enter・Tab は処理しない
    const run = (f: (s: EditorState) => Result | null) => () => {
      if (this.editor.view.composing) return false;
      return runResult(this.editor, f(this.editor.state), notify, getUndoManager());
    };
    return {
      Enter: run(enterInLine),
      Tab: run(demote),
      'Shift-Tab': run(promote),
      'Alt-Shift-ArrowRight': run(demote),
      'Alt-Shift-ArrowLeft': run(promote),
      Backspace: run(backspaceAtLineStart),
      'Mod-Enter': () => {
        this.options.onInsertArticle();
        return true;
      },
    };
  },
});

function pastePlugin(
  editor: Editor,
  notify: (m: string) => void,
  getUndo: () => UndoManager | null,
) {
  return new Plugin({
    key: new PluginKey('rb-paste'),
    props: {
      handlePaste(view, event) {
        const text = event.clipboardData?.getData('text/plain') ?? '';
        if (!text) return true;
        if (!/\r?\n./.test(text.trim())) {
          view.dispatch(view.state.tr.insertText(text.replace(/\r?\n/g, '')).scrollIntoView());
          return true;
        }
        const r = pasteLines(view.state, text);
        if (!r) {
          view.dispatch(view.state.tr.insertText(text.replace(/\r?\n/g, '')).scrollIntoView());
          notify('複数行の取り込みは、条の行や前文・附則の行で行えます');
          return true;
        }
        runResult(editor, r, notify, getUndo());
        if ('tr' in r) notify('行頭の番号から項・号に分けて取り込みました');
        return true;
      },
      // ドロップした HTML の書式も落とす
      transformPastedHTML: (html) => html.replace(/<[^>]+>/g, ''),
    },
  });
}
