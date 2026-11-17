// 書式チェック（F-18）のエディタ側。エディタの文書から行を作り、packages/core の lintLines で調べる。
// 行のキーは文書の中の位置（文字列）。結果はプラグインの状態に持ち、文書が変わるたびに作り直す。
// 入力した記号をその場で全角にする（7-1.2）のもここで行う。

import {
  applyLintFix,
  bodyFromPM,
  formatDivisionNum,
  lintLines,
  pmToInlines,
  ruleAnchors,
  type ArticleNum,
  type DivisionLevel,
  type LintArticle,
  type LintIssue,
  type LintLine,
  type LintOptions,
  type PMNode as PMJson,
} from '@rule-builder/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { articleLabel, articleLineInfos, lineKindsOf, locationLabel } from './lines.ts';

export type LintContext = Omit<LintOptions, 'anchors'>;

const inlinesOf = (node: PMNode) => pmToInlines((node.toJSON() as PMJson).content);

/** エディタの文書から、書式チェックの行と条を作る */
export function editorLintLines(doc: PMNode): { lines: LintLine[]; articles: LintArticle[] } {
  const lines: LintLine[] = [];
  const articles: LintArticle[] = [];
  const count: Record<DivisionLevel, number> = { chapter: 0, section: 0, subsection: 0 };
  const plain = (node: PMNode, pos: number, label: string) =>
    lines.push({
      key: String(pos),
      kind: 'plain',
      label,
      indent: (node.attrs.indent as string) ?? '',
      inlines: inlinesOf(node),
    });

  doc.forEach((block, pos) => {
    switch (block.type.name) {
      case 'division': {
        const level = block.attrs.level as DivisionLevel;
        count[level]++;
        if (level === 'chapter') count.section = count.subsection = 0;
        if (level === 'section') count.subsection = 0;
        lines.push({
          key: String(pos),
          kind: 'heading',
          label: `${formatDivisionNum(level, count[level])}の名前`,
          inlines: inlinesOf(block),
        });
        return;
      }
      case 'article': {
        const num = block.attrs.num as ArticleNum | null;
        const label = articleLabel(num) || '条';
        const infos = articleLineInfos(lineKindsOf(block));
        const single = infos.filter((i) => i.kind === 'kou').length <= 1;
        let i = 0;
        block.forEach((child, off) => {
          const cpos = pos + 1 + off;
          if (child.type.name === 'articleCaption') {
            articles.push({ key: String(cpos), label, num });
            if (num && !block.attrs.deleted) {
              lines.push({
                key: String(cpos),
                kind: 'caption',
                label: label + 'の見出し',
                inlines: inlinesOf(child),
              });
            }
            return;
          }
          const info = infos[i++]!;
          lines.push({
            key: String(cpos),
            kind: info.kind === 'cont' ? 'plain' : 'law',
            label: locationLabel(num, info, single),
            indent: '',
            inlines: inlinesOf(child),
          });
        });
        return;
      }
      default: {
        const name = block.type.name;
        const label =
          { preamble: '前文', supplementary: '附則', appendix: '別表', prose: '本文' }[name] ?? '';
        if (!label) return;
        block.descendants((child, off) => {
          const cpos = pos + 1 + off;
          if (child.type.name === 'plainLine') plain(child, cpos, label);
          else if (child.type.name === 'provisionHeading' || child.type.name === 'appendixHeading')
            lines.push({
              key: String(cpos),
              kind: 'heading',
              label: `${label}の見出し`,
              inlines: inlinesOf(child),
            });
          return !child.isTextblock;
        });
      }
    }
  });
  return { lines, articles };
}

/** エディタの文書を調べる */
export function lintEditorDoc(doc: PMNode, ctx: LintContext): LintIssue[] {
  const { lines, articles } = editorLintLines(doc);
  return lintLines(lines, articles, {
    ...ctx,
    // このルールのアンカーは、同じルールへのリンクがあるときだけ求める
    anchors: () => ruleAnchors({ body: bodyFromPM(doc.toJSON() as PMJson) }),
  });
}

export type LintState = { issues: LintIssue[] };

export const lintKey = new PluginKey<LintState>('rb-lint');

