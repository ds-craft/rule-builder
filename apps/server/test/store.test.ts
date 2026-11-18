import { addEntry, createProposalDoc, readProposal } from '@rule-builder/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CHUNK, COMPACT_AT, RoomStore } from '../src/room/store.ts';
import { createSqlStorage } from './helpers/sqlite.ts';

const AMEND = { kind: 'ルール' as const, year: 8, number: 4 };

function setup() {
  const s = createSqlStorage();
  return { ...s, store: new RoomStore(s.sql, s.transaction) };
}

/** 保存した更新から文書を作り直す */
function restore(store: RoomStore) {
  const doc = new Y.Doc();
  for (const u of store.load()) Y.applyUpdate(doc, u);
  return doc;
}

describe('RoomStore', () => {
  it('追記した更新から文書を作り直せる', () => {
    const { store } = setup();
    const doc = createProposalDoc({
      id: 'p1',
      amendingNumber: AMEND,
      enforcementDate: '2026-12-01',
    });
    store.append(Y.encodeStateAsUpdate(doc));
    doc.on('update', (u: Uint8Array) => store.append(u));
    doc.getMap('meta').set('summary', '説明');
    doc.getMap('meta').set('enforcementDate', '2027-01-01');
    expect(store.count).toBe(3);

    const again = new RoomStore(setup().sql, () => {});
    expect(again.count).toBe(0);
    const back = restore(store);
    expect(readProposal(back)).toMatchObject({
      id: 'p1',
      summary: '説明',
      enforcementDate: '2027-01-01',
    });
  });

  it('まとめ直しても内容は変わらず、件数が1になる', () => {
    const { store } = setup();
    const doc = createProposalDoc({ id: 'p1', amendingNumber: AMEND, enforcementDate: '' });
    doc.on('update', (u: Uint8Array) => store.append(u));
    store.append(Y.encodeStateAsUpdate(doc));
    for (let i = 0; i < COMPACT_AT; i++) doc.getMap('meta').set('summary', `説明${i}`);
    store.replaceAll(Y.encodeStateAsUpdate(doc));
    expect(store.count).toBe(1);
    doc.getMap('meta').set('summary', '最後');
    expect(store.count).toBe(2);
    expect(readProposal(restore(store)).summary).toBe('最後');
  });

  it('大きな更新は分けて置き、読むときにつなげる', () => {
    const { store, db } = setup();
    const doc = createProposalDoc({ id: 'p1', amendingNumber: AMEND, enforcementDate: '' });
    const long = '第一条　' + 'あ'.repeat(CHUNK); // UTF-8 で CHUNK の3倍ほど
    addEntry(doc, {
      op: 'amend',
      ruleId: 'R0401001',
      baseSha: 'x',
      baseMarkdown: `---\nname: 長いルール\n---\n\n${long}\n`,
    });
    store.append(Y.encodeStateAsUpdate(doc));
    const parts = db.prepare('SELECT COUNT(*) AS n FROM doc_updates').get() as { n: number };
    expect(parts.n).toBeGreaterThan(1);
    expect(readProposal(restore(store)).entries[0]).toMatchObject({
      op: 'amend',
      ruleId: 'R0401001',
    });
  });

  it('改正案の状態などを room_meta に置ける', () => {
    const { store } = setup();
    expect(store.getMeta('status')).toBeNull();
    store.setMeta('status', 'draft');
    store.setMeta('status', 'deliberation');
    expect(store.getMeta('status')).toBe('deliberation');
  });
});
