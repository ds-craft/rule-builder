// エディタが編集する Yjs 文書の用意。
// 最初から Collaboration 拡張で Y.XmlFragment につなぎ、元に戻すは Yjs の UndoManager（自分の操作だけを戻す）で行う。
// Phase 5 で改正案1件＝1つの Y.Doc（ルールごとに body:<entryId> の断片）にし、Phase 9 でサーバーと同期する。

import type { TopBlock } from '@rule-builder/core';
import { getSchema } from '@tiptap/core';
import {
  defaultDeleteFilter,
  defaultProtectedNodes,
  prosemirrorJSONToYXmlFragment,
  ySyncPluginKey,
  yXmlFragmentToProsemirrorJSON,
} from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { bodyFromPM, bodyToPM, type PMNode } from './convert.ts';
import { schemaExtensions } from './schema.ts';

export const editorSchema = getSchema(schemaExtensions);

/** 同じ行で続けて打った分をまとめる時間（行が変わると plugins.ts の undoBoundaryPlugin で区切る） */
export const UNDO_CAPTURE_MS = 1500;

export const bodyField = (entryId: string) => `body:${entryId}`;

/** 本文を Yjs の断片に書き込む（断片が空のときだけ使う） */
export function writeBody(fragment: Y.XmlFragment, body: readonly TopBlock[]) {
  prosemirrorJSONToYXmlFragment(editorSchema, bodyToPM(body), fragment);
}

/** Yjs の断片から本文（モデル）を読む */
export function readBody(fragment: Y.XmlFragment): TopBlock[] {
  return bodyFromPM(yXmlFragmentToProsemirrorJSON(fragment) as PMNode);
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
