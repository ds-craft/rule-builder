import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRule } from '@rule-builder/core';
import { describe, expect, it } from 'vitest';
import { layoutRule, searchLines, tocItems, type LawArticle } from './layout.ts';

const FIX = join(import.meta.dirname, '../../../../test/fixtures/rules/rules');
const load = (name: string) => layoutRule(parseRule(readFileSync(join(FIX, name), 'utf8')).doc);

const articles = (s: ReturnType<typeof load>) =>
  s.flatMap((x) => x.items.filter((i): i is LawArticle => i.type === 'article'));

describe('表示のレイアウト（portal の rule-scripts.html と同じ判定）', () => {
  it('前文は section.preamble、本文は plain・行頭の全角空白を除く', () => {
    const s = load('R0701001.md');
    expect(s[0]!.className).toBe('preamble');
    expect(s[0]!.heading?.text).toBe('前文');
    expect(s[0]!.lines[0]!.kind).toBe('plain');
    expect(s[0]!.lines[0]!.inlines[0]).toMatchObject({ value: expect.stringMatching(/^私たちは/) });
  });

  it('項が1つの条は single、号は gou、項が複数の条は kou', () => {
    const a = articles(load('R0701001.md'));
    const art1 = a.find((x) => x.heading?.text === '第1条（定義）')!;
    expect(art1.lines.map((l) => l.kind)).toEqual(['single', ...Array(11).fill('gou')]);
    const art2 = a.find((x) => x.heading?.text === '第2条（運営投票）')!;
    expect(art2.lines.every((l) => l.kind === 'kou')).toBe(true);
  });

  it('附則の中の見出し付きの本文は条として扱わない（plain）', () => {
    const s = load('R0701001.md');
    const supp = s.find((x) => x.heading?.text === '附則')!;
    expect(supp.className).toBe('chapter');
    const kinds = supp.items.flatMap((i) =>
      i.type === 'article' ? i.lines.map((l) => l.kind) : [],
    );
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((k) => k === 'plain')).toBe(true);
  });

  it('見出しのない本文（施行令の本則）は chapter の中の条文として plain・号', () => {
    const s = load('R0702001.md');
    expect(s[0]!.heading).toBeNull();
    expect(s[0]!.className).toBe('chapter');
    const a = s[0]!.items[0] as LawArticle;
    expect(a.heading).toBeNull();
    expect(a.lines[0]!.kind).toBe('plain');
    expect(a.lines[1]!.kind).toBe('gou');
  });

  it('アンカーは見出しの文言の空白を - にする', () => {
    const s = load('R0701002.md');
    const toc = tocItems(s);
    expect(toc.some((t) => t.anchor === '第3章-処罰')).toBe(true);
    expect(toc.some((t) => t.anchor === '第8条（窃盗の禁止）')).toBe(true);
  });

  it('目次の階層（章・節・款・条）', () => {
    const toc = tocItems(load('R0701001.md'));
    const levels = new Map(toc.map((t) => [t.text, t.level]));
    expect(levels.get('第1章 総則')).toBe(1);
    expect(levels.get('第1条（定義）')).toBe(2);
    expect(levels.get('第1節 参加')).toBe(2);
    expect(levels.get('第5条（参加条件）')).toBe(3);
    expect(levels.get('第1款 総則')).toBe(3);
  });

  it('文書内の検索は位置と前後の文を返す', () => {
    const hits = searchLines(load('R0701001.md'), '短縮投票');
    expect(hits.length).toBeGreaterThan(2);
    expect(hits[0]!.label).toBe('第2条の2（短縮投票）');
  });
});
