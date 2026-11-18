import { describe, expect, it } from 'vitest';
import { parseRule } from '../markdown/parse.ts';
import type { Proposal } from '../model/proposal.ts';
import { exportProposal } from '../output/export.ts';
import {
  contentHash,
  enforcementInstant,
  isEditable,
  isFutureEnforcement,
  isWithdrawable,
  jstToday,
  renumberProposal,
} from './flow.ts';

const md = (number: number) =>
  `---
layout: rule
title: 試しのルール
rule_name: 試しのルール
rule_number: 令和8年ルール第${number}号
enforcement_date: 令和8年12月1日
order: 9
permalink: /rule/R08010${String(number).padStart(2, '0')}.html
---

##### 第1条（目的）

　本文
`;

const proposal = (number = 4): Proposal => ({
  id: 'x',
  amendingNumber: { kind: 'ルール', year: 8, number },
  enforcementDate: '2026-12-01',
  summary: '',
  status: 'draft',
  updatedAt: '',
  entries: [{ entryId: 'a', op: 'create', doc: parseRule(md(number)).doc }],
});

describe('状態', () => {
  it('編集できるのは下書きと運営内協議だけ', () => {
    expect(isEditable('draft')).toBe(true);
    expect(isEditable('unei_discussion')).toBe(true);
    expect(isEditable('mod_vote')).toBe(false);
    expect(isEditable('passed')).toBe(false);
  });
  it('取り下げられるのは可決より前', () => {
    expect(isWithdrawable('draft')).toBe(false);
    expect(isWithdrawable('participant_vote')).toBe(true);
    expect(isWithdrawable('passed')).toBe(false);
  });
});

describe('内容のハッシュ', () => {
  it('同じ内容なら同じ値、本文が変われば別の値', async () => {
    const a = await contentHash(proposal());
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await contentHash(proposal())).toBe(a);
    const changed = proposal();
    changed.enforcementDate = '2026-12-02';
    expect(await contentHash(changed)).not.toBe(a);
  });
});

describe('改正ルール番号の付け替え', () => {
  it('仮番号と同じ番号で制定するルールは、ファイル名・permalink も変わる', () => {
    const p = renumberProposal(proposal(4), { kind: 'ルール', year: 8, number: 5 });
    const ex = exportProposal(p);
    expect(ex.files[0]!.path).toBe('rules/R0801005.md');
    expect(ex.files[0]!.content).toContain('permalink: /rule/R0801005.html');
    expect(ex.files[0]!.content).toContain('rule_number: 令和8年ルール第5号');
  });
});

describe('施行日', () => {
  it('施行日の 0時（JST）', () => {
    expect(new Date(enforcementInstant('2026-12-01')).toISOString()).toBe(
      '2026-11-30T15:00:00.000Z',
    );
    expect(enforcementInstant('')).toBeNaN();
  });
  it('JST の日付で未来かどうかを決める', () => {
    const now = Date.parse('2026-11-30T15:30:00Z'); // JST 12月1日 0:30
    expect(jstToday(now)).toBe('2026-12-01');
    expect(isFutureEnforcement('2026-12-01', now)).toBe(false);
    expect(isFutureEnforcement('2026-12-02', now)).toBe(true);
  });
});
