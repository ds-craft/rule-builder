// E2E（F-41〜F-43 の完了条件）：2つのブラウザで同じ改正案を同時に編集する。
// サーバーは wrangler dev（OpsBot の代わりの Worker つき、状態は一時フォルダ）、画面は Vite の開発サーバーで動かす。
// Cookie を届かせるため、画面とサーバーは同じホスト名（localhost）にそろえる。
// `npm run test:e2e -w apps/web` で実行する（初回は `npx playwright install chromium`）。
import { defineConfig } from '@playwright/test';
import { API_PORT, APP_PORT, RULES_REPO } from './e2e/ports.ts';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  globalSetup: './e2e/setup.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --port ${APP_PORT} --strictPort`,
    url: `http://localhost:${APP_PORT}`,
    reuseExistingServer: false,
    // 画面が読む公開中のルールは、E2E ではメモリ上の GitHub（e2e/setup.ts）から返す（各テストで振り向ける）
    env: { VITE_API_ORIGIN: `http://localhost:${API_PORT}`, VITE_RULES_REPO: RULES_REPO },
    timeout: 120_000,
  },
});
