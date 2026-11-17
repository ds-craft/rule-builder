import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inlineText } from '../markdown/inline.ts';
import { parseRule } from '../markdown/parse.ts';
import { listArticles, planDelete, planInsert } from '../model/ops.ts';
import { ruleLintLines } from '../lint/lint.ts';
import {
  anchorArticle,
  findIncomingLinks,
  findReferences,
  removedAnchors,
  renumberMap,
  renumberTargets,
} from './refs.ts';

const FIX = join(import.meta.dirname, '../../../../test/fixtures/rules/rules');
const read = (name: string) => readFileSync(join(FIX, name), 'utf8');
const load = (name: string) => parseRule(read(name)).doc;

describe('参照の抽出', () => {
  it('条・項・号・相対的な参照', () => {
    const refs = findReferences(
      '前条第4項の投票と第5条の2第1項及び第3条から第5条の9まで、第2項・第1号・前各号・次条による',
    );
    expect(refs.map((r) => [r.kind, r.text])).toEqual([
      ['relative', '前条'],
      ['paragraph', '第4項'],
      ['article', '第5条の2第1項'],
      ['article', '第3条'],
      ['article', '第5条の9'],
      ['paragraph', '第2項'],
      ['item', '第1号'],
      ['relative', '前各号'],
      ['relative', '次条'],
    ]);
    expect(refs[2]!.article).toBe('第5条の2');
  });

  it('ほかのルールの条・章は別に扱い、「本ルール」は自分の条とする', () => {
    const refs = findReferences(
      '基本ルール第1条第9号と、禁止事項及び処罰に関するルール第3章、本ルール第2条、附則第1条',
    );
    expect(refs.map((r) => [r.kind, r.text, r.ruleName ?? ''])).toEqual([
      ['external', '第1条第9号', '基本ルール'],
      ['external', '第3章', '禁止事項及び処罰に関するルール'],
      ['article', '第2条', ''],
      ['external', '第1条', '附則'],
    ]);
  });

  it('第13条を第3条と取り違えない', () => {
    const map = new Map([['第3条', '第4条']]);
    expect(renumberTargets('第13条と第3条と第3条の2', map).map((t) => t.index)).toEqual([5]);
  });

  it('アンカーの条番号', () => {
    expect(anchorArticle('第8条（窃盗の禁止）')).toEqual({ main: 8, branches: [] });
    expect(anchorArticle('第5条の2')).toEqual({ main: 5, branches: [2] });
    expect(anchorArticle('第3章-処罰')).toBeNull();
  });
});

describe('条の振り直しと参照の候補（現行ルール）', () => {
  /** ルールの本文（条の見出しを除く）の、自分の条への参照をすべて数える（独立した素朴な数え方） */
  const naiveCount = (md: string, affected: Set<string>) => {
    let n = 0;
    for (const line of md.split('\n')) {
      if (line.startsWith('#') || line.startsWith('---')) continue;
      // リンクの飛び先は文ではないので除く
      const text = line.replace(/\]\([^)]*\)/g, ']');
      for (const m of text.matchAll(/(.{0,8})第(\d+)条((?:の\d+)*)/g)) {
        if (/(ルール|施行令|附則|特例)$/.test(m[1]!) && !/(^|[^基])本ルール$/.test(m[1]!)) continue;
        if (affected.has(`第${m[2]}条${m[3]}`)) n++;
      }
    }
    return n;
  };

  for (const name of readdirSync(FIX).filter((f) => f.endsWith('.md'))) {
    it(`${name}：先頭に条を入れて後ろをずらすと、自分の条への参照がすべて候補になる`, () => {
      const doc = load(name);
      const nums = listArticles(doc.body).map((a) => a.num);
      if (nums.length === 0) return;
      const plan = planInsert(nums, 0);
      const map = renumberMap(plan.shifted);
      const { lines } = ruleLintLines(doc);
      const found = lines.flatMap((l) =>
        l.kind === 'caption' ? [] : renumberTargets(inlineText(l.inlines), map),
      );
      expect(found.length).toBe(naiveCount(read(name), new Set(map.keys())));
      for (const t of found) expect(map.get(t.old)).toBe(t.neu);
    });
  }

  it('R0701001：第3条を削除して詰めると、第5条の…の参照が第4条の…の候補になる', () => {
    const doc = load('R0701001.md');
    const nums = listArticles(doc.body).map((a) => a.num);
    const plan = planDelete(nums, 3);
    const map = renumberMap(plan.closed);
    const { lines } = ruleLintLines(doc);
    const found = lines.flatMap((l) =>
      renumberTargets(inlineText(l.inlines), map).map((t) => ({ label: l.label, ...t })),
    );
    expect(found.map((t) => `${t.label}：${t.old}→${t.neu}`)).toEqual([
      '第5条 第3項：第5条の2→第4条の2',
      '第5条 第3項：第5条の9→第4条の9',
      '第5条 第6項：第5条の4→第4条の4',
      '第5条の3 第5項：第5条の9→第4条の9',
      '第5条の4 第1項：第5条の6→第4条の6',
      '附則：第5条の2→第4条の2',
    ]);
  });

  it('R0801003：「基本ルール第1条」は候補にしない', () => {
    const doc = load('R0801003.md');
    const map = new Map([['第1条', '第2条']]);
    const { lines } = ruleLintLines(doc);
    const found = lines.flatMap((l) => renumberTargets(inlineText(l.inlines), map));
    expect(found).toEqual([]);
  });
});

describe('ほかのルールからのリンク', () => {
  const others = readdirSync(FIX)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ id: f.replace('.md', ''), name: load(f).meta.name, markdown: read(f) }));

  it('見出しが変わると切れるリンクを探す', () => {
    const found = findIncomingLinks(
      'R0701002',
      new Set(['第8条（窃盗の禁止）', '第3章-処罰']),
      others,
    );
    expect(found.map((f) => [f.ruleId, f.anchor])).toEqual([
      ['R0410001', '第8条（窃盗の禁止）'],
      ['R0701003', '第3章-処罰'],
    ]);
    expect(found[1]!.heading).toMatch(/^第\d+条/);
  });

  it('無くなる見出し', () => {
    const md = read('R0701002.md');
    const changed = md.replace('##### 第8条（窃盗の禁止）', '##### 第8条（盗みの禁止）');
    const current = new Set(
      [...changed.matchAll(/^#{2,5} (.+)$/gm)].map((m) => m[1]!.trim().replace(/\s+/g, '-')),
    );
    expect([...removedAnchors(md, current)]).toEqual(['第8条（窃盗の禁止）']);
  });
});
