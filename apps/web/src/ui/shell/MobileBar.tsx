// スマホの画面下のバー（上げる・下げる・項・号・条・目次）。
// 画面のキーボードが出たら、visualViewport でキーボードの上に移す。

import { IndentDecrease, IndentIncrease, List, Plus, FilePlus2 } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { getCommand, isEnabled } from '../../commands/registry.ts';
import type { IconSpec } from '../../commands/types.ts';
import { useCommandContext } from '../../commands/useCommandContext.ts';
import { Icon } from '../common/Icon.tsx';
import { moveFocus } from '../common/keyNav.ts';

const BUTTONS: { cmd: string; label: string; icon: IconSpec }[] = [
  { cmd: 'promote', label: '上げる', icon: IndentDecrease },
  { cmd: 'demote', label: '下げる', icon: IndentIncrease },
  { cmd: 'add-para', label: '項', icon: Plus },
  { cmd: 'add-item', label: '号', icon: Plus },
  { cmd: 'article-after', label: '条', icon: FilePlus2 },
  { cmd: 'nav-open', label: '目次', icon: List },
];

/** 画面のキーボードが隠している高さ（キーボードが無ければ 0） */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const hidden = window.innerHeight - (vv.height + vv.offsetTop);
      // アドレスバーの出入りなどの小さな差は無視する
      setInset(hidden > 80 ? Math.round(hidden) : 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}

export function MobileBar() {
  const ctx = useCommandContext();
  const inset = useKeyboardInset();
  // キーボードが出ているときはステータスバーが隠れるので、キーボードのすぐ上に置く
  const style: CSSProperties | undefined = inset ? { bottom: inset } : undefined;
  return (
    <div
      className="fab no-print"
      role="toolbar"
      aria-label="よく使う操作"
      style={style}
      onKeyDown={(e) => moveFocus(e, 'button')}
    >
      {BUTTONS.map((b) => {
        const c = getCommand(b.cmd);
        return (
          <button
            key={b.cmd}
            type="button"
            title={c.tip ?? c.label}
            disabled={!isEnabled(c, ctx)}
            // 押してもキーボードを閉じない（紙面のフォーカスを外さない）
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => c.run(ctx)}
          >
            <Icon icon={b.icon} />
            {b.label}
          </button>
        );
      })}
    </div>
  );
}
