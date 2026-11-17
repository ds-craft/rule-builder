// 新旧対照表（F-32）。改正された条（見出しごとのかたまり）だけを、左に改正後・右に改正前で並べ、
// 変わった文字に傍線を引く。portal の「条文比較」と同じ HTML を出す。
// 移植元: ds-craft/portal script/rule_history.py（fb5a7ef）の blocks・mark_lines・to_lines・align・
//         pair_blocks・compare_lines・line_div・none_div・group_rows・whole_rows・compare_html

import { chars, SequenceMatcher } from './difflib.ts';

const LINK_RE = /\[([^\]]*)\]\([^)]*\)/g;

/** Python の html.escape（quote=True）と同じ */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** front matter（rule_name だけ使う）と本文に分ける（rule_history.py の split_front_matter と同じ） */
export function splitFrontMatter(text: string): { fm: Record<string, string>; body: string } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return { fm: {}, body: text };
  const end = lines.indexOf('---', 1);
  const fm: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    let value = line.slice(i + 1).trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && `"'`.includes(value[0]!)) {
      value = value.slice(1, -1);
    }
    fm[line.slice(0, i).trim()] = value;
  }
  return { fm, body: lines.slice(end + 1).join('\n') };
}

type Block = { heading: string; lines: string[]; key: string };

/** 本文を見出しごとのかたまりに分ける。kramdown の属性行（{: ...}）は除き、リンクは文字だけにする */
export function blocks(body: string): Block[] {
  const result: { heading: string; lines: string[] }[] = [];
  let cur: { heading: string; lines: string[] } | null = null;
  for (const line of body.split('\n')) {
    if (line.startsWith('#')) {
      cur = { heading: line.replace(/^#+/, '').trim(), lines: [] };
      result.push(cur);
    } else if (line.trim().startsWith('{:')) {
      continue;
    } else {
      if (!cur) {
        cur = { heading: '', lines: [] };
        result.push(cur);
      }
      if (line.trim()) cur.lines.push(line.replace(LINK_RE, '$1'));
    }
  }
  return result
    .map((b) => ({ ...b, key: b.heading + '\n' + b.lines.join('\n') }))
    .filter((b) => b.heading || b.lines.length);
}

type Seg = [text: string, marked: boolean];
type MarkedLine = [html: string, changed: boolean];

/** 文字単位で比べ、変わった部分に印を付ける。行ごとの (HTML, 変わったか) を (改正前, 改正後) で返す */
export function markLines(old: string, neu: string): [MarkedLine[], MarkedLine[]] {
  const a = chars(old);
  const b = chars(neu);
  const sm = new SequenceMatcher(a, b);
  const oseg: Seg[] = [];
  const nseg: Seg[] = [];
  for (const [tag, i1, i2, j1, j2] of sm.getOpcodes()) {
    if (tag === 'equal') {
      oseg.push([a.slice(i1, i2).join(''), false]);
      nseg.push([b.slice(j1, j2).join(''), false]);
    } else {
      if (i2 > i1) oseg.push([a.slice(i1, i2).join(''), true]);
      if (j2 > j1) nseg.push([b.slice(j1, j2).join(''), true]);
    }
  }
  return [toLines(oseg, 'del'), toLines(nseg, 'ins')];
}

/** (文字列, 変わったか) の並びを行に分ける。印は行をまたがないよう行ごとに付け直す */
function toLines(segments: Seg[], tag: string): MarkedLine[] {
  const lines: string[][] = [[]];
  const changed: boolean[] = [false];
  for (const [text, marked] of segments) {
    text.split('\n').forEach((part, k) => {
      if (k > 0) {
        lines.push([]);
        changed.push(false);
      }
      if (part) {
        lines[lines.length - 1]!.push(
          marked ? `<${tag} class="diff-mark">${escapeHtml(part)}</${tag}>` : escapeHtml(part),
        );
        changed[changed.length - 1] = changed[changed.length - 1]! || marked;
      }
    });
  }
  return lines.map((l, i) => [l.join(''), changed[i]!]);
}

/** 改正前後の行を同じ項・号の改正とみなす似ている度合いの下限 */
const SIMILAR = 0.45;

/** 順序を保ったまま、似ている行どうしを組にする（似ている度合いの合計が最大になる組み合わせ） */
function align(olds: string[], news: string[]): [string | null, string | null][] {
  const n = olds.length;
  const m = news.length;
  const sim = olds.map((o) => news.map((w) => new SequenceMatcher(chars(o), chars(w)).ratio()));
  const best = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = sim[i]![j]!;
      const take = s >= SIMILAR ? best[i + 1]![j + 1]! + s : -1;
      best[i]![j] = Math.max(take, best[i + 1]![j]!, best[i]![j + 1]!);
    }
  }
  const pairs: [string | null, string | null][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const s = sim[i]![j]!;
    if (s >= SIMILAR && best[i]![j] === best[i + 1]![j + 1]! + s) {
      pairs.push([olds[i]!, news[j]!]);
      i++;
      j++;
    } else if (best[i]![j] === best[i + 1]![j]) {
      pairs.push([olds[i]!, null]);
      i++;
    } else {
      pairs.push([null, news[j]!]);
      j++;
    }
  }
  return [
    ...pairs,
    ...olds.slice(i).map((o): [string, null] => [o, null]),
    ...news.slice(j).map((w): [null, string] => [null, w]),
  ];
}

