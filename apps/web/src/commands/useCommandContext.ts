import { useNavigate } from 'react-router';
import { useActiveEditor } from '../editor/activeEditor.ts';
import { currentEntry, useApp } from '../state/store.ts';
import { useIsMobile } from '../ui/common/useIsMobile.ts';
import type { CommandContext } from './types.ts';

/**
 * @param live 選択や元に戻すの状態が変わるたびに描き直すか。文字を打つたびに描き直すので、
 *   カーソルの位置で表示が変わる部品（リボン・ステータスバーなど）だけ true にする
 */
export function useCommandContext(live = true): CommandContext {
  const app = useApp();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const editor = useActiveEditor((s) => s.editor);
  useActiveEditor((s) => (live ? s.version : 0));
  const entry = currentEntry(app);
  return {
    app,
    entry,
    editor: app.ui.mode === 'edit' && entry && !entry.readOnly ? editor : null,
    navigate: (to) => void navigate(to),
    isMobile,
  };
}
