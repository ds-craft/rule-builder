// ファイル画面（Word の Backstage）：左の縦メニューと各ページ。
// 起動時の画面も、編集中に「ファイル」タブで開く画面も、すべてこの1つの画面にまとめる。
// ログインしていなければ、ホーム（Discord でログイン）とヘルプだけを使える。

import {
  ArrowLeft,
  Columns2,
  FileText,
  FolderOpen,
  House,
  Info,
  LifeBuoy,
  Save,
  Upload,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useAuth } from '../../state/auth.ts';
import { useApp } from '../../state/store.ts';
import { AccountPage } from './AccountPage.tsx';
import { TitleBar } from '../shell/TitleBar.tsx';
import { formatRuleNumber } from '@rule-builder/core';
import { HomePage } from './HomePage.tsx';
import { ExportPage } from './ExportPage.tsx';
import { InfoPage } from './InfoPage.tsx';
import { PrintPage } from './PrintPage.tsx';
import { SavePage } from './SavePage.tsx';
import { NewPage } from './NewPage.tsx';
import { OpenPage } from './OpenPage.tsx';
import { HelpPage } from './HelpPage.tsx';

type PageKey =
  'home' | 'new' | 'open' | 'info' | 'save' | 'export' | 'print' | 'help' | 'account' | 'close';

type PageDef = {
  key: PageKey;
  icon: LucideIcon;
  label: string;
  needsProposal: boolean;
  /** ログインしていなくても使える */
  public?: boolean;
  /** まだ中身のないページ（書き出し・新旧対照表は Phase 6） */
  notReady?: boolean;
};

const PAGES: (PageDef | '-')[] = [
  { key: 'home', icon: House, label: 'ホーム', needsProposal: false, public: true },
  { key: 'new', icon: FileText, label: '新規', needsProposal: false },
  { key: 'open', icon: FolderOpen, label: '開く', needsProposal: false },
  '-',
  { key: 'info', icon: Info, label: '情報', needsProposal: true },
  { key: 'save', icon: Save, label: '保存', needsProposal: true },
  { key: 'export', icon: Upload, label: '書き出し', needsProposal: true },
  { key: 'print', icon: Columns2, label: '新旧対照表・印刷', needsProposal: true },
  '-',
  { key: 'help', icon: LifeBuoy, label: 'ヘルプ', needsProposal: false, public: true },
  { key: 'account', icon: User, label: 'アカウント', needsProposal: false },
  { key: 'close', icon: X, label: '閉じる', needsProposal: true },
];

const isPage = (k: string | undefined): k is PageKey => PAGES.some((p) => p !== '-' && p.key === k);

export function FileScreen() {
  const { page } = useParams();
  const navigate = useNavigate();
  const entries = useApp((s) => s.entries);
  const current = useApp((s) => s.current);
  const proposal = useApp((s) => s.proposal);
  const saveState = useApp((s) => s.saveState);
  const authStatus = useAuth((s) => s.status);
  const loggedIn = authStatus === 'user';
  // 改正案を開いていないときは、情報・保存などは押せない
  const hasProposal = !!proposal;
  const editable = entries.findIndex((e, i) => i >= Math.max(0, current) && e.op !== 'repeal');
  const backTo = editable >= 0 ? `/edit/${editable}` : null;

  // 閉じる：改正案を閉じてホームへ（内容は自動で保存されている）
  useEffect(() => {
    if (page !== 'close' || !proposal) return;
    void useApp
      .getState()
      .closeSession()
      .then(() => {
        useApp.getState().showToast('改正案を閉じました（内容は自動で保存されています）');
        void navigate('/file/home', { replace: true });
      });
  }, [page, proposal, navigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && backTo && !document.querySelector('dialog[open]')) {
        void navigate(backTo);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [backTo, navigate]);

  const usable = (p: PageDef) =>
    (loggedIn || !!p.public) && !(p.needsProposal && !hasProposal) && !p.notReady;
  const def = PAGES.find((p): p is PageDef => p !== '-' && p.key === page);
  // ログインの確認が終わるまでは、ログインの要るページを開いたままにする（再読み込みでホームに飛ばないように）
  if (authStatus === 'loading' && def && !def.public) return null;
  if (!isPage(page) || !def || !usable(def)) {
    return <Navigate to="/file/home" replace />;
  }
  if (page === 'close') return null;

  return (
    <>
      <TitleBar
        center={
          proposal
            ? `${formatRuleNumber(proposal.amendingNumber) || '（番号なし）'} の改正案`
            : 'ルールの改正案を作成・編集します'
        }
        save={proposal ? saveState : null}
      />
      <div className="backstage">
        <nav aria-label="ファイル">
          {backTo && (
            <Link className="back" to={backTo}>
              <ArrowLeft className="i" aria-hidden="true" />
              編集に戻る
            </Link>
          )}
          {PAGES.map((p, i) => {
            if (p === '-') return <hr key={i} />;
            const Icon = p.icon;
            if (!usable(p)) {
              return (
                <span
                  key={p.key}
                  className="disabled"
                  aria-disabled="true"
                  title={p.notReady && hasProposal ? '準備中です' : undefined}
                >
                  <Icon className="i" aria-hidden="true" />
                  {p.label}
                </span>
              );
            }
            return (
              <Link
                key={p.key}
                to={`/file/${p.key}`}
                className={page === p.key ? 'active' : ''}
                aria-current={page === p.key ? 'page' : undefined}
              >
                <Icon className="i" aria-hidden="true" />
                {p.label}
              </Link>
            );
          })}
        </nav>
        <main className="bs-body">
          {page === 'home' && <HomePage />}
          {page === 'new' && <NewPage />}
          {page === 'open' && <OpenPage />}
          {page === 'info' && <InfoPage />}
          {page === 'save' && <SavePage />}
          {page === 'export' && <ExportPage />}
          {page === 'print' && <PrintPage />}
          {page === 'help' && <HelpPage />}
          {page === 'account' && <AccountPage />}
        </main>
      </div>
    </>
  );
}
