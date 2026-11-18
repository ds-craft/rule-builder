// アカウント：ログイン中の運営者・ログアウト・このブラウザの控え。

import { LogOut } from 'lucide-react';
import { logout, useAuth } from '../../state/auth.ts';
import { Avatar } from '../common/Avatar.tsx';

export function AccountPage() {
  const user = useAuth((s) => s.user);
  const offline = useAuth((s) => s.offline);
  if (!user) return null;
  return (
    <>
      <h2>アカウント</h2>
      <section className="prop-card" style={{ maxWidth: 640 }}>
        <div className="acct">
          <Avatar id={user.id} name={user.name} url={user.avatarUrl} size="lg" />
          <div>
            <b style={{ fontSize: 17 }}>{user.name}</b> <span className="tag amend">運営者</span>
            {user.onLeave && <span className="tag">休止中</span>}
            <div className="muted">Discord でログイン中（ユーザー ID：{user.id}）</div>
          </div>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          運営者かどうかは OpsBot
          で確かめています（15分ごとに確かめ直します）。運営ロールが外れると、15分以内に編集できなくなり、ログアウトします。ログインは7日間有効です。
          {offline &&
            ' いまはサーバーにつながらないため、この端末で最後に確かめた内容を出しています。'}
        </p>
      </section>
      <div className="row-actions" style={{ marginTop: 16 }}>
        <button type="button" className="btn" onClick={() => void logout()}>
          <LogOut className="i" aria-hidden="true" />
          ログアウト
        </button>
      </div>
      <h3 className="bs-h">このブラウザ</h3>
      <p style={{ maxWidth: 640 }}>
        開いた改正案は、このブラウザにも控えを置きます。通信が切れている間の編集は控えに残し、つながったときにサーバーへ送ります。
      </p>
    </>
  );
}
