// 和暦（令和）と ISO 形式の日付の変換。

const REIWA_START = 2018; // 令和1年 = 2019年

/** 西暦年 → 令和の年。 */
export function reiwaYear(year: number): number {
  return year - REIWA_START;
}

/** '2026-11-17' → '令和8年11月17日'。 */
export function isoToWareki(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`日付の形式が正しくありません: ${iso}`);
  const y = reiwaYear(Number(m[1]));
  if (y < 1) throw new Error(`令和より前の日付は扱えません: ${iso}`);
  return `令和${y}年${Number(m[2])}月${Number(m[3])}日`;
}

/** '令和8年11月17日'・'令和元年5月1日' → '2026-11-17'。解釈できなければ null。 */
export function warekiToIso(s: string): string | null {
  const m = /^令和(元|\d+)年(\d+)月(\d+)日$/.exec(s.trim());
  if (!m) return null;
  const y = (m[1] === '元' ? 1 : Number(m[1])) + REIWA_START;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
