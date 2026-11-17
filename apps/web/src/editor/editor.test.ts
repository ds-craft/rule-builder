import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRule, serializeRule, type Article, type RuleDoc } from '@rule-builder/core';
import { Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addItem,
  addParagraph,
  changeKind,
  cursorLocation,
  demote,
  enterInLine,
  pasteLines,
  promote,
  type Result,
} from './commands.ts';
import { RuleEditing, runResult } from './RuleEditing.ts';
import { schemaExtensions } from './schema.ts';
import { bodyField, createUndoManager, readBody, writeBody } from './ydoc.ts';

const FIX = join(import.meta.dirname, '../../../../test/fixtures/rules/rules');
const loadDoc = (name: string) => parseRule(readFileSync(join(FIX, name), 'utf8')).doc;

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
  const notes: string[] = [];
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      ...schemaExtensions,
      Collaboration.configure({ fragment, yUndoOptions: { undoManager: undo } }),
      RuleEditing.configure({ notify: (m) => notes.push(m), getUndoManager: () => undo }),
    ],
  });
  editors.push(editor);
  const model = (): RuleDoc => ({ meta: doc.meta, body: readBody(fragment) });
  const md = () => serializeRule(model());
  /** 条 label の n 行目（0 は見出し）の文中にカーソルを置く */
  const cursorAt = (label: string, line: number, offset = 0) => {
    let target = -1;
    editor.state.doc.forEach((node, pos) => {
      if (target >= 0 || node.type.name !== 'article') return;
      const n = node.attrs.num as { main: number; branches: number[] } | null;
      const l = n ? `第${n.main}条` + n.branches.map((b) => `の${b}`).join('') : '';
      if (l !== label) return;
      let i = 0;
      node.forEach((_child, off) => {
        if (i++ === line) target = pos + 1 + off + 1 + offset;
      });
    });
    if (target < 0) throw new Error(`見つかりません: ${label} ${line}`);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target)),
    );
  };
  const run = (f: (s: Editor['state']) => Result | null) =>
    runResult(editor, f(editor.state), (m) => notes.push(m), undo);
  const article = (label: string) =>
    model()
      .body.flatMap(function flat(b): Article[] {
        if (b.type === 'article') return [b];
        if (b.type === 'division') return b.children.flatMap(flat);
        return [];
      })
      .find(
        (a) =>
          a.num && `第${a.num.main}条` + a.num.branches.map((x) => `の${x}`).join('') === label,
      )!;
  return { editor, undo, fragment, notes, model, md, cursorAt, run, article };
}

