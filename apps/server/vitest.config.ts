import { defineProject } from 'vitest/config';

// node:sqlite（D1 と Durable Object の SQLite の代わり）は node 22.13 未満では実験フラグが要る
const [major, minor] = process.versions.node.split('.').map(Number) as [number, number];
const needsSqliteFlag = major < 22 || (major === 22 && minor < 13);

export default defineProject({
  test: {
    name: 'server',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    execArgv: needsSqliteFlag ? ['--experimental-sqlite', '--no-warnings'] : [],
  },
});
