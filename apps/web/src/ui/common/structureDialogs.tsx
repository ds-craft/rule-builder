// 条の挿入・削除・移動・番号変更のダイアログ（F-14）。

import {
  checkRenumber,
  describeRenumbering,
  formatArticleNum,
  planDelete,
  planInsert,
  planSwap,
  type ArticleNum,
  type Renumbering,
} from '@rule-builder/core';
import type { Transaction } from '@tiptap/pm/state';
import { useState, type ReactNode } from 'react';
import type { CommandContext } from '../../commands/types.ts';
import {
  articleNums,
  currentArticle,
  deleteArticle,
  insertArticle,
  insertTarget,
  moveArticle,
  renumberArticles,
  undeleteArticle,
  type ArticleRef,
} from '../../editor/structure.ts';
import { openDialog } from './dialogs.tsx';

/** 構造の変更を1回の「元に戻す」として反映し、番号の対応表を記録する */
function apply(ctx: CommandContext, tr: Transaction, renumbered: Renumbering[] = []) {
  const editor = ctx.editor;
  if (!editor) return;
  ctx.entry?.undo.stopCapturing();
  editor.view.dispatch(tr);
  ctx.entry?.undo.stopCapturing();
  if (ctx.entry) ctx.app.logRenumbering(ctx.entry.key, renumbered);
  editor.commands.focus();
}

function Choice({
  name,
  value,
  checked,
  onChange,
  title,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (v: string) => void;
  title: string;
  children?: ReactNode;
}) {
  return (
    <label className="choice">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
      />{' '}
      <span className="ttl">{title}</span>
      {children && <ul>{children}</ul>}
    </label>
  );
}

/** ずれる条を最大4件まで並べ、残りは「ほかN条」 */
function RenumberList({ list }: { list: Renumbering[] }) {
  return (
    <>
      {list.slice(0, 4).map((r) => (
        <li key={r.index}>{describeRenumbering(r)}</li>
      ))}
      {list.length > 4 && <li>ほか{list.length - 4}条</li>}
    </>
  );
}

/** 選択肢つきダイアログの選んだ値を持つ入れ物 */
function choiceBody<T extends string>(
  initial: T,
  render: (v: T, set: (v: T) => void) => ReactNode,
) {
  return function Body({ onChange }: { onChange: (v: T) => void }) {
    const [v, setV] = useState<T>(initial);
    const set = (x: T) => {
      setV(x);
      onChange(x);
    };
    return <>{render(v, set)}</>;
  };
}

// ---------- 挿入 ----------

export function openInsertArticleDialog(ctx: CommandContext, where: 'before' | 'after') {
  const editor = ctx.editor;
  if (!editor) return;
  const state = editor.state;
  const target = insertTarget(state, where);
  const nums = articleNums(state.doc);
  const plan = planInsert(nums, target.at);
  const label = (n: ArticleNum) => formatArticleNum(n);
  const done = (num: ArticleNum, renumbered: Renumbering[]) => {
    apply(ctx, insertArticle(editor.state, target, num, renumbered), renumbered);
    ctx.app.showToast(
      renumbered.length
        ? `${label(num)}を挿入し、${renumbered.length}条の番号を繰り下げました`
        : `${label(num)}を挿入しました`,
    );
  };
  // 末尾への追加ではダイアログを出さない
  if (plan.atEnd) return done(plan.shift, []);

  // 既定値：改正中なら枝番号、新規制定中ならずらす（Phase 5 で改正案の種類を見る。今は既存のルールの改正のみ）
  const amending = true;
  const initial = plan.branch && amending ? 'branch' : 'shift';
  const choice = { value: initial as 'branch' | 'shift' };
  const Body = choiceBody<'branch' | 'shift'>(initial, (v, set) => (
    <>
      <p style={{ marginTop: 0 }}>
        {target.anchor && where === 'after'
          ? `${label(target.anchor)}の後`
          : target.at === 0
            ? '先頭'
            : `${label(nums[target.at]!)}の前`}
        に新しい条を入れます。条番号をどうしますか？
      </p>
      {plan.branch && (
        <Choice
          name="numopt"
          value="branch"
          checked={v === 'branch'}
          onChange={(x) => set(x as 'branch')}
          title={`${label(plan.branch)}にする（枝番号）`}
        >
          <li>ほかの条の番号は変わりません。改正ではふつうこちら</li>
        </Choice>
      )}
      <Choice
        name="numopt"
        value="shift"
        checked={v === 'shift'}
        onChange={(x) => set(x as 'shift')}
        title={`${label(plan.shift)}にして、後ろの条を1つずつずらす`}
      >
        <RenumberList list={plan.shifted} />
      </Choice>
    </>
  ));
  openDialog({
    title: '条の挿入',
    body: <Body onChange={(v) => (choice.value = v)} />,
    actions: [
      { label: 'キャンセル' },
      {
        label: '挿入',
        primary: true,
        run: () => {
          if (choice.value === 'branch' && plan.branch) done(plan.branch, []);
          else done(plan.shift, plan.shifted);
        },
      },
    ],
  });
}

