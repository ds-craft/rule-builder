import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from './App.tsx';

describe('App', () => {
  it('ファイル画面のホームを表示する', () => {
    render(
      <MemoryRouter initialEntries={['/file/home']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByText('rule-builder')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '最近使った改正案' })).toBeTruthy();
    expect(screen.getByText('情報').closest('[aria-disabled="true"]')).toBeTruthy();
  });
});
