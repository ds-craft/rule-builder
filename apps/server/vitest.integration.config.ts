import { defineConfig } from 'vitest/config';

// 結合テスト：wrangler dev（本物の Workers の実行環境）を起動し、WebSocket で同期を確かめる。
// `npm run test:integration -w apps/server` で実行する（通常の npm test には含めない）。
export default defineConfig({
  test: {
    include: ['test/integration/**/*.itest.ts'],
    environment: 'node',
    globalSetup: ['test/integration/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
