import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatArticleNum,
  listArticles,
  parseRule,
  planDelete,
  planInsert,
  planSwap,
  serializeRule,
  type RuleDoc,
} from '@rule-builder/core';
import { Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { RuleEditing } from './RuleEditing.ts';
import { schemaExtensions } from './schema.ts';
import {
  addSupplementaryLine,
  articleNums,
  articleRefs,
  currentArticle,
  deleteArticle,
  insertArticle,
  insertDivision,
  insertPreamble,
  insertTarget,
  moveArticle,
  renumberArticles,
  undeleteArticle,
} from './structure.ts';
import { bodyField, createUndoManager, readBody, writeBody } from './ydoc.ts';

const FIX = join(import.meta.dirname, '../../../../test/fixtures/rules/rules');
const loadDoc = (name: string) => parseRule(readFileSync(join(FIX, name), 'utf8')).doc;

const META: RuleDoc['meta'] = {
  kind: 'ルール',
  year: 8,
  number: 9,
  name: 'テスト',
  enforcementDate: '2026-12-01',
  order: 9,
  extra: {},
};

let editors: Editor[] = [];
afterEach(() => {
  editors.forEach((e) => e.destroy());
  editors = [];
});

function setup(doc: RuleDoc) {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment(bodyField('t'));
  writeBody(fragment, doc.body);
  const undo = createUndoManager(fragment);
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      ...schemaExtensions,
      Collaboration.configure({ fragment, yUndoOptions: { undoManager: undo } }),
      RuleEditing.configure({ getUndoManager: () => undo }),
    ],
  });
  editors.push(editor);
  const md = () => serializeRule({ meta: doc.meta, body: readBody(fragment) });
  const dispatch = (tr: Transaction) => {
    undo.stopCapturing();
    editor.view.dispatch(tr);
    undo.stopCapturing();
  };
  const type = (text: string) => editor.commands.insertContent(text);
  const labels = () =>
    listArticles(readBody(fragment)).map(
      (a) => (a.num ? formatArticleNum(a.num) : '') + (a.deleted ? '削除' : ''),
    );
  const cursorInArticle = (label: string) => {
    const ref = articleRefs(editor.state.doc).find(
      (a) => a.node.attrs.num && formatArticleNum(a.node.attrs.num) === label,
    )!;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, ref.pos + 2)),
    );
  };
  /** 後に条を挿入（ダイアログで mode を選んだのと同じ） */
  const insertAfter = (mode: 'branch' | 'shift' = 'shift', where: 'after' | 'before' = 'after') => {
    const t = insertTarget(editor.state, where);
    const plan = planInsert(articleNums(editor.state.doc), t.at);
    if (mode === 'branch' && plan.branch) dispatch(insertArticle(editor.state, t, plan.branch, []));
    else dispatch(insertArticle(editor.state, t, plan.shift, plan.shifted));
  };
  return { editor, undo, md, dispatch, type, labels, cursorInArticle, insertAfter };
}

