// 書き出し（F-31・F-33）：改正案から、ds-craft/rules に置くファイルとコミット情報を組み立てる。
// 現行の rules リポジトリのコミットと同じ形にする（作者＝改正ルール番号、日時＝施行日 0時、本文にトレーラー）。
//   件名：〈ルール名〉 施行 ／ 〈対象〉の一部を改正するルール 施行（施行令なら「…の一部を改正する施行令」）
//   本文：令和8年ルール第4号 ／ 〈説明行（任意）〉 ／ 空行 ／ Rule-Id・Enforced・Repeals

import { parseRule } from '../markdown/parse.ts';
import { serializeRule } from '../markdown/serialize.ts';
import type { Proposal, ProposalEntry } from '../model/proposal.ts';
import { formatRuleId, formatRuleNumber, type RuleKind } from '../numbering/ruleId.ts';
import { isoToWareki } from '../numbering/wareki.ts';

export type ExportFile = {
  entryId: string;
  op: ProposalEntry['op'];
  ruleId: string;
  name: string;
  /** リポジトリの中のパス（rules/R0801004.md・rules/repealed/R0401003.md） */
  path: string;
  content: string;
};

export type ExportResult = {
  /** 書き出すファイル（改正のないルールは含めない） */
  files: ExportFile[];
  /** 元の場所から消すファイル（廃止で rules/repealed/ に移すもの） */
  deletes: string[];
  /** 原文と同じで書き出さないルール */
  unchanged: { entryId: string; name: string }[];
};

/** 改正ルールの ID（令和8年ルール第4号 → R0801004） */
export const amendingId = (p: Pick<Proposal, 'amendingNumber'>) => formatRuleId(p.amendingNumber);

export function exportProposal(p: Proposal): ExportResult {
  const result: ExportResult = { files: [], deletes: [], unchanged: [] };
  for (const e of p.entries) {
    if (e.op === 'repeal') {
      // 廃止：rules/<ID>.md を rules/repealed/<ID>.md に移し、repealed_date・repealed_by を足す
      const doc = parseRule(e.baseMarkdown).doc;
      doc.meta.extra = {
        ...doc.meta.extra,
        repealed_date: p.enforcementDate ? isoToWareki(p.enforcementDate) : '',
        repealed_by: amendingId(p),
      };
      result.files.push({
        entryId: e.entryId,
        op: e.op,
        ruleId: e.ruleId,
        name: doc.meta.name,
        path: `rules/repealed/${e.ruleId}.md`,
        content: serializeRule(doc),
      });
      result.deletes.push(`rules/${e.ruleId}.md`);
      continue;
    }
    const content = serializeRule(e.doc);
    if (e.op === 'amend' && content === e.baseMarkdown) {
      result.unchanged.push({ entryId: e.entryId, name: e.doc.meta.name });
      continue;
    }
    const id = formatRuleId(e.doc.meta);
    result.files.push({
      entryId: e.entryId,
      op: e.op,
      ruleId: e.op === 'amend' ? e.ruleId : id,
      name: e.doc.meta.name,
      path: `rules/${id}.md`,
      content,
    });
  }
  return result;
}

const AMEND_SUFFIX: Record<RuleKind, string> = {
  ルール: 'の一部を改正するルール',
  ルール施行令: 'の一部を改正する施行令',
  国内法: 'の一部を改正する国内法',
};

const REPEAL_SUFFIX: Record<RuleKind, string> = {
  ルール: 'を廃止するルール',
  ルール施行令: 'を廃止する施行令',
  国内法: 'を廃止する国内法',
};

/** 件名の既定値：新規ルールがあればその名称、なければ先頭の改正対象で組み立てる */
export function defaultSubject(p: Proposal, ex: ExportResult = exportProposal(p)): string {
  const created = ex.files.find((f) => f.op === 'create');
  if (created) return `${created.name || '（名称未設定）'} 施行`;
  const amended = ex.files.find((f) => f.op === 'amend');
  if (amended) return `${amended.name}${AMEND_SUFFIX[p.amendingNumber.kind]} 施行`;
  const repealed = ex.files.find((f) => f.op === 'repeal');
  if (repealed) return `${repealed.name}${REPEAL_SUFFIX[p.amendingNumber.kind]} 施行`;
  return '（ルールがありません） 施行';
}

export type CommitInfo = {
  subject: string;
  /** コミットメッセージ全体（commit-message.txt の中身） */
  message: string;
  authorName: string;
  /** 2026-12-01T00:00:00+09:00（施行日が未定なら YYYY-MM-DD のまま） */
  date: string;
};

export function commitInfo(
  p: Proposal,
  subject?: string,
  ex: ExportResult = exportProposal(p),
): CommitInfo {
  const number = formatRuleNumber(p.amendingNumber);
  const enforced = p.enforcementDate || 'YYYY-MM-DD';
  const ruleIds = ex.files.filter((f) => f.op !== 'repeal').map((f) => `Rule-Id: ${f.ruleId}`);
  const repeals = ex.files.filter((f) => f.op === 'repeal').map((f) => `Repeals: ${f.ruleId}`);
  const subj = subject ?? defaultSubject(p, ex);
  const lines = [subj, '', number];
  if (p.summary.trim()) lines.push(p.summary.trim());
  lines.push('', ...ruleIds, `Enforced: ${enforced}`, ...repeals);
  return {
    subject: subj,
    message: lines.join('\n') + '\n',
    authorName: number,
    date: `${enforced}T00:00:00+09:00`,
  };
}

/** git でコミットするコマンドの例（作者・コミッターとも改正ルール番号、メールは空、日時は施行日 0時） */
export function gitCommitCommand(c: CommitInfo, ex?: ExportResult): string {
  const lines: string[] = [];
  if (ex?.deletes.length) lines.push(`git rm ${ex.deletes.join(' ')}`);
  if (ex?.files.length) lines.push(`git add ${ex.files.map((f) => f.path).join(' ')}`);
  lines.push(
    `GIT_AUTHOR_NAME="${c.authorName}" GIT_AUTHOR_EMAIL="" \\\n` +
      `GIT_AUTHOR_DATE="${c.date}" \\\n` +
      `GIT_COMMITTER_NAME="${c.authorName}" GIT_COMMITTER_EMAIL="" \\\n` +
      `GIT_COMMITTER_DATE="${c.date}" \\\n` +
      'git commit -F commit-message.txt',
  );
  return lines.join('\n');
}

/** 施行前としてポータルに載せるための pending/<改正ルールID>/ 一式（Phase 10-6 と同じ形式） */
export function pendingFiles(
  p: Proposal,
  c: CommitInfo,
  ex: ExportResult = exportProposal(p),
): { path: string; content: string }[] {
  const base = `pending/${amendingId(p)}`;
  const info = {
    amendingNumber: formatRuleNumber(p.amendingNumber),
    amendingId: amendingId(p),
    enforcementDate: p.enforcementDate,
    subject: c.subject,
    rules: ex.files.map((f) => ({ id: f.ruleId, op: f.op })),
    publicUrl: null,
  };
  return [
    { path: `${base}/pending.json`, content: JSON.stringify(info, null, 2) + '\n' },
    ...ex.files.map((f) => ({ path: `${base}/${f.path}`, content: f.content })),
  ];
}
