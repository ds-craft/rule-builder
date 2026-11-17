import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SequenceMatcher, chars } from './difflib.ts';
import { compareHtml } from './ruleCompare.ts';

const FIX = join(import.meta.dirname, '../../../../test/fixtures');

type Version = { vid: string; date: string; latest: boolean; compare_html: string | null };
const history = JSON.parse(readFileSync(join(FIX, 'portal/rule_history.json'), 'utf8')) as Record<
  string,
  { repealed: boolean; versions: Version[] }
>;

function versionText(rid: string, v: Version, repealed: boolean): string {
  if (!v.latest) return readFileSync(join(FIX, `rules/versions/${rid}/${v.vid}.md`), 'utf8');
  const p = join(FIX, `rules/rules/${repealed ? 'repealed/' : ''}${rid}.md`);
  return readFileSync(existsSync(p) ? p : join(FIX, `rules/rules/${rid}.md`), 'utf8');
}

describe('difflib.SequenceMatcher（Python と同じ結果）', () => {
  it('opcodes と ratio', () => {
    // Python: SequenceMatcher(None, "abxcd", "abcd", autojunk=False).get_opcodes()
    const sm = new SequenceMatcher(chars('abxcd'), chars('abcd'));
    expect(sm.getOpcodes()).toEqual([
      ['equal', 0, 2, 0, 2],
      ['delete', 2, 3, 2, 2],
      ['equal', 3, 5, 2, 4],
    ]);
    expect(sm.ratio()).toBeCloseTo(0.8888888888888888, 15);
    // Python: SequenceMatcher(None, "qabxcd", "abycdf", autojunk=False).get_opcodes()
    expect(new SequenceMatcher(chars('qabxcd'), chars('abycdf')).getOpcodes()).toEqual([
      ['delete', 0, 1, 0, 0],
      ['equal', 1, 3, 0, 2],
      ['replace', 3, 4, 2, 3],
      ['equal', 4, 6, 3, 5],
      ['insert', 6, 6, 5, 6],
    ]);
  });
});

/**
 * 比べられないもの：廃止したルールの最新の版は、現行のファイル（rules/repealed/）に後から個人名を伏せる修正
 * （〔個人名省略〕）が入っており、portal の条文比較を作ったときの文面と違うため、同じ結果にならない。
 */
const REDACTED_LATER = new Set(['R0401001', 'R0401002', 'R0501001']);

describe('新旧対照表が portal の条文比較と一致する', () => {
  for (const [rid, rule] of Object.entries(history)) {
    rule.versions.forEach((v, i) => {
      if (i === 0 || !v.compare_html) return;
      const prev = rule.versions[i - 1]!;
      const skip = v.latest && rule.repealed && REDACTED_LATER.has(rid);
      (skip ? it.skip : it)(`${rid} ${prev.vid} → ${v.vid}`, () => {
        const html = compareHtml(
          { markdown: versionText(rid, prev, rule.repealed), date: prev.date },
          { markdown: versionText(rid, v, rule.repealed), date: v.date },
        );
        expect(html).toBe(v.compare_html);
      });
    });
  }
});
