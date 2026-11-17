// コマンド定義の一覧。リボン・右クリックメニュー・スマホの下部バー・キー操作が同じ定義を使う。
// まだ中身のない操作は enabled が false を返し、無効表示になる（後のフェーズで中身を入れる）。

import { serializeRule } from '@rule-builder/core';
import type { EditorState, Transaction } from '@tiptap/pm/state';
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
  Minus,
  Pencil,
  Plus,
  Redo2,
  Save,
  Search,
  SpellCheck,
  Trash2,
  Undo2,
  Unlink,
  Users,
} from 'lucide-react';
import {
  addItem,
  addParagraph,
  articleCursor,
  changeKind,
  currentLineKind,
  demote,
  promote,
  toggleGeneral,
  type Result,
} from '../editor/commands.ts';
import { runResult } from '../editor/RuleEditing.ts';
import {
  addSupplementaryLine,
  currentArticle,
  hasPreamble,
  insertDivision,
  insertPreamble,
} from '../editor/structure.ts';
import {
  moveCurrentArticle,
  openDeleteArticleDialog,
  openInsertArticleDialog,
  openRenumberDialog,
} from '../ui/common/structureDialogs.tsx';
import { downloadDraft } from '../state/actions.ts';
import { ZOOM_MAX, ZOOM_MIN } from '../state/store.ts';
import { openMarkdownDialog } from '../ui/common/dialogs.tsx';
import {
  linkTarget,
  openLinkDialog,
  removeLinkAtCursor,
  linkRangeAt,
} from '../ui/common/linkDialog.tsx';
import { checkCounts } from '../editor/checks.ts';
import type { Command, CommandContext } from './types.ts';

/** 構造の変更（1回の「元に戻す」で戻る） */
const structural = (f: (s: EditorState) => Transaction) => (ctx: CommandContext) => {
  const e = ctx.editor;
  if (!e) return;
  ctx.entry?.undo.stopCapturing();
  e.view.dispatch(f(e.state));
  ctx.entry?.undo.stopCapturing();
  e.commands.focus();
};

/** 編集中のエディタに対する操作 */
const edit = (f: (s: EditorState) => Result | null) => (ctx: CommandContext) => {
  const e = ctx.editor;
  if (!e) return;
  runResult(e, f(e.state), ctx.app.showToast, ctx.entry?.undo);
  e.commands.focus();
};

const inArticle = (ctx: CommandContext) => !!ctx.editor && !!articleCursor(ctx.editor.state);
const inLiveArticle = (ctx: CommandContext) =>
  !!ctx.editor &&
  !!articleCursor(ctx.editor.state) &&
  !currentArticle(ctx.editor.state)?.node.attrs.deleted;
const lineKind = (ctx: CommandContext) => (ctx.editor ? currentLineKind(ctx.editor.state) : null);
const inLine = (ctx: CommandContext) => {
  const k = lineKind(ctx);
  return k !== null && k !== 'cont';
};

