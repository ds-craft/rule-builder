// 改正案の Yjs 文書の保存（Durable Object の SQLite）。
// 届いた更新を1件ずつ追記し、COMPACT_AT 件たまったら文書全体の1件にまとめ直す。
// SQLite の1行の上限（2MB）を超えないよう、大きな更新は CHUNK バイトごとに分けて置く。

/** Durable Object の SqlStorage のうち、ここで使う部分（テストでは node:sqlite で代用する） */
export interface SqlLike {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
}

export const COMPACT_AT = 200;
export const CHUNK = 512 * 1024;

const toBytes = (v: unknown): Uint8Array =>
  v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer);

export class RoomStore {
  private readonly sql: SqlLike;
  private readonly transaction: (f: () => void) => void;
  private nextSeq = 1;
  private rows = 0;

  constructor(sql: SqlLike, transaction: (f: () => void) => void) {
    this.sql = sql;
    this.transaction = transaction;
    sql.exec(`CREATE TABLE IF NOT EXISTS doc_updates (
      seq INTEGER NOT NULL,
      part INTEGER NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (seq, part)
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS room_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  }

  /** 保存してある更新を古い順に返す */
  load(): Uint8Array[] {
    const out: Uint8Array[] = [];
    let seq = -1;
    let parts: Uint8Array[] = [];
    const flush = () => {
      if (parts.length === 0) return;
      if (parts.length === 1) out.push(parts[0]!);
      else {
        const total = parts.reduce((n, p) => n + p.length, 0);
        const merged = new Uint8Array(total);
        let at = 0;
        for (const p of parts) {
          merged.set(p, at);
          at += p.length;
        }
        out.push(merged);
      }
      parts = [];
    };
    for (const row of this.sql
      .exec('SELECT seq, data FROM doc_updates ORDER BY seq, part')
      .toArray()) {
      const s = Number(row.seq);
      if (s !== seq) {
        flush();
        seq = s;
      }
      parts.push(toBytes(row.data));
    }
    flush();
    this.rows = out.length;
    this.nextSeq = seq + 1 > 0 ? seq + 1 : 1;
    return out;
  }

  private insert(seq: number, update: Uint8Array) {
    for (let at = 0, part = 0; at < update.length || part === 0; at += CHUNK, part++) {
      const piece = update.slice(at, at + CHUNK);
      this.sql.exec(
        'INSERT INTO doc_updates (seq, part, data) VALUES (?, ?, ?)',
        seq,
        part,
        piece.buffer,
      );
    }
  }

  /** 更新を1件足す。戻り値はたまっている件数 */
  append(update: Uint8Array): number {
    const seq = this.nextSeq++;
    this.transaction(() => this.insert(seq, update));
    this.rows++;
    return this.rows;
  }

  /** 文書全体（Y.encodeStateAsUpdate）の1件に置き換える */
  replaceAll(state: Uint8Array) {
    this.transaction(() => {
      this.sql.exec('DELETE FROM doc_updates');
      this.insert(1, state);
    });
    this.nextSeq = 2;
    this.rows = 1;
  }

  get count(): number {
    return this.rows;
  }

  getMeta(key: string): string | null {
    const row = this.sql.exec('SELECT value FROM room_meta WHERE key = ?', key).toArray()[0];
    return row ? String(row.value) : null;
  }

  setMeta(key: string, value: string) {
    this.sql.exec(
      'INSERT INTO room_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }
}
