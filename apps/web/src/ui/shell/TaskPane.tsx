import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/** 見出しと閉じるボタンを持つ右の作業ウィンドウ。 */
export function TaskPane({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside className="pane" aria-label={title}>
      <div className="ph">
        {title}
        <button type="button" aria-label="閉じる" onClick={onClose}>
          <X className="i" aria-hidden="true" />
        </button>
      </div>
      <div className="pbody">{children}</div>
    </aside>
  );
}
