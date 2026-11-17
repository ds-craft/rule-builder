// エディタの画面：リボン・ナビゲーション・紙面・作業ウィンドウ・ステータスバー。

import { ChevronDown, Eye } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { getCommand, isEnabled } from '../../commands/registry.ts';
import { useCommandContext } from '../../commands/useCommandContext.ts';
import { layoutRule } from '../../render/layout.ts';
import { RuleView } from '../../render/RuleView.tsx';
import { useApp, type PaneKind } from '../../state/store.ts';
import { Menu, type MenuItem } from '../common/Menu.tsx';
import { NotReadyPane, RuleInfoPane } from '../panes/RuleInfoPane.tsx';
import { NavigationPane } from './NavigationPane.tsx';
import { Ribbon } from './Ribbon.tsx';
import { StatusBar } from './StatusBar.tsx';
import { TaskPane } from './TaskPane.tsx';
import { TitleBar } from './TitleBar.tsx';

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

  if (!entry) return <Navigate to="/file/home" replace />;
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
      if (ctrl && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        const c = getCommand('find');
        if (isEnabled(c, ctx)) c.run(ctx);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const scrollTo = (selector: string) => {
    const el = canvasRef.current?.querySelector(selector);
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (ctx.isMobile) setUi({ nav: false });
  };

  const op = '閲覧（公開中の版）';
  const title = `${entry.doc.meta.name || '（名称未設定）'} — ${op}`;
  const switcherItems: MenuItem[] = [
    { type: 'heading', text: '開いているルール' },
    ...entries.map((e, i): MenuItem => ({
      type: 'custom',
      key: e.key,
      node: (
        <button
          type="button"
          role="menuitem"
          aria-current={i === index ? 'true' : undefined}
          onClick={() => {
            setSwitcher(null);
            void navigate(`/edit/${i}`);
          }}
        >
          <span>{e.doc.meta.name}</span>
          <span className="k">閲覧</span>
        </button>
      ),
    })),
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
            onGoHeading={(key) => {
              setActiveKey(key);
              scrollTo(`[data-key="${key}"]`);
            }}
            onGoLine={(key) => scrollTo(`[data-line="${key}"]`)}
          />
        )}
        <div className="canvas" ref={canvasRef}>
          {ui.mode === 'read' && (
            <div className="readbar">
              <Eye className="i" aria-hidden="true" />
              <b>閲覧モード</b>
              <span className="muted">
                {entry.readOnly
                  ? 'ポータルでの見た目です。公開中のルールを閲覧用に開いています。'
                  : 'ポータルでの見た目です。編集するにはステータスバー右下の「編集」'}
              </span>
            </div>
          )}
          <div className="sheet" style={sheetStyle}>
            <RuleView
              doc={entry.doc}
              sections={sections}
              generalOnly={ui.mode === 'read' && ui.generalOnly}
              onTitleClick={() => setUi({ pane: 'info' })}
            />
          </div>
        </div>
        {ui.pane && (
          <TaskPane title={PANE_TITLES[ui.pane]} onClose={() => setUi({ pane: null })}>
            {ui.pane === 'info' ? (
              <RuleInfoPane
                doc={entry.doc}
                note={entry.readOnly ? '公開中のルールを閲覧用に開いています。' : undefined}
              />
            ) : (
              <NotReadyPane />
            )}
          </TaskPane>
        )}
        <StatusBar location="—" summary={`公開中の版（${entry.sha.slice(0, 7)}）`} />
      </div>
      <div
        className={'backdrop' + (backdrop ? ' open' : '')}
        onClick={() => setUi({ nav: false, pane: null })}
      />
    </>
  );
}