/** 書式チェックの結果を持つプラグイン（ほかのルールの一覧が届いたら refreshLint で調べ直す） */
export function lintPlugin(getContext: () => LintContext) {
  return new Plugin<LintState>({
    key: lintKey,
    state: {
      init: (_, state) => ({ issues: lintEditorDoc(state.doc, getContext()) }),
      apply: (tr, old, _o, state) =>
        tr.docChanged || tr.getMeta(lintKey)
          ? { issues: lintEditorDoc(state.doc, getContext()) }
          : old,
    },
  });
}

export function refreshLint(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(lintKey, true).setMeta('addToHistory', false));
}

export function lintIssues(state: EditorState): LintIssue[] {
  return lintKey.getState(state)?.issues ?? [];
}

/** 修正（全角にする）。文字数は変わらないので、行の中の文字を同じ位置のまま置き換える。直せなければ null */
export function fixIssue(state: EditorState, issue: LintIssue): Transaction | null {
  if (!issue.fix || issue.key === null) return null;
  const pos = Number(issue.key);
  const node = state.doc.nodeAt(pos);
  if (!node?.isTextblock) return null;
  const fixed = applyLintFix(issue.fix, node.textContent);
  if (fixed === node.textContent) return null;
  const tr = state.tr;
  node.forEach((child, off) => {
    if (!child.isText) return;
    const s = fixed.slice(off, off + child.nodeSize);
    if (s !== child.text) {
      const from = pos + 1 + off;
      tr.replaceWith(from, from + child.nodeSize, state.schema.text(s, child.marks));
    }
  });
  return tr;
}

/** 行のキーの場所（行の末尾）にカーソルを置く */
export function selectionAtKey(state: EditorState, key: string): Transaction | null {
  const pos = Number(key);
  const node = state.doc.nodeAt(pos);
  if (!node) return null;
  const end = node.isTextblock ? pos + 1 + node.content.size : pos + 1;
  const $pos = state.doc.resolve(Math.min(end, state.doc.content.size));
  const sel = node.isTextblock
    ? TextSelection.create(state.doc, end)
    : TextSelection.findFrom($pos, 1, true);
  return sel ? state.tr.setSelection(sel).scrollIntoView() : null;
}

// ---------- 入力した記号をその場で全角にする ----------

const LINE_START = /^(?:\d+\.|[-+*])$/;
const FW: Record<string, string> = {
  '-': '－',
  '+': '＋',
  '*': '＊',
  '.': '．',
  '#': '＃',
  '>': '＞',
};
const fw = (s: string) =>
  s
    .replace(/[0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))
    .replace(/[-+*.#>]/g, (c) => FW[c]!);

/** 行頭が Markdown の行頭になる行か（前文・附則などの字下げのない行、番号のない続きの行） */
function startsMarkdownLine(node: PMNode): boolean {
  if (node.type.name === 'plainLine')
    return (
      !/[^ \t]/.test((node.attrs.indent as string) ?? '') &&
      (node.attrs.indent as string).length < 4
    );
  return node.type.name === 'lawLine' && node.attrs.kind === 'cont';
}

/**
 * 入力した文字を必要なら全角にした変更。変えないなら null。
 * 「*」「_」はどこでも、「#」「>」は行頭で、「-」「+」「1.」は行頭で続けて空白を打ったときに全角にする。
 */
export function fullwidthInput(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): Transaction | null {
  const $from = state.doc.resolve(from);
  const parent = $from.parent;
  if (!parent.isTextblock || parent.type.spec.code) return null;
  let out = text.replace(/\*/g, '＊').replace(/_/g, '＿');
  let start = from;
  if (startsMarkdownLine(parent)) {
    const before = parent.textBetween(0, $from.parentOffset);
    if (before === '' && /^[#>]/.test(out)) out = fw(out[0]!) + out.slice(1);
    if (/^[ \t]/.test(text) && LINE_START.test(before)) {
      out = fw(before) + out;
      start = from - before.length;
    }
  }
  if (out === text && start === from) return null;
  return state.tr.insertText(out, start, to);
}

export function fullwidthPlugin(enabled: () => boolean) {
  return new Plugin({
    key: new PluginKey('rb-fullwidth'),
    props: {
      handleTextInput(view, from, to, text) {
        // 日本語変換中は触らない（変換中の文字の DOM を書き換えると入力が乱れる）
        if (view.composing || !enabled()) return false;
        const tr = fullwidthInput(view.state, from, to, text);
        if (!tr) return false;
        view.dispatch(tr);
        return true;
      },
    },
  });
}
