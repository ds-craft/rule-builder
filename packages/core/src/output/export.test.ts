import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRule } from '../markdown/parse.ts';
import type { Proposal } from '../model/proposal.ts';
import { commitInfo, exportProposal, gitCommitCommand, pendingFiles } from './export.ts';

const C = join(import.meta.dirname, '../../../../test/fixtures/commits');
const read = (f: string) => readFileSync(join(C, f), 'utf8');
/** git log --format=%B は末尾に空行を足すので、実際のメッセージ（末尾の改行1つ）に戻す */
const message = (f: string) => read(f).trimEnd() + '\n';

describe('過去の改正を再現する', () => {
  it('令和8年ルール第2号（基本ルールの改正）：ファイルとコミット情報が元のコミットと一致する', () => {
    const before = read('R0801002-before-R0701001.md');
    const after = read('R0801002-after-R0701001.md');
    const p: Proposal = {
      id: 'x',
      amendingNumber: { kind: 'ルール', year: 8, number: 2 },
      enforcementDate: '2026-07-28',
      summary: '運営の短縮投票に関する基本ルール改正',
      status: 'draft',
      updatedAt: '',
      entries: [
        {
          entryId: 'a',
          op: 'amend',
          ruleId: 'R0701001',
          baseSha: 's',
          baseMarkdown: before,
          doc: parseRule(after).doc,
        },
      ],
    };
    const ex = exportProposal(p);
    expect(ex.files.map((f) => f.path)).toEqual(['rules/R0701001.md']);
    expect(ex.files[0]!.content).toBe(after);
    const c = commitInfo(p, undefined, ex);
    expect(c.message).toBe(message('R0801002-message.txt'));
    expect(c.authorName).toBe('令和8年ルール第2号');
    expect(c.date).toBe('2026-07-28T00:00:00+09:00');
  });

  it('令和8年ルール第3号（制定と廃止）：廃止の front matter と Repeals が元のコミットと一致する', () => {
    const created = read('R0801003-after-R0801003.md');
    const p: Proposal = {
      id: 'x',
      amendingNumber: { kind: 'ルール', year: 8, number: 3 },
      enforcementDate: '2026-08-27',
      summary: '',
      status: 'draft',
      updatedAt: '',
      entries: [
        { entryId: 'a', op: 'create', doc: parseRule(created).doc },
        {
          entryId: 'b',
          op: 'repeal',
          ruleId: 'R0401003',
          baseSha: 's',
          baseMarkdown: read('R0801003-before-R0401003.md'),
        },
      ],
    };
    const ex = exportProposal(p);
    expect(ex.files.map((f) => f.path)).toEqual([
      'rules/R0801003.md',
      'rules/repealed/R0401003.md',
    ]);
    expect(ex.files[0]!.content).toBe(created);
    expect(ex.files[1]!.content).toBe(read('R0801003-after-repealed-R0401003.md'));
    expect(ex.deletes).toEqual(['rules/R0401003.md']);
    const c = commitInfo(p, undefined, ex);
    expect(c.message).toBe(message('R0801003-message.txt'));
    expect(gitCommitCommand(c, ex)).toContain('git rm rules/R0401003.md');
  });

  it('改正のない（原文と一致する）ルールは含めない', () => {
    const before = read('R0801002-before-R0701001.md');
    const p: Proposal = {
      id: 'x',
      amendingNumber: { kind: 'ルール', year: 8, number: 4 },
      enforcementDate: '',
      summary: '',
      status: 'draft',
      updatedAt: '',
      entries: [
        {
          entryId: 'a',
          op: 'amend',
          ruleId: 'R0701001',
          baseSha: 's',
          baseMarkdown: before,
          doc: parseRule(before).doc,
        },
      ],
    };
    const ex = exportProposal(p);
    expect(ex.files).toEqual([]);
    expect(ex.unchanged).toEqual([{ entryId: 'a', name: '基本ルール' }]);
    const c = commitInfo(p, undefined, ex);
    expect(c.message).toContain('Enforced: YYYY-MM-DD');
    expect(pendingFiles(p, c, ex)[0]!.path).toBe('pending/R0801004/pending.json');
  });
});
