// サーバー（Worker）が確かめた運営者を、ProposalRoom への接続に渡す。
// Durable Object には Worker からしか届かないので、このヘッダーは Worker が付けたものだけになる
// （Worker は画面から届いた同名のヘッダーを上書きする）。日本語の名前を含むため URI エンコードする。

export const USER_HEADER = 'x-rb-user';

export type RoomUser = {
  uid: string;
  name: string;
  avatar: string | null;
  /** 運営者かどうかを判定した時刻（ms）。15分を過ぎた接続は切って、つなぎ直しのときに判定し直す */
  chk: number;
  /** 読み取り専用で接続する（届いた更新は捨てる） */
  readOnly: boolean;
};

export const encodeUser = (u: RoomUser) => encodeURIComponent(JSON.stringify(u));

export function decodeUser(value: string | null): RoomUser | null {
  if (!value) return null;
  try {
    const u = JSON.parse(decodeURIComponent(value)) as Partial<RoomUser>;
    if (typeof u.uid !== 'string' || typeof u.chk !== 'number') return null;
    return {
      uid: u.uid,
      name: String(u.name ?? ''),
      avatar: typeof u.avatar === 'string' ? u.avatar : null,
      chk: u.chk,
      readOnly: u.readOnly === true,
    };
  } catch {
    return null;
  }
}
