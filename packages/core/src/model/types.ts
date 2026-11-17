// 内部モデル：ルール＝書誌情報＋構造の木。
// 項・号・細分の番号は持たない（位置から算出する）。条番号は利用者が振り方を選ぶため持つ。
// モデルはイミュータブルに扱う。

import type { ArticleNum, DivisionLevel } from '../numbering/article.ts';
import type { RuleKind } from '../numbering/ruleId.ts';

export type { ArticleNum, DivisionLevel, RuleKind };

export type RuleDoc = { meta: RuleMeta; body: TopBlock[] };

export type RuleMeta = {
  kind: RuleKind;
  /** 令和の年 */
  year: number;
  /** 号 */
  number: number;
  /** rule_name（title と同じ） */
  name: string;
  /** ISO 形式 YYYY-MM-DD（出力時に和暦へ）。未定なら空文字 */
  enforcementDate: string;
  /** 並び順。過去の版のファイルには無い */
  order: number | null;
  /** repealed_date など、上で扱わないキー（値は文字列のまま保持して書き戻す） */
  extra: Record<string, string>;
  /** 読み込んだファイルの front matter の書き方。新規作成時は無し（既定の書き方で出す） */
  format?: FrontMatterFormat;
};

/** front matter の書き方（往復で元と一致させるための情報）。 */
export type FrontMatterFormat = {
  /** キーの順序 */
  keys: string[];
  /** 値を "…" で囲んで書いていたキー */
  quoted: string[];
  /** 書誌情報から自動で作る値（title・permalink など）と異なっていたキーの値 */
  overrides: Record<string, string>;
};

export type TopBlock = Preamble | Division | Article | Supplementary | Prose | Appendix | RawLine;

export type DivisionChild = Division | Article | Prose | RawLine;

/** 章（##）・節（###）・款（####） */
export type Division = {
  type: 'division';
  level: DivisionLevel;
  num: number;
  title: string;
  /** 「第1章」と見出しの間の空白（半角または全角）。既定は半角 */
  sep?: string;
  children: DivisionChild[];
};

/** 条（#####） */
export type Article = {
  type: 'article';
  /** 例 { main: 2, branches: [2] } → 第2条の2。null は番号のない条（「（見出し）」だけのもの） */
  num: ArticleNum | null;
  /** （ ）の中の見出し。空なら見出しなし */
  caption: string;
  /** {: data-general="true"} */
  general: boolean;
  /** 「第5条　削除」として残した条。true なら caption・paragraphs は空 */
  deleted: boolean;
  /** 項。1つだけなら番号を付けない（portal の single） */
  paragraphs: Paragraph[];
};

/** 番号のない続きの行（行頭の全角空白も含めた原文のまま）。現行では廃止ルールの一部にだけある */
export type ContinuationLines = Inline[][];

/** 項（①…） */
export type Paragraph = { text: Inline[]; cont?: ContinuationLines; items: Item[] };
/** 号（一…） */
export type Item = { text: Inline[]; cont?: ContinuationLines; subitems: SubItem[] };
/** 号の細分（イ…） */
export type SubItem = { text: Inline[]; cont?: ContinuationLines };

export type Inline =
  | { kind: 'text'; value: string }
  | { kind: 'link'; href: string; title?: string; children: Inline[] };

/** 前文（## 前文）。各行は原文のまま（行頭の全角空白も含む） */
export type Preamble = { type: 'preamble'; lines: Inline[][] };

/** 附則（## 附則）。中に「##### 附則」「##### 改正附則（…）」などの見出しを持つことがある */
export type Supplementary = {
  type: 'supplementary';
  /** ## 附則 の直後、見出しの前にある行 */
  lines: Inline[][];
  provisions: SupplementaryProvision[];
};

export type SupplementaryProvision = {
  /** ##### の後の文言（「附則」「施行附則（令和7年6月19日施行）」「第1条（施行期日）」など） */
  heading: string;
  general: boolean;
  lines: Inline[][];
};

/** 条の見出しがない本文（施行令の本則など）。各行は原文のまま */
export type Prose = { type: 'prose'; lines: Inline[][] };

/** 別表（## 別表第一（…））。各行は原文のまま */
export type Appendix = { type: 'appendix'; heading: string; lines: Inline[][] };

/** 解釈できなかった行 */
export type RawLine = { type: 'raw'; source: string; reason: string };