/** かたまりの並びを比べ、変わったものを (改正前, 改正後) の組にして返す。片方がないものは null */
function pairBlocks(oldBlocks: Block[], newBlocks: Block[]): [Block | null, Block | null][] {
  const pairs: [Block | null, Block | null][] = [];
  const sm = new SequenceMatcher(
    oldBlocks.map((b) => b.key),
    newBlocks.map((b) => b.key),
  );
  for (const [tag, i1, i2, j1, j2] of sm.getOpcodes()) {
    if (tag === 'equal') continue;
    const olds = oldBlocks.slice(i1, i2);
    const news = newBlocks.slice(j1, j2);
    // 範囲の中では、見出しが同じものどうしを組にし、残りは順に組にする
    const sub = new SequenceMatcher(
      olds.map((b) => b.heading),
      news.map((b) => b.heading),
    );
    for (const [, a1, a2, b1, b2] of sub.getOpcodes()) {
      const o = olds.slice(a1, a2);
      const n = news.slice(b1, b2);
      for (let k = 0; k < Math.max(o.length, n.length); k++)
        pairs.push([o[k] ?? null, n[k] ?? null]);
    }
  }
  return pairs;
}

type LinePair = [old: string | null, neu: string | null, changed: boolean];

/** 1つの条の項・号の行を比べ、対応する行どうしの組を返す */
function compareLines(oldLines: string[], newLines: string[]): LinePair[] {
  const pairs: LinePair[] = [];
  const sm = new SequenceMatcher(oldLines, newLines);
  for (const [tag, i1, i2, j1, j2] of sm.getOpcodes()) {
    if (tag === 'equal') {
      for (const l of newLines.slice(j1, j2)) pairs.push([escapeHtml(l), escapeHtml(l), false]);
      continue;
    }
    for (const [o, n] of align(oldLines.slice(i1, i2), newLines.slice(j1, j2))) {
      const [om, nm] = markLines(o ?? '', n ?? '');
      pairs.push([o !== null ? om[0]![0] : null, n !== null ? nm[0]![0] : null, true]);
    }
  }
  return pairs;
}

function lineDiv(content: string | null, changed: boolean, heading = false): string {
  const cls = 'diff-line' + (heading ? ' diff-heading' : '') + (changed ? '' : ' is-same');
  return `<div class="${cls}">${content || '&#8203;'}</div>`;
}

const noneDiv = (label: string) => `<div class="diff-none">${label}</div>`;

