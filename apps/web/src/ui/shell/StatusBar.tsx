// ステータスバー：カーソルの位置・件数・表示モード・拡大率。

import { Eye, Pencil, SpellCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { getCommand, isEnabled } from '../../commands/registry.ts';
import { useCommandContext } from '../../commands/useCommandContext.ts';
import { ZOOM_MAX, ZOOM_MIN } from '../../state/store.ts';

export function StatusBar({ location, summary }: { location: string; summary: ReactNode }) {
  const ctx = useCommandContext();
  const { ui, setUi } = ctx.app;
  const run = (id: string) => {
    const c = getCommand(id);
    if (isEnabled(c, ctx)) c.run(ctx);
  };
  const editOk = isEnabled(getCommand('mode-edit'), ctx);
  return (
    <div className="status">
      <span className="si" title="カーソルの位置">
        <b>{location}</b>
      </span>
      <span className="si hide-s">{summary}</span>
      <button
        type="button"
        className="si hide-s"
        title="書式チェックを開く"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => run('pane-check')}
      >
        <SpellCheck className="i" aria-hidden="true" />
        書式チェック
      </button>
      <span className="sp" />
      <span className="vm" role="group" aria-label="表示モード">
        <button
          type="button"
          className={ui.mode === 'edit' ? 'on' : ''}
          title={editOk ? '編集' : '編集（このルールは閲覧用に開いています）'}
          disabled={!editOk}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run('mode-edit')}
        >
          <Pencil className="i" aria-hidden="true" />
          <span className="hide-s">編集</span>
        </button>
        <button
          type="button"
          className={ui.mode === 'read' ? 'on' : ''}
          title="閲覧（ポータルでの見た目）"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run('mode-read')}
        >
          <Eye className="i" aria-hidden="true" />
          <span className="hide-s">閲覧</span>
        </button>
      </span>
      <span className="si hide-s">
        <button type="button" className="si" aria-label="縮小" onClick={() => run('zoom-out')}>
          −
        </button>
        <input
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={10}
          value={ui.zoom}
          aria-label="拡大率"
          onChange={(e) => setUi({ zoom: Number(e.target.value) })}
        />
        <button type="button" className="si" aria-label="拡大" onClick={() => run('zoom-in')}>
          ＋
        </button>
        {ui.zoom}%
      </span>
    </div>
  );
}
