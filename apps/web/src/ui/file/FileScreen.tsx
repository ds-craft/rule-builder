// ファイル画面（Word の Backstage）：左の縦メニューと各ページ。
// 起動時の画面も、編集中に「ファイル」タブで開く画面も、すべてこの1つの画面にまとめる。

import {
  ArrowLeft,
  Columns2,
  FileText,
  FolderOpen,
  House,
  Info,
  Save,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useApp } from '../../state/store.ts';
import { TitleBar } from '../shell/TitleBar.tsx';
import { HomePage } from './HomePage.tsx';
import { NewPage } from './NewPage.tsx';
import { OpenPage } from './OpenPage.tsx';

type PageKey = 'home' | 'new' | 'open' | 'info' | 'save' | 'export' | 'print' | 'close';

type PageDef = { key: PageKey; icon: LucideIcon; label: string; needsProposal: boolean };

const PAGES: (PageDef | '-')[] = [
  { key: 'home', icon: House, label: 'ホーム', needsProposal: false },
  { key: 'new', icon: FileText, label: '新規', needsProposal: false },
  { key: 'open', icon: FolderOpen, label: '開く', needsProposal: false },
  '-',
  { key: 'info', icon: Info, label: '情報', needsProposal: true },
  { key: 'save', icon: Save, label: '保存', needsProposal: true },
  { key: 'export', icon: Upload, label: '書き出し', needsProposal: true },
  { key: 'print', icon: Columns2, label: '新旧対照表・印刷', needsProposal: true },
  '-',
  { key: 'close', icon: X, label: '閉じる', needsProposal: true },
];

const isPage = (k: string | undefined): k is PageKey => PAGES.some((p) => p !== '-' && p.key === k);

export function FileScreen() {
  const { page } = useParams();
  const navigate = useNavigate();
  const entries = useApp((s) => s.entries);
  const current = useApp((s) => s.current);
  // 改正案（Phase 5）を開いていないときは、情報・保存などは押せない
  const hasProposal = false;
  const backTo = entries.length ? `/edit/${Math.max(0, current)}` : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && backTo && !document.querySelector('dialog[open]')) {
        void navigate(backTo);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [backTo, navigate]);

  const def = PAGES.find((p): p is PageDef => p !== '-' && p.key === page);
  if (!isPage(page) || !def || (def.needsProposal && !hasProposal)) {
    return <Navigate to="/file/home" replace />;
  }

  return (
    <>
      <TitleBar center="ルールの改正案を作成・編集します" />
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
            if (p.needsProposal && !hasProposal) {
              return (
                <span key={p.key} className="disabled" aria-disabled="true">
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
        <div className="bs-body">
          {page === 'home' && <HomePage />}
          {page === 'new' && <NewPage />}
          {page === 'open' && <OpenPage />}
        </div>
      </div>
    </>
  );
}
