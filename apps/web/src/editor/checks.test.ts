// 書式チェック・参照の確認・リンクのエディタ側のテスト（Phase 7）。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatArticleNum,
  parseRule,
  planDelete,
  planInsert,
  serializeRule,
  type RuleDoc,
} from '@rule-builder/core';
import { Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { linkRangeAt, linkableSelection } from '../ui/common/linkDialog.tsx';
import { fixIssue, fullwidthInput, lintIssues } from './lint.ts';
import { applyRefs, recordRenumbering, refItems, refContext } from './refs.ts';
import { RuleEditing } from './RuleEditing.ts';
import { schemaExtensions } from './schema.ts';
import {
  articleNums,
  articleRefs,
  deleteArticle,
  insertArticle,
  insertTarget,
  moveArticle,
} from './structure.ts';
import { bodyField, createUndoManager, readBody, writeBody } from './ydoc.ts';

const FIX = join(import.meta.dirname, '../../../../test/fixtures/rules/rules');
const loadDoc = (name: string) => parseRule(readFileSync(join(FIX, name), 'utf8')).doc;

const rule = (body: string): RuleDoc =>
  parseRule(
    `---\nlayout: rule\ntitle: テスト\nrule_name: テスト\nrule_number: 令和8年ルール第9号\nenforcement_date: 令和8年12月1日\norder: 9\npermalink: /rule/R0801009.html\n---\n\n${body}\n`,
  ).doc;

let editors: Editor[] = [];
afterEach(() => {
  editors.forEach((e) => e.destroy());
  editors = [];
});

function setup(doc: RuleDoc, ruleId = 'R0801009') {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment(bodyField('t'));
  writeBody(fragment, doc.body);
  const undo = createUndoManager(fragment);
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      ...schemaExtensions,
      Collaboration.configure({ fragment, yUndoOptions: { undoManager: undo } }),
      RuleEditing.configure({ getUndoManager: () => undo, lintContext: () => ({ ruleId }) }),
    ],
  });
  editors.push(editor);
  const md = () => serializeRule({ meta: doc.meta, body: readBody(fragment) });
  /** 構造の操作を反映して、参照の確認に記録する（structureDialogs の apply と同じ） */
  const op = (tr: Transaction, list: Parameters<typeof recordRenumbering>[1]['list'] = []) => {
    editor.view.dispatch(tr);
    editor.view.dispatch(
      recordRenumbering(editor.state, { oldDoc: tr.before, mapping: tr.mapping, list, ruleId }),
    );
  };
  const cursorInArticle = (label: string) => {
    const ref = articleRefs(editor.state.doc).find(
      (a) => a.node.attrs.num && formatArticleNum(a.node.attrs.num) === label,
    )!;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, ref.pos + 2)),
    );
    return ref;
  };
  return { editor, md, op, cursorInArticle, undo };
}

