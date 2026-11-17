// ルールの種類・番号とファイル名（ID）。ID は R＋年2桁＋種別2桁＋号3桁（例 R0701001）。

export type RuleKind = 'ルール' | 'ルール施行令' | '国内法';

export const RULE_KINDS: readonly RuleKind[] = ['ルール', 'ルール施行令', '国内法'];

const KIND_CODE: Record<RuleKind, string> = { ルール: '01', ルール施行令: '02', 国内法: '10' };

export function isRuleKind(s: string): s is RuleKind {
  return (RULE_KINDS as readonly string[]).includes(s);
}

export type RuleNumber = { kind: RuleKind; year: number; number: number };

export function formatRuleId({ kind, year, number }: RuleNumber): string {
  return `R${String(year).padStart(2, '0')}${KIND_CODE[kind]}${String(number).padStart(3, '0')}`;
}

export function parseRuleId(id: string): RuleNumber | null {
  const m = /^R(\d{2})(\d{2})(\d{3})$/.exec(id);
  if (!m) return null;
  const kind = RULE_KINDS.find((k) => KIND_CODE[k] === m[2]);
  if (!kind) return null;
  return { kind, year: Number(m[1]), number: Number(m[3]) };
}

/** 「令和7年ルール第1号」。国内法は番号を持たないため空文字。 */
export function formatRuleNumber({ kind, year, number }: RuleNumber): string {
  if (kind === '国内法') return '';
  return `令和${year}年${kind}第${number}号`;
}

export function parseRuleNumber(s: string): RuleNumber | null {
  const m = /^令和(元|\d+)年(ルール施行令|ルール)第(\d+)号$/.exec(s);
  if (!m) return null;
  return {
    kind: m[2] as RuleKind,
    year: m[1] === '元' ? 1 : Number(m[1]),
    number: Number(m[3]),
  };
}
