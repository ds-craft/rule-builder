// アプリ全体の状態。
// 開いている文書（entries）と、画面の表示状態（ui）を持つ。
// Phase 5 で改正案（Yjs 文書）を入れるまでは、公開中のルールを閲覧用に開くだけ。

import type { RuleDoc } from '@rule-builder/core';
import { create } from 'zustand';

export type OpenEntry = {
  key: string;
  /** 公開中のルールを閲覧用に開いたもの */
  source: 'remote';
  ruleId: string;
  path: string;
  /** 取得したときの main のコミットSHA */
  sha: string;
  markdown: string;
  doc: RuleDoc;
  readOnly: boolean;
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
  entries: OpenEntry[];
  current: number;
  ui: UiState;
  toast: Toast | null;
  /** 開いている文書を足し、その位置を返す（同じルールがあればそれを使う） */
  openEntry: (entry: OpenEntry) => number;
  closeAll: () => void;
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
  mode: 'read',
  generalOnly: false,
  showChanges: true,
  zoom: 100,
  search: '',
  openLocation: 'recent',
};

let toastId = 0;

export const useApp = create<AppState>()((set, get) => ({
  entries: [],
  current: -1,
  ui: initialUi,
  toast: null,
  openEntry(entry) {
    const { entries } = get();
    const i = entries.findIndex((e) => e.ruleId === entry.ruleId && e.sha === entry.sha);
    if (i >= 0) return i;
    set({ entries: [...entries, entry] });
    return entries.length;
  },
  closeAll() {
    set({ entries: [], current: -1 });
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
