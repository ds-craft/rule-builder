// ds-craft/rules への反映（手順書 10-3.5・10-6）。GitHub の操作だけをここに置き、いつ行うかは controller.ts が決める。
//   Draft PR：運営投票の開始時に、固定した内容で proposal/<改正案ID> ブランチと Draft PR を作る（作者は GitHub App）
//   施行前：pending/<改正ルールID>/ を main に置くコミット（作者は GitHub App。改正履歴には数えない）
//   反映：作者・コミッター＝改正ルール番号、日時＝施行日 00:00 +09:00、本文にトレーラーのコミットを main の先頭の上に作る
//   後片付け：pending/<改正ルールID>/ を消すコミット（作者は GitHub App）

import {
  commitInfo,
  exportProposal,
  formatRuleId,
  parseRuleId,
  parseRuleNumber,
  pendingFiles,
  SequenceMatcher,
  type AmendingNumber,
  type CommitInfo,
  type ExportResult,
  type Proposal,
} from '@rule-builder/core';
import { GitHubError, type RulesRepo, type TreeChange } from '../github/client.ts';

export const proposalBranch = (proposalId: string) => `proposal/${proposalId}`;

/** 作者・コミッターのメール。GitHub が空を受け付けなければ noreply にする（rule_history.py は作者名だけを見る） */
export const FALLBACK_EMAIL = 'noreply@ds2.uk';

export type Built = { p: Proposal; ex: ExportResult; c: CommitInfo };

export function build(p: Proposal): Built {
  const ex = exportProposal(p);
  return { p, ex, c: commitInfo(p, undefined, ex) };
}

function changesOf(ex: ExportResult): TreeChange[] {
  return [
    ...ex.deletes.map((path) => ({ path, delete: true as const })),
    ...ex.files.map((f) => ({ path: f.path, content: f.content })),
  ];
}

// ---------- 差分（Draft PR の本文） ----------

/** 行ごとの差分（unified diff の形。前後3行） */
export function unifiedDiff(before: string, after: string, context = 3): string {
  const a = before ? before.replace(/\n$/, '').split('\n') : [];
  const b = after ? after.replace(/\n$/, '').split('\n') : [];
  const ops = new SequenceMatcher(a, b).getOpcodes();
  const out: string[] = [];
  ops.forEach(([tag, i1, i2, j1, j2], k) => {
    if (tag === 'equal') {
      const lines = a.slice(i1, i2);
      const first = k === 0;
      const last = k === ops.length - 1;
      if (lines.length <= context * 2 && !first && !last) lines.forEach((l) => out.push(` ${l}`));
      else {
        if (!first) lines.slice(0, context).forEach((l) => out.push(` ${l}`));
        if (!first && !last) out.push('@@ … @@');
        if (!last) lines.slice(-context).forEach((l) => out.push(` ${l}`));
      }
      return;
    }
    a.slice(i1, i2).forEach((l) => out.push(`-${l}`));
    b.slice(j1, j2).forEach((l) => out.push(`+${l}`));
  });
  return out.join('\n');
}

const OP_LABEL = { create: '制定', amend: '改正', repeal: '廃止' } as const;

export function pullBody(b: Built, publicUrl: string | null, hash: string): string {
  const parts = [
    `rule-builder の改正案（${b.c.authorName || '番号未定'}・施行日 ${b.p.enforcementDate}）を、運営投票の開始時に固定した内容です。`,
    'このブランチは参照用です。**マージしないでください**（反映は可決後に rule-builder が規約どおりのコミットで行い、この PR は閉じます）。',
    '',
    publicUrl ? `- 公開リンク（新旧対照表）：${publicUrl}` : '',
    `- 内容のハッシュ：\`${hash}\``,
    '',
  ];
  for (const f of b.ex.files) {
    const entry = b.p.entries.find((e) => e.entryId === f.entryId)!;
    const before = entry.op === 'create' ? '' : entry.baseMarkdown;
    parts.push(
      `### ${OP_LABEL[f.op]}：${f.name}（${f.path}）`,
      '',
      '```diff',
      unifiedDiff(before, f.content),
      '```',
      '',
    );
  }
  return parts.filter((x, i, arr) => x !== '' || arr[i - 1] !== '').join('\n');
}

/** Draft PR を作る（あれば中身を置き換える）。固定した内容のコミットを proposal/<ID> ブランチに置く */
export async function openDraftPull(
  repo: RulesRepo,
  proposalId: string,
  b: Built,
  title: string,
  publicUrl: string | null,
  hash: string,
): Promise<{ number: number; url: string }> {
  const head = await repo.headSha();
  if (!head) throw new Error(`${repo.repo} の main が見つかりません`);
  const tree = await repo.createTree(await repo.treeOf(head), changesOf(b.ex));
  const sha = await repo.createCommit({ message: b.c.message, tree, parents: [head] });
  const branch = proposalBranch(proposalId);
  await repo.putBranch(branch, sha);
  const body = pullBody(b, publicUrl, hash);
  const prTitle = `[改正案] ${title}`;
  const existing = await repo.findPull(branch);
  const pr = existing
    ? await repo.updatePull(existing.number, { title: prTitle, body })
    : await repo.createDraftPull({ title: prTitle, head: branch, body });
  return { number: pr.number, url: pr.html_url };
}

