// コマンド定義の一覧。リボン・右クリックメニュー・スマホの下部バー・キー操作が同じ定義を使う。
// まだ中身のない操作は enabled が false を返し、無効表示になる（後のフェーズで中身を入れる）。

import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Code,
  Columns2,
  Eye,
  FilePlus2,
  Hash,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Link,
  List,
  Pencil,
  Plus,
  Redo2,
  Save,
  Search,
  SpellCheck,
  Trash2,
  Undo2,
  Users,
} from 'lucide-react';
import { serializeRule } from '@rule-builder/core';
import type { Command, CommandContext } from './types.ts';
import { ZOOM_MAX, ZOOM_MIN } from '../state/store.ts';
import { openMarkdownDialog } from '../ui/common/dialogs.tsx';

const never = () => false;
const editable = (ctx: CommandContext) =>
  !!ctx.entry && !ctx.entry.readOnly && ctx.app.ui.mode === 'edit';

const list: Command[] = [
  // ---- 元に戻す（Phase 3） ----
  { id: 'undo', label: '元に戻す', icon: Undo2, shortcut: 'Ctrl+Z', enabled: never, run() {} },
  { id: 'redo', label: 'やり直し', icon: Redo2, shortcut: 'Ctrl+Y', enabled: never, run() {} },

  // ---- 行の種類・段落・追加（Phase 3） ----
  { id: 'kind-p', label: '項', icon: '①', tip: 'この行を「項」にする', enabled: never, run() {} },
  { id: 'kind-i', label: '号', icon: '一', tip: 'この行を「号」にする', enabled: never, run() {} },
  {
    id: 'kind-s',
    label: '号の細分',
    icon: 'イ',
    tip: 'この行を「号の細分」にする',
    enabled: never,
    run() {},
  },
  {
    id: 'promote',
    label: 'レベルを上げる',
    icon: IndentDecrease,
    shortcut: 'Shift+Tab',
    enabled: never,
    run() {},
  },
  {
    id: 'demote',
    label: 'レベルを下げる',
    icon: IndentIncrease,
    shortcut: 'Tab',
    enabled: never,
    run() {},
  },
  {
    id: 'add-para',
    label: '項',
    icon: Plus,
    tip: '項を追加',
    shortcut: 'Enter',
    enabled: never,
    run() {},
  },
  { id: 'add-item', label: '号', icon: Plus, tip: '号を追加', enabled: never, run() {} },
  {
    id: 'general',
    label: '一般向け',
    icon: Users,
    tip: '一般向け条文にする（ポータルの「一般向け条文のみ表示」で表示される）',
    enabled: never,
    pressed: () => false,
    run() {},
  },

  // ---- 挿入（Phase 4） ----
  {
    id: 'article-after',
    label: '条を挿入',
    icon: FilePlus2,
    tip: '条を挿入',
    shortcut: 'Ctrl+Enter',
    enabled: never,
    run() {},
  },
  { id: 'article-before', label: '前に条を挿入', icon: FilePlus2, enabled: never, run() {} },
  { id: 'chapter', label: '章', icon: '章', tip: '章を挿入', enabled: never, run() {} },
  { id: 'section', label: '節', icon: '節', tip: '節を挿入', enabled: never, run() {} },
  { id: 'preamble', label: '前文', icon: '前', tip: '前文を追加', enabled: never, run() {} },
  { id: 'supp', label: '附則', icon: '附', tip: '附則に行を追加', enabled: never, run() {} },
  { id: 'link', label: '条文へのリンク', icon: Link, shortcut: 'Ctrl+K', enabled: never, run() {} },

  // ---- 条のツール（Phase 4） ----
  { id: 'art-up', label: '上へ移動', icon: ArrowUp, enabled: never, run() {} },
  { id: 'art-down', label: '下へ移動', icon: ArrowDown, enabled: never, run() {} },
  { id: 'art-renum', label: '条番号の変更', icon: Hash, enabled: never, run() {} },
  { id: 'art-del', label: 'この条を削除', icon: Trash2, enabled: never, run() {} },

  // ---- 校閲 ----
  {
    id: 'pane-check',
    label: '書式チェック',
    icon: SpellCheck,
    enabled: (ctx) => !!ctx.entry,
    pressed: (ctx) => ctx.app.ui.pane === 'check',
    run: (ctx) => togglePane(ctx, 'check'),
  },
  {
    id: 'pane-refs',
    label: '参照の確認',
    icon: ArrowLeftRight,
    enabled: (ctx) => !!ctx.entry,
    pressed: (ctx) => ctx.app.ui.pane === 'refs',
    run: (ctx) => togglePane(ctx, 'refs'),
  },
  {
    id: 'pane-info',
    label: 'ルールの情報',
    icon: Pencil,
    enabled: (ctx) => !!ctx.entry,
    pressed: (ctx) => ctx.app.ui.pane === 'info',
    run: (ctx) => togglePane(ctx, 'info'),
  },
  {
    id: 'show-changes',
    label: '変更箇所を表示',
    icon: Highlighter,
    enabled: never,
    pressed: (ctx) => ctx.app.ui.showChanges,
    run: (ctx) => ctx.app.setUi({ showChanges: !ctx.app.ui.showChanges }),
  },
  {
    id: 'compare',
    label: '新旧対照表',
    icon: Columns2,
    enabled: never,
    run: (ctx) => ctx.navigate('/file/print'),
  },

  // ---- 表示 ----
  {
    id: 'mode-edit',
    label: '編集',
    icon: Pencil,
    enabled: (ctx) => !!ctx.entry && !ctx.entry.readOnly,
    pressed: (ctx) => ctx.app.ui.mode === 'edit',
    run: (ctx) => ctx.app.setUi({ mode: 'edit' }),
  },
  {
    id: 'mode-read',
    label: '閲覧',
    icon: Eye,
    tip: 'ポータルでの見た目で確認',
    enabled: (ctx) => !!ctx.entry,
    pressed: (ctx) => ctx.app.ui.mode === 'read',
    run: (ctx) => ctx.app.setUi({ mode: 'read' }),
  },
  {
    id: 'toggle-nav',
    label: 'ナビゲーション',
    icon: List,
    pressed: (ctx) => ctx.app.ui.nav,
    run: (ctx) => {
      const nav = !ctx.app.ui.nav;
      ctx.app.setUi(ctx.isMobile && nav ? { nav, pane: null } : { nav });
    },
  },
  {
    id: 'nav-open',
    label: '目次',
    icon: List,
    run: (ctx) => ctx.app.setUi(ctx.isMobile ? { nav: true, pane: null } : { nav: true }),
  },
  {
    id: 'general-only',
    label: '一般向け条文のみ',
    icon: Users,
    tip: '一般向け条文のみ表示（閲覧モード）',
    enabled: (ctx) => !!ctx.entry && ctx.app.ui.mode === 'read',
    pressed: (ctx) => ctx.app.ui.generalOnly,
    run: (ctx) => ctx.app.setUi({ generalOnly: !ctx.app.ui.generalOnly }),
  },
  {
    id: 'markdown',
    label: 'Markdown',
    icon: Code,
    tip: '出力される Markdown を表示',
    enabled: (ctx) => !!ctx.entry,
    run: (ctx) => {
      if (ctx.entry)
        openMarkdownDialog(ctx.entry.doc, serializeRule(ctx.entry.doc), ctx.app.showToast);
    },
  },
  {
    id: 'find',
    label: '検索',
    icon: Search,
    shortcut: 'Ctrl+F',
    enabled: (ctx) => !!ctx.entry,
    run: (ctx) => {
      ctx.app.setUi(ctx.isMobile ? { nav: true, pane: null } : { nav: true });
      requestAnimationFrame(() => document.getElementById('navsearch')?.focus());
    },
  },
  { id: 'save', label: '保存', icon: Save, shortcut: 'Ctrl+S', enabled: editable, run() {} },
  {
    id: 'zoom-in',
    label: '拡大',
    icon: Plus,
    run: (ctx) => ctx.app.setUi({ zoom: Math.min(ZOOM_MAX, ctx.app.ui.zoom + 10) }),
  },
  {
    id: 'zoom-out',
    label: '縮小',
    icon: Plus,
    run: (ctx) => ctx.app.setUi({ zoom: Math.max(ZOOM_MIN, ctx.app.ui.zoom - 10) }),
  },
];

function togglePane(ctx: CommandContext, pane: 'info' | 'check' | 'refs') {
  const open = ctx.app.ui.pane === pane && !ctx.isMobile ? null : pane;
  ctx.app.setUi(ctx.isMobile ? { pane: open, nav: false } : { pane: open });
}

export const COMMANDS: ReadonlyMap<string, Command> = new Map(list.map((c) => [c.id, c]));

export function getCommand(id: string): Command {
  const c = COMMANDS.get(id);
  if (!c) throw new Error(`コマンドがありません: ${id}`);
  return c;
}

export function isEnabled(c: Command, ctx: CommandContext): boolean {
  return c.enabled ? c.enabled(ctx) : true;
}

/** ツールチップ（「元に戻す（Ctrl+Z）」）。 */
export function commandTip(c: Command): string {
  return (c.tip ?? c.label) + (c.shortcut ? `（${c.shortcut}）` : '');
}
