// 作業ウィンドウ「書式チェック」（F-18）。項目ごとに位置・説明・修正ボタン・「その場所へ」を出す。

import { FIX_LABEL, lintRule, type LintIssue, type LintLevel } from '@rule-builder/core';
import { Check } from 'lucide-react';
import type { CommandContext } from '../../commands/types.ts';
import { useActiveEditor } from '../../editor/activeEditor.ts';
import { fixIssue, lintIssues, selectionAtKey } from '../../editor/lint.ts';
import { entryRuleId } from '../../github/linkIndex.ts';
import { setSetting, useSettings } from '../../state/settings.ts';

export const LEVEL_LABEL: Record<LintLevel, string> = {
  error: 'エラー',
  warn: '注意',
  info: '情報',
};

/** 紙面の場所へ移る（閲覧モードなら編集モードにしてから） */
export function goToPos(ctx: CommandContext, key: string) {
  const editor = useActiveEditor.getState().editor;
  if (!editor || editor.isDestroyed) return;
  const patch = ctx.isMobile ? { pane: null, mode: 'edit' as const } : { mode: 'edit' as const };
  ctx.app.setUi(patch);
  const tr = selectionAtKey(editor.state, key);
  if (!tr) return;
  editor.view.dispatch(tr);
  // 閲覧モードから戻ったときは紙面が出てからフォーカスする
  setTimeout(() => {
    editor.view.focus();
    const dom = editor.view.domAtPos(editor.state.selection.from).node;
    const el = dom instanceof HTMLElement ? dom : dom.parentElement;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 0);
}

export function CheckPane({ ctx }: { ctx: CommandContext }) {
  const editor = useActiveEditor((s) => s.editor);
  useActiveEditor((s) => s.version);
  const auto = useSettings((s) => s.autoFullwidth);
  const entry = ctx.entry;
  if (!entry) return null;
  if (entry.op === 'repeal') {
    return <p className="muted">廃止するルールは本文を編集しないため、調べません。</p>;
  }
  const live = editor && !editor.isDestroyed;
  const issues: LintIssue[] = live
    ? lintIssues(editor.state)
    : lintRule(entry.doc, { ruleId: entryRuleId(entry) });

  const fix = (issue: LintIssue) => {
    if (!live) return;
    const tr = fixIssue(editor.state, issue);
    if (!tr) return;
    entry.undo.stopCapturing();
    editor.view.dispatch(tr);
    entry.undo.stopCapturing();
    ctx.app.showToast('修正しました');
  };

  return (
    <>
      {issues.length ? (
        issues.map((it, i) => (
          <div key={i} className={`issue ${it.level}`}>
            <div>
              <span className="lv">{LEVEL_LABEL[it.level]}</span>
              <b>{it.label}</b>
            </div>
            <div>{it.message}</div>
            {it.context && <div className="ctx">{it.context}</div>}
            <div className="acts">
              {it.fix && live && !entry.readOnly && (
                <button type="button" className="btn small primary" onClick={() => fix(it)}>
                  {FIX_LABEL[it.fix]}
                </button>
              )}
              {it.key !== null && live && (
                <button type="button" className="btn small" onClick={() => goToPos(ctx, it.key!)}>
                  その場所へ
                </button>
              )}
            </div>
          </div>
        ))
      ) : (
        <p style={{ margin: 0 }}>
          <Check className="i" aria-hidden="true" /> 問題は見つかりませんでした。
        </p>
      )}
      <p className="muted">ポータルで表示が崩れる書き方や、番号の飛び、リンク切れを調べます。</p>
      <label className="muted check-opt">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => setSetting('autoFullwidth', e.target.checked)}
        />{' '}
        入力した「*」「_」や行頭の記号を、その場で全角にする
      </label>
    </>
  );
}
