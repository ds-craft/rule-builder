// 右クリックメニュー・ミニツールバー・タイトルバーのメニュー。

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { commandTip, getCommand, isEnabled } from '../../commands/registry.ts';
import { useCommandContext } from '../../commands/useCommandContext.ts';
import { Icon } from './Icon.tsx';
import { moveFocus } from './keyNav.ts';

export type MenuItem =
  | { type: 'command'; id: string; label?: string; disabled?: boolean }
  | { type: 'separator' }
  | { type: 'heading'; text: string }
  | { type: 'custom'; key: string; node: ReactNode };

/** 画面の端からはみ出さない位置に出すメニュー。外側を押す・Esc で閉じる。 */
export function Menu({
  x,
  y,
  items,
  onClose,
  center = false,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  /** x を中央に合わせる */
  center?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const ctx = useCommandContext();
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left0 = center ? x - w / 2 : x;
    setPos({
      left: Math.max(8, Math.min(left0, innerWidth - w - 8)),
      top: Math.max(8, Math.min(y, innerHeight - h - 8)),
    });
  }, [x, y, center]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, []);

  return (
    <div
      className="menu"
      role="menu"
      ref={ref}
      style={pos}
      onKeyDown={(e) => moveFocus(e, 'button', 'vertical')}
    >
      {items.map((it, i) => {
        if (it.type === 'separator') return <hr key={i} />;
        if (it.type === 'heading') {
          return (
            <div key={i} className="mh">
              {it.text}
            </div>
          );
        }
        if (it.type === 'custom') return <div key={it.key}>{it.node}</div>;
        const c = getCommand(it.id);
        const disabled = it.disabled || !isEnabled(c, ctx);
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={disabled}
            title={commandTip(c)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onClose();
              c.run(ctx);
            }}
          >
            <Icon icon={c.icon} />
            <span>{it.label ?? c.label}</span>
            {c.shortcut && <span className="k">{c.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** 文字を選んだときに近くに出すボタン（Word のミニツールバー）。 */
export function MiniToolbar({ rect, commands }: { rect: DOMRect; commands: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const ctx = useCommandContext();
  const [pos, setPos] = useState({ left: rect.left, top: rect.top });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos({
      left: Math.max(8, Math.min(rect.left, innerWidth - el.offsetWidth - 8)),
      top: Math.max(8, rect.top - el.offsetHeight - 8),
    });
  }, [rect]);
  return (
    <div
      className="mini no-print"
      role="toolbar"
      aria-label="選んだ文字の操作"
      ref={ref}
      style={pos}
    >
      {commands.map((id) => {
        const c = getCommand(id);
        return (
          <button
            key={id}
            type="button"
            title={commandTip(c)}
            disabled={!isEnabled(c, ctx)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => c.run(ctx)}
          >
            <Icon icon={c.icon} />
            {c.id === 'link' ? 'リンク' : c.label}
          </button>
        );
      })}
    </div>
  );
}
