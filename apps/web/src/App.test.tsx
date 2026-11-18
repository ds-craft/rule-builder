import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './App.tsx';
import { useAuth } from './state/auth.ts';
import 'fake-indexeddb/auto';

const ME = { id: '100000000000000001', name: '運営者A', avatarUrl: null, onLeave: false };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useAuth.setState({ status: 'loading', user: null, offline: false, notice: null, returnTo: null });
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );

describe('App', () => {
  it('ログインしていなければ、ホームは Discord でログインだけ', () => {
    useAuth.setState({ status: 'anon' });
    renderAt('/file/home');
    expect(screen.getByRole('button', { name: 'Discord でログイン' })).toBeTruthy();
    // ログインしていなければ、新規・開くも押せない
    expect(screen.getByText('開く').closest('[aria-disabled="true"]')).toBeTruthy();
    expect(screen.getByText('ヘルプ').closest('a')).toBeTruthy();
  });

  it('ログインを断られたら、その理由を出す', () => {
    useAuth.setState({ status: 'anon' });
    renderAt('/file/home?login=denied');
    expect(screen.getByText(/運営者のロールが確認できなかったため/)).toBeTruthy();
  });

  it('ログインしていなければ、ログインの要るページはホームに戻す', () => {
    useAuth.setState({ status: 'anon' });
    renderAt('/file/open');
    expect(screen.getByRole('button', { name: 'Discord でログイン' })).toBeTruthy();
  });

  it('ログインしていれば、運営の改正案を出す', async () => {
    vi.stubGlobal('fetch', (url: string) =>
      Promise.resolve(
        String(url).endsWith('/proposals')
          ? Response.json({
              proposals: [
                {
                  id: '6f1c1e0a-2b3c-4d5e-8f90-000000000001',
                  amendingNumber: { kind: 'ルール', year: 8, number: 4 },
                  enforcementDate: '2026-12-01',
                  rules: [{ name: '基本ルール', op: 'amend' }],
                  status: 'draft',
                  createdAt: '2026-11-01T00:00:00Z',
                  createdBy: { id: ME.id, name: ME.name },
                  updatedAt: '2026-11-02T00:00:00Z',
                  updatedBy: { id: '100000000000000002', name: '運営者B', avatarUrl: null },
                },
              ],
            })
          : Response.json({ message: 'x' }, { status: 404 }),
      ),
    );
    useAuth.setState({ status: 'user', user: ME });
    renderAt('/file/home');
    expect(screen.getByRole('heading', { name: /運営者Aさん/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '運営の改正案' })).toBeTruthy();
    expect(await screen.findByText('基本ルール（改正）', { selector: 'td' })).toBeTruthy();
    expect(screen.getByText('運営者B')).toBeTruthy();
    expect(screen.getByText('情報').closest('[aria-disabled="true"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'アカウント：運営者A' })).toBeTruthy();
  });
});
