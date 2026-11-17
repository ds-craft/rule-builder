// アクセシビリティの自動チェック（axe）。色のコントラストなど描画が要るものは happy-dom では調べられないので、
// 構造（ロール・名前・ランドマーク）だけを見る。実際のブラウザでの確認は Phase 8 の手順で行う。

import { cleanup, render } from '@testing-library/react';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './App.tsx';
import { createProposal } from './state/actions.ts';
import { parseRule } from '@rule-builder/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import 'fake-indexeddb/auto';

// ルールの一覧は取りに行かない（取得できないときと同じ動き）
vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
afterEach(cleanup);

const FIX = join(import.meta.dirname, '../../../test/fixtures/rules/rules');

async function violations(container: Element): Promise<string[]> {
  const r = await axe.run(container, {
    resultTypes: ['violations'],
    rules: {
      // happy-dom では描画しないので調べられない
      'color-contrast': { enabled: false },
      // 紙面の見出しの順は portal と同じ（章 h2 の次に条 h5）
      'heading-order': { enabled: false },
      'page-has-heading-one': { enabled: false },
    },
  });
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

describe('アクセシビリティ（axe）', () => {
  it('ファイル画面のホーム', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/file/home']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(await violations(container)).toEqual([]);
  });

  it('エディタの画面', async () => {
    const doc = parseRule(readFileSync(join(FIX, 'R0701002.md'), 'utf8')).doc;
    await createProposal(
      { amendingNumber: { kind: 'ルール', year: 8, number: 9 }, enforcementDate: '' },
      { op: 'create', doc },
    );
    const { container, findByRole } = render(
      <MemoryRouter initialEntries={['/edit/0']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await findByRole('tablist');
    expect(await violations(container)).toEqual([]);
  });
});