describe('構造の操作', () => {
  it('空の状態から章のあるルールを作れる', () => {
    const t = setup({ meta: META, body: [] });
    t.dispatch(insertPreamble(t.editor.state));
    t.type('前文の文。');
    t.dispatch(insertDivision(t.editor.state, 'chapter'));
    t.type('総則');
    t.insertAfter();
    t.type('定義');
    t.editor.commands.focus();
    t.editor.commands.setTextSelection(t.editor.state.selection.$from.end() + 2);
    t.type('この条の本文。');
    t.dispatch(insertDivision(t.editor.state, 'chapter'));
    t.type('雑則');
    t.insertAfter();
    t.dispatch(addSupplementaryLine(t.editor.state));
    t.type('このルールは、公布の日から施行します。');
    expect(t.md()).toBe(`---
layout: rule
permalink: /rule/R0801009.html
order: 9
title: テスト
rule_name: テスト
rule_number: 令和8年ルール第9号
enforcement_date: 令和8年12月1日
category: ルール
og_description: テスト(令和8年ルール第9号)
---

## 前文

　前文の文。

## 第1章 総則

##### 第1条（定義）

　この条の本文。

## 第2章 雑則

##### 第2条

${'　'}

## 附則

##### 附則

　このルールは、公布の日から施行します。
`);
  });

  it('空の状態から章のないルールを作れる', () => {
    const t = setup({ meta: META, body: [] });
    t.insertAfter();
    t.insertAfter();
    t.insertAfter();
    expect(t.labels()).toEqual(['第1条', '第2条', '第3条']);
  });

  it('本文だけの施行令（見出しのない本文）を読み込んで編集しても形が崩れない', () => {
    const doc = loadDoc('R0702001.md');
    const t = setup(doc);
    expect(t.md()).toBe(serializeRule(doc));
  });

  it('条の挿入：枝番号・後ろをずらす・枝番号の間に割り込まない、元に戻すで番号ごと戻る', () => {
    const doc = loadDoc('R0701001.md');
    const t = setup(doc);
    const before = t.labels();
    t.cursorInArticle('第2条');
    t.insertAfter('branch');
    expect(t.labels().slice(1, 5)).toEqual(['第2条', '第2条の2', '第2条の3', '第3条']);
    t.editor.commands.undo();
    expect(t.labels()).toEqual(before);
    t.cursorInArticle('第2条');
    t.insertAfter('shift');
    expect(t.labels().slice(1, 6)).toEqual(['第2条', '第2条の2', '第3条', '第4条', '第5条']);
    expect(t.labels()).toContain('第6条の2');
    t.editor.commands.undo();
    expect(t.md()).toBe(serializeRule(doc));
  });

  it('条の削除：番号を残す・後ろを詰める・削除の取り消し', () => {
    const doc = loadDoc('R0801003.md');
    const t = setup(doc);
    t.cursorInArticle('第3条');
    let ref = currentArticle(t.editor.state)!;
    t.dispatch(deleteArticle(t.editor.state, ref, 'keep', []));
    expect(t.md()).toContain('##### 第3条　削除\n\n##### 第4条');
    ref = currentArticle(t.editor.state)!;
    t.dispatch(undeleteArticle(t.editor.state, ref));
    expect(t.md()).toBe(serializeRule(doc));
    t.cursorInArticle('第3条');
    ref = currentArticle(t.editor.state)!;
    const plan = planDelete(articleNums(t.editor.state.doc), ref.index);
    t.dispatch(deleteArticle(t.editor.state, ref, 'close', plan.closed));
    expect(t.labels().slice(0, 4)).toEqual(['第1条', '第2条', '第3条', '第4条']);
    expect(t.md()).toContain('##### 第3条（審査および決定）');
    t.editor.commands.undo();
    expect(t.md()).toBe(serializeRule(doc));
  });

  it('条の移動と番号の入れ替え、章の境目を越えるときは番号を変えない', () => {
    const doc = loadDoc('R0801003.md');
    const t = setup(doc);
    t.cursorInArticle('第3条');
    const r = moveArticle(t.editor.state, currentArticle(t.editor.state)!, -1);
    if ('error' in r) throw new Error(r.error);
    t.dispatch(r.tr);
    expect(t.labels().slice(0, 3)).toEqual(['第1条', '第3条', '第2条']);
    const ia = currentArticle(t.editor.state)!.index;
    t.dispatch(
      renumberArticles(t.editor.state, planSwap(articleNums(t.editor.state.doc), ia, ia + 1)),
    );
    expect(t.labels().slice(0, 3)).toEqual(['第1条', '第2条', '第3条']);
    expect(t.md()).toContain('##### 第2条（個人開発領の要件）');

    const basic = setup(loadDoc('R0701001.md'));
    basic.cursorInArticle('第5条');
    const m = moveArticle(basic.editor.state, currentArticle(basic.editor.state)!, -1);
    expect('crossed' in m && m.crossed).toBe('division');
  });
});
