// タイトルバー：アプリ名、中央のタイトル（エディタではルールの切り替えボタン）、保存状態、
// 編集中のほかの運営者（押すとその人のカーソルへ移動）、共有、自分のアイコン（アカウント・ログアウト）。

import { formatRuleNumber } from '@rule-builder/core';
import { Cloud, CloudOff, LogOut, Share2, User } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { logout, useAuth } from '../../state/auth.ts';
import type { Peer, SaveState } from '../../state/session.ts';
import { useApp } from '../../state/store.ts';
import { Avatar } from '../common/Avatar.tsx';
import { copyText, openDialog } from '../common/dialogs.tsx';
import { Menu } from '../common/Menu.tsx';

export type { SaveState };

const SAVE_LABEL: Record<SaveState, string> = {
  saved: '保存済み',
  saving: '保存中…',
  offline: 'オフライン（この端末に控えています）',
};

const SAVE_TIP: Record<SaveState, string> = {
  saved: 'サーバーに自動で保存されます',
  saving: 'サーバーに自動で保存されます',
  offline: 'つながったら、控えた変更をサーバーに送ります',
};

export function TitleBar({ center, save = null }: { center: ReactNode; save?: SaveState | null }) {
  return (
    <header className="titlebar">
      <Link className="brand" to="/file/home" title="ホーム">
        rule-builder
      </Link>
      <span className="doc-title">{center}</span>
      {save && (
        <span
          className={'save' + (save === 'offline' ? ' offline' : '')}
          aria-live="polite"
          title={SAVE_TIP[save]}
        >
          {save === 'offline' ? (
            <CloudOff className="i" aria-hidden="true" />
          ) : (
            <Cloud className="i" aria-hidden="true" />
          )}
          <span className="lbl">{SAVE_LABEL[save]}</span>
        </span>
      )}
      <TitleRight />
    </header>
  );
}

/** 改正案の共有リンク（運営者どうしで送り合う。開くにはログインが要る） */
export const shareUrl = (id: string) =>
  `${location.origin}${location.pathname}#/p/${encodeURIComponent(id)}`;

function TitleRight() {
  const user = useAuth((s) => s.user);
  const session = useApp((s) => s.session);
  const peers = useApp((s) => s.peers);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <>
      {peers.length > 0 && (
        <span className="peers" aria-label="この改正案を開いている人">
          {peers.map((p) => (
            <button
              key={p.uid}
              type="button"
              title={`${p.name}（押すとカーソルの位置へ移動）`}
              aria-label={`${p.name}のカーソルへ移動`}
              onClick={() => jumpToPeer(p, (to) => void navigate(to))}
            >
              <Avatar id={p.uid} name={p.name} url={p.avatar} />
            </button>
          ))}
        </span>
      )}
      {session && (
        <button type="button" className="share" title="この改正案を共有" onClick={openShareDialog}>
          <Share2 className="i" aria-hidden="true" />
          <span>共有</span>
        </button>
      )}
      <button
        type="button"
        className="me"
        title={`アカウント：${user.name}`}
        aria-label={`アカウント：${user.name}`}
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu(menu ? null : { x: r.right - 200, y: r.bottom + 4 });
        }}
      >
        <Avatar id={user.id} name={user.name} url={user.avatarUrl} />
      </button>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { type: 'heading', text: `${user.name}（運営者）` },
            {
              type: 'custom',
              key: 'account',
              node: (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    void navigate('/file/account');
                  }}
                >
                  <User className="i" aria-hidden="true" />
                  <span>アカウント</span>
                </button>
              ),
            },
            {
              type: 'custom',
              key: 'logout',
              node: (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    void logout();
                  }}
                >
                  <LogOut className="i" aria-hidden="true" />
                  <span>ログアウト</span>
                </button>
              ),
            },
          ]}
        />
      )}
    </>
  );
}

/** ほかの人のカーソルへ移動する（別のルールを開いていれば、そのルールに切り替えてから） */
export function jumpToPeer(peer: Peer, go: (to: string) => void) {
  const { entries, current, showToast } = useApp.getState();
  const i = entries.findIndex((e) => e.key === peer.entryKey);
  const proposal = useApp.getState().proposal;
  const title = proposal ? formatRuleNumber(proposal.amendingNumber) || '（番号なし）' : '';
  if (i < 0) {
    showToast(`${peer.name}は「${title} の改正案」を開いています`);
    return;
  }
  const onEditor = location.hash.startsWith('#/edit/');
  if (!onEditor || i !== current) go(`/edit/${i}`);
  // 切り替えた紙面が描かれてから、カーソルの札を探す
  let tries = 0;
  const find = () => {
    const el = document.querySelector<HTMLElement>(
      `.collaboration-carets__caret[data-uid="${CSS.escape(peer.uid)}"]`,
    );
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
      return;
    }
    if (++tries < 20) setTimeout(find, 100);
    else showToast(`${peer.name}のカーソルは、いま「${entries[i]!.doc.meta.name}」の外にあります`);
  };
  setTimeout(find, 50);
}

function openShareDialog() {
  const { session, proposal, showToast } = useApp.getState();
  const user = useAuth.getState().user;
  if (!session || !proposal || !user) return;
  const url = shareUrl(session.id);
  const title = formatRuleNumber(proposal.amendingNumber) || '（番号なし）';
  openDialog({
    title: `「${title} の改正案」を共有`,
    body: (
      <>
        <p style={{ marginTop: 0 }}>
          このリンクを Discord などで運営者に送ると、同じ改正案を開いて一緒に編集できます。
        </p>
        <div className="share-link">
          <input
            type="text"
            readOnly
            value={url}
            aria-label="改正案のリンク"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="btn primary"
            onClick={() => void copyText(url, showToast)}
          >
            リンクをコピー
          </button>
        </div>
        <h4 style={{ margin: '14px 0 0' }}>誰が見られるか</h4>
        <ul className="share-who">
          <li>
            <b>運営者</b>：Discord
            でログインすれば、全員が開いて編集できます。「開く」の「運営の改正案」にも出ています。
          </li>
          <li>
            <b>参加者・そのほかの人</b>
            ：このリンクでは見られません。発議すると、ログインなしで見られる公開リンクを発行します。
          </li>
        </ul>
        <h4 style={{ margin: '14px 0 0' }}>いま開いている人</h4>
        <SharePeople />
      </>
    ),
    actions: [{ label: '閉じる', primary: true }],
  });
}

/** 共有ダイアログの「いま開いている人」（ダイアログを開いている間の出入りも反映する） */
function SharePeople() {
  const user = useAuth((s) => s.user);
  const peers = useApp((s) => s.peers);
  if (!user) return null;
  return (
    <ul className="people">
      <li>
        <Avatar id={user.id} name={user.name} url={user.avatarUrl} size="sm" />
        {user.name}（あなた）
      </li>
      {peers.map((p) => (
        <li key={p.uid}>
          <Avatar id={p.uid} name={p.name} url={p.avatar} size="sm" />
          {p.name}
        </li>
      ))}
    </ul>
  );
}
