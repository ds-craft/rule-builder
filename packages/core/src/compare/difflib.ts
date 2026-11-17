// Python の difflib.SequenceMatcher（isjunk なし・autojunk=False）の移植。
// 新旧対照表を portal の script/rule_history.py と同じ結果にするため、同じアルゴリズムを使う。
// 移植元: CPython Lib/difflib.py（SequenceMatcher）

export type Opcode = ['replace' | 'delete' | 'insert' | 'equal', number, number, number, number];
type Match = [number, number, number];

export class SequenceMatcher<T> {
  private a: readonly T[];
  private b: readonly T[];
  private b2j = new Map<T, number[]>();
  private matchingBlocks: Match[] | null = null;
  private opcodes: Opcode[] | null = null;

  constructor(a: readonly T[], b: readonly T[]) {
    this.a = a;
    this.b = b;
    b.forEach((elt, i) => {
      const list = this.b2j.get(elt);
      if (list) list.push(i);
      else this.b2j.set(elt, [i]);
    });
  }

  findLongestMatch(alo: number, ahi: number, blo: number, bhi: number): Match {
    const { a, b, b2j } = this;
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map<number, number>();
      for (const j of b2j.get(a[i]!) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = newj2len;
    }
    // 迷惑な要素（junk・popular）はないので、前後への延長は Python と同じ条件で行うだけ
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti--;
      bestj--;
      bestsize++;
    }
    while (
      besti + bestsize < ahi &&
      bestj + bestsize < bhi &&
      a[besti + bestsize] === b[bestj + bestsize]
    ) {
      bestsize++;
    }
    return [besti, bestj, bestsize];
  }

  getMatchingBlocks(): Match[] {
    if (this.matchingBlocks) return this.matchingBlocks;
    const la = this.a.length;
    const lb = this.b.length;
    const queue: [number, number, number, number][] = [[0, la, 0, lb]];
    const blocks: Match[] = [];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop()!;
      const x = this.findLongestMatch(alo, ahi, blo, bhi);
      const [i, j, k] = x;
      if (k) {
        blocks.push(x);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    blocks.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    // 隣り合うものをまとめる
    let i1 = 0;
    let j1 = 0;
    let k1 = 0;
    const nonAdjacent: Match[] = [];
    for (const [i2, j2, k2] of blocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
      else {
        if (k1) nonAdjacent.push([i1, j1, k1]);
        i1 = i2;
        j1 = j2;
        k1 = k2;
      }
    }
    if (k1) nonAdjacent.push([i1, j1, k1]);
    nonAdjacent.push([la, lb, 0]);
    this.matchingBlocks = nonAdjacent;
    return nonAdjacent;
  }

  getOpcodes(): Opcode[] {
    if (this.opcodes) return this.opcodes;
    let i = 0;
    let j = 0;
    const answer: Opcode[] = [];
    for (const [ai, bj, size] of this.getMatchingBlocks()) {
      let tag: Opcode[0] | '' = '';
      if (i < ai && j < bj) tag = 'replace';
      else if (i < ai) tag = 'delete';
      else if (j < bj) tag = 'insert';
      if (tag) answer.push([tag, i, ai, j, bj]);
      i = ai + size;
      j = bj + size;
      if (size) answer.push(['equal', ai, i, bj, j]);
    }
    this.opcodes = answer;
    return answer;
  }

  ratio(): number {
    const matches = this.getMatchingBlocks().reduce((n, m) => n + m[2], 0);
    const length = this.a.length + this.b.length;
    return length ? (2 * matches) / length : 1;
  }
}

/** 文字単位で比べるための並び（Python と同じくコードポイント単位） */
export const chars = (s: string): string[] => Array.from(s);
