// エディタの画面：リボン・ナビゲーション・紙面・作業ウィンドウ・ステータスバー。

import { Ban, Check, ChevronDown, Eye, FileText, Info, Plus, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { formatRuleNumber, type ArticleNum } from '@rule-builder/core';
import { TextSelection } from '@tiptap/pm/state';
import { getCommand, isEnabled } from '../../commands/registry.ts';
import { articleCursor, cursorLocation } from '../../editor/commands.ts';
import { articleLabel } from '../../editor/lines.ts';
import { targetPos } from '../../editor/navigation.ts';
import { RuleEditorView } from '../../editor/RuleEditorView.tsx';
import { useCommandContext } from '../../commands/useCommandContext.ts';
import { layoutRule } from '../../render/layout.ts';
import { RuleView } from '../../render/RuleView.tsx';
import { useApp, type PaneKind } from '../../state/store.ts';
import { Menu, type MenuItem } from '../common/Menu.tsx';
import { changesKey } from '../../editor/changes.ts';
import { staleEntries } from '../../state/actions.ts';
import { OP_TAG } from '../file/InfoPage.tsx';
import { CheckPane } from '../panes/CheckPane.tsx';
import { RefsPane } from '../panes/RefsPane.tsx';
import { RuleMetaForm } from '../panes/RuleMetaForm.tsx';
import { NavigationPane } from './NavigationPane.tsx';
import { Ribbon } from './Ribbon.tsx';
import { StatusBar } from './StatusBar.tsx';
import { TaskPane } from './TaskPane.tsx';
import { TitleBar } from './TitleBar.tsx';

const KIND_KEY: Record<string, string> = { kou: 'p', gou: 'i', saibun: 's' };

const PANE_TITLES: Record<PaneKind, string> = {
  info: 'ルールの情報',
  check: '書式チェック',
  refs: '参照の確認',
};

export function EditorScreen() {
  const { index } = useParams();
  const n = Number(index);
  const entries = useApp((s) => s.entries);
  const entry = entries[n];
  const current = useApp((s) => s.current);
  const setCurrent = useApp((s) => s.setCurrent);

  useEffect(() => {
    if (entry && current !== n) setCurrent(n);
  }, [entry, current, n, setCurrent]);

  if (!entry) return <Navigate to={entries.length ? '/file/info' : '/file/home'} replace />;
  return <Editor key={entry.key} index={n} />;
}

function Editor({ index }: { index: number }) {
  const ctx = useCommandContext();
  const navigate = useNavigate();
  const { ui, setUi, entries } = ctx.app;
  const entry = entries[index]!;
  const sections = useMemo(() => layoutRule(entry.doc), [entry.doc]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [switcher, setSwitcher] = useState<{ x: number; y: number } | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const cursor = ctx.editor ? articleCursor(ctx.editor.state) : null;
  const kind = cursor && cursor.index >= 0 ? cursor.infos[cursor.index]!.kind : null;
  const proposal = ctx.app.proposal;
  const saveState = ctx.app.saveState;
  const [stale, setStale] = useState<string[]>([]);

  // 改正案を開いたとき、元にした版が今の main より古ければ知らせる（並行改正の見落としに気づくため）
  useEffect(() => {
    staleEntries().then(setStale, () => setStale([]));
  }, [proposal?.id]);

  // スマホでは開いたときにナビゲーションとリボンを畳む
  useEffect(() => {
    if (ctx.isMobile) setUi({ nav: false, ribbonOpen: false, pane: null });
    // 開いたときだけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // キー操作（紙面の外でも効くもの）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const run = (id: string) => {
        e.preventDefault();
        const c = getCommand(id);
        if (isEnabled(c, ctx)) c.run(ctx);
      };
      if (ctrl && e.key.toLowerCase() === 'f') run('find');
      if (ctrl && e.key.toLowerCase() === 's') run('save');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const editor = ctx.editor;
  const editing = ui.mode === 'edit' && !entry.readOnly;

  /** 目次・検索結果のキーの場所へ移動する（編集中はカーソルも移す） */
  const goTo = (key: string) => {
    if (ctx.isMobile) setUi({ nav: false });
    if (editing && editor) {
      const pos = targetPos(editor.state.doc, key);
      if (pos === null) return;
      const dom = editor.view.nodeDOM(pos);
      if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start', behavior: 'smooth' });
      const $pos = editor.state.doc.resolve(Math.min(pos + 1, editor.state.doc.content.size));
      const sel = TextSelection.findFrom($pos, 1, true);
      if (sel) editor.view.dispatch(editor.state.tr.setSelection(sel));
      editor.view.focus();
      return;
    }
    const sel = key[0] === 'h' ? `[data-key="${key}"]` : `[data-line="${key}"]`;
    canvasRef.current?.querySelector(sel)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const amending = proposal ? formatRuleNumber(proposal.amendingNumber) || '（番号なし）' : '';
  const opLabel = { create: '新規制定', amend: '改正', repeal: '廃止' }[entry.op];
  const title = `${entry.doc.meta.name || '（名称未設定）'} — ${opLabel}（${amending}）`;
  const go = (to: string) => {
    setSwitcher(null);
    void navigate(to);
  };
  const switcherItems: MenuItem[] = [
    { type: 'heading', text: `${amending} の改正案に含まれるルール` },
    ...entries.map((e, i): MenuItem => ({
      type: 'custom',
      key: e.key,
      node: (
        <button
          type="button"
          role="menuitem"
          aria-current={i === index ? 'true' : undefined}
          onClick={() => go(`/edit/${i}`)}
        >
          {i === index ? (
            <Check className="i" aria-hidden="true" />
          ) : e.op === 'repeal' ? (
            <Ban className="i" aria-hidden="true" />
          ) : (
            <FileText className="i" aria-hidden="true" />
          )}
          <span>{e.doc.meta.name || '（名称未設定）'}</span>
          <span className="k">{OP_TAG[e.op].label}</span>
        </button>
      ),
    })),
    { type: 'separator' },
    {
      type: 'custom',
      key: 'add',
      node: (
        <button type="button" role="menuitem" onClick={() => go('/file/info')}>
          <Plus className="i" aria-hidden="true" />
          <span>ルールを追加…</span>
        </button>
      ),
    },
    {
      type: 'custom',
      key: 'info',
      node: (
        <button type="button" role="menuitem" onClick={() => go('/file/info')}>
          <Info className="i" aria-hidden="true" />
          <span>改正案の情報</span>
        </button>
      ),
    },
  ];
  const changes = editor ? changesKey.getState(editor.state) : null;
  const summary =
    entry.op === 'create'
      ? '新規制定'
      : entry.op === 'repeal'
        ? '廃止'
        : changes
          ? `変更 ${changes.articles.filter((x) => x).length + changes.removed}条`
          : '改正';

  const backdrop = ctx.isMobile && (ui.nav || !!ui.pane);
  const sheetStyle = { zoom: ui.zoom / 100 } as CSSProperties;

  return (
    <>
      <TitleBar
        center={
          <button
            type="button"
            className="tb doc-switch"
            title="開いているほかのルールに切り替える"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setSwitcher(switcher ? null : { x: r.left + r.width / 2, y: r.bottom + 4 });
            }}
          >
            <span>{title}</span>
            <ChevronDown className="i" aria-hidden="true" />
          </button>
        }
        save={saveState}
      />
      {switcher && (
        <Menu
          x={switcher.x}
          y={switcher.y}
          center
          items={switcherItems}
          onClose={() => setSwitcher(null)}
        />
      )}
      <div className="editor">
        <Ribbon
          articleLabel={
            cursor?.article.attrs.num
              ? articleLabel(cursor.article.attrs.num as ArticleNum)
              : cursor
                ? '条'
                : null
          }
          currentKind={KIND_KEY[kind ?? ''] ?? null}
          singleParagraph={!!cursor && cursor.infos.filter((i) => i.kind === 'kou').length <= 1}
        />
        {ui.nav && (
          <NavigationPane
            sections={sections}
            activeKey={activeKey}
            articleMarks={
              entry.op === 'amend' && ui.showChanges ? (changes?.articles ?? null) : null
            }
            onGoHeading={(key) => {
              setActiveKey(key);
              goTo(key);
            }}
            onGoLine={goTo}
          />
        )}
        <div className="canvas" ref={canvasRef}>
          {stale.includes(entry.key) && (
            <div className="readbar warnbar" role="alert">
              <TriangleAlert className="i" aria-hidden="true" />
              <b>この下書きの作成後にルールが更新されています</b>
              <span className="muted">
                同じルールを変える改正案がほかにないか確かめてください。
              </span>
            </div>
          )}
          {entry.op === 'repeal' && (
            <div className="readbar warnbar">
              <Ban className="i" aria-hidden="true" />
              <b>廃止</b>
              <span className="muted">このルールは改正案で廃止します。本文は編集しません。</span>
            </div>
          )}
          {ui.mode === 'read' && entry.op !== 'repeal' && (
            <div className="readbar">
              <Eye className="i" aria-hidden="true" />
              <b>閲覧モード</b>
              <span className="muted">
                ポータルでの見た目です。編集するにはステータスバー右下の「編集」
              </span>
            </div>
          )}
          <div
            className={
              'sheet' +
              (editing ? ' editing' : '') +
              (ui.showChanges && entry.op === 'amend' ? ' show-changes' : '')
            }
            style={sheetStyle}
          >
            {!entry.readOnly && (
              <RuleEditorView
                entry={entry}
                hidden={!editing}
                onTitleClick={() => setUi({ pane: 'info' })}
              />
            )}
            {!editing && (
              <RuleView
                doc={entry.doc}
                sections={sections}
                generalOnly={ui.generalOnly}
                onTitleClick={() => setUi({ pane: 'info' })}
              />
            )}
          </div>
        </div>
        {ui.pane && (
          <TaskPane title={PANE_TITLES[ui.pane]} onClose={() => setUi({ pane: null })}>
            {ui.pane === 'info' ? (
              <RuleMetaForm entry={entry} />
            ) : ui.pane === 'check' ? (
              <CheckPane ctx={ctx} />
            ) : (
              <RefsPane ctx={ctx} />
            )}
          </TaskPane>
        )}
        <StatusBar
          location={editing && editor ? cursorLocation(editor.state) : '—'}
          summary={summary}
        />
      </div>
      <div
        className={'backdrop' + (backdrop ? ' open' : '')}
        onClick={() => setUi({ nav: false, pane: null })}
      />
    </>
  );
}
