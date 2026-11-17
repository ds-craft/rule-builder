// 最近使った改正案の一覧（このブラウザの IndexedDB）。改正案の本文は y-indexeddb に改正案ごとに保存する。
// IndexedDB が使えない環境（プライベートブラウズの一部など）では、このページを開いている間だけ覚える。

import type { AmendingNumber } from '@rule-builder/core';

export type RecentProposal = {
  id: string;
  amendingNumber: AmendingNumber;
  enforcementDate: string;
  /** 含まれるルールの名前（制定・改正・廃止の別つき） */
  rules: { name: string; op: 'create' | 'amend' | 'repeal' }[];
  updatedAt: string;
};

const DB_NAME = 'rule-builder';
const STORE = 'recent-proposals';

let memory = new Map<string, RecentProposal>();

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function run<T>(
  mode: IDBTransactionMode,
  f: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = f(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/** 更新日時の新しい順 */
export async function listRecent(): Promise<RecentProposal[]> {
  const all = (await run<RecentProposal[]>('readonly', (s) => s.getAll())) ?? [...memory.values()];
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function putRecent(p: RecentProposal): Promise<void> {
  memory.set(p.id, p);
  await run('readwrite', (s) => s.put(p));
}

export async function deleteRecent(id: string): Promise<void> {
  memory.delete(id);
  await run('readwrite', (s) => s.delete(id));
}

/** テスト用 */
export function resetRecentMemory() {
  memory = new Map();
}