function groupRows(pairs: LinePair[], headingPair: LinePair | null = null): string[] {
  const rows: string[] = [];
  const items: [LinePair, boolean][] = [
    ...(headingPair && (headingPair[0] || headingPair[1])
      ? [[headingPair, true] as [LinePair, boolean]]
      : []),
    ...pairs.map((p): [LinePair, boolean] => [p, false]),
  ];
  for (const [[o, n, changed], isHeading] of items) {
    // 改正前にない行（追加された項）は改正前の欄に「（新設）」、改正後にない行（削られた項）は改正後の欄に「（削除）」
    const newCell = n !== null ? lineDiv(n, changed, isHeading) : noneDiv('（削除）');
    const oldCell = o !== null ? lineDiv(o, changed, isHeading) : noneDiv('（新設）');
    rows.push(`<tr><td>${newCell}</td><td>${oldCell}</td></tr>`);
  }
  return rows;
}

/** 条ごと新設・削除されたもの。反対側は条の全部の行にまたがる1つの欄にする */
function wholeRows(heading: string, lines: string[], side: 'new' | 'old'): string[] {
  const tag = side === 'new' ? 'ins' : 'del';
  const divs: string[] = [];
  if (heading)
    divs.push(lineDiv(`<${tag} class="diff-mark">${escapeHtml(heading)}</${tag}>`, true, true));
  for (const l of lines)
    divs.push(lineDiv(`<${tag} class="diff-mark">${escapeHtml(l)}</${tag}>`, true));
  const other = noneDiv(side === 'new' ? '（新設）' : '（削除）');
  return divs.map((d, k) => {
    const span = k === 0 ? `<td rowspan="${divs.length}">${other}</td>` : '';
    return side === 'new' ? `<tr><td>${d}</td>${span}</tr>` : `<tr>${span}<td>${d}</td></tr>`;
  });
}

export type CompareSide = {
  markdown: string;
  /** 施行日（和暦。表の見出しに「（〈施行日〉 施行）」と出す） */
  date: string;
  /** 見出しの括弧書きを差し替える（「（現行）」など） */
  label?: string;
};

/** 改正された条だけを、左に改正後・右に改正前で並べた表（新旧対照表）の HTML */
export function compareHtml(old: CompareSide, neu: CompareSide): string {
  const o = splitFrontMatter(old.markdown);
  const n = splitFrontMatter(neu.markdown);
  const groups: string[][] = [];
  const oldName = o.fm.rule_name ?? '';
  const newName = n.fm.rule_name ?? '';
  if (oldName !== newName) {
    const [om, nm] = markLines(oldName, newName);
    groups.push(groupRows([[om[0]![0], nm[0]![0], true]], ['題名', '題名', false]));
  }
  for (const [ob, nb] of pairBlocks(blocks(o.body), blocks(n.body))) {
    if (ob && nb) {
      const [oh, nh] = markLines(ob.heading, nb.heading);
      const heading: LinePair = [oh[0]![0], nh[0]![0], ob.heading !== nb.heading];
      groups.push(groupRows(compareLines(ob.lines, nb.lines), heading));
    } else if (nb) {
      groups.push(wholeRows(nb.heading, nb.lines, 'new'));
    } else if (ob) {
      groups.push(wholeRows(ob.heading, ob.lines, 'old'));
    }
  }
  if (!groups.length) {
    return '<p class="diff-empty">この改正で、条文の文言は変わっていません（リンクなど表示の変更のみ）。</p>';
  }
  const out = [
    '<table class="diff-table">',
    `<thead><tr><th scope="col">改正後<span class="diff-date">${neu.label ?? `（${neu.date} 施行）`}</span></th>` +
      `<th scope="col">改正前<span class="diff-date">${old.label ?? `（${old.date} 施行）`}</span></th></tr></thead>`,
  ];
  for (const rows of groups) out.push('<tbody>' + rows.join('') + '</tbody>');
  out.push('</table>');
  return out.join('\n');
}