// ---------- 削除 ----------

export function openDeleteArticleDialog(ctx: CommandContext) {
  const editor = ctx.editor;
  const ref = editor && currentArticle(editor.state);
  if (!editor || !ref) return;
  if (ref.node.attrs.deleted) {
    apply(ctx, undeleteArticle(editor.state, ref));
    ctx.app.showToast('削除を取り消しました');
    return;
  }
  const num = ref.node.attrs.num as ArticleNum | null;
  const lab = num ? formatArticleNum(num) : 'この条';
  const plan = planDelete(articleNums(editor.state.doc), ref.index);
  const caption = ref.node.firstChild?.textContent ?? '';
  const choice = { value: 'keep' as 'keep' | 'close' };
  const Body = choiceBody<'keep' | 'close'>('keep', (v, set) => (
    <>
      <p style={{ marginTop: 0 }}>
        「{lab}
        {caption ? `（${caption}）` : ''}」を削除します。後ろの条の番号をどうしますか？
      </p>
      <Choice
        name="delopt"
        value="keep"
        checked={v === 'keep'}
        onChange={(x) => set(x as 'keep')}
        title={`番号はそのまま（「${lab}　削除」として残す）`}
      >
        <li>ほかの条の番号は変わりません</li>
      </Choice>
      {plan.closed.length > 0 && (
        <Choice
          name="delopt"
          value="close"
          checked={v === 'close'}
          onChange={(x) => set(x as 'close')}
          title="後ろの条を1つずつ詰める"
        >
          <RenumberList list={plan.closed} />
        </Choice>
      )}
    </>
  ));
  openDialog({
    title: `${lab}の削除`,
    body: <Body onChange={(v) => (choice.value = v)} />,
    actions: [
      { label: 'キャンセル' },
      {
        label: '削除',
        primary: true,
        run: () => {
          const close = choice.value === 'close';
          const renumbered = close ? plan.closed : [];
          apply(
            ctx,
            deleteArticle(editor.state, ref, close ? 'close' : 'keep', renumbered),
            renumbered,
          );
          ctx.app.showToast(`${lab}を削除しました（元に戻す：Ctrl+Z）`);
        },
      },
    ],
  });
}

// ---------- 移動 ----------

