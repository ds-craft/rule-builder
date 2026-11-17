// front matter ⇔ RuleMeta。
// ファイル名・permalink・title・rule_number・og_description などは書誌情報から作る。
// 読み込んだファイルのキー順・引用符・自動生成と異なる値は RuleMeta.format に残して書き戻す。

import type { FrontMatterFormat, RuleMeta } from '../model/types.ts';
import {
  formatRuleId,
  formatRuleNumber,
  isRuleKind,
  parseRuleId,
  parseRuleNumber,
} from '../numbering/ruleId.ts';
import { isoToWareki, warekiToIso } from '../numbering/wareki.ts';

/** 既定のキー順（現行ファイルと同じ）。 */
export const CANONICAL_KEYS = [
  'layout',
  'permalink',
  'order',
  'title',
  'rule_name',
  'rule_number',
  'enforcement_date',
  'repealed_date',
  'repealed_by',
  'category',
  'og_description',
] as const;

const DERIVED_KEYS = [
  'layout',
  'permalink',
  'title',
  'rule_name',
  'rule_number',
  'enforcement_date',
  'category',
  'og_description',
] as const;

export type Warning = { line?: number; message: string };

export function ruleIdOf(meta: Pick<RuleMeta, 'kind' | 'year' | 'number'>): string {
  return formatRuleId(meta);
}

/** 書誌情報から自動で作る front matter の値。 */
export function derivedFrontMatter(meta: RuleMeta): Record<(typeof DERIVED_KEYS)[number], string> {
  const ruleNumber = formatRuleNumber(meta);
  return {
    layout: 'rule',
    permalink: `/rule/${ruleIdOf(meta)}.html`,
    title: meta.name,
    rule_name: meta.name,
    rule_number: ruleNumber,
    enforcement_date: meta.enforcementDate ? isoToWareki(meta.enforcementDate) : '',
    category: meta.kind,
    og_description: ruleNumber ? `${meta.name}(${ruleNumber})` : meta.name,
  };
}

/** 書き出す front matter のキーと値（順序つき）。 */
export function frontMatterEntries(meta: RuleMeta): [key: string, value: string][] {
  const values = new Map<string, string>();
  const derived = derivedFrontMatter(meta);
  for (const key of DERIVED_KEYS) values.set(key, derived[key]);
  if (meta.order !== null) values.set('order', String(meta.order));
  for (const [k, v] of Object.entries(meta.extra)) values.set(k, v);
  for (const [k, v] of Object.entries(meta.format?.overrides ?? {})) {
    if (values.has(k)) values.set(k, v);
  }

  // キーの順序：読み込んだファイルの順を基本に、足りないキーは既定の位置に差し込む
  const order: string[] = meta.format ? meta.format.keys.filter((k) => values.has(k)) : [];
  const canonical: readonly string[] = CANONICAL_KEYS;
  for (const key of values.keys()) {
    if (order.includes(key)) continue;
    const ci = canonical.indexOf(key);
    if (ci < 0) {
      order.push(key);
      continue;
    }
    // 既定の順で直前にあたるキーのうち、既に並んでいる最後のものの後ろに入れる
    let pos = -1;
    for (let i = ci - 1; i >= 0 && pos < 0; i--) pos = order.indexOf(canonical[i]!);
    if (pos < 0) {
      for (let i = ci + 1; i < canonical.length && pos < 0; i++) {
        const j = order.indexOf(canonical[i]!);
        if (j >= 0) pos = j - 1;
      }
    }
    order.splice(pos + 1, 0, key);
  }
  return order.map((k) => [k, values.get(k)!]);
}

const NEEDS_QUOTE_RE = /^[\s"'{[\]&*!|>%@`#,?:-]|: |\s#|\s$/;

export function serializeFrontMatter(meta: RuleMeta): string {
  const quoted = new Set(meta.format?.quoted ?? []);
  const lines = frontMatterEntries(meta).map(([k, v]) => {
    const q = quoted.has(k) || v === '' || NEEDS_QUOTE_RE.test(v);
    return `${k}: ${q ? JSON.stringify(v) : v}`;
  });
  return ['---', ...lines, '---'].join('\n') + '\n';
}

/** front matter の本文（--- の間の行）を RuleMeta に変換する。 */
export function parseFrontMatter(
  lines: readonly string[],
  firstLine = 2,
): { meta: RuleMeta; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const raw = new Map<string, string>();
  const format: FrontMatterFormat = { keys: [], quoted: [], overrides: {} };
  lines.forEach((line, i) => {
    const m = /^([A-Za-z_][\w-]*):\s?(.*)$/.exec(line);
    if (!m) {
      warnings.push({ line: firstLine + i, message: `front matter の行を解釈できません: ${line}` });
      return;
    }
    const key = m[1]!;
    let value = m[2]!;
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value) as string;
        format.quoted.push(key);
      } catch {
        warnings.push({ line: firstLine + i, message: `値を解釈できません: ${line}` });
      }
    }
    format.keys.push(key);
    raw.set(key, value);
  });

  const take = (k: string): string | undefined => {
    const v = raw.get(k);
    raw.delete(k);
    return v;
  };

  const category = take('category') ?? '';
  const kind = isRuleKind(category) ? category : 'ルール';
  if (!isRuleKind(category)) warnings.push({ message: `種類（category）が不明です: ${category}` });

  const ruleNumberSrc = take('rule_number') ?? '';
  const permalink = take('permalink') ?? '';
  let num = parseRuleNumber(ruleNumberSrc);
  if (!num) {
    // 国内法は rule_number が空。ID（rule_id か permalink の R0000000）から番号を得る
    const id = raw.get('rule_id') ?? /R\d{7}/.exec(permalink)?.[0] ?? '';
    num = parseRuleId(id);
    if (!num) warnings.push({ message: `ルール番号を解釈できません: ${ruleNumberSrc}` });
  }

  const name = take('rule_name') ?? take('title') ?? '';
  const enforcementSrc = take('enforcement_date') ?? '';
  const enforcementDate = enforcementSrc ? (warekiToIso(enforcementSrc) ?? '') : '';
  if (enforcementSrc && !enforcementDate) {
    warnings.push({ message: `施行日を解釈できません: ${enforcementSrc}` });
  }
  const orderSrc = take('order');
  const order = orderSrc !== undefined && /^\d+$/.test(orderSrc) ? Number(orderSrc) : null;

  const fileValues: Record<string, string | undefined> = {
    layout: take('layout'),
    permalink,
    title: take('title'),
    rule_name: name,
    rule_number: ruleNumberSrc,
    enforcement_date: enforcementSrc,
    category,
    og_description: take('og_description'),
  };
  if (orderSrc !== undefined && order === null) raw.set('order', orderSrc);

  const meta: RuleMeta = {
    kind: num?.kind ?? kind,
    year: num?.year ?? 0,
    number: num?.number ?? 0,
    name,
    enforcementDate,
    order,
    extra: Object.fromEntries(raw),
    format,
  };

  const derived = derivedFrontMatter(meta);
  for (const key of DERIVED_KEYS) {
    const v = fileValues[key];
    if (v !== undefined && v !== derived[key]) format.overrides[key] = v;
  }
  return { meta, warnings };
}