export async function closeDraftPull(
  repo: RulesRepo,
  proposalId: string,
  pr: { number: number } | null,
  note: string,
): Promise<void> {
  const branch = proposalBranch(proposalId);
  const found = pr ?? (await repo.findPull(branch));
  if (found) {
    await repo.comment(found.number, note).catch(() => {});
    await repo.updatePull(found.number, { state: 'closed' });
  }
  await repo.deleteBranch(branch);
}

// ---------- 改正ルール番号 ----------

/**
 * 公開中のリポジトリで使われている改正ルール番号（ルールのファイル名と、反映のコミットの作者名）。
 * 改正だけのルール（令和8年ルール第2号など）はファイルを持たないので、作者名から拾う。
 */
export function usedNumbers(files: Iterable<string>, authors: Iterable<string>): AmendingNumber[] {
  const out: AmendingNumber[] = [];
  for (const path of files) {
    const id = /([^/]+)\.md$/.exec(path)?.[1];
    const n = id ? parseRuleId(id) : null;
    if (n) out.push(n);
  }
  for (const a of authors) {
    const n = parseRuleNumber(a.trim());
    if (n) out.push(n);
  }
  return out;
}

/** 仮番号が空いていればそれを、埋まっていれば次の空き番号を返す（D1 の採番表への登録は controller が行う） */
export function nextFreeNumber(
  provisional: AmendingNumber,
  used: Iterable<AmendingNumber>,
): AmendingNumber {
  const taken = new Set<number>();
  for (const u of used) {
    if (u.kind === provisional.kind && u.year === provisional.year) taken.add(u.number);
  }
  let n = Math.max(1, provisional.number);
  while (taken.has(n)) n++;
  return { ...provisional, number: n };
}

// ---------- 施行前・反映・後片付け ----------

/** 反映の前に、改正・廃止するルールが固定したときの元の版から変わっていないか（F-57）。変わったパスを返す */
export async function changedBases(repo: RulesRepo, head: string, p: Proposal): Promise<string[]> {
  const changed: string[] = [];
  for (const e of p.entries) {
    if (e.op === 'create') {
      const path = `rules/${formatRuleId(e.doc.meta)}.md`;
      if ((await repo.readFile(path, head)) !== null) changed.push(path);
      continue;
    }
    const path = `rules/${e.ruleId}.md`;
    const now = await repo.readFile(path, head);
    if (now !== e.baseMarkdown) changed.push(path);
  }
  return changed;
}

async function commitOnMain(
  repo: RulesRepo,
  message: string,
  changes: TreeChange[],
  identity?: { name: string; date: string },
): Promise<string> {
  const head = await repo.headSha();
  if (!head) throw new Error(`${repo.repo} の main が見つかりません`);
  const tree = await repo.createTree(await repo.treeOf(head), changes);
  const create = (email: string) =>
    repo.createCommit({
      message,
      tree,
      parents: [head],
      ...(identity
        ? {
            author: { name: identity.name, email, date: identity.date },
            committer: { name: identity.name, email, date: identity.date },
          }
        : {}),
    });
  let sha: string;
  try {
    sha = await create('');
  } catch (e) {
    if (!(identity && e instanceof GitHubError && e.status === 422)) throw e;
    sha = await create(FALLBACK_EMAIL);
  }
  // 早送りだけ（先に main が進んでいたら 422 で失敗し、次の再試行で先頭からやり直す）
  await repo.updateRef('main', sha);
  return sha;
}

export async function commitPending(
  repo: RulesRepo,
  b: Built,
  publicUrl: string | null,
): Promise<string> {
  const files = pendingFiles(b.p, b.c, b.ex, publicUrl);
  return commitOnMain(
    repo,
    `${b.c.authorName}を施行前として掲載（${b.p.enforcementDate}施行）`,
    files.map((f) => ({ path: f.path, content: f.content })),
  );
}

export async function commitEnactment(repo: RulesRepo, b: Built): Promise<string> {
  return commitOnMain(repo, b.c.message, changesOf(b.ex), { name: b.c.authorName, date: b.c.date });
}

/** pending/<改正ルールID>/ のファイルを消す（なければ null） */
export async function commitCleanup(
  repo: RulesRepo,
  b: Built,
  amendingId: string,
): Promise<string | null> {
  const head = await repo.headSha();
  if (!head) throw new Error(`${repo.repo} の main が見つかりません`);
  const base = `pending/${amendingId}`;
  const paths = [`${base}/pending.json`, ...b.ex.files.map((f) => `${base}/${f.path}`)];
  const present: string[] = [];
  for (const path of paths) if ((await repo.readFile(path, head)) !== null) present.push(path);
  if (!present.length) return null;
  return commitOnMain(
    repo,
    `${b.c.authorName}の施行に伴い施行前の掲載を削除`,
    present.map((path) => ({ path, delete: true as const })),
  );
}
