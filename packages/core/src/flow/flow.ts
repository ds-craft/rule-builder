// 発議・採決・自動反映（手順書 Phase 10）で、画面とサーバーが同じに扱うもの。
//   - 状態の表示名と、編集・公開リンク・取り下げの可否
//   - 固定した内容のハッシュ（運営投票の本文に載せ、反映の前に確かめる）
//   - 改正ルール番号の付け替え（可決後に仮番号が埋まっていたとき）
//   - 施行日の 0時（JST）

import type { AmendingNumber, Proposal, ProposalStatus } from '../model/proposal.ts';
import { exportProposal, type ExportResult } from '../output/export.ts';
import { formatRuleNumber } from '../numbering/ruleId.ts';

export const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: '下書き',
  unei_discussion: '運営内協議',
  mod_vote: '運営投票中',
  participant_discussion: '参加者協議',
  participant_vote: '参加者投票中',
  passed: '可決（施行前）',
  enacted: '反映済み',
  rejected: '否決',
};

export const PROPOSAL_STATUSES = Object.keys(STATUS_LABEL) as ProposalStatus[];

export function isProposalStatus(s: unknown): s is ProposalStatus {
  return typeof s === 'string' && s in STATUS_LABEL;
}

/** 運営者が本文を編集できる（運営投票の開始後は固定） */
export const isEditable = (s: ProposalStatus) => s === 'draft' || s === 'unei_discussion';

/** 公開リンクで見られる（発議済み） */
export const isPublished = (s: ProposalStatus) => s !== 'draft';

/** 取り下げられる（可決より前） */
export const isWithdrawable = (s: ProposalStatus) =>
  s === 'unei_discussion' ||
  s === 'mod_vote' ||
  s === 'participant_discussion' ||
  s === 'participant_vote';

/** 進み具合の段階（発議ページの表示用） */
export const FLOW_STEPS = [
  { key: 'proposed', label: '発議' },
  { key: 'unei_discussion', label: '運営内協議' },
  { key: 'mod_vote', label: '運営投票' },
  { key: 'participant_discussion', label: '参加者協議' },
  { key: 'participant_vote', label: '参加者投票' },
  { key: 'passed', label: '可決（施行前）' },
  { key: 'enacted', label: '反映' },
] as const;

/** いまの段階の位置（FLOW_STEPS の添字）。否決は投票の段階で止まる */
export function flowStepIndex(s: ProposalStatus): number {
  switch (s) {
    case 'draft':
      return -1;
    case 'unei_discussion':
      return 1;
    case 'mod_vote':
      return 2;
    case 'participant_discussion':
      return 3;
    case 'participant_vote':
      return 4;
    case 'passed':
      return 5;
    case 'enacted':
      return 6;
    case 'rejected':
      return -1;
  }
}

// ---------- 内容のハッシュ ----------

/** ハッシュの元にする並び（改正ルール番号・施行日・書き出すファイル・消すファイル） */
export function contentForHash(p: Proposal, ex: ExportResult = exportProposal(p)): string {
  return JSON.stringify({
    amendingNumber: formatRuleNumber(p.amendingNumber),
    enforcementDate: p.enforcementDate,
    files: ex.files.map((f) => ({ path: f.path, content: f.content })),
    deletes: ex.deletes,
  });
}

/** 内容のハッシュ（sha256:…）。WebCrypto を使うので画面・Workers・Node のどれでも同じ値になる */
export async function contentHash(p: Proposal, ex?: ExportResult): Promise<string> {
  const bytes = new TextEncoder().encode(contentForHash(p, ex));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// ---------- 改正ルール番号の付け替え ----------

const sameNumber = (a: AmendingNumber, b: AmendingNumber) =>
  a.kind === b.kind && a.year === b.year && a.number === b.number;

/**
 * 改正ルール番号を付け替える（手順書 10-6.1）。仮番号と同じ番号で制定するルールは、そのルールの番号も変える
 * （ファイル名・permalink は書誌情報から作るので、書き出し直せば変わる）。廃止の repealed_by も書き出しで変わる。
 */
export function renumberProposal(p: Proposal, next: AmendingNumber): Proposal {
  const prev = p.amendingNumber;
  return {
    ...p,
    amendingNumber: { ...next },
    entries: p.entries.map((e) => {
      if (e.op !== 'create' || !sameNumber(e.doc.meta, prev)) return e;
      return { ...e, doc: { ...e.doc, meta: { ...e.doc.meta, number: next.number } } };
    }),
  };
}

// ---------- 施行日 ----------

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 施行日（YYYY-MM-DD）の 0時（JST）のミリ秒。形式が違えば NaN */
export function enforcementInstant(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  return Date.parse(`${date}T00:00:00+09:00`);
}

/** JST での今日（YYYY-MM-DD） */
export function jstToday(now = Date.now()): string {
  return new Date(now + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 施行日がまだ来ていない（今日より後）。施行前として pending/ に置く */
export const isFutureEnforcement = (date: string, now = Date.now()) => date > jstToday(now);
