import { STATUS_LABEL as CORE_STATUS_LABEL } from '@rule-builder/core';
import { formatRuleNumber, isoToWareki, type AmendingNumber } from '@rule-builder/core';
import { CloudOff, FileText, Info, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { errorMessage, fetchRuleList } from '../../github/rules.ts';
import {
  ApiError,
  fetchProposals,
  loginUrl,
  OfflineError,
  type ServerProposal,
} from '../../server/api.ts';
import { localOnlyProposals, migrateToServer, openProposal } from '../../state/actions.ts';
import { signedOut, useAuth, type LoginNotice } from '../../state/auth.ts';
import { useApp } from '../../state/store.ts';
import { listRecent, type RecentProposal } from '../../storage/recent.ts';
import { Avatar } from '../common/Avatar.tsx';
import { openDialog } from '../common/dialogs.tsx';
import { openNewProposalDialog } from './NewProposalDialog.tsx';
import { TemplateList, type TemplateKey } from './templates.tsx';

export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 11 ? 'おはようございます' : h < 18 ? 'こんにちは' : 'こんばんは';
}

/** 更新日時の表示（今日なら時刻、それ以外は日付） */
export function updatedLabel(iso: string, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay ? `今日 ${hm}` : `${d.getMonth() + 1}月${d.getDate()}日`;
}

const OP_LABEL = { create: '新規', amend: '改正', repeal: '廃止' } as const;

export const proposalSummary = (p: Pick<RecentProposal, 'rules'>) =>
  p.rules
    .map((r) => (r.op === 'create' ? r.name || '（名称未設定）' : `${r.name}（${OP_LABEL[r.op]}）`))
    .join('、') || 'ルールなし';

/** 改正案の状態の表示名（packages/core の STATUS_LABEL） */
export const STATUS_LABEL: Record<string, string> = CORE_STATUS_LABEL;

const numberLabel = (a: ServerProposal['amendingNumber'] | AmendingNumber) =>
  formatRuleNumber(a as AmendingNumber) || '（番号なし）';

/** 改正案を開いて、最初のルール（なければ改正案の情報）へ */
export function useOpenProposal() {
  const navigate = useNavigate();
  const showToast = useApp((s) => s.showToast);
  return async (id: string) => {
    try {
      await openProposal(id);
      const { entries } = useApp.getState();
      void navigate(entries.length ? '/edit/0' : '/file/info');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '改正案を開けませんでした');
    }
  };
}

/** この端末に控えてある改正案（オフラインのときに開ける） */
export function useRecent(): RecentProposal[] | null {
  const [list, setList] = useState<RecentProposal[] | null>(null);
  const session = useApp((s) => s.session);
  const proposal = useApp((s) => s.proposal);
  useEffect(() => {
    void listRecent().then(setList);
  }, [session, proposal?.updatedAt]);
  return list;
}

