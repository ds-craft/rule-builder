// ステータスバー：カーソルの位置・件数・表示モード・拡大率。

import { ArrowLeftRight, Eye, Pencil, SpellCheck } from 'lucide-react';
import { getCommand, isEnabled } from '../../commands/registry.ts';
import { useCommandContext } from '../../commands/useCommandContext.ts';
import { useActiveEditor } from '../../editor/activeEditor.ts';
import { changesKey } from '../../editor/changes.ts';
import { cursorLocation } from '../../editor/commands.ts';
import { checkCounts, useDismissed } from '../../editor/checks.ts';
import { useLinkIndex } from '../../github/linkIndex.ts';
import { ZOOM_MAX, ZOOM_MIN } from '../../state/store.ts';

export function StatusBar({ editing }: { editing: boolean }) {
  const ctx = useCommandContext();
  const editor = ctx.editor;
  const location = editing && editor ? cursorLocation(editor.state) : '—';
  const op = ctx.entry?.op;
  const changes = editor ? changesKey.getState(editor.state) : null;
  const summary =
    op === 'create'
      ? '新規制定'
      : op === 'repeal'
        ? '廃止'
        : changes
          ? `変更 ${changes.articles.filter((x) => x).length + changes.removed}条`
          : '改正';
  const { ui, setUi } = ctx.app;
  const run = (id: string) => {
    const c = getCommand(id);
    if (isEnabled(c, ctx)) c.run(ctx);
  };
  const editOk = isEnabled(getCommand('mode-edit'), ctx);
  // 件数は紙面のエディタ・公開中のルールの一覧・閉じた警告が変わったら数え直す
  useActiveEditor((s) => s.version);
  useLinkIndex((s) => s.rules);
  useDismissed((s) => s.keys);
  const counts = checkCounts();
  const lintable = ctx.entry?.op !== 'repeal';
  return (
    <div className="status" role="region" aria-label="ステータスバー">
      <span className="si" title="カーソルの位置">
        <b>{location}</b>
      </span>
      <span className="si hide-s">{summary}</span>
      {lintable && (
        <button
          type="button"
          className={'si hide-s' + (counts.lint ? ' bad' : '')}
          title="書式チェックを開く"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run('pane-check')}
        >
          <SpellCheck className="i" aria-hidden="true" />
          {counts.lint ? `書式の問題 ${counts.lint}件` : '書式の問題なし'}
        </button>
      )}
      {counts.refs > 0 && (
        <button
          type="button"
          className="si"
          title="参照の確認を開く"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run('pane-refs')}
        >
          <ArrowLeftRight className="i" aria-hidden="true" />
          参照の確認 {counts.refs}件
        </button>
      )}
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
