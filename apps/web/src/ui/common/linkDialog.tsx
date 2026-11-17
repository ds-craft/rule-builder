// 条文へのリンク（F-17）。文字を選んで Ctrl+K・ミニツールバー・右クリック・挿入タブから開く。
// リンク先のルール（このルール＋公開中のルール）と章・条を選び、ポータル上のリンク先を確かめてから OK。
// リンクにカーソルを置いて開くと、そのリンクの変更・解除になる。

import {
  bodyFromPM,
  parseRuleHref,
  ruleHeadings,
  ruleHref,
  type PMNode as PMJson,
  type RuleHeading,
} from '@rule-builder/core';
import type { Editor } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { useEffect, useState } from 'react';
import type { CommandContext } from '../../commands/types.ts';
import { entryRuleId, loadLinkIndex, useLinkIndex } from '../../github/linkIndex.ts';
import { PORTAL_RULE_BASE } from '../../render/RuleView.tsx';
import { openDialog } from './dialogs.tsx';

export type LinkRange = { from: number; to: number; mark: Mark | null };

function linkAt(state: EditorState, pos: number): Mark | null {
  const $pos = state.doc.resolve(pos);
  const marks = [...($pos.nodeAfter?.marks ?? []), ...($pos.nodeBefore?.marks ?? [])];
  return marks.find((m) => m.type.name === 'link') ?? null;
}

/** カーソルのあるリンクの範囲（リンクの外なら null） */
export function linkRangeAt(state: EditorState): LinkRange | null {
  const { $from, empty } = state.selection;
  if (!empty) return null;
  const mark = linkAt(state, $from.pos);
  if (!mark) return null;
  const start = $from.start();
  const runs: { from: number; to: number }[] = [];
  $from.parent.forEach((child, off) => {
    if (!mark.isInSet(child.marks)) return;
    const a = start + off;
    const last = runs[runs.length - 1];
    if (last && last.to === a) last.to = a + child.nodeSize;
    else runs.push({ from: a, to: a + child.nodeSize });
  });
  const r = runs.find((x) => x.from <= $from.pos && $from.pos <= x.to);
  return r ? { ...r, mark } : null;
}

/** リンクを付けられる選択か（条文・前文などの1つの行の中の文字） */
export function linkableSelection(state: EditorState): LinkRange | null {
  const { $from, $to, empty, from, to } = state.selection;
  if (empty || !$from.sameParent($to)) return null;
  const link = state.schema.marks.link;
  if (!link || !$from.parent.type.allowsMarkType(link)) return null;
  return { from, to, mark: linkAt(state, from) };
}

/** リンクの対象（選んだ文字か、カーソルのあるリンク） */
export function linkTarget(state: EditorState): LinkRange | null {
  return linkableSelection(state) ?? linkRangeAt(state);
}

type RuleOption = { id: string | null; name: string; headings: RuleHeading[] };

/** ポータルの URL（同じルールの中のリンクは、このルールのページの #…） */
export function portalUrl(href: string, selfId: string): string {
  return new URL(href.startsWith('#') ? `${selfId}.html${href}` : href, PORTAL_RULE_BASE).href;
}