const list: Command[] = [
  // ---- 元に戻す ----
  {
    id: 'undo',
    label: '元に戻す',
    icon: Undo2,
    shortcut: 'Ctrl+Z',
    enabled: (ctx) => !!ctx.editor && !!ctx.entry?.undo.canUndo(),
    run: (ctx) => {
      ctx.entry?.undo.stopCapturing();
      ctx.editor?.chain().focus().undo().run();
    },
  },
  {
    id: 'redo',
    label: 'やり直し',
    icon: Redo2,
    shortcut: 'Ctrl+Y',
    enabled: (ctx) => !!ctx.editor && !!ctx.entry?.undo.canRedo(),
    run: (ctx) => ctx.editor?.chain().focus().redo().run(),
  },

  // ---- 行の種類・段落・追加 ----
  {
    id: 'kind-p',
    label: '項',
    icon: '①',
    tip: 'この行を「項」にする',
    enabled: inLine,
    pressed: (ctx) => lineKind(ctx) === 'kou',
    run: edit((s) => changeKind(s, 'kou')),
  },
  {
    id: 'kind-i',
    label: '号',
    icon: '一',
    tip: 'この行を「号」にする',
    enabled: inLine,
    pressed: (ctx) => lineKind(ctx) === 'gou',
    run: edit((s) => changeKind(s, 'gou')),
  },
  {
    id: 'kind-s',
    label: '号の細分',
    icon: 'イ',
    tip: 'この行を「号の細分」にする',
    enabled: inLine,
    pressed: (ctx) => lineKind(ctx) === 'saibun',
    run: edit((s) => changeKind(s, 'saibun')),
  },
  {
    id: 'promote',
    label: 'レベルを上げる',
    icon: IndentDecrease,
    shortcut: 'Shift+Tab',
    enabled: (ctx) => ['gou', 'saibun'].includes(lineKind(ctx) ?? ''),
    run: edit(promote),
  },
  {
    id: 'demote',
    label: 'レベルを下げる',
    icon: IndentIncrease,
    shortcut: 'Tab',
    enabled: (ctx) => ['kou', 'gou'].includes(lineKind(ctx) ?? ''),
    run: edit(demote),
  },
  {
    id: 'add-para',
    label: '項',
    icon: Plus,
    tip: '項を追加',
    enabled: inArticle,
    run: edit(addParagraph),
  },
  {
    id: 'add-item',
    label: '号',
    icon: Plus,
    tip: '号を追加',
    enabled: (ctx) => lineKind(ctx) !== null,
    run: edit(addItem),
  },
  {
    id: 'general',
    label: '一般向け',
    icon: Users,
    tip: '一般向け条文にする（ポータルの「一般向け条文のみ表示」で表示される）',
    enabled: inLiveArticle,
    pressed: (ctx) => !!(ctx.editor && articleCursor(ctx.editor.state)?.article.attrs.general),
    run: (ctx) => {
      const c = ctx.editor && articleCursor(ctx.editor.state);
      edit(toggleGeneral)(ctx);
      if (c)
        ctx.app.showToast(
          c.article.attrs.general ? '一般向けを解除しました' : '一般向け条文にしました',
        );
    },
  },

  // ---- 挿入 ----
  {
    id: 'article-after',
    label: '条を挿入',
    icon: FilePlus2,
    tip: '後に条を挿入',
    shortcut: 'Ctrl+Enter',
    enabled: (ctx) => !!ctx.editor,
    run: (ctx) => openInsertArticleDialog(ctx, 'after'),
  },
  {
    id: 'article-before',
    label: '前に条を挿入',
    icon: FilePlus2,
    enabled: inArticle,
    run: (ctx) => openInsertArticleDialog(ctx, 'before'),
  },
  {
    id: 'chapter',
    label: '章',
    icon: '章',
    tip: '章を挿入',
    enabled: (ctx) => !!ctx.editor,
    run: structural((s) => insertDivision(s, 'chapter')),
  },
  {
    id: 'section',
    label: '節',
    icon: '節',
    tip: '節を挿入',
    enabled: (ctx) => !!ctx.editor,
    run: structural((s) => insertDivision(s, 'section')),
  },
  {
    id: 'preamble',
    label: '前文',
    icon: '前',
    tip: '前文を追加',
    enabled: (ctx) => !!ctx.editor && !hasPreamble(ctx.editor.state.doc),
    run: structural(insertPreamble),
  },
  {
    id: 'supp',
    label: '附則',
    icon: '附',
    tip: '附則に行を追加',
    enabled: (ctx) => !!ctx.editor,
    run: structural(addSupplementaryLine),
  },
  {
    id: 'link',
    label: '条文へのリンク',
    icon: Link,
    shortcut: 'Ctrl+K',
    enabled: (ctx) => !!ctx.editor && !!linkTarget(ctx.editor.state),
    run: openLinkDialog,
  },
  {
    id: 'unlink',
    label: 'リンクを解除',
    icon: Unlink,
    enabled: (ctx) => !!ctx.editor && !!linkRangeAt(ctx.editor.state),
    run: removeLinkAtCursor,
  },

  // ---- 条のツール ----
  {
    id: 'art-up',
    label: '上へ移動',
    icon: ArrowUp,
    enabled: inArticle,
    run: (ctx) => moveCurrentArticle(ctx, -1),
  },
  {
    id: 'art-down',
    label: '下へ移動',
    icon: ArrowDown,
    enabled: inArticle,
    run: (ctx) => moveCurrentArticle(ctx, 1),
  },
  {
    id: 'art-renum',
    label: '条番号の変更',
    icon: Hash,
    enabled: (ctx) =>
      inArticle(ctx) && !!ctx.editor && !!currentArticle(ctx.editor.state)?.node.attrs.num,
    run: openRenumberDialog,
  },
  {
    id: 'art-del',
    label: 'この条を削除',
    icon: Trash2,
    enabled: inArticle,
    run: openDeleteArticleDialog,
  },
  {
    id: 'art-undel',
    label: '削除を取り消す',
    icon: Undo2,
    enabled: (ctx) => !!ctx.editor && !!currentArticle(ctx.editor.state)?.node.attrs.deleted,
    run: openDeleteArticleDialog,
  },

  // ---- 校閲 ----
  {
    id: 'pane-check',
    label: '書式チェック',
    labelFor: () => {
      const n = checkCounts().lint;
      return n ? `書式チェック（${n}）` : '書式チェック';
    },
    icon: SpellCheck,
    enabled: (ctx) => !!ctx.entry,
    pressed: (ctx) => ctx.app.ui.pane === 'check',
    run: (ctx) => togglePane(ctx, 'check'),
  },
  {
    id: 'pane-refs',
    label: '参照の確認',
    labelFor: () => {
      const n = checkCounts().refs;
      return n ? `参照の確認（${n}）` : '参照の確認';
    },
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
    enabled: (ctx) => ctx.entry?.op === 'amend',
    pressed: (ctx) => ctx.app.ui.showChanges,
    run: (ctx) => ctx.app.setUi({ showChanges: !ctx.app.ui.showChanges }),
  },
  {
    id: 'compare',
    label: '新旧対照表',
    icon: Columns2,
    enabled: (ctx) => !!ctx.app.session,
    run: (ctx) => ctx.navigate('/file/print'),
  },

  // ---- 表示 ----
  {
    id: 'mode-edit',
    label: '編集',
    icon: Pencil,
    enabled: (ctx) => !!ctx.entry && !ctx.entry.readOnly,
    pressed: (ctx) => ctx.app.ui.mode === 'edit' && !ctx.entry?.readOnly,
    run: (ctx) => ctx.app.setUi({ mode: 'edit' }),
  },
  {
    id: 'mode-read',
    label: '閲覧',
    icon: Eye,
    tip: 'ポータルでの見た目で確認',
    enabled: (ctx) => !!ctx.entry,
    pressed: (ctx) => ctx.app.ui.mode === 'read',
    run: (ctx) =>
      ctx.app.setUi({ mode: 'read', tab: ctx.app.ui.tab === 'article' ? 'home' : ctx.app.ui.tab }),
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
      setTimeout(() => document.getElementById('navsearch')?.focus(), 0);
    },
  },
  {
    id: 'save',
    label: '下書きファイルを保存',
    icon: Save,
    shortcut: 'Ctrl+S',
    enabled: (ctx) => !!ctx.app.session,
    run: (ctx) => {
      if (downloadDraft()) ctx.app.showToast('下書きファイルを保存しました');
    },
  },
  {
    id: 'zoom-in',
    label: '拡大',
    icon: Plus,
    run: (ctx) => ctx.app.setUi({ zoom: Math.min(ZOOM_MAX, ctx.app.ui.zoom + 10) }),
  },
  {
    id: 'zoom-out',
    label: '縮小',
    icon: Minus,
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
export function commandLabel(c: Command, ctx: CommandContext): string {
  return c.labelFor ? c.labelFor(ctx) : c.label;
}

export function commandTip(c: Command): string {
  return (c.tip ?? c.label) + (c.shortcut ? `（${c.shortcut}）` : '');
}