describe('書式チェック（エディタ）', () => {
  it('問題の位置を出し、修正すると直る（リンクは残す）', () => {
    const { editor, md } = setup(
      rule('## 前文\n\n- [*a*](#第1条（目的）)の_こと\n\n##### 第1条（目的）\n\n　本文'),
    );
    const issues = lintIssues(editor.state);
    expect(issues.map((i) => [i.label, i.rule])).toEqual([
      ['前文', 'line-start'],
      ['前文', 'emphasis'],
    ]);
    for (const rule of ['line-start', 'emphasis']) {
      const issue = lintIssues(editor.state).find((i) => i.rule === rule)!;
      editor.view.dispatch(fixIssue(editor.state, issue)!);
    }
    expect(lintIssues(editor.state)).toEqual([]);
    expect(md()).toContain('－ [＊a＊](#第1条（目的）)の＿こと');
  });

  it('このルールの中のリンク切れ', () => {
    const { editor } = setup(rule('##### 第1条（目的）\n\n　[第2条](#第2条（なし）)による'));
    expect(lintIssues(editor.state).map((i) => i.message)).toEqual([
      'リンク先の見出し「第2条（なし）」がこのルールにありません',
    ]);
  });

  it('入力した記号をその場で全角にする', () => {
    const { editor } = setup(rule('##### 第1条（目的）\n\n　本文\n\n## 附則\n\n　あ'));
    const s = editor.state;
    // 本文の行：*・_ は全角に
    let pos = -1;
    s.doc.descendants((n, p) => {
      if (pos < 0 && n.type.name === 'lawLine') pos = p + 1;
    });
    expect(fullwidthInput(s, pos, pos, '*')?.doc.textBetween(pos, pos + 1)).toBe('＊');
    // 本文の行の先頭の # は崩れないのでそのまま
    expect(fullwidthInput(s, pos, pos, '#')).toBeNull();
    // 字下げのない行の先頭：# はすぐ、- は続けて空白を打ったときに全角に
    const tr = s.tr;
    let plain = -1;
    s.doc.descendants((n, p) => {
      if (plain < 0 && n.type.name === 'plainLine') plain = p;
    });
    tr.setNodeMarkup(plain, undefined, { indent: '' });
    tr.insertText('-', plain + 1, plain + 2);
    const s2 = s.apply(tr);
    expect(fullwidthInput(s2, plain + 1, plain + 1, '#')?.doc.nodeAt(plain)?.textContent).toBe(
      '＃-',
    );
    expect(fullwidthInput(s2, plain + 2, plain + 2, ' ')?.doc.nodeAt(plain)?.textContent).toBe(
      '－ ',
    );
    expect(fullwidthInput(s2, plain + 2, plain + 2, 'a')).toBeNull();
  });
});