export function RecentList() {
  const list = useRecent();
  const openId = useApp((s) => s.session?.id);
  const open = useOpenProposal();
  if (!list) return <p className="muted">読み込み中…</p>;
  if (!list.length) return <p className="muted">この端末に控えている改正案はありません。</p>;
  return (
    <table className="list files">
      <thead>
        <tr>
          <th>改正案</th>
          <th className="hide-mobile">含まれるルール</th>
          <th className="hide-mobile">施行日</th>
          <th>更新</th>
        </tr>
      </thead>
      <tbody>
        {list.map((p) => (
          <tr
            key={p.id}
            className="row"
            tabIndex={0}
            onClick={() => void open(p.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void open(p.id);
            }}
          >
            <td>
              <FileText className="i" aria-hidden="true" /> <b>{numberLabel(p.amendingNumber)}</b>
              {p.id === openId && <span className="tag amend">開いています</span>}
              <div className="muted only-mobile">{proposalSummary(p)}</div>
            </td>
            <td className="hide-mobile">{proposalSummary(p)}</td>
            <td className="hide-mobile">
              {p.enforcementDate ? isoToWareki(p.enforcementDate) : '未設定'}
            </td>
            <td>{updatedLabel(p.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 運営の改正案（サーバー上の全件） */
export function useServerProposals() {
  const [state, setState] = useState<{
    list: ServerProposal[] | null;
    error: unknown;
  }>({ list: null, error: null });
  const proposal = useApp((s) => s.proposal);
  const load = useCallback(() => {
    fetchProposals().then(
      (list) => setState({ list, error: null }),
      (error: unknown) => {
        if (error instanceof ApiError && error.loggedOut)
          signedOut(error.code === 'forbidden' ? 'revoked' : 'logout');
        setState((s) => ({ list: s.list, error }));
      },
    );
  }, []);
  useEffect(load, [load, proposal?.updatedAt]);
  // 開いている改正案がまだ一覧にない（作った直後など）ときは、少し待って読み直す
  const openId = useApp((s) => s.session?.id);
  const missing = !!openId && !!state.list && !state.list.some((p) => p.id === openId);
  useEffect(() => {
    if (!missing) return;
    const t = setTimeout(load, 5000);
    return () => clearTimeout(t);
  }, [missing, state.list, load]);
  // サーバーの一覧は編集から少し遅れて更新されるので、画面に戻ったときと30秒ごとに読み直す
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === 'visible') load();
    };
    const timer = setInterval(again, 30_000);
    document.addEventListener('visibilitychange', again);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', again);
    };
  }, [load]);
  return { ...state, reload: load };
}

export function ServerList({
  limit = Infinity,
  status = 'all',
}: {
  limit?: number;
  status?: string;
}) {
  const { list, error, reload } = useServerProposals();
  const me = useAuth((s) => s.user?.id);
  const openId = useApp((s) => s.session?.id);
  const open = useOpenProposal();
  if (error && !list) {
    if (error instanceof OfflineError) {
      return (
        <>
          <div className="notice warn" role="status">
            <CloudOff className="i" aria-hidden="true" />
            <span className="grow">
              サーバーにつながらないため、運営の改正案を読み込めません。この端末に控えている改正案は開けます（編集はつながったときにサーバーへ送ります）。
            </span>
            <button type="button" className="btn small" onClick={reload}>
              再試行
            </button>
          </div>
          <RecentList />
        </>
      );
    }
    return (
      <div className="issue error">
        <span className="lv">エラー</span>
        {errorMessage(error)}
        <div className="acts">
          <button type="button" className="btn small" onClick={reload}>
            再試行
          </button>
        </div>
      </div>
    );
  }
  if (!list) return <p className="muted">読み込み中…</p>;
  const rows = list.filter((p) => status === 'all' || p.status === status).slice(0, limit);
  if (!rows.length)
    return (
      <p className="muted">
        {list.length ? 'この状態の改正案はありません。' : 'まだ改正案はありません。'}
      </p>
    );
  return (
    <table className="list files">
      <thead>
        <tr>
          <th>改正案</th>
          <th className="hide-mobile">含まれるルール</th>
          <th className="hide-mobile">施行日</th>
          <th className="hide-mobile">状態</th>
          <th>最終更新</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr
            key={p.id}
            className="row"
            tabIndex={0}
            onClick={() => void open(p.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void open(p.id);
            }}
          >
            <td>
              <FileText className="i" aria-hidden="true" /> <b>{numberLabel(p.amendingNumber)}</b>
              {p.id === openId && <span className="tag amend">開いています</span>}
              <div className="muted only-mobile">{proposalSummary(p)}</div>
            </td>
            <td className="hide-mobile">{proposalSummary(p)}</td>
            <td className="hide-mobile">
              {p.enforcementDate ? isoToWareki(p.enforcementDate) : '未設定'}
            </td>
            <td className="hide-mobile">
              <span className="tag">{STATUS_LABEL[p.status] ?? p.status}</span>
            </td>
            <td>
              <span className="who">
                <Avatar
                  id={p.updatedBy.id}
                  name={p.updatedBy.name}
                  url={p.updatedBy.avatarUrl}
                  size="sm"
                />
                <span>
                  {p.updatedBy.name || '（不明）'}
                  {p.updatedBy.id === me ? '（あなた）' : ''}
                  <br />
                  <span className="muted">{updatedLabel(p.updatedAt)}</span>
                </span>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** テンプレートを選んだとき：既存のルールの改正なら先に公開中のルールの一覧を取る */
export function useTemplatePicker() {
  const navigate = useNavigate();
  const showToast = useApp((s) => s.showToast);
  return (tpl: TemplateKey) => {
    const go = (to: string) => void navigate(to);
    if (tpl !== 'amend') return openNewProposalDialog(tpl, go);
    fetchRuleList().then(
      (list) => openNewProposalDialog(tpl, go, list.rules),
      (e: unknown) => showToast(errorMessage(e)),
    );
  };
}

const LOGIN_NOTICE: Record<LoginNotice, ['err' | 'warn' | 'info', string]> = {
  denied: [
    'err',
    '運営者のロールが確認できなかったため、ログインできませんでした。rule-builder にログインできるのは「運営」ロールを持つ人だけです。',
  ],
  cancelled: ['info', 'ログインを取り消しました。'],
  error: ['err', 'ログインできませんでした。しばらくしてからやり直してください。'],
  logout: ['info', 'ログアウトしました。'],
  revoked: [
    'warn',
    '運営者のロールが確認できなくなったため、ログアウトしました。編集中の内容はサーバーに保存されています。',
  ],
  share: ['info', '共有された改正案を開くには、ログインしてください。'],
};

const isNotice = (v: string | null): v is LoginNotice => !!v && v in LOGIN_NOTICE;

export function Notice({
  kind,
  children,
}: {
  kind: 'err' | 'warn' | 'info';
  children: React.ReactNode;
}) {
  const Icon = kind === 'info' ? Info : TriangleAlert;
  return (
    <div className={`notice ${kind}`} role="status">
      <Icon className="i" aria-hidden="true" />
      <span className="grow">{children}</span>
    </div>
  );
}

function useOnline() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** ログインしていないときのホーム：Discord でログインするだけ */
function LoginHome() {
  const [params, setParams] = useSearchParams();
  const stored = useAuth((s) => s.notice);
  const returnTo = useAuth((s) => s.returnTo);
  const online = useOnline();
  // サーバーから戻ったときの結果（#/file/home?login=denied など）を知らせに移し、URL からは消す
  const fromUrl = params.get('login');
  useEffect(() => {
    if (isNotice(fromUrl)) {
      useAuth.setState({ notice: fromUrl });
      setParams({}, { replace: true });
    }
  }, [fromUrl, setParams]);
  const notice = isNotice(fromUrl) ? fromUrl : stored;
  const n = notice ? LOGIN_NOTICE[notice] : null;
  return (
    <>
      <h2>rule-builder</h2>
      {n && <Notice kind={n[0]}>{n[1]}</Notice>}
      <section className="login">
        <p style={{ marginTop: 0 }}>ルールの改正案を、運営者どうしで同時に編集できます。</p>
        <button
          type="button"
          className="btn discord"
          disabled={!online}
          onClick={() => {
            useAuth.setState({ notice: null });
            location.href = loginUrl(returnTo ?? '/file/home');
          }}
        >
          Discord でログイン
        </button>
        {!online && <p className="muted">オフラインのためログインできません。</p>}
        <p className="muted">
          ログインできるのは「運営」ロールを持つ人だけです。発議済みの改正案は、ログインしなくても公開リンクから見られます。
        </p>
      </section>
    </>
  );
}

const askedKey = (uid: string) => `rule-builder:migrate-asked:${uid}`;

function wasAsked(uid: string): boolean {
  try {
    return localStorage.getItem(askedKey(uid)) === '1';
  } catch {
    return false;
  }
}

function markAsked(uid: string) {
  try {
    localStorage.setItem(askedKey(uid), '1');
  } catch {
    // 覚えられなければ、次にホームを開いたときにもう一度聞く
  }
}

/** このブラウザだけにある改正案をサーバーに移すか聞く */
export function askMigrate(list: RecentProposal[], done: () => void) {
  const { showToast } = useApp.getState();
  openDialog({
    title: 'サーバーに移しますか',
    body: (
      <>
        <p style={{ marginTop: 0 }}>
          このブラウザだけに保存されている改正案が <b>{list.length}件</b>{' '}
          あります。サーバーに移すと、ほかの運営者も開いて一緒に編集できるようになります。
        </p>
        <table className="list files">
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>
                  <FileText className="i" aria-hidden="true" />{' '}
                  <b>{numberLabel(p.amendingNumber)}</b>
                  <div className="muted">
                    {proposalSummary(p)}・更新 {updatedLabel(p.updatedAt)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          移したあとも、このブラウザに控えは残ります。「あとで」を選んだ場合は、ホームからいつでも移せます。
        </p>
      </>
    ),
    actions: [
      { label: 'あとで' },
      {
        label: 'サーバーに移す',
        primary: true,
        run: () => {
          showToast('サーバーに移しています…');
          migrateToServer(list.map((p) => p.id)).then(
            (n) => {
              showToast(
                n === list.length
                  ? `${n}件の改正案をサーバーに移しました`
                  : `${list.length}件のうち${n}件を移しました。残りは通信の状態を確かめてから、もう一度移してください`,
              );
              done();
            },
            () => {
              showToast('サーバーに移せませんでした。通信の状態を確かめてください');
              done();
            },
          );
        },
      },
    ],
  });
}

/** このブラウザだけにある改正案（サーバーの一覧が読めないときは調べない） */
function useLocalOnly() {
  const [list, setList] = useState<RecentProposal[]>([]);
  const [seq, setSeq] = useState(0);
  useEffect(() => {
    localOnlyProposals().then(setList, () => setList([]));
  }, [seq]);
  return { list, reload: () => setSeq((n) => n + 1) };
}

export function HomePage() {
  const status = useAuth((s) => s.status);
  if (status === 'loading') return <p className="muted">読み込み中…</p>;
  if (status !== 'user') return <LoginHome />;
  return <UserHome />;
}

function UserHome() {
  const pick = useTemplatePicker();
  const user = useAuth((s) => s.user)!;
  const offline = useAuth((s) => s.offline);
  const local = useLocalOnly();
  // 初めてログインしたとき（このブラウザで初めて）に、ブラウザだけにある改正案を移すか聞く
  useEffect(() => {
    if (!local.list.length || wasAsked(user.id)) return;
    markAsked(user.id);
    askMigrate(local.list, local.reload);
    // 一覧が届いたときに一度だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.list, user.id]);
  return (
    <>
      <h2>
        {greeting()}、{user.name}さん
      </h2>
      {offline && (
        <Notice kind="warn">
          サーバーにつながらないため、この端末に控えている内容で開いています。つながったら、控えた変更をサーバーに送ります。
        </Notice>
      )}
      {local.list.length > 0 && (
        <div className="notice warn">
          <TriangleAlert className="i" aria-hidden="true" />
          <span className="grow">
            このブラウザだけに保存されている改正案が {local.list.length}件
            あります。サーバーに移すと、ほかの運営者も開けるようになります。
          </span>
          <button
            type="button"
            className="btn small primary"
            onClick={() => askMigrate(local.list, local.reload)}
          >
            サーバーに移す…
          </button>
        </div>
      )}
      <h3 className="bs-h">新規</h3>
      <TemplateList keys={['create-ルール', 'amend', 'blank']} onPick={pick} />
      <p>
        <Link to="/file/new">その他の種類 →</Link>
      </p>
      <h3 className="bs-h">運営の改正案</h3>
      <ServerList limit={5} />
      <p className="muted">
        改正案はサーバーに自動で保存され、運営者全員が開けます。すべての改正案は「
        <Link to="/file/open">開く</Link>」から探せます。
      </p>
    </>
  );
}
