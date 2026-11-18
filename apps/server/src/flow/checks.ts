// 発議前の確認（F-50・手順書 10-2.1）。画面の一覧と同じ項目を、サーバーでも packages/core でやり直す。
//   - 施行日の入力
//   - 書式チェックのエラー0件（ほかのルールへのリンクは、公開中のルールの見出しで調べる）
//   - 参照の確認の残り0件：候補は編集の操作のたびに画面で作るもので文書に残らないため、画面の件数を受け取る
//   - 元にした版が最新であること（改正・廃止するルールの中身が今の main と同じ）

import {
  exportProposal,
  formatRuleId,
  lintRule,
  parseRule,
  ruleAnchors,
  type LintRuleIndex,
  type Proposal,
} from '@rule-builder/core';
import type { RulesRepo } from '../github/client.ts';
import type { PreflightCheck } from './state.ts';

export type RemoteRules = {
  head: string;
  /** rules/ と rules/repealed/ のファイル（パス → 中身） */
  files: Map<string, string>;
};

/** main の先頭のルールをすべて読む（施行中と廃止） */
export async function readRemoteRules(repo: RulesRepo): Promise<RemoteRules> {
  const head = await repo.headSha();
  if (!head) throw new Error(`${repo.repo} の main が見つかりません`);
  const [active, repealed] = await Promise.all([
    repo.listDir('rules', head),
    repo.listDir('rules/repealed', head),
  ]);
  const paths = [...active, ...repealed]
    .filter((x) => x.type === 'file' && x.name.endsWith('.md'))
    .map((x) => x.path);
  const files = new Map<string, string>();
  await Promise.all(
    paths.map(async (p) => {
      const text = await repo.readFile(p, head);
      if (text !== null) files.set(p, text);
    }),
  );
  return { head, files };
}

const ruleName = (p: Proposal, i: number) => {
  const e = p.entries[i]!;
  if (e.op === 'repeal') return parseRule(e.baseMarkdown).doc.meta.name || e.ruleId;
  return e.doc.meta.name || '（名称未設定）';
};

export function preflight(
  p: Proposal,
  remote: RemoteRules,
  clientRefsRemaining: number,
): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  const ex = exportProposal(p);

  checks.push({
    key: 'entries',
    label: '改正するルールがある',
    ok: ex.files.length > 0,
    details:
      ex.files.length > 0
        ? []
        : ['制定・改正・廃止するルールがありません（原文と同じルールは数えません）'],
  });

  checks.push({
    key: 'enforcement',
    label: '施行日が入力されている',
    ok: /^\d{4}-\d{2}-\d{2}$/.test(p.enforcementDate),
    details: /^\d{4}-\d{2}-\d{2}$/.test(p.enforcementDate)
      ? []
      : ['ファイル画面の「情報」で施行日を入力してください'],
  });

  // ほかのルールへのリンク先：公開中のルール（改正案の中のルールは改正後の見出し）
  const index = new Map<string, { name: string; anchors: ReadonlySet<string> | null }>();
  for (const [path, text] of remote.files) {
    const id = /([^/]+)\.md$/.exec(path)?.[1];
    if (!id) continue;
    const doc = parseRule(text).doc;
    index.set(id, { name: doc.meta.name, anchors: ruleAnchors(doc) });
  }
  for (const e of p.entries) {
    if (e.op === 'repeal') continue;
    const id = e.op === 'amend' ? e.ruleId : formatRuleId(e.doc.meta);
    index.set(id, { name: e.doc.meta.name, anchors: ruleAnchors(e.doc) });
  }
  const lintDetails: string[] = [];
  p.entries.forEach((e, i) => {
    if (e.op === 'repeal') return;
    const ruleId = e.op === 'amend' ? e.ruleId : formatRuleId(e.doc.meta);
    const errors = lintRule(e.doc, { ruleId, rules: index as LintRuleIndex }).filter(
      (x) => x.level === 'error',
    );
    if (errors.length) lintDetails.push(`${ruleName(p, i)}：${errors.length}件`);
  });
  checks.push({
    key: 'lint',
    label: '書式チェックのエラーが0件',
    ok: lintDetails.length === 0,
    details: lintDetails,
  });

  const refs = Math.max(0, Math.floor(Number(clientRefsRemaining) || 0));
  checks.push({
    key: 'refs',
    label: '参照の確認の残りが0件',
    ok: refs === 0,
    details: refs === 0 ? [] : [`${refs}件残っています（校閲タブの「参照の確認」）`],
  });

  const stale: string[] = [];
  p.entries.forEach((e, i) => {
    if (e.op === 'create') {
      const path = `rules/${formatRuleId(e.doc.meta)}.md`;
      if (remote.files.has(path))
        stale.push(`${ruleName(p, i)}：同じ番号のルール（${path}）がすでにあります`);
      return;
    }
    const now = remote.files.get(`rules/${e.ruleId}.md`);
    if (now === undefined) stale.push(`${ruleName(p, i)}：公開中のルールに見つかりません`);
    else if (now !== e.baseMarkdown)
      stale.push(`${ruleName(p, i)}：元にした版のあとで公開中のルールが更新されています`);
  });
  checks.push({
    key: 'base',
    label: '元にした版が最新',
    ok: stale.length === 0,
    details: stale,
  });

  return checks;
}
