// TipTap のスキーマ（エディタの文書の形）。
//
// 内部モデル（packages/core の RuleDoc）と1対1に変換できる形にしている。手順書 3-1 の入れ子の形とは次の点が違う。
//   - 章・節・款は見出しの行（division）として平たく並べる。Markdown 自体が平たい構造のため情報は失われない
//   - 条の中は「種類（項・号・細分・続き）を属性に持つ行」（lawLine）を平たく並べる。Word の箇条書きのレベルと同じく、
//     Tab・Shift+Tab は種類を変えるだけ。項の前の号など不正な並びは normalize.ts が変更のたびに直す
// 項・号・細分・章・節・条の番号は文字として持たず、numbering.ts の装飾で描く（利用者が消したり打ったりできない）。

import { Mark, Node, mergeAttributes } from '@tiptap/core';

export type LineKind = 'kou' | 'gou' | 'saibun' | 'cont';

export const RuleDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'topBlock*',
});

export const Text = Node.create({ name: 'text', group: 'inline' });

/** リンク（条文へのリンク） */
export const LawLink = Mark.create({
  name: 'link',
  inclusive: false,
  addAttributes() {
    return { href: { default: '' }, title: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'a[href]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { rel: 'noreferrer' }), 0];
  },
});

/** 章・節・款の見出し。中身は見出しの文言（「総則」）。番号は装飾で描く */
export const Division = Node.create({
  name: 'division',
  group: 'topBlock',
  content: 'text*',
  marks: '',
  defining: true,
  addAttributes() {
    return {
      level: { default: 'chapter' },
      /** 「第1章」と見出しの間の空白。既定は半角 */
      sep: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'h2[data-division]' }];
  },
  renderHTML({ node }) {
    const tag =
      node.attrs.level === 'chapter' ? 'h2' : node.attrs.level === 'section' ? 'h3' : 'h4';
    return [
      tag,
      { 'data-division': node.attrs.level, class: `division division--${node.attrs.level}` },
      0,
    ];
  },
});

/** 条。最初の子が見出し（articleCaption）、続いて条文の行 */
export const ArticleNode = Node.create({
  name: 'article',
  group: 'topBlock',
  content: 'articleCaption lawLine*',
  isolating: true,
  addAttributes() {
    return {
      /** { main, branches } または null（番号のない条） */
      num: { default: { main: 1, branches: [] } },
      general: { default: false },
      deleted: { default: false },
    };
  },
  parseHTML() {
    return [{ tag: 'article' }];
  },
  renderHTML({ node }) {
    return [
      'article',
      {
        class: 'article' + (node.attrs.deleted ? ' is-deleted' : ''),
        'data-general': node.attrs.general ? 'true' : null,
      },
      0,
    ];
  },
});

/** 条の見出し（（ ）の中の文言） */
export const ArticleCaption = Node.create({
  name: 'articleCaption',
  content: 'text*',
  marks: '',
  defining: true,
  parseHTML() {
    return [{ tag: 'h5' }];
  },
  renderHTML() {
    return ['h5', { class: 'caption' }, ['span', { class: 'caption-text' }, 0]];
  },
});

/** 条文の行（項・号・号の細分・番号のない続き） */
export const LawLine = Node.create({
  name: 'lawLine',
  content: 'text*',
  marks: 'link',
  addAttributes() {
    return { kind: { default: 'kou' } };
  },
  parseHTML() {
    return [{ tag: 'p[data-kind]' }];
  },
  renderHTML({ node }) {
    return ['p', { class: 'law-line', 'data-kind': node.attrs.kind }, 0];
  },
});

/** 前文・附則・別表・見出しのない本文の行。行頭の空白（字下げ）は indent に分けて持つ */
export const PlainLine = Node.create({
  name: 'plainLine',
  content: 'text*',
  marks: 'link',
  addAttributes() {
    return { indent: { default: '　' } };
  },
  parseHTML() {
    return [{ tag: 'p[data-plain]' }];
  },
  renderHTML() {
    return ['p', { class: 'law-line', 'data-plain': '' }, 0];
  },
});

export const Preamble = Node.create({
  name: 'preamble',
  group: 'topBlock',
  content: 'plainLine+',
  isolating: true,
  parseHTML() {
    return [{ tag: 'section.preamble' }];
  },
  renderHTML() {
    return [
      'section',
      { class: 'preamble' },
      ['h2', { contenteditable: 'false' }, '前文'],
      ['div', 0],
    ];
  },
});

/** 見出しのない本文（施行令の本則など） */
export const Prose = Node.create({
  name: 'prose',
  group: 'topBlock',
  content: 'plainLine+',
  isolating: true,
  parseHTML() {
    return [{ tag: 'div.prose' }];
  },
  renderHTML() {
    return ['div', { class: 'article prose' }, 0];
  },
});

export const Supplementary = Node.create({
  name: 'supplementary',
  group: 'topBlock',
  content: 'plainLine* provision*',
  isolating: true,
  parseHTML() {
    return [{ tag: 'section.supplementary' }];
  },
  renderHTML() {
    return [
      'section',
      { class: 'chapter supplementary' },
      ['h2', { contenteditable: 'false' }, '附則'],
      ['div', 0],
    ];
  },
});

/** 附則の中の見出し（「##### 附則」「##### 改正附則（…）」）と本文 */
export const Provision = Node.create({
  name: 'provision',
  content: 'provisionHeading plainLine*',
  isolating: true,
  addAttributes() {
    return { general: { default: false } };
  },
  parseHTML() {
    return [{ tag: 'div.provision' }];
  },
  renderHTML() {
    return ['div', { class: 'article provision' }, 0];
  },
});

export const ProvisionHeading = Node.create({
  name: 'provisionHeading',
  content: 'text*',
  marks: '',
  defining: true,
  parseHTML() {
    return [{ tag: 'h5.provision-heading' }];
  },
  renderHTML() {
    return ['h5', { class: 'provision-heading' }, 0];
  },
});

/** 別表（## 別表第一（…）） */
export const Appendix = Node.create({
  name: 'appendix',
  group: 'topBlock',
  content: 'appendixHeading plainLine*',
  isolating: true,
  parseHTML() {
    return [{ tag: 'section.appendix' }];
  },
  renderHTML() {
    return ['section', { class: 'chapter appendix' }, 0];
  },
});

export const AppendixHeading = Node.create({
  name: 'appendixHeading',
  content: 'text*',
  marks: '',
  defining: true,
  parseHTML() {
    return [{ tag: 'h2.appendix-heading' }];
  },
  renderHTML() {
    return ['h2', { class: 'appendix-heading' }, 0];
  },
});

/** 解釈できなかった行（原文のまま） */
export const RawLine = Node.create({
  name: 'raw',
  group: 'topBlock',
  content: 'text*',
  marks: '',
  addAttributes() {
    return { reason: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'p.raw-line' }];
  },
  renderHTML({ node }) {
    return ['p', { class: 'raw-line', title: node.attrs.reason }, 0];
  },
});

/** スキーマを作るための拡張の一覧（装飾やキー操作は含まない） */
export const schemaExtensions = [
  RuleDocument,
  Text,
  LawLink,
  Division,
  ArticleNode,
  ArticleCaption,
  LawLine,
  PlainLine,
  Preamble,
  Prose,
  Supplementary,
  Provision,
  ProvisionHeading,
  Appendix,
  AppendixHeading,
  RawLine,
];