function LinkForm({
  own,
  selfId,
  initial,
  onChange,
}: {
  own: RuleOption;
  selfId: string;
  initial: { ruleId: string | null; anchor: string };
  onChange: (href: string) => void;
}) {
  const { status, rules } = useLinkIndex();
  const others: RuleOption[] = rules
    .filter((r) => !r.repealed && r.id !== selfId)
    .map((r) => ({ id: r.id, name: r.name, headings: r.headings }));
  const options = [own, ...others];
  const [ruleId, setRuleId] = useState<string | null>(
    initial.ruleId === selfId ? null : initial.ruleId,
  );
  const [anchor, setAnchor] = useState(initial.anchor);
  const rule = options.find((o) => o.id === ruleId) ?? own;
  const href = ruleHref({ ruleId: rule.id, anchor }, selfId);
  useEffect(() => {
    onChange(href);
  }, [href, onChange]);
  // ルールを変えたら、そのルールの最初の見出し（ほかのルールは「ルール全体」）にする
  const pickRule = (id: string | null) => {
    setRuleId(id);
    const r = options.find((o) => o.id === id) ?? own;
    setAnchor(r.id === null ? (r.headings[0]?.anchor ?? '') : '');
  };
  const known = !anchor || rule.headings.some((h) => h.anchor === anchor);
  return (
    <>
      <div className="field">
        <label htmlFor="lk-rule">リンク先のルール</label>
        <select
          id="lk-rule"
          style={{ width: '100%' }}
          value={rule.id ?? ''}
          onChange={(e) => pickRule(e.target.value || null)}
        >
          {options.map((o) => (
            <option key={o.id ?? ''} value={o.id ?? ''}>
              {o.name}
            </option>
          ))}
          {ruleId !== null && !others.some((o) => o.id === ruleId) && (
            <option value={ruleId}>{ruleId}</option>
          )}
        </select>
        {status === 'loading' && <div className="muted">ほかのルールを読み込んでいます…</div>}
        {status === 'error' && (
          <div className="muted">
            ほかのルールを読み込めませんでした（このルールの中へはリンクできます）
          </div>
        )}
      </div>
      <div className="field">
        <label htmlFor="lk-head">リンク先の章・条</label>
        <select
          id="lk-head"
          style={{ width: '100%' }}
          value={anchor}
          onChange={(e) => setAnchor(e.target.value)}
        >
          {rule.id !== null && <option value="">ルール全体（見出しを指定しない）</option>}
          {!known && <option value={anchor}>{anchor}（見つかりません）</option>}
          {rule.headings.map((h, i) => (
            <option key={i} value={h.anchor}>
              {'　'.repeat(Math.max(0, h.level - 1))}
              {h.text}
            </option>
          ))}
        </select>
      </div>
      <p className="muted" style={{ wordBreak: 'break-all' }}>
        ポータル上のリンク先：
        <a href={portalUrl(href || `${selfId}.html`, selfId)} target="_blank" rel="noreferrer">
          <code>{href || '（なし）'}</code>
        </a>
      </p>
    </>
  );
}

/** このルールの見出し（いまの紙面から） */
function ownHeadings(editor: Editor): RuleHeading[] {
  return ruleHeadings({ body: bodyFromPM(editor.getJSON() as PMJson) });
}

export function openLinkDialog(ctx: CommandContext) {
  const editor = ctx.editor;
  if (!editor || !ctx.entry) return;
  const target = linkTarget(editor.state);
  if (!target) {
    ctx.app.showToast('リンクにしたい文字を選んでから実行してください');
    return;
  }
  void loadLinkIndex();
  const selfId = entryRuleId(ctx.entry);
  const label = editor.state.doc.textBetween(target.from, target.to);
  const current = target.mark?.attrs.href as string | undefined;
  const parsed = current ? parseRuleHref(current) : null;
  const own: RuleOption = { id: null, name: 'このルール', headings: ownHeadings(editor) };
  const initial = parsed ?? { ruleId: null, anchor: own.headings[0]?.anchor ?? '' };
  const value = { href: '' };
  const link = editor.schema.marks.link!;
  const undo = ctx.entry.undo;
  const run = (f: () => void, message: string) => {
    undo.stopCapturing();
    f();
    undo.stopCapturing();
    editor.commands.focus();
    ctx.app.showToast(message);
  };
  const setLink = () => {
    if (!value.href) return false;
    run(
      () => {
        const tr = editor.state.tr.removeMark(target.from, target.to, link);
        tr.addMark(target.from, target.to, link.create({ href: value.href, title: null }));
        editor.view.dispatch(tr);
      },
      current ? 'リンクを変更しました' : 'リンクを挿入しました',
    );
  };
  openDialog({
    title: '条文へのリンク',
    body: (
      <>
        <div className="field">
          <label>表示する文字</label>
          <div>{label}</div>
        </div>
        {current && !parsed && (
          <p className="muted">
            いまのリンク先：<code>{current}</code>（ルールの外のページ）
          </p>
        )}
        <LinkForm own={own} selfId={selfId} initial={initial} onChange={(h) => (value.href = h)} />
      </>
    ),
    actions: [
      { label: 'キャンセル' },
      ...(current
        ? [
            {
              label: 'リンクを解除',
              run: () =>
                run(
                  () =>
                    editor.view.dispatch(editor.state.tr.removeMark(target.from, target.to, link)),
                  'リンクを解除しました',
                ),
            },
          ]
        : []),
      { label: 'OK', primary: true, run: setLink },
    ],
  });
}

/** リンクを解除する（カーソルのあるリンク） */
export function removeLinkAtCursor(ctx: CommandContext) {
  const editor = ctx.editor;
  const r = editor && linkRangeAt(editor.state);
  if (!editor || !r) return;
  ctx.entry?.undo.stopCapturing();
  editor.view.dispatch(editor.state.tr.removeMark(r.from, r.to, editor.schema.marks.link!));
  ctx.entry?.undo.stopCapturing();
  editor.commands.focus();
  ctx.app.showToast('リンクを解除しました');
}
