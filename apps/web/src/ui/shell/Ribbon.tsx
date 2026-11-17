// リボン：タブ・グループ・大小のボタン・ギャラリー・コンテキストタブ（条のツール）。
// ボタンはコマンド定義から描画する。

import { formatArticleNum, type ArticleNum } from '@rule-builder/core';
import type { ReactNode } from 'react';
import { articleCursor } from '../../editor/commands.ts';
import { useNavigate } from 'react-router';
import { commandLabel, commandTip, getCommand, isEnabled } from '../../commands/registry.ts';
import type { CommandContext } from '../../commands/types.ts';
import { useCommandContext } from '../../commands/useCommandContext.ts';
import type { RibbonTab } from '../../state/store.ts';
import { Icon } from '../common/Icon.tsx';
import { moveFocus } from '../common/keyNav.ts';

type Btn = { cmd: string; size: 'lg' | 'sm'; label?: string };
type Group =
  | { label: string; kind: 'buttons'; buttons: Btn[] }
  | { label: string; kind: 'column'; buttons: Btn[] }
  | { label: string; kind: 'gallery' };

const lg = (cmd: string, label?: string): Btn => ({ cmd, size: 'lg', label });
const sm = (cmd: string, label?: string): Btn => ({ cmd, size: 'sm', label });

const TABS: { key: Exclude<RibbonTab, 'article'>; label: string }[] = [
  { key: 'home', label: 'ホーム' },
  { key: 'insert', label: '挿入' },
  { key: 'review', label: '校閲' },
  { key: 'view', label: '表示' },
];

const LAYOUT: Record<RibbonTab, Group[]> = {
  home: [
    { label: '元に戻す', kind: 'column', buttons: [sm('undo'), sm('redo')] },
    { label: '行の種類', kind: 'gallery' },
    { label: '段落', kind: 'column', buttons: [sm('promote'), sm('demote')] },
    {
      label: '追加',
      kind: 'buttons',
      buttons: [lg('add-para'), lg('add-item'), lg('article-after')],
    },
    { label: '条', kind: 'buttons', buttons: [lg('general')] },
  ],
  insert: [
    {
      label: '条文',
      kind: 'buttons',
      buttons: [lg('article-after', '条'), lg('add-para'), lg('add-item')],
    },
    { label: '見出し', kind: 'buttons', buttons: [lg('chapter'), lg('section')] },
    { label: '前文・附則', kind: 'buttons', buttons: [lg('preamble'), lg('supp')] },
    { label: 'リンク', kind: 'buttons', buttons: [lg('link')] },
  ],
  review: [
    { label: 'チェック', kind: 'buttons', buttons: [lg('pane-check')] },
    { label: '参照', kind: 'buttons', buttons: [lg('pane-refs')] },
    { label: '変更', kind: 'buttons', buttons: [lg('show-changes'), lg('compare')] },
  ],
  view: [
    { label: '表示モード', kind: 'buttons', buttons: [lg('mode-edit'), lg('mode-read')] },
    { label: '表示', kind: 'column', buttons: [sm('toggle-nav'), sm('general-only')] },
    { label: 'ソース', kind: 'buttons', buttons: [lg('markdown')] },
  ],
  article: [
    {
      label: '挿入',
      kind: 'buttons',
      buttons: [lg('article-before'), lg('article-after', '後に条を挿入')],
    },
    { label: '移動', kind: 'column', buttons: [sm('art-up'), sm('art-down')] },
    { label: '番号', kind: 'buttons', buttons: [lg('art-renum')] },
    { label: '設定', kind: 'buttons', buttons: [lg('general')] },
    { label: '削除', kind: 'buttons', buttons: [lg('art-del'), lg('art-undel')] },
  ],
};

function RibbonButton({ btn, ctx }: { btn: Btn; ctx: CommandContext }) {
  const c = getCommand(btn.cmd);
  const tip = commandTip(c);
  const pressed = c.pressed?.(ctx);
  return (
    <button
      type="button"
      className={`rb ${btn.size}${pressed ? ' on' : ''}`}
      title={tip}
      aria-label={tip}
      aria-pressed={pressed === undefined ? undefined : pressed}
      disabled={!isEnabled(c, ctx)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => c.run(ctx)}
    >
      <Icon icon={c.icon} />
      <span>{btn.label ?? commandLabel(c, ctx)}</span>
    </button>
  );
}

