// 開いている改正案（1件＝1つの Y.Doc）。ブラウザへの自動保存（y-indexeddb）と、ルールごとの元に戻す履歴を持つ。

import {
  entryFragment,
  readEntries,
  readEntryDoc,
  readProposalMeta,
  touchProposal,
  type EntryInfo,
  type ProposalMeta,
  type TopBlock,
} from '@rule-builder/core';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { createUndoManager, type KeptUndoManager } from '../editor/ydoc.ts';
import { putRecent } from '../storage/recent.ts';

/** 改正案ごとの IndexedDB の名前 */
export const persistenceName = (id: string) => `rule-builder-proposal:${id}`;

/** 更新日時の記録（この変更では更新日時を書き換えない） */
const TOUCH = Symbol('touch');

export type SaveState = 'saved' | 'saving';

export class ProposalSession {
  readonly ydoc: Y.Doc;
  readonly id: string;
  private persistence: IndexeddbPersistence | null = null;
  private undos = new Map<string, KeptUndoManager>();
  private touchTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  saveState: SaveState = 'saved';

  constructor(ydoc: Y.Doc, persist = true) {
    this.ydoc = ydoc;
    this.id = readProposalMeta(ydoc).id;
    if (persist && typeof indexedDB !== 'undefined') {
      try {
        this.persistence = new IndexeddbPersistence(persistenceName(this.id), ydoc);
      } catch {
        this.persistence = null;
      }
    }
    ydoc.on('update', this.onUpdate);
    ydoc.getMap('meta').observeDeep(this.emit);
    ydoc.getArray('entries').observeDeep(this.emit);
  }

  /** ブラウザに保存してある改正案を開く */
  static async load(id: string): Promise<ProposalSession> {
    const ydoc = new Y.Doc();
    const p = new IndexeddbPersistence(persistenceName(id), ydoc);
    await p.whenSynced;
    await p.destroy();
    return new ProposalSession(ydoc);
  }

  /** 保存の状態や、改正案の情報・ルールの一覧が変わったときに呼ぶ */
  subscribe(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private emit = () => {
    this.listeners.forEach((f) => f());
  };

  private onUpdate = (_u: Uint8Array, origin: unknown) => {
    this.saveState = 'saving';
    this.emit();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveState = 'saved';
      this.emit();
    }, 600);
    if (origin === TOUCH || origin === this.persistence) return;
    // 更新日時と最近使った改正案の一覧は少し待ってからまとめて書く
    if (this.touchTimer) clearTimeout(this.touchTimer);
    this.touchTimer = setTimeout(() => this.touch(), 800);
  };

  /** 更新日時を記録し、最近使った改正案の一覧を更新する */
  touch() {
    this.ydoc.transact(() => touchProposal(this.ydoc), TOUCH);
    void this.saveRecent();
  }

  saveRecent() {
    const meta = this.meta();
    return putRecent({
      id: meta.id,
      amendingNumber: meta.amendingNumber,
      enforcementDate: meta.enforcementDate,
      rules: readEntries(this.ydoc).map((e) => ({ name: e.meta.name, op: e.op })),
      updatedAt: meta.updatedAt,
    });
  }

  meta(): ProposalMeta {
    return readProposalMeta(this.ydoc);
  }

  entries(): EntryInfo[] {
    return readEntries(this.ydoc);
  }

  fragment(entryId: string): Y.XmlFragment {
    return entryFragment(this.ydoc, entryId);
  }

  /** ルールごとの元に戻す履歴（エディタを作り直しても残る） */
  undoFor(entryId: string): KeptUndoManager {
    let u = this.undos.get(entryId);
    if (!u) {
      u = createUndoManager(this.fragment(entryId));
      this.undos.set(entryId, u);
    }
    return u;
  }

  body(info: EntryInfo): TopBlock[] {
    return readEntryDoc(this.ydoc, info).body;
  }

  async destroy() {
    if (this.touchTimer) {
      clearTimeout(this.touchTimer);
      this.touch();
    }
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.ydoc.off('update', this.onUpdate);
    this.undos.forEach((u) => u.dispose());
    this.undos.clear();
    this.listeners.clear();
    if (this.persistence) await this.persistence.destroy();
    this.ydoc.destroy();
  }
}
