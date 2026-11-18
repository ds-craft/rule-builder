// テスト用：node:sqlite で D1 と Durable Object の SqlStorage の代わりを作る。
// D1 は migrations/*.sql をすべて適用した状態で始める。
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SqlLike } from '../../src/room/store.ts';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

const toInput = (v: unknown): SQLInputValue => {
  if (v === undefined) throw new Error('D1_TYPE_ERROR: undefined は bind できません');
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as SQLInputValue;
};

class Statement {
  constructor(
    readonly db: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params.map(toInput));
  }
  async first<T>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as
      Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? (row[column] ?? null) : { ...row }) as T;
  }
  async all<T>() {
    const rows = this.db
      .prepare(this.sql)
      .all(...this.params)
      .map((r) => ({ ...r }));
    return { results: rows as T[], success: true, meta: { changes: 0 } };
  }
  async run() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { success: true, results: [], meta: { changes: Number(info.changes) } };
  }
}

export function createD1() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  return {
    raw: db,
    prepare: (sql: string) => new Statement(db, sql),
  };
}

export function createSqlStorage(db = new DatabaseSync(':memory:')) {
  const sql: SqlLike = {
    exec(query, ...bindings) {
      const stmt = db.prepare(query);
      const params = bindings.map(toInput);
      if (/^\s*(SELECT|WITH)/i.test(query)) {
        const rows = stmt.all(...params).map((r) => ({ ...r }));
        return { toArray: () => rows };
      }
      stmt.run(...params);
      return { toArray: () => [] };
    },
  };
  const transaction = (f: () => void) => {
    db.exec('BEGIN');
    try {
      f();
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  return { db, sql, transaction };
}
