// アプリ全体の状態。
// 開いている改正案（session）と、その中のルールの一覧の写し（entries）、画面の表示状態（ui）を持つ。
// 改正案の実体は Y.Doc（state/session.ts）。entries は表示・書き出しのための写しで、Y.Doc の変更に合わせて作り直す。

import type { EntryOp, ProposalMeta, Renumbering, RuleDoc, TopBlock } from '@rule-builder/core';
import type * as Y from 'yjs';
import { create } from 'zustand';
import type { KeptUndoManager } from '../editor/ydoc.ts';
import type { ProposalSession, SaveState } from './session.ts';

/** 改正案の中のルール（表示用の写し） */
export type OpenEntry = {
  /** entryId */
  key: string;
  op: EntryOp;
  ruleId: string;
  baseSha: string;
  baseMarkdown: string;
  /** 本文の最新の写し（エディタの変更を少し遅れて反映する。表示・書き出し用） */
  doc: RuleDoc;
  /** 廃止のルールは本文を編集しない */
  readOnly: boolean;
  /** 本文の実体（エディタがそのまま編集する） */
  ydoc: Y.Doc;
  fragment: Y.XmlFragment;
  undo: KeptUndoManager;
};

export type RibbonTab = 'home' | 'insert' | 'review' | 'view' | 'article';
export type PaneKind = 'info' | 'check' | 'refs';
export type ViewMode = 'edit' | 'read';
export type OpenLocation = 'recent' | 'remote' | 'device';

export type UiState = {
  tab: RibbonTab;
  /** スマホでリボンを開いているか */
  ribbonOpen: boolean;
  nav: boolean;
  pane: PaneKind | null;
  mode: ViewMode;
  generalOnly: boolean;
  showChanges: boolean;
  zoom: number;
  search: string;
  openLocation: OpenLocation;
};

export type Toast = { id: number; message: string };

export type AppState = {
  session: ProposalSession | null;
  proposal: ProposalMeta | null;
  entries: OpenEntry[];
  current: number;
  saveState: SaveState;
  ui: UiState;
  toast: Toast | null;
  /** 番号が変わった条の対応表（ルールごと・操作ごと）。参照の確認（Phase 7）で使う */
  renumberLog: Record<string, Renumbering[][]>;
  logRenumbering: (key: string, list: Renumbering[]) => void;
  /** 改正案を開く（開いていた改正案は閉じる） */
  openSession: (session: ProposalSession) => Promise<void>;
  closeSession: () => Promise<void>;
  /** Y.Doc の改正案の情報・ルールの一覧から写しを作り直す */
  refresh: () => void;
  /** エディタの変更を本文の写しに反映する */
  updateBody: (key: string, body: TopBlock[]) => void;
  setCurrent: (index: number) => void;
  setUi: (patch: Partial<UiState>) => void;
  showToast: (message: string) => void;
};

export const ZOOM_MIN = 60;
export const ZOOM_MAX = 160;

export const initialUi: UiState = {
  tab: 'home',
  ribbonOpen: true,
  nav: true,
  pane: null,
  mode: 'edit',
  generalOnly: false,
  showChanges: true,
  zoom: 100,
  search: '',
  openLocation: 'recent',
};

let toastId = 0;
let unsubscribe: (() => void) | null = null;

export const useApp = create<AppState>()((set, get) => ({
  session: null,
  proposal: null,
  entries: [],
  current: -1,
  saveState: 'saved',
  ui: initialUi,
  toast: null,
  renumberLog: {},
  logRenumbering(key, list) {
    if (list.length === 0) return;
    set((s) => ({
      renumberLog: { ...s.renumberLog, [key]: [...(s.renumberLog[key] ?? []), list] },
    }));
  },
  async openSession(session) {
    const prev = get().session;
    if (prev === session) return;
    unsubscribe?.();
    if (prev) await prev.destroy();
    set({ session, entries: [], current: -1, renumberLog: {} });
    unsubscribe = session.subscribe(() => get().refresh());
    get().refresh();
    void session.saveRecent();
  },
  async closeSession() {
    const prev = get().session;
    unsubscribe?.();
    unsubscribe = null;
    set({ session: null, proposal: null, entries: [], current: -1, renumberLog: {} });
    if (prev) await prev.destroy();
  },
  refresh() {
    const session = get().session;
    if (!session) return;
    const old = new Map(get().entries.map((e) => [e.key, e]));
    const entries = session.entries().map((info): OpenEntry => {
      const prev = old.get(info.entryId);
      const body = prev?.doc.body ?? session.body(info);
      return {
        key: info.entryId,
        op: info.op,
        ruleId: info.ruleId,
        baseSha: info.baseSha,
        baseMarkdown: info.baseMarkdown,
        doc: { meta: info.meta, body },
        readOnly: info.op === 'repeal',
        ydoc: session.ydoc,
        fragment: session.fragment(info.entryId),
        undo: session.undoFor(info.entryId),
      };
    });
    const current = Math.min(get().current, entries.length - 1);
    set({ proposal: session.meta(), entries, current, saveState: session.saveState });
  },
  updateBody(key, body) {
    set((s) => ({
      entries: s.entries.map((e) => (e.key === key ? { ...e, doc: { ...e.doc, body } } : e)),
    }));
  },
  setCurrent(index) {
    set({ current: index });
  },
  setUi(patch) {
    set((s) => ({ ui: { ...s.ui, ...patch } }));
  },
  showToast(message) {
    set({ toast: { id: ++toastId, message } });
  },
}));

export const currentEntry = (s: AppState): OpenEntry | null => s.entries[s.current] ?? null;
