// いま紙面で編集しているエディタ（コマンドから使う）。
import type { Editor } from '@tiptap/core';
import { create } from 'zustand';

export const useActiveEditor = create<{ editor: Editor | null; version: number }>(() => ({
  editor: null,
  version: 0,
}));

export function setActiveEditor(editor: Editor | null) {
  useActiveEditor.setState({ editor });
}

/** 選択や元に戻すの状態が変わったら、リボン・ステータスバーを描き直す */
export function bumpEditorVersion() {
  useActiveEditor.setState((s) => ({ version: s.version + 1 }));
}
