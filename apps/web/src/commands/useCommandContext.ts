import { useNavigate } from 'react-router';
import { currentEntry, useApp } from '../state/store.ts';
import { useIsMobile } from '../ui/common/useIsMobile.ts';
import type { CommandContext } from './types.ts';

export function useCommandContext(): CommandContext {
  const app = useApp();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  return { app, entry: currentEntry(app), navigate: (to) => void navigate(to), isMobile };
}
