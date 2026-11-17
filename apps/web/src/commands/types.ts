import type { Editor } from '@tiptap/core';
import type { LucideIcon } from 'lucide-react';
import type { AppState, OpenEntry } from '../state/store.ts';

/** コマンドを実行するときの文脈。 */
export type CommandContext = {
  app: AppState;
  entry: OpenEntry | null;
  /** 紙面で編集中のエディタ（編集モードのときだけ） */
  editor: Editor | null;
  navigate: (to: string) => void;
  isMobile: boolean;
};

/** アイコン：Lucide のアイコン、または文字のアイコン（章・節・前・附）。 */
export type IconSpec = LucideIcon | string;

export type Command = {
  id: string;
  label: string;
  /** 状態で変わる表示名（「書式チェック（3）」など。無ければ label） */
  labelFor?: (ctx: CommandContext) => string;
  icon: IconSpec;
  /** ツールチップ（無ければ label） */
  tip?: string;
  /** 表示用のショートカット（例 Ctrl+Z） */
  shortcut?: string;
  /** 押せるか（無ければ常に押せる） */
  enabled?: (ctx: CommandContext) => boolean;
  /** トグルの状態（トグルでないものは undefined） */
  pressed?: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => void;
};
