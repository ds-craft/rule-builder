import { useNavigate } from 'react-router';
import { useActiveEditor } from '../editor/activeEditor.ts';
import { currentEntry, useApp } from '../state/store.ts';
import { useIsMobile } from '../ui/common/useIsMobile.ts';
import type { CommandContext } from './types.ts';

export function useCommandContext(): CommandContext {
  const app = useApp();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  // 選択や元に戻すの状態が変わったら描き直す
  const editor = useActiveEditor((s) => s.editor);
  useActiveEditor((s) => s.version);
  const entry = currentEntry(app);
  return {
    app,
    entry,
    editor: app.ui.mode === 'edit' && entry && !entry.readOnly ? editor : null,
    navigate: (to) => void navigate(to),
    isMobile,
  };
}
