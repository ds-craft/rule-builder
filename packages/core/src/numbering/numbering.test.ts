import { describe, expect, it } from 'vitest';
import {
  compareArticleNum,
  formatArticleNum,
  formatRuleId,
  formatRuleNumber,
  gouNumber,
  isoToWareki,
  kouNumber,
  lineKind,
  parseArticleNum,
  parseGouNumber,
  parseKouNumber,
  parseRuleId,
  parseRuleNumber,
  parseSaibunNumber,
  saibunNumber,
  warekiToIso,
} from '../index.ts';

describe('項の番号', () => {
  it('3つのブロックの境目', () => {
    expect(kouNumber(1)).toBe('①');
    expect(kouNumber(20)).toBe('⑳');
    expect(kouNumber(21)).toBe('㉑');
    expect(kouNumber(35)).toBe('㉟');
    expect(kouNumber(36)).toBe('㊱');
    expect(kouNumber(50)).toBe('㊿');
  });
  it('51以上・0以下はエラー', () => {
    expect(() => kouNumber(51)).toThrow();
    expect(() => kouNumber(0)).toThrow();
  });
  it('往復', () => {
    for (let n = 1; n <= 50; n++) expect(parseKouNumber(kouNumber(n))).toBe(n);
    expect(parseKouNumber('一')).toBeNull();
  });
});

describe('号の番号', () => {
  it('漢数字', () => {
    expect(gouNumber(1)).toBe('一');
    expect(gouNumber(10)).toBe('十');
    expect(gouNumber(11)).toBe('十一');
    expect(gouNumber(20)).toBe('二十');
    expect(gouNumber(21)).toBe('二十一');
    expect(gouNumber(99)).toBe('九十九');
    expect(() => gouNumber(100)).toThrow();
  });
  it('往復', () => {
    for (let n = 1; n <= 99; n++) expect(parseGouNumber(gouNumber(n))).toBe(n);
    expect(parseGouNumber('一十')).toBeNull();
    expect(parseGouNumber('')).toBeNull();
  });
});

describe('号の細分', () => {
  it('イロハ順', () => {
    expect(saibunNumber(1)).toBe('イ');
    expect(saibunNumber(2)).toBe('ロ');
    expect(saibunNumber(47)).toBe('ス');
    expect(() => saibunNumber(48)).toThrow();
    expect(parseSaibunNumber('ハ')).toBe(3);
  });
});

describe('行の種類（portal と同じ判定）', () => {
  it.each([
    ['①　運営の承認は', 'kou'],
    ['一　ディスコード鯖', 'gou'],
    ['十一　陸', 'gou'],
    ['イ　細分', 'saibun'],
    ['　本文', 'text'],
    ['一般に', 'text'],
    ['イアリーオ臨時政府', 'text'],
  ])('%s → %s', (line, kind) => {
    expect(lineKind(line)).toBe(kind);
  });
});

describe('条番号', () => {
  it('書式と解釈', () => {
    expect(formatArticleNum({ main: 2, branches: [2] })).toBe('第2条の2');
    expect(parseArticleNum('第5条の9')).toEqual({ main: 5, branches: [9] });
    expect(parseArticleNum('第3条')).toEqual({ main: 3, branches: [] });
    expect(parseArticleNum('第3条（定義）')).toBeNull();
  });
  it('大小', () => {
    const a = (s: string) => parseArticleNum(s)!;
    expect(compareArticleNum(a('第2条'), a('第2条の2'))).toBeLessThan(0);
    expect(compareArticleNum(a('第2条の2'), a('第2条の3'))).toBeLessThan(0);
    expect(compareArticleNum(a('第2条の3'), a('第3条'))).toBeLessThan(0);
    expect(compareArticleNum(a('第2条の2'), a('第2条の2'))).toBe(0);
  });
});

describe('和暦', () => {
  it('ISO ⇔ 和暦', () => {
    expect(isoToWareki('2026-11-17')).toBe('令和8年11月17日');
    expect(warekiToIso('令和8年11月17日')).toBe('2026-11-17');
    expect(warekiToIso('令和7年6月19日')).toBe('2025-06-19');
    expect(warekiToIso('令和元年5月1日')).toBe('2019-05-01');
    expect(warekiToIso('令和8年2月30日')).toBeNull();
    expect(warekiToIso('平成31年4月1日')).toBeNull();
  });
});

describe('ルールのID・番号', () => {
  it('ID', () => {
    expect(formatRuleId({ kind: 'ルール', year: 7, number: 1 })).toBe('R0701001');
    expect(formatRuleId({ kind: 'ルール施行令', year: 7, number: 1 })).toBe('R0702001');
    expect(formatRuleId({ kind: '国内法', year: 4, number: 1 })).toBe('R0410001');
    expect(parseRuleId('R0801003')).toEqual({ kind: 'ルール', year: 8, number: 3 });
    expect(parseRuleId('R0899003')).toBeNull();
  });
  it('ルール番号', () => {
    expect(formatRuleNumber({ kind: 'ルール', year: 7, number: 1 })).toBe('令和7年ルール第1号');
    expect(formatRuleNumber({ kind: '国内法', year: 4, number: 1 })).toBe('');
    expect(parseRuleNumber('令和7年ルール施行令第1号')).toEqual({
      kind: 'ルール施行令',
      year: 7,
      number: 1,
    });
  });
});