describe('エディタ', () => {
  it('読み込んだだけなら Markdown は元と同じ', () => {
    const doc = loadDoc('R0701001.md');
    const { md } = setup(doc);
    expect(md()).toBe(serializeRule(doc));
  });

  it('文字の入力が Markdown に反映され、元に戻すで戻る', () => {
    const doc = loadDoc('R0801003.md');
    const t = setup(doc);
    t.cursorAt('第2条', 1, 0);
    t.editor.commands.insertContent('【追加】');
    expect(t.md()).toContain('①　【追加】参加者は、');
    t.undo.stopCapturing();
    t.editor.commands.undo();
    expect(t.md()).toBe(serializeRule(doc));
  });

  it('レベルを下げる・上げる（項 → 号 → 項）と、番号を入力せずに条文が組み上がる', () => {
    const t = setup(loadDoc('R0801003.md'));
    t.cursorAt('第2条', 2);
    expect(cursorLocation(t.editor.state)).toBe('第2条 第2項');
    t.run(demote);
    expect(t.article('第2条').paragraphs).toHaveLength(1);
    expect(t.article('第2条').paragraphs[0]!.items).toHaveLength(1);
    expect(cursorLocation(t.editor.state)).toBe('第2条 第1項 第1号');
    expect(t.md()).toContain('　参加者は、旧ボーダー外において');
    expect(t.md()).toContain('一　前項の届出は');
    t.run(promote);
    expect(t.article('第2条').paragraphs).toHaveLength(2);
  });

  it('最初の項は号にできない', () => {
    const t = setup(loadDoc('R0801003.md'));
    t.cursorAt('第2条', 1);
    t.run(demote);
    expect(t.notes).toContain('最初の項は号にできません（前に項が必要です）');
  });

  it('Enter で同じ種類の次の行、空の号で Enter はレベルを上げる', () => {
    const t = setup(loadDoc('R0801003.md'));
    t.cursorAt('第1条', 2, 0); // 第1号の先頭
    t.editor.commands.setTextSelection(t.editor.state.selection.$from.end());
    t.run(enterInLine);
    expect(t.article('第1条').paragraphs[0]!.items).toHaveLength(4);
    expect(cursorLocation(t.editor.state)).toBe('第1条 第1項 第2号');
    t.run(enterInLine); // 空の号で Enter → 項になる
    expect(t.article('第1条').paragraphs).toHaveLength(2);
  });

  it('番号と空の行の案内表示は行の属性で描き、行の中に編集できない要素を置かない（日本語変換との干渉を防ぐ）', () => {
    const t = setup(loadDoc('R0801003.md'));
    t.cursorAt('第1条', 2, 0); // 第1号の先頭
    t.editor.commands.setTextSelection(t.editor.state.selection.$from.end());
    t.run(enterInLine);
    const dom = t.editor.view.dom;
    const ce = '[contenteditable="false"]';
    expect(dom.querySelectorAll(`.law-line ${ce}, .caption ${ce}, .division ${ce}`)).toHaveLength(
      0,
    );
    const empty = dom.querySelector<HTMLElement>('p.law-line[data-ph]')!;
    expect(empty.dataset.no).toBe('二　');
    expect(empty.dataset.ph).toBe('ここに号を入力');
    expect(empty.style.getPropertyValue('--ph')).toBe('"ここに号を入力"');
    // 文字を入れると案内表示の属性が外れ、番号は残る
    t.editor.commands.insertContent('あ');
    const line = [...dom.querySelectorAll<HTMLElement>('p.law-line')].find(
      (e) => e.textContent === 'あ',
    )!;
    expect(line.hasAttribute('data-ph')).toBe(false);
    expect(line.dataset.no).toBe('二　');
  });

  it('行の途中の Enter は残りを次の行に送る', () => {
    const t = setup(loadDoc('R0801003.md'));
    t.cursorAt('第3条', 1, 3);
    t.run(enterInLine);
    const ps = t.article('第3条').paragraphs;
    expect(ps).toHaveLength(4);
    expect(ps[0]!.text).toEqual([{ kind: 'text', value: '個人開' }]);
    expect(ps[1]!.text[0]).toMatchObject({ value: expect.stringMatching(/^発領は、25万/) });
  });

  it('項・号の追加とギャラリーでの種類の変更', () => {
    const t = setup(loadDoc('R0801003.md'));
    t.cursorAt('第3条', 1);
    t.run(addItem);
    t.editor.commands.insertContent('新しい号');
    t.run(addParagraph);
    t.editor.commands.insertContent('新しい項');
    const a = t.article('第3条');
    expect(a.paragraphs).toHaveLength(4);
    expect(a.paragraphs[0]!.items[0]!.text).toEqual([{ kind: 'text', value: '新しい号' }]);
    expect(a.paragraphs[1]!.text).toEqual([{ kind: 'text', value: '新しい項' }]);
    t.cursorAt('第3条', 3);
    t.run((s) => changeKind(s, 'gou'));
    expect(t.article('第3条').paragraphs).toHaveLength(3);
  });

  it('構造の変更と文字入力が Ctrl+Z で順に戻る', () => {
    const doc = loadDoc('R0801003.md');
    const t = setup(doc);
    t.cursorAt('第3条', 2, 0);
    t.editor.commands.insertContent('あ');
    t.run(demote);
    t.editor.commands.insertContent('い');
    t.undo.stopCapturing();
    t.editor.commands.undo();
    expect(t.md()).toContain('一　あ個人開発領は');
    t.editor.commands.undo();
    expect(t.md()).toContain('②　あ個人開発領は');
    t.editor.commands.undo();
    expect(t.md()).toBe(serializeRule(doc));
    t.editor.commands.redo();
    expect(t.md()).toContain('②　あ個人開発領は');
  });

  it('不正な並び（項の前の号）は自動で直る', () => {
    const t = setup(loadDoc('R0801003.md'));
    t.cursorAt('第2条', 1);
    const line = t.editor.state.selection.$from.before();
    t.editor.view.dispatch(t.editor.state.tr.setNodeMarkup(line, undefined, { kind: 'saibun' }));
    expect(t.article('第2条').paragraphs).toHaveLength(2);
  });

  it('複数行の貼り付けは行頭の番号から項・号に分ける', () => {
    const t = setup(loadDoc('R0801003.md'));
    t.cursorAt('第3条', 3);
    t.run((s) => pasteLines(s, '④　第四項\n一　号その一\nイ　細分\n二　号その二'));
    const ps = t.article('第3条').paragraphs;
    expect(ps).toHaveLength(4);
    expect(ps[3]!.items).toHaveLength(2);
    expect(ps[3]!.items[0]!.subitems).toHaveLength(1);
  });

  it('エディタを作り直しても元に戻す履歴が残る（閲覧モードやルールの切り替えの後）', () => {
    const doc = loadDoc('R0801003.md');
    const t = setup(doc);
    t.cursorAt('第3条', 2, 0);
    t.run(demote);
    t.editor.destroy();
    const editor2 = new Editor({
      element: document.createElement('div'),
      extensions: [
        ...schemaExtensions,
        Collaboration.configure({ fragment: t.fragment, yUndoOptions: { undoManager: t.undo } }),
        RuleEditing.configure({ notify: () => {}, getUndoManager: () => t.undo }),
      ],
    });
    editors.push(editor2);
    expect(t.undo.canUndo()).toBe(true);
    editor2.commands.undo();
    expect(t.md()).toBe(serializeRule(doc));
  });
});