/** 「行の種類」ギャラリー（Word のスタイル ギャラリーに相当）。 */
function Gallery({
  ctx,
  current,
  single,
}: {
  ctx: CommandContext;
  current: string | null;
  single: boolean;
}) {
  const items = [
    {
      key: 'p',
      cmd: 'kind-p',
      sample: single ? '　本文' : '①　項',
      name: single ? '項（1つ）' : '項',
    },
    { key: 'i', cmd: 'kind-i', sample: '一　号', name: '号' },
    { key: 's', cmd: 'kind-s', sample: 'イ　細分', name: '号の細分' },
  ];
  return (
    <div className="gallery">
      {items.map((it) => {
        const c = getCommand(it.cmd);
        return (
          <button
            key={it.key}
            type="button"
            className={'gal' + (current === it.key ? ' on' : '')}
            title={c.tip}
            disabled={!isEnabled(c, ctx)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => c.run(ctx)}
          >
            <span className="s">{it.sample}</span>
            <span className="n">{it.name}</span>
          </button>
        );
      })}
    </div>
  );
}

const KIND_KEY: Record<string, string> = { kou: 'p', gou: 'i', saibun: 's' };

export function Ribbon() {
  const ctx = useCommandContext();
  const cursor = ctx.editor ? articleCursor(ctx.editor.state) : null;
  /** カーソルが条の中にあるときの条番号（条のツールのタブを出す） */
  const articleLabel = cursor?.article.attrs.num
    ? formatArticleNum(cursor.article.attrs.num as ArticleNum)
    : cursor
      ? '条'
      : null;
  const kind = cursor && cursor.index >= 0 ? cursor.infos[cursor.index]!.kind : null;
  const currentKind = KIND_KEY[kind ?? ''] ?? null;
  const singleParagraph = !!cursor && cursor.infos.filter((i) => i.kind === 'kou').length <= 1;
  const navigate = useNavigate();
  const { ui, setUi } = ctx.app;
  const tab: RibbonTab = ui.tab === 'article' && !articleLabel ? 'home' : ui.tab;

  const selectTab = (key: RibbonTab) => {
    // スマホではリボンを畳んでおき、タブを押したときだけ開く（同じタブをもう一度押すと閉じる）
    const ribbonOpen = !(ctx.isMobile && ui.ribbonOpen && tab === key);
    setUi({ tab: key, ribbonOpen });
  };

  const body: ReactNode = LAYOUT[tab].map((g) => (
    <div className="rg" key={g.label}>
      <div className="rg-body">
        {g.kind === 'gallery' ? (
          <Gallery ctx={ctx} current={currentKind} single={singleParagraph} />
        ) : g.kind === 'column' ? (
          <div className="rcol">
            {g.buttons.map((b) => (
              <RibbonButton key={b.cmd} btn={b} ctx={ctx} />
            ))}
          </div>
        ) : (
          g.buttons.map((b) => <RibbonButton key={b.cmd + (b.label ?? '')} btn={b} ctx={ctx} />)
        )}
      </div>
      <div className="rg-label">{g.label}</div>
    </div>
  ));

  return (
    <div
      className={'ribbon' + (ctx.isMobile && !ui.ribbonOpen ? ' collapsed' : '')}
      role="region"
      aria-label="リボン"
    >
      <div className="rtabs">
        <button type="button" className="file" onClick={() => void navigate('/file/info')}>
          ファイル
        </button>
        <div
          role="tablist"
          aria-label="リボン"
          className="rtabs-list"
          onKeyDown={(e) => {
            // ←→ でタブを移り、そのタブを選ぶ
            if (moveFocus(e, '[role="tab"]')) (document.activeElement as HTMLElement).click();
          }}
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`rtab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls="ribbon-body"
              tabIndex={tab === t.key ? 0 : -1}
              className={tab === t.key ? 'active' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectTab(t.key)}
            >
              {t.label}
            </button>
          ))}
          {articleLabel && (
            <span className="ctx-wrap" role="none">
              <span className="ctx-cap" aria-hidden="true">
                {articleLabel}
              </span>
              <button
                type="button"
                role="tab"
                id="rtab-article"
                aria-label={`条のツール（${articleLabel}）`}
                aria-selected={tab === 'article'}
                aria-controls="ribbon-body"
                tabIndex={tab === 'article' ? 0 : -1}
                className={'ctx' + (tab === 'article' ? ' active' : '')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectTab('article')}
              >
                条のツール
              </button>
            </span>
          )}
        </div>
      </div>
      <div
        id="ribbon-body"
        className={'rbody' + (tab === 'article' ? ' ctx' : '')}
        role="toolbar"
        aria-labelledby={`rtab-${tab}`}
        onKeyDown={(e) => moveFocus(e, 'button')}
      >
        {body}
      </div>
    </div>
  );
}
