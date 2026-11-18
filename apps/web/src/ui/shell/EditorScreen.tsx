// エディタの画面：リボン・ナビゲーション・紙面・作業ウィンドウ・ステータスバー。

import {
  Ban,
  Check,
  ChevronDown,
  Eye,
  FileText,
  Info,
  Lock,
  Plus,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { formatRuleNumber } from '@rule-builder/core';
import { TextSelection } from '@tiptap/pm/state';
import { getCommand, isEnabled } from '../../commands/registry.ts';
import { targetPos } from '../../editor/navigation.ts';
import { RuleEditorView } from '../../editor/RuleEditorView.tsx';
import { useCommandContext } from '../../commands/useCommandContext.ts';
import { layoutRule } from '../../render/layout.ts';
import { RuleView } from '../../render/RuleView.tsx';
import { useApp, type PaneKind } from '../../state/store.ts';
import { Menu, type MenuItem } from '../common/Menu.tsx';
import { RULES_REPO } from '../../github/rules.ts';
import { staleEntries } from '../../state/actions.ts';
import { OP_TAG } from '../file/InfoPage.tsx';
import { CheckPane } from '../panes/CheckPane.tsx';
import { RefsPane } from '../panes/RefsPane.tsx';
import { RuleMetaForm } from '../panes/RuleMetaForm.tsx';
import { MobileBar } from './MobileBar.tsx';
import { NavigationPane } from './NavigationPane.tsx';
import { Ribbon } from './Ribbon.tsx';
import { StatusBar } from './StatusBar.tsx';
import { TaskPane } from './TaskPane.tsx';
import { TitleBar } from './TitleBar.tsx';
import { FlowBanner } from './FlowBanner.tsx';

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
  // 文字を打つたびに画面全体を描き直さないよう、カーソルで変わる部分（リボン・ステータスバー・目次の印）は
  // それぞれの部品が描き直す
  const ctx = useCommandContext(false);
  const navigate = useNavigate();
  const { ui, setUi, entries } = ctx.app;
  const entry = entries[index]!;
  const sections = useMemo(() => layoutRule(entry.doc), [entry.doc]);
  const canvasRef = useRef<HTMLElement>(null);
  const [switcher, setSwitcher] = useState<{ x: number; y: number } | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const proposal = ctx.app.proposal;
  const saveState = ctx.app.saveState;
  const flowLocked = ctx.app.flowLocked;
  const [stale, setStale] = useState<{ sha: string; keys: string[] }>({ sha: '', keys: [] });
  /** 閉じた警告（同じ版のあいだは出さない） */
  const [dismissed, setDismissed] = useState<string | null>(null);

  // 元にした版が今の main より古ければ知らせる（F-45。並行改正の見落としに気づくため）。
  // 開いたときと、編集中は5分ごと・画面に戻ったときに確かめ直す（main の SHA は5分間キャッシュする）
  useEffect(() => {
    let alive = true;
    const check = () => {
      if (document.visibilityState === 'hidden') return;
      staleEntries().then(
        (r) => alive && setStale(r),
        () => {},
      );
    };
    check();
    const timer = setInterval(check, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', check);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [proposal?.id, entries.length]);

  // いま開いているルールを在席に載せる（ほかの人がアイコンを押したときの移動先）
  useEffect(() => {
    ctx.app.session?.setActiveEntry(entry.key);
  }, [ctx.app.session, entry.key]);

  // スマホでは開いたときにナビゲーションとリボンを畳む
  useEffect(() => {
    if (ctx.isMobile) setUi({ nav: false, ribbonOpen: false, pane: null });
    // 開いたときだけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // スマホでドロワーを開いたら、ドロワーの中（閉じるボタン）にフォーカスを移す
  useEffect(() => {
    if (!ctx.isMobile) return;
    const sel = ui.pane ? '.pane .ph button' : ui.nav ? '.nav .ph button' : null;
    if (sel) document.querySelector<HTMLElement>(sel)?.focus();
  }, [ctx.isMobile, ui.nav, ui.pane]);

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
      // Esc：スマホのドロワー、またはフォーカスのある作業ウィンドウを閉じて紙面に戻る
      if (
        e.key === 'Escape' &&
        !document.querySelector('dialog[open], .menu') &&
        ((ctx.isMobile && (ui.nav || ui.pane)) ||
          (ui.pane && (document.activeElement as HTMLElement | null)?.closest('.pane')))
      ) {
        e.preventDefault();
        setUi(ctx.isMobile ? { nav: false, pane: null } : { pane: null });
        ctx.editor?.commands.focus();
      }
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
        <Ribbon />
        {ui.nav && (
          <NavigationPane
            sections={sections}
            activeKey={activeKey}
            showMarks={entry.op === 'amend' && ui.showChanges}
            onGoHeading={(key) => {
              setActiveKey(key);
              goTo(key);
            }}
            onGoLine={goTo}
          />
        )}
        <main className="canvas" ref={canvasRef} aria-label="紙面">
          {stale.keys.includes(entry.key) && dismissed !== `${entry.key}@${stale.sha}` && (
            <div className="ebanner-wrap" role="alert">
              <TriangleAlert className="i" aria-hidden="true" />
              <span className="grow">
                <b>公開中のルールが更新されました。</b>
                この改正案は更新前の版（{entry.baseSha.slice(0, 7)}）をもとにしています。新しい版（
                {stale.sha.slice(0, 7)}
                ）の変更を取り込まずに発議すると、その変更が失われます。同じルールを変える改正案がほかにないかも確かめてください。
              </span>
              <a
                className="btn small"
                href={`https://github.com/${RULES_REPO}/compare/${entry.baseSha}...${stale.sha}`}
                target="_blank"
                rel="noreferrer"
              >
                何が変わったか見る
              </a>
              <button
                type="button"
                className="btn small"
                onClick={() => setDismissed(`${entry.key}@${stale.sha}`)}
              >
                閉じる
              </button>
            </div>
          )}
          <FlowBanner />
          {flowLocked && entry.op !== 'repeal' && (
            <div className="readbar">
              <Lock className="i" aria-hidden="true" />
              <b>読み取り専用</b>
              <span className="muted">運営投票の開始後は内容が固定され、編集できません</span>
            </div>
          )}
          {entry.op === 'repeal' && (
            <div className="readbar warnbar">
              <Ban className="i" aria-hidden="true" />
              <b>廃止</b>
              <span className="muted">このルールは改正案で廃止します。本文は編集しません。</span>
            </div>
          )}
          {ui.mode === 'read' && entry.op !== 'repeal' && !flowLocked && (
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
        </main>
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
        {ctx.isMobile && editing && <MobileBar />}
        <StatusBar editing={editing} />
      </div>
      <div
        className={'backdrop' + (backdrop ? ' open' : '')}
        onClick={() => setUi({ nav: false, pane: null })}
      />
    </>
  );
}