describe('参照の確認（エディタ）', () => {
  it('R0701001：第3条の前に条を入れて後ろをずらすと、番号の変わる参照が候補になり、書き換えられる', () => {
    const { editor, md, op, cursorInArticle } = setup(loadDoc('R0701001.md'), 'R0701001');
    cursorInArticle('第3条');
    const target = insertTarget(editor.state, 'before');
    const plan = planInsert(articleNums(editor.state.doc), target.at);
    op(insertArticle(editor.state, target, plan.shift, plan.shifted), plan.shifted);
    const items = refItems(editor.state);
    const texts = items.flatMap((it) => (it.type === 'text' ? [`${it.old}→${it.neu}`] : []));
    expect(texts).toEqual([
      '第5条の2→第6条の2',
      '第5条の9→第6条の9',
      '第5条の4→第6条の4',
      '第5条の9→第6条の9',
      '第5条の6→第6条の6',
      '第5条の2→第6条の2',
    ]);
    const first = items[0]!;
    expect(refContext(editor.state, first)?.match).toBe('第5条の2');
    // 書き換えると候補から消え、ほかの候補の位置はずれない
    editor.view.dispatch(applyRefs(editor.state, [first])!);
    expect(refItems(editor.state)).toHaveLength(items.length - 1);
    editor.view.dispatch(applyRefs(editor.state, refItems(editor.state))!);
    expect(refItems(editor.state)).toEqual([]);
    const out = md();
    expect(out).toContain('第6条の2');
    expect(out).not.toMatch(/[^#] 第5条の9/);
  });

  it('続けて番号が変わったら、候補の新しい番号も続けて変える', () => {
    const { editor, op, cursorInArticle } = setup(
      rule('##### 第1条（a）\n\n　第2条による\n\n##### 第2条（b）\n\n　b'),
    );
    for (let k = 0; k < 2; k++) {
      cursorInArticle('第1条');
      const target = insertTarget(editor.state, 'after');
      const plan = planInsert(articleNums(editor.state.doc), target.at);
      op(insertArticle(editor.state, target, plan.shift, plan.shifted), plan.shifted);
    }
    const items = refItems(editor.state);
    expect(items.map((it) => (it.type === 'text' ? `${it.old}→${it.neu}` : it.type))).toEqual([
      '第2条→第4条',
    ]);
  });

  it('文言を書き換えた候補は消える', () => {
    const { editor, op, cursorInArticle } = setup(
      rule('##### 第1条（a）\n\n　第2条による\n\n##### 第2条（b）\n\n　b'),
    );
    cursorInArticle('第1条');
    const target = insertTarget(editor.state, 'after');
    const plan = planInsert(articleNums(editor.state.doc), target.at);
    op(insertArticle(editor.state, target, plan.shift, plan.shifted), plan.shifted);
    const it = refItems(editor.state)[0]!;
    if (it.type !== 'text') throw new Error();
    editor.view.dispatch(editor.state.tr.insertText('9', it.from + 1, it.from + 2));
    expect(refItems(editor.state)).toEqual([]);
  });

  it('リンクの飛び先も候補にする（ほかのルールへのリンクの文字は候補にしない）', () => {
    const { editor, md, op, cursorInArticle } = setup(
      rule(
        '##### 第1条（a）\n\n　[第2条](#第2条（b）)と[第2条](R0701002.html#第2条（定義）)\n\n##### 第2条（b）\n\n　b',
      ),
    );
    cursorInArticle('第1条');
    const target = insertTarget(editor.state, 'after');
    const plan = planInsert(articleNums(editor.state.doc), target.at);
    op(insertArticle(editor.state, target, plan.shift, plan.shifted), plan.shifted);
    const items = refItems(editor.state);
    expect(items.map((it) => it.type)).toEqual(['text', 'href']);
    editor.view.dispatch(applyRefs(editor.state, items)!);
    expect(md()).toContain('[第3条](#第3条（b）)と[第2条](R0701002.html#第2条（定義）)');
  });

  it('「前条」の指す条が変わると確認を出す（削除して詰めたとき・移動したとき）', () => {
    const { editor, op, cursorInArticle } = setup(
      rule(
        '##### 第1条（a）\n\n　a\n\n##### 第2条（b）\n\n　b\n\n##### 第3条（c）\n\n　前条による',
      ),
    );
    const ref = cursorInArticle('第2条');
    const plan = planDelete(articleNums(editor.state.doc), ref.index);
    op(deleteArticle(editor.state, ref, 'close', plan.closed), plan.closed);
    const notes = refItems(editor.state).filter((it) => it.type === 'note');
    expect(notes.map((n) => n.type === 'note' && n.message)).toEqual([
      '「前条」が指す条が変わります（第2条 → 第1条）。文言を確かめてください',
    ]);
  });

  it('「削除」として残したときは「前条」の確認を出さない', () => {
    const { editor, op, cursorInArticle } = setup(
      rule(
        '##### 第1条（a）\n\n　a\n\n##### 第2条（b）\n\n　b\n\n##### 第3条（c）\n\n　前条による',
      ),
    );
    const ref = cursorInArticle('第2条');
    op(deleteArticle(editor.state, ref, 'keep', []));
    expect(refItems(editor.state)).toEqual([]);
  });

  it('条を移動すると、動かした条の「前条」の確認を出す', () => {
    const { editor, op, cursorInArticle } = setup(
      rule(
        '##### 第1条（a）\n\n　a\n\n##### 第2条（b）\n\n　前条による\n\n##### 第3条（c）\n\n　c',
      ),
    );
    const ref = cursorInArticle('第2条');
    const r = moveArticle(editor.state, ref, 1);
    if ('error' in r) throw new Error(r.error);
    op(r.tr);
    const notes = refItems(editor.state).filter((it) => it.type === 'note');
    expect(notes).toHaveLength(1);
  });
});

describe('条文へのリンク', () => {
  it('選んだ文字・カーソルのあるリンクの範囲', () => {
    const { editor } = setup(rule('##### 第1条（a）\n\n　あ[いう](#第1条（a）)え'));
    let line = -1;
    editor.state.doc.descendants((n, p) => {
      if (line < 0 && n.type.name === 'lawLine') line = p;
    });
    const s = editor.state;
    const sel = s.apply(s.tr.setSelection(TextSelection.create(s.doc, line + 1, line + 2)));
    expect(linkableSelection(sel)).toMatchObject({ from: line + 1, to: line + 2, mark: null });
    const cur = s.apply(s.tr.setSelection(TextSelection.create(s.doc, line + 3)));
    const r = linkRangeAt(cur)!;
    expect([r.from, r.to, r.mark?.attrs.href]).toEqual([line + 2, line + 4, '#第1条（a）']);
    const out = s.apply(s.tr.setSelection(TextSelection.create(s.doc, line + 5)));
    expect(linkRangeAt(out)).toBeNull();
  });
});
