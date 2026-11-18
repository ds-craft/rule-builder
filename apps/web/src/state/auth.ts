// ログイン中の運営者（F-40）。起動時に /auth/me で確かめる。
// 通信が切れているときは、この端末で最後にログインしていた人として控えの改正案を編集できるようにする
// （つながったときにサーバーが判定し直し、運営者でなくなっていればログアウトする）。

import { create } from 'zustand';
import { ApiError, fetchMe, logoutRequest, OfflineError, type Me } from '../server/api.ts';

/** ホームに出す知らせ（ログインの結果・ログアウトの理由） */
export type LoginNotice = 'denied' | 'cancelled' | 'error' | 'logout' | 'revoked' | 'share';

export type AuthState = {
  status: 'loading' | 'anon' | 'user';
  user: Me | null;
  /** サーバーに確かめられず、この端末の控えでログイン中として扱っている */
  offline: boolean;
  notice: LoginNotice | null;
  /** ログインの後に戻る場所（共有された改正案のリンクなど） */
  returnTo: string | null;
};

const CACHE_KEY = 'rule-builder:last-user';

function readCache(): Me | null {
  try {
    const v = localStorage.getItem(CACHE_KEY);
    return v ? (JSON.parse(v) as Me) : null;
  } catch {
    return null;
  }
}

function writeCache(me: Me | null) {
  try {
    if (me) localStorage.setItem(CACHE_KEY, JSON.stringify(me));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // 保存できなくても、このページを開いている間は使える
  }
}

export const useAuth = create<AuthState>()(() => ({
  status: 'loading',
  user: null,
  offline: false,
  notice: null,
  returnTo: null,
}));

/** 運営者かどうかをサーバーに確かめる。ログインしていなければ null */
export async function loadMe(): Promise<Me | null> {
  try {
    const me = await fetchMe();
    writeCache(me);
    useAuth.setState({ status: 'user', user: me, offline: false });
    return me;
  } catch (e) {
    if (e instanceof OfflineError) {
      const cached = readCache();
      useAuth.setState(
        cached
          ? { status: 'user', user: cached, offline: true }
          : { status: 'anon', user: null, offline: true },
      );
      return cached;
    }
    if (e instanceof ApiError && e.loggedOut) {
      const was = useAuth.getState().status === 'user';
      writeCache(null);
      useAuth.setState({
        status: 'anon',
        user: null,
        offline: false,
        notice: was && e.code === 'forbidden' ? 'revoked' : useAuth.getState().notice,
      });
      return null;
    }
    // OpsBot に問い合わせられないなど：ログイン中の扱いは変えない
    const s = useAuth.getState();
    if (s.status === 'loading')
      useAuth.setState({ status: readCache() ? 'user' : 'anon', user: readCache() });
    return useAuth.getState().user;
  }
}

export async function logout(notice: LoginNotice = 'logout') {
  writeCache(null);
  useAuth.setState({ status: 'anon', user: null, offline: false, notice });
  await logoutRequest().catch(() => {});
}

/** ログインを断られた・運営ロールが外れたとき（サーバーがセッションを消している） */
export function signedOut(notice: LoginNotice) {
  writeCache(null);
  useAuth.setState({ status: 'anon', user: null, offline: false, notice });
}

const COLORS = [
  '#3460fb',
  '#c2410c',
  '#197a4b',
  '#8b3fc7',
  '#b42318',
  '#0e7490',
  '#a16207',
  '#be185d',
];

/** 人ごとの色（カーソル・アイコン）。ID から決めるので、どの端末でも同じ色になる */
export function userColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length]!;
}