export function moveCurrentArticle(ctx: CommandContext, dir: -1 | 1) {
  const editor = ctx.editor;
  const ref = editor && currentArticle(editor.state);
  if (!editor || !ref) return;
  const r = moveArticle(editor.state, ref, dir);
  if ('error' in r) return ctx.app.showToast(r.error);
  const undo = ctx.entry?.undo;
  if (r.crossed === 'division') {
    // 章・節の境目を越えるときは番号を変えない
    apply(ctx, r.tr);
    return ctx.app.showToast(r.message);
  }
  // 入れ替えたあとに番号の扱いを選ぶ。選んだ番号の変更も同じ1回の「元に戻す」にまとめる
  undo?.stopCapturing();
  editor.view.dispatch(r.tr);
  const timeout = undo?.captureTimeout;
  if (undo) undo.captureTimeout = Number.MAX_SAFE_INTEGER;
  const finish = () => {
    if (undo) {
      undo.captureTimeout = timeout!;
      undo.stopCapturing();
    }
    editor.commands.focus();
  };
  const a = ref.node.attrs.num as ArticleNum | null;
  const b = r.other.node.attrs.num as ArticleNum | null;
  if (!a || !b) return finish();
  const choice = { value: 'swap' as 'swap' | 'keep' };
  const Body = choiceBody<'swap' | 'keep'>('swap', (v, set) => (
    <>
      <p style={{ marginTop: 0 }}>
        {formatArticleNum(a)}と{formatArticleNum(b)}の順番を入れ替えました。条番号をどうしますか？
      </p>
      <Choice
        name="mv"
        value="swap"
        checked={v === 'swap'}
        onChange={(x) => set(x as 'swap')}
        title="番号も入れ替えて、並び順どおりにする"
      />
      <Choice
        name="mv"
        value="keep"
        checked={v === 'keep'}
        onChange={(x) => set(x as 'keep')}
        title="番号はそのまま（順序が前後します）"
      />
    </>
  ));
  openDialog({
    title: '条の移動',
    body: <Body onChange={(v) => (choice.value = v)} />,
    actions: [
      {
        label: 'OK',
        primary: true,
        run: () => {
          if (choice.value === 'swap') {
            // 移動後の並びで、動かした条と相手の条の番号を入れ替える
            // 動かした条にはカーソルがあり、相手の条はその後ろ（上へ）か前（下へ）にある
            const nums = articleNums(editor.state.doc);
            const ia = currentArticle(editor.state)?.index ?? -1;
            const swap = planSwap(nums, ia, ia - dir);
            editor.view.dispatch(renumberArticles(editor.state, swap));
            if (ctx.entry) ctx.app.logRenumbering(ctx.entry.key, swap);
          }
          finish();
        },
      },
    ],
  });
  // Esc で閉じたときも履歴の区切りを戻す
  const dlg = document.querySelector('dialog');
  dlg?.addEventListener('close', () => undo && undo.captureTimeout !== timeout && finish(), {
    once: true,
  });
}

// ---------- 番号の変更 ----------

export function openRenumberDialog(ctx: CommandContext) {
  const editor = ctx.editor;
  const ref = editor && currentArticle(editor.state);
  if (!editor || !ref) return;
  const old = ref.node.attrs.num as ArticleNum | null;
  const oldLabel = old ? formatArticleNum(old) : 'この条';
  const value = {
    main: String(old?.main ?? 1),
    branch: old?.branches[0] ? String(old.branches[0]) : '',
  };
  let setMsg: (m: string) => void = () => {};
  function Body() {
    const [msg, setM] = useState('');
    setMsg = setM;
    return (
      <>
        <p style={{ marginTop: 0 }}>
          {oldLabel}の番号を変えます。文中の参照は「参照の確認」で書き換えられます。
        </p>
        <div className="inline-fields">
          第
          <input
            type="number"
            min={1}
            defaultValue={value.main}
            aria-label="条"
            onChange={(e) => (value.main = e.target.value)}
          />
          条 の{' '}
          <input
            type="number"
            min={2}
            defaultValue={value.branch}
            placeholder="なし"
            aria-label="枝番号"
            onChange={(e) => (value.branch = e.target.value)}
          />
        </div>
        <p className="muted" role="alert">
          {msg}
        </p>
      </>
    );
  }
  openDialog({
    title: '条番号の変更',
    body: <Body />,
    actions: [
      { label: 'キャンセル' },
      {
        label: '変更',
        primary: true,
        run: () => {
          const to: ArticleNum = {
            main: Number(value.main),
            branches: value.branch ? [Number(value.branch)] : [],
          };
          if (old && formatArticleNum(to) === oldLabel) return;
          const err = checkRenumber(articleNums(editor.state.doc), ref.index, to);
          if (err) {
            setMsg(err);
            return false;
          }
          const list: Renumbering[] = old ? [{ index: ref.index, from: old, to }] : [];
          const tr = editor.state.tr.setNodeMarkup(ref.pos, undefined, {
            ...ref.node.attrs,
            num: to,
          });
          apply(ctx, tr, list);
          ctx.app.showToast(`${oldLabel}を${formatArticleNum(to)}に変更しました`);
        },
      },
    ],
  });
}

export type { ArticleRef };
