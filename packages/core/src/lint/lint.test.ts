import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRule } from '../markdown/parse.ts';
import { serializeRule } from '../markdown/serialize.ts';
import type { RuleDoc } from '../model/types.ts';
import {
  portalAnchor,
  parseRuleHref,
  ruleAnchors,
  ruleHeadings,
  ruleHref,
} from '../links/anchors.ts';
import { applyLintFix, countIssues, lintRule, type LintRuleIndex } from './lint.ts';

const FIX = join(import.meta.dirname, '../../../../test/fixtures/rules/rules');
const load = (name: string) => parseRule(readFileSync(join(FIX, name), 'utf8')).doc;

const rule = (body: string, extra = ''): RuleDoc =>
  parseRule(
    `---\nlayout: rule\ntitle: テスト\nrule_name: テスト\nrule_number: 令和8年ルール第9号\nenforcement_date: 令和8年12月1日\norder: 9\npermalink: /rule/R0801009.html\n${extra}---\n\n${body}\n`,
  ).doc;

const lint = (doc: RuleDoc, rules?: LintRuleIndex) => lintRule(doc, { ruleId: 'R0801009', rules });

describe('見出しのアンカー', () => {
  it('portal と同じく空白を - にする', () => {
    expect(portalAnchor('第3章 処罰')).toBe('第3章-処罰');
    expect(portalAnchor('第8条（窃盗の禁止）')).toBe('第8条（窃盗の禁止）');
  });

  it('現行ルールのリンク先のアンカーがすべて見つかる', () => {
    const anchors = new Map(
      readdirSync(FIX)
        .filter((f) => f.endsWith('.md'))
        .map((f) => [f.replace('.md', ''), ruleAnchors(load(f))]),
    );
    const hrefs = readdirSync(FIX)
      .filter((f) => f.endsWith('.md'))
      .flatMap((f) => [
        ...readFileSync(join(FIX, f), 'utf8').matchAll(/\]\((R\d{7}\.html#[^ )]+)/g),
      ])
      .map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(3);
    for (const href of hrefs) {
      const t = parseRuleHref(href)!;
      expect(anchors.get(t.ruleId!)?.has(t.anchor), href).toBe(true);
    }
  });

  it('見出しの一覧（章・条・附則）', () => {
    const hs = ruleHeadings(load('R0701002.md'));
    expect(hs.some((h) => h.anchor === '第3章-処罰' && h.level === 1)).toBe(true);
    expect(hs.find((h) => h.anchor === '第8条（窃盗の禁止）')?.article).toEqual({
      main: 8,
      branches: [],
    });
  });

  it('href を作る・読む', () => {
    expect(ruleHref({ ruleId: null, anchor: '第1条（目的）' }, 'R0701001')).toBe('#第1条（目的）');
    expect(ruleHref({ ruleId: 'R0701001', anchor: 'a' }, 'R0701001')).toBe('#a');
    expect(ruleHref({ ruleId: 'R0701002', anchor: '第3章-処罰' }, 'R0701001')).toBe(
      'R0701002.html#第3章-処罰',
    );
    expect(ruleHref({ ruleId: 'R0702001', anchor: '' }, 'R0701001')).toBe('R0702001.html');
    expect(parseRuleHref('https://example.com/')).toBeNull();
    expect(parseRuleHref('R0702001.html')).toEqual({ ruleId: 'R0702001', anchor: '' });
    expect(parseRuleHref('#%E7%AC%AC1%E6%9D%A1')).toEqual({ ruleId: null, anchor: '第1条' });
  });
});

describe('書式チェック', () => {
  it('現行ルールにエラーはない', () => {
    for (const f of readdirSync(FIX).filter((x) => x.endsWith('.md'))) {
      const errors = lint(load(f)).filter((i) => i.level === 'error');
      expect(errors, f).toEqual([]);
    }
  });

  it('行頭の記号（Markdown の行頭になる行だけ）', () => {
    const doc = rule('## 前文\n\n- 箇条書き\n\n##### 第1条（目的）\n\n　- 項の中は行頭にならない');
    const issues = lint(doc).filter((i) => i.rule === 'line-start');
    expect(issues.map((i) => i.label)).toEqual(['前文']);
    expect(issues[0]!.fix).toBe('line-start');
  });

  it('強調になる文字', () => {
    const doc = rule('##### 第1条（目的）\n\n　*重要*な_こと');
    const [issue] = lint(doc).filter((i) => i.rule === 'emphasis');
    expect(issue?.label).toBe('第1条');
    expect(issue?.level).toBe('error');
  });

  it('区切りの空白', () => {
    const doc = rule('## 附則\n\n一 半角の空白');
    expect(lint(doc).filter((i) => i.rule === 'separator')).toHaveLength(1);
  });

  it('空の行・見出しのない条・欠番・重複', () => {
    const doc = rule(
      '##### 第1条\n\n①　あ\n②　\n\n##### 第3条（a）\n\n　い\n\n##### 第3条（b）\n\n　う',
    );
    const issues = lint(doc);
    expect(issues.map((i) => [i.level, i.label, i.message])).toEqual([
      ['info', '第1条の見出し', '条の見出しがありません'],
      ['warn', '第1条 第2項', '何も書かれていない行があります'],
      ['warn', '第3条', '第2条がありません（欠番）'],
      ['error', '第3条', '第3条が2つあります'],
    ]);
    expect(countIssues(issues)).toBe(3);
  });

  it('リンク切れ', () => {
    const doc = rule(
      '##### 第1条（目的）\n\n　[前条](#第9条（なし）)と[第1条](#第1条（目的）)と[別](R0701002.html#第3章-処罰)と[無](R0701099.html)',
    );
    const rules: LintRuleIndex = new Map([
      ['R0701002', { name: '禁止事項及び罰則に関するルール', anchors: new Set(['第3章-処罰']) }],
    ]);
    expect(lint(doc, rules).map((i) => i.message)).toEqual([
      'リンク先の見出し「第9条（なし）」がこのルールにありません',
      'リンク先のルール（R0701099）が見つかりません',
    ]);
    // ほかのルールの一覧がなければ、ほかのルールへのリンクは調べない
    expect(lint(doc).map((i) => i.message)).toEqual([
      'リンク先の見出し「第9条（なし）」がこのルールにありません',
    ]);
  });
});

describe('修正（全角にする）', () => {
  it('文字数を変えずに全角にする', () => {
    const cases: [Parameters<typeof applyLintFix>[0], string, string][] = [
      ['line-start', '- 箇条書き', '－ 箇条書き'],
      ['line-start', '12. 番号', '１２． 番号'],
      ['line-start', '## 見出し', '＃＃ 見出し'],
      ['line-start', '> 引用', '＞ 引用'],
      ['emphasis', 'a*b_c*', 'a＊b＿c＊'],
      ['separator', '一 号', '一　号'],
      ['separator', '十二 号', '十二　号'],
    ];
    for (const [fix, before, after] of cases) {
      expect(applyLintFix(fix, before)).toBe(after);
      expect(after.length).toBe(before.length);
    }
  });

  it('修正すると問題が消え、出力が崩れない', () => {
    const doc = rule('## 前文\n\n- *a*\n\n## 附則\n\n一 b');
    for (const i of lint(doc)) {
      if (!i.fix) continue;
      const fixed = doc.body.map((b) => {
        if (b.type !== 'preamble' && b.type !== 'supplementary') return b;
        return {
          ...b,
          lines: b.lines.map((l) =>
            l.map((n) => (n.kind === 'text' ? { ...n, value: applyLintFix(i.fix!, n.value) } : n)),
          ),
        };
      });
      doc.body = fixed as RuleDoc['body'];
    }
    expect(lint(doc).filter((i) => i.fix)).toEqual([]);
    expect(serializeRule(doc)).toContain('－ ＊a＊');
  });
});
