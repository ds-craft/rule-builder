import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useNavigate, useParams } from 'react-router';
import { openProposal } from './state/actions.ts';
import { loadMe, useAuth } from './state/auth.ts';
import { loadFlow, needsPolling, resetFlow, useFlow } from './state/flow.ts';
import { useApp } from './state/store.ts';
import { DialogHost } from './ui/common/dialogs.tsx';
import { Toast } from './ui/common/Toast.tsx';
import { FileScreen } from './ui/file/FileScreen.tsx';
import { EditorScreen } from './ui/shell/EditorScreen.tsx';
import { PublicPage } from './ui/public/PublicPage.tsx';

// GitHub Pages で404にならないよう HashRouter を使う。#/file/:page と #/edit/:index、共有リンクの #/p/:id、
// ログインなしで見られる公開リンクの #/public/:publicId。
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/file/:page" element={<FileScreen />} />
      <Route path="/edit/:index" element={<EditorScreen />} />
      <Route path="/p/:id" element={<SharedProposal />} />
      <Route path="/public/:publicId" element={<PublicPage />} />
      <Route path="*" element={<Navigate to="/file/home" replace />} />
    </Routes>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 共有された改正案のリンク（運営者どうしで送り合う）。ログインしていなければ、ログインの後にここへ戻る */
function SharedProposal() {
  const { id = '' } = useParams();
  const status = useAuth((s) => s.status);
  const navigate = useNavigate();
  const showToast = useApp((s) => s.showToast);
  useEffect(() => {
    if (!UUID.test(id)) {
      void navigate('/file/home', { replace: true });
      return;
    }
    if (status === 'loading') return;
    if (status === 'anon') {
      useAuth.setState({ notice: 'share', returnTo: `/p/${id}` });
      void navigate('/file/home', { replace: true });
      return;
    }
    let cancelled = false;
    openProposal(id).then(
      () => {
        if (cancelled) return;
        const { entries } = useApp.getState();
        void navigate(entries.length ? '/edit/0' : '/file/info', { replace: true });
      },
      (e: unknown) => {
        if (cancelled) return;
        showToast(e instanceof Error ? e.message : '改正案を開けませんでした');
        void navigate('/file/home', { replace: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, status, navigate, showToast]);
  return (
    <main className="loading-screen" aria-busy="true">
      <p className="muted">改正案を開いています…</p>
    </main>
  );
}

/** 起動時に運営者かどうかを確かめ、ログアウトされたら（運営ロールが外れたなど）改正案を閉じてホームに戻る */
function AuthWatcher() {
  const navigate = useNavigate();
  useEffect(() => {
    void loadMe();
    const recheck = () => {
      if (useAuth.getState().offline) void loadMe();
    };
    window.addEventListener('online', recheck);
    const unsub = useAuth.subscribe((s, prev) => {
      if (prev.status === 'user' && s.status === 'anon') {
        void useApp
          .getState()
          .closeSession()
          .then(() => navigate('/file/home', { replace: true }));
      }
    });
    return () => {
      window.removeEventListener('online', recheck);
      unsub();
    };
  }, [navigate]);
  return null;
}

/** 開いている改正案の発議・採決の状態を読み、サーバーの知らせと定期的な読み直しで追う */
function FlowSync() {
  const session = useApp((s) => s.session);
  const loggedIn = useAuth((s) => s.status === 'user');
  const polling = useFlow((s) => needsPolling(s.view));
  const id = session?.id ?? null;
  useEffect(() => {
    if (!session || !loggedIn || !id) {
      resetFlow();
      return;
    }
    void loadFlow(id);
    const off = session.onFlowChange(() => void loadFlow(id));
    // つなぎ直したとき（オフラインから戻ったとき）も読み直す
    const onOnline = () => void loadFlow(id);
    window.addEventListener('online', onOnline);
    return () => {
      off();
      window.removeEventListener('online', onOnline);
    };
  }, [session, loggedIn, id]);
  useEffect(() => {
    if (!polling || !id) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void loadFlow(id);
    }, 60_000);
    return () => clearInterval(timer);
  }, [polling, id]);
  return null;
}

export function App() {
  return (
    <HashRouter>
      <AuthWatcher />
      <FlowSync />
      <AppRoutes />
      <DialogHost />
      <Toast />
    </HashRouter>
  );
}
