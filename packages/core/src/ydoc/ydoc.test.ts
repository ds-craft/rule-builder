import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { articleChanges } from '../compare/changes.ts';
import { parseRule } from '../markdown/parse.ts';
import { serializeRule } from '../markdown/serialize.ts';
import { decodeDraft, encodeDraft } from './draftFile.ts';
import { bodyFromPM, bodyToPM } from './pmJson.ts';
import {
  addEntry,
  createProposalDoc,
  entryFragment,
  readEntries,
  readEntryDoc,
  readProposal,
  readProposalMeta,
  removeEntry,
  updateProposalMeta,
  updateRuleMeta,
} from './proposal.ts';
import { readFragmentJSON, writeFragmentJSON } from './yxml.ts';

const FIXTURES = join(import.meta.dirname, '../../../../test/fixtures/rules');
function listMarkdown(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return listMarkdown(p);
    return f.endsWith('.md') && f !== 'SOURCE.md' ? [p] : [];
  });
}
const R0801003 = readFileSync(join(FIXTURES, 'rules/R0801003.md'), 'utf8');

describe('Yjs の断片 ⇔ モデルの往復（全フィクスチャ）', () => {
  for (const file of listMarkdown(FIXTURES)) {
    it(relative(FIXTURES, file).replaceAll('\\', '/'), () => {
      const md = readFileSync(file, 'utf8');
      const { doc } = parseRule(md);
      const ydoc = new Y.Doc();
      const f = ydoc.getXmlFragment('body');
      writeFragmentJSON(f, bodyToPM(doc.body));
      const body = bodyFromPM(readFragmentJSON(f));
      expect(serializeRule({ meta: doc.meta, body })).toBe(md);
    });
  }
});

describe('改正案の Yjs 文書', () => {
  it('改正案の情報とルールの追加・読み出し', () => {
    const ydoc = createProposalDoc({
      id: 'p1',
      amendingNumber: { kind: 'ルール', year: 8, number: 4 },
      enforcementDate: '2026-12-01',
    });
    const create = parseRule(R0801003).doc;
    create.meta = { ...create.meta, number: 4, format: undefined, order: 9 };
    const a = addEntry(ydoc, { op: 'create', doc: create });
    const b = addEntry(ydoc, {
      op: 'amend',
      ruleId: 'R0801003',
      baseSha: 'abc',
      baseMarkdown: R0801003,
    });
    const c = addEntry(ydoc, {
      op: 'repeal',
      ruleId: 'R0801003',
      baseSha: 'abc',
      baseMarkdown: R0801003,
    });
    expect(readEntries(ydoc).map((e) => e.op)).toEqual(['create', 'amend', 'repeal']);
    const p = readProposal(ydoc);
    expect(p.amendingNumber).toEqual({ kind: 'ルール', year: 8, number: 4 });
    const amend = readEntries(ydoc)[1]!;
    expect(serializeRule(readEntryDoc(ydoc, amend))).toBe(R0801003);
    expect(serializeRule(readEntryDoc(ydoc, readEntries(ydoc)[0]!))).toContain(
      'permalink: /rule/R0801004.html',
    );

    updateProposalMeta(ydoc, { enforcementDate: '2027-01-01', summary: '説明' });
    expect(readProposalMeta(ydoc)).toMatchObject({
      enforcementDate: '2027-01-01',
      summary: '説明',
    });
    updateRuleMeta(ydoc, a, { name: '新しい名前' });
    expect(readEntries(ydoc)[0]!.meta.name).toBe('新しい名前');
    removeEntry(ydoc, c);
    expect(readEntries(ydoc).map((e) => e.entryId)).toEqual([a, b]);
  });

  it('下書きファイルの保存と読み込み', () => {
    const ydoc = createProposalDoc({
      amendingNumber: { kind: 'ルール', year: 8, number: 4 },
      enforcementDate: '',
    });
    addEntry(ydoc, { op: 'amend', ruleId: 'R0801003', baseSha: 'abc', baseMarkdown: R0801003 });
    const file = JSON.stringify(encodeDraft(ydoc));
    const back = decodeDraft(file);
    expect(readProposal(back)).toEqual(readProposal(ydoc));
    expect(() => decodeDraft('{}')).toThrow('rule-builder の下書きファイルではありません');
    expect(() => decodeDraft(JSON.stringify({ ...JSON.parse(file), version: 99 }))).toThrow(
      /新しい版/,
    );
  });

  it('改正前と比べた条ごとの変更', () => {
    const ydoc = createProposalDoc({
      amendingNumber: { kind: 'ルール', year: 8, number: 4 },
      enforcementDate: '',
    });
    const id = addEntry(ydoc, {
      op: 'amend',
      ruleId: 'R0801003',
      baseSha: 'abc',
      baseMarkdown: R0801003,
    });
    const json = readFragmentJSON(entryFragment(ydoc, id));
    expect(articleChanges(R0801003, json).count).toBe(0);
    // 第2条の文言を変え、新しい条を足し、第3条を消す
    const content = json.content!;
    const arts = content.filter((n) => n.type === 'article');
    arts[1]!.content![1]!.content![0]!.text = '変更した文。';
    content.splice(content.indexOf(arts[2]!), 1);
    content.push({
      type: 'article',
      attrs: { num: { main: 99, branches: [] } },
      content: [{ type: 'articleCaption' }],
    });
    const s = articleChanges(R0801003, json);
    expect(s.articles.slice(0, 2)).toEqual([null, 'changed']);
    expect(s.articles[s.articles.length - 1]).toBe('new');
    expect(s.removed).toBe(1);
    expect(s.count).toBe(3);
  });
});
