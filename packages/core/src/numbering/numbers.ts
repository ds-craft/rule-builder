// 項・号・号の細分の番号。portal の _includes/rule-scripts.html の正規表現に合わせる。
// 移植元: ds-craft/portal _includes/rule-scripts.html（fb5a7ef）

/** 項の番号として使える最大値（㊿）。 */
export const MAX_KOU = 50;

/** 項：1 → ①、21 → ㉑、36 → ㊱。範囲外はエラー。 */
export function kouNumber(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > MAX_KOU) {
    throw new RangeError(`項の番号は1〜${MAX_KOU}までです: ${n}`);
  }
  if (n <= 20) return String.fromCodePoint(0x2460 + n - 1);
  if (n <= 35) return String.fromCodePoint(0x3251 + n - 21);
  return String.fromCodePoint(0x32b1 + n - 36);
}

/** 項の番号の文字を数に戻す。項の番号でなければ null。 */
export function parseKouNumber(ch: string): number | null {
  const cp = ch.codePointAt(0);
  if (cp === undefined || ch.length !== 1) return null;
  if (cp >= 0x2460 && cp <= 0x2473) return cp - 0x2460 + 1;
  if (cp >= 0x3251 && cp <= 0x325f) return cp - 0x3251 + 21;
  if (cp >= 0x32b1 && cp <= 0x32bf) return cp - 0x32b1 + 36;
  return null;
}

const KANJI_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 号：1 → 一、10 → 十、11 → 十一、20 → 二十、99 → 九十九。 */
export function gouNumber(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) {
    throw new RangeError(`号の番号は1〜99までです: ${n}`);
  }
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const t = tens === 0 ? '' : tens === 1 ? '十' : KANJI_DIGITS[tens] + '十';
  return t + KANJI_DIGITS[ones];
}

/** 漢数字の号の番号を数に戻す（一〜九十九）。解釈できなければ null。 */
export function parseGouNumber(s: string): number | null {
  const m = /^(?:([二三四五六七八九]?)十)?([一二三四五六七八九]?)$/.exec(s);
  if (!m || s === '') return null;
  const tens = s.includes('十') ? (m[1] ? KANJI_DIGITS.indexOf(m[1]) : 1) : 0;
  return tens * 10 + (m[2] ? KANJI_DIGITS.indexOf(m[2]) : 0);
}

/** 号の細分の順序（portal の SAIBUN_RE と同じイロハ順）。 */
export const SAIBUN_ORDER =
  'イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセス';

/** 号の細分：1 → イ、2 → ロ … */
export function saibunNumber(n: number): string {
  const ch = SAIBUN_ORDER[n - 1];
  if (!Number.isInteger(n) || n < 1 || ch === undefined) {
    throw new RangeError(`号の細分の番号は1〜${SAIBUN_ORDER.length}までです: ${n}`);
  }
  return ch;
}

export function parseSaibunNumber(ch: string): number | null {
  const i = SAIBUN_ORDER.indexOf(ch);
  return ch.length === 1 && i >= 0 ? i + 1 : null;
}

// 行頭の判定（portal と同じ正規表現）
export const KOU_RE = /^[①-⑳㉑-㉟㊱-㊿]/;
export const GOU_RE = /^[一二三四五六七八九十百]+　/;
export const SAIBUN_RE = new RegExp(`^[${SAIBUN_ORDER}]　`);

export type LineKind = 'kou' | 'gou' | 'saibun' | 'text';

/** 行の文字列から行の種類を判定する（portal の lineKind と同じ）。 */
export function lineKind(text: string): LineKind {
  return KOU_RE.test(text)
    ? 'kou'
    : GOU_RE.test(text)
      ? 'gou'
      : SAIBUN_RE.test(text)
        ? 'saibun'
        : 'text';
}
