// 作業ウィンドウ「参照の確認」（F-15）。条番号が変わったときの、文中の参照とリンク先の書き換えの候補。
// 自動では書き換えない。候補ごとに「書き換える」「無視」「その場所へ」、全体に「すべて書き換える」「すべて無視」。

import type { CommandContext } from '../../commands/types.ts';
import { useActiveEditor } from '../../editor/activeEditor.ts';
import { incomingKey, incomingWarnings, useDismissed } from '../../editor/checks.ts';
import { locationAt } from '../../editor/commands.ts';
import {
  applyRefs,
  clearRefs,
  refContext,
  refItems,
  removeRefs,
  type RefItem,
} from '../../editor/refs.ts';
import { useLinkIndex } from '../../github/linkIndex.ts';
import { goToPos } from './CheckPane.tsx';

export function RefsPane({ ctx }: { ctx: CommandContext }) {
  const editor = useActiveEditor((s) => s.editor);
  useActiveEditor((s) => s.version);
  const rules = useLinkIndex((s) => s.rules);
  const dismissed = useDismissed((s) => s.keys);
  const entry = ctx.entry;
  if (!entry) return null;
  const live = !!editor && !editor.isDestroyed;
  const items = live ? refItems(editor.state) : [];
  const incoming = incomingWarnings(entry, rules).filter(
    (l) => !dismissed.includes(incomingKey(l)),
  );
  const replaceable = items.filter((it) => it.type !== 'note');

  const dispatchWithUndo = (f: () => void) => {
    entry.undo.stopCapturing();
    f();
    entry.undo.stopCapturing();
  };
  const rewrite = (list: RefItem[], message: string) => {
    if (!live) return;
    const tr = applyRefs(editor.state, list);
    if (!tr) {
      ctx.app.showToast('文が変わったため書き換えられません');
      return;
    }
    dispatchWithUndo(() => editor.view.dispatch(tr));
    ctx.app.showToast(message);
  };
  const ignore = (ids: number[]) => live && editor.view.dispatch(removeRefs(editor.state.tr, ids));

  if (items.length === 0 && incoming.length === 0) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        確認が必要な参照はありません。条の挿入・削除・移動で番号が変わると、ここに一覧が出ます。
      </p>
    );
  }
  return (
    <>
      {items.length > 0 && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            条番号が変わったため、文中の参照を確認してください。自動では書き換えません。
          </p>
          <div className="row-actions" style={{ marginBottom: 10 }}>
            {replaceable.length > 0 && (
              <button
                type="button"
                className="btn small primary"
                onClick={() => rewrite(replaceable, 'すべて書き換えました')}
              >
                すべて書き換える
              </button>
            )}
            <button
              type="button"
              className="btn small"
              onClick={() => live && editor.view.dispatch(clearRefs(editor.state))}
            >
              すべて無視
            </button>
          </div>
        </>
      )}
      {live &&
        items.map((it) => {
          const pos = it.type === 'note' ? it.pos : it.from;
          const at = locationAt(
            editor.state.doc.resolve(Math.min(pos + 1, editor.state.doc.content.size)),
          );
          if (it.type === 'note') {
            return (
              <div key={it.id} className="issue info">
                <div>
                  <span className="lv">確認</span>
                  <b>{at}</b>
                </div>
                <div>{it.message}</div>
                <div className="acts">
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => goToPos(ctx, String(it.pos))}
                  >
                    その場所へ
                  </button>
                  <button type="button" className="btn small" onClick={() => ignore([it.id])}>
                    閉じる
                  </button>
                </div>
              </div>
            );
          }
          const c = refContext(editor.state, it);
          const linePos = editor.state.doc.resolve(it.from).before();
          return (
            <div key={it.id} className="issue warn">
              <div>
                <span className="lv">{it.type === 'href' ? 'リンク先' : '参照'}</span>
                <b>{at}</b>
              </div>
              {c && (
                <div className="ctx">
                  …{c.before}
                  <mark>{c.match}</mark>
                  {c.after}…
                </div>
              )}
              <div>
                {it.type === 'text'
                  ? `「${it.old}」を「${it.neu}」に`
                  : `リンク先「${it.oldHref}」を「${it.newHref}」に`}
              </div>
              <div className="acts">
                <button
                  type="button"
                  className="btn small primary"
                  onClick={() => rewrite([it], '書き換えました')}
                >
                  書き換える
                </button>
                <button type="button" className="btn small" onClick={() => ignore([it.id])}>
                  無視
                </button>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => goToPos(ctx, String(linePos))}
                >
                  その場所へ
                </button>
              </div>
            </div>
          );
        })}
      {incoming.map((l) => (
        <div key={incomingKey(l)} className="issue info">
          <div>
            <span className="lv">確認</span>
            <b>ほかのルール</b>
          </div>
          <div>
            ほかのルールのリンクが切れます：{l.ruleName}
            {l.heading ? ` ${l.heading}` : ''}の「{l.text}」（リンク先「{l.anchor}」）
          </div>
          <div className="acts">
            <button
              type="button"
              className="btn small"
              onClick={() => useDismissed.setState((s) => ({ keys: [...s.keys, incomingKey(l)] }))}
            >
              閉じる
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
