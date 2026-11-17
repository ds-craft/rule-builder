// 下書きファイル（F-35）：改正案を .json に保存・読み込みする。
//   { format: 'rule-builder-proposal', version: 1, proposal, ydocUpdate }
// proposal は人が読める形、ydocUpdate は Y.encodeStateAsUpdate の Base64。読み込みは ydocUpdate を優先する。

import * as Y from 'yjs';
import type { Proposal } from '../model/proposal.ts';
import { readProposal } from './proposal.ts';

export const DRAFT_FORMAT = 'rule-builder-proposal';
export const DRAFT_VERSION = 1;

export type DraftFile = {
  format: typeof DRAFT_FORMAT;
  version: number;
  proposal: Proposal;
  ydocUpdate: string;
};

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeDraft(ydoc: Y.Doc): DraftFile {
  return {
    format: DRAFT_FORMAT,
    version: DRAFT_VERSION,
    proposal: readProposal(ydoc),
    ydocUpdate: toBase64(Y.encodeStateAsUpdate(ydoc)),
  };
}

export class DraftFileError extends Error {}

/** 下書きファイルの中身（JSON の文字列）から改正案の Y.Doc を作る */
export function decodeDraft(text: string): Y.Doc {
  let data: Partial<DraftFile>;
  try {
    data = JSON.parse(text) as Partial<DraftFile>;
  } catch {
    throw new DraftFileError('rule-builder の下書きファイルではありません');
  }
  if (data.format !== DRAFT_FORMAT)
    throw new DraftFileError('rule-builder の下書きファイルではありません');
  if (typeof data.version !== 'number' || data.version > DRAFT_VERSION) {
    throw new DraftFileError(
      '新しい版の rule-builder で作られた下書きファイルです。ページを再読み込みしてください',
    );
  }
  if (typeof data.ydocUpdate !== 'string') throw new DraftFileError('下書きファイルが壊れています');
  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, fromBase64(data.ydocUpdate));
  } catch {
    throw new DraftFileError('下書きファイルが壊れています');
  }
  return ydoc;
}
