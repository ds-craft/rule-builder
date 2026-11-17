// エディタが編集する Yjs 文書の用意。
// 最初から Collaboration 拡張で Y.XmlFragment につなぎ、元に戻すは Yjs の UndoManager（自分の操作だけを戻す）で行う。
// Phase 5 で改正案1件＝1つの Y.Doc（ルールごとに body:<entryId> の断片）にし、Phase 9 でサーバーと同期する。

import {
  bodyFromPM,
  bodyToPM,
  readFragmentJSON,
  writeFragmentJSON,
  type TopBlock,
} from '@rule-builder/core';
import { getSchema } from '@tiptap/core';
import { defaultDeleteFilter, defaultProtectedNodes, ySyncPluginKey } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { schemaExtensions } from './schema.ts';

export const editorSchema = getSchema(schemaExtensions);

/** 同じ行で続けて打った分をまとめる時間（行が変わると plugins.ts の undoBoundaryPlugin で区切る） */
export const UNDO_CAPTURE_MS = 1500;

export { bodyField } from '@rule-builder/core';

/** 本文を Yjs の断片に書き込む（断片が空のときだけ使う） */
export function writeBody(fragment: Y.XmlFragment, body: readonly TopBlock[]) {
  writeFragmentJSON(fragment, bodyToPM(body));
}

/** Yjs の断片から本文（モデル）を読む */
export function readBody(fragment: Y.XmlFragment): TopBlock[] {
  return bodyFromPM(readFragmentJSON(fragment));
}

/**
 * エディタを作り直しても履歴が残る UndoManager。
 * y-tiptap はエディタを閉じるときに渡した UndoManager も destroy するため、それを無視し、
 * 文書を捨てるときだけ dispose で破棄する。
 */
export class KeptUndoManager extends Y.UndoManager {
  override destroy() {}
  dispose() {
    super.destroy();
  }
}

export function createUndoManager(fragment: Y.XmlFragment): KeptUndoManager {
  return new KeptUndoManager(fragment, {
    trackedOrigins: new Set([ySyncPluginKey]),
    captureTimeout: UNDO_CAPTURE_MS,
    deleteFilter: (item) => defaultDeleteFilter(item, defaultProtectedNodes),
    captureTransaction: (tr) => tr.meta.get('addToHistory') !== false,
  });
}
