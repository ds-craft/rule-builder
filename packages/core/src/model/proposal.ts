// 改正案：作業の単位。1回の改正（改正ルール番号1つ）で制定・改正・廃止するルールをまとめる。
// 実体は1つの Yjs 文書（ydoc/proposal.ts）で、この型は読み書きのための見え方。

import type { RuleKind } from '../numbering/ruleId.ts';
import type { RuleDoc } from './types.ts';

export type AmendingNumber = { kind: RuleKind; year: number; number: number };

/**
 * 改正案の状態（手順書 10-1）。サーバーだけが変える（Yjs 文書の meta.status は使わず、下書きのまま）。
 * 取り下げると下書きに戻る。
 */
export type ProposalStatus =
  | 'draft'
  | 'unei_discussion'
  | 'mod_vote'
  | 'participant_discussion'
  | 'participant_vote'
  | 'passed'
  | 'enacted'
  | 'rejected';

export type ProposalMeta = {
  id: string;
  /** 改正ルール番号 */
  amendingNumber: AmendingNumber;
  /** 施行日（ISO）。未定なら空 */
  enforcementDate: string;
  /** コミット本文の説明行（任意） */
  summary: string;
  status: ProposalStatus;
  /** 最後に変更した日時（ISO） */
  updatedAt: string;
};

export type ProposalEntry =
  | { entryId: string; op: 'create'; doc: RuleDoc }
  | {
      entryId: string;
      op: 'amend';
      ruleId: string;
      baseSha: string;
      baseMarkdown: string;
      doc: RuleDoc;
    }
  /** 廃止（F-06）。本文は編集しない */
  | { entryId: string; op: 'repeal'; ruleId: string; baseSha: string; baseMarkdown: string };

export type Proposal = ProposalMeta & { entries: ProposalEntry[] };

export type EntryOp = ProposalEntry['op'];
