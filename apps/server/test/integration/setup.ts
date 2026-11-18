// 結合テストの前に wrangler dev を起動する（OpsBot の代わりの Worker も一緒に）。
// 状態（D1・Durable Object）は毎回まっさらな一時フォルダに置く。
// 自動反映の先として、メモリ上の GitHub（helpers/fakeGitHub.ts）を HTTP で立てる。発議・採決は模擬の OpsBot で行う。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { startFakeGitHub, type FakeGitHubServer } from '../helpers/fakeGitHubServer.ts';

export const PORT = 8790;
export const GITHUB_PORT = 8791;
export const RULES_REPO = 'ds-craft/rules-staging';
const ROOT = join(import.meta.dirname, '..', '..');

let child: ChildProcess | null = null;
let dir = '';
let github: FakeGitHubServer | null = null;

function run(args: string[], log: (s: string) => void) {
  // Linux ではプロセスグループごと止められるよう、別のグループで起動する
  return spawn('npx', ['wrangler', ...args], {
    cwd: ROOT,
    shell: true,
    detached: process.platform !== 'win32',
    env: { ...process.env, CI: '1' },
  }).on('error', (e) => log(String(e)));
}

export async function setup(project: TestProject) {
  github = await startFakeGitHub(GITHUB_PORT, RULES_REPO);
  dir = mkdtempSync(join(tmpdir(), 'rb-itest-'));
  const envFile = join(dir, 'dev.env');
  writeFileSync(
    envFile,
    [
      'DISCORD_CLIENT_SECRET=dummy',
      'SESSION_SECRET=integration-test-secret',
      'APP_ORIGIN=http://localhost:5173',
      `API_ORIGIN=http://127.0.0.1:${PORT}`,
      'ALLOW_DEV_LOGIN=true',
      'OPSBOT_PROPOSALS=sim',
      'SIM_DISCUSSION_HOURS=0',
      `RULES_REPO=${RULES_REPO}`,
      `GITHUB_API=http://127.0.0.1:${GITHUB_PORT}`,
      'GITHUB_TOKEN=itest-token',
      'GITHUB_APP_ID=',
      'GITHUB_APP_PRIVATE_KEY=',
    ].join('\n'),
  );
  const state = join(dir, 'state');
  let out = '';
  await new Promise<void>((resolve, reject) => {
    const p = run(
      ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state],
      (s) => (out += s),
    );
    p.stdout?.on('data', (d) => (out += d));
    p.stderr?.on('data', (d) => (out += d));
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`マイグレーションに失敗しました\n${out}`)),
    );
  });
  out = '';
  child = run(
    [
      'dev',
      '-c',
      'wrangler.jsonc',
      '-c',
      'dev/opsbot-stub/wrangler.jsonc',
      '--env-file',
      envFile,
      '--persist-to',
      state,
      '--port',
      String(PORT),
      '--show-interactive-dev-session=false',
    ],
    (s) => (out += s),
  );
  child.stdout?.on('data', (d) => (out += d));
  child.stderr?.on('data', (d) => (out += d));
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (/Ready on/.test(out)) break;
    if (child.exitCode !== null || Date.now() > deadline) {
      throw new Error(`wrangler dev が起動しませんでした\n${out}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  project.provide('apiOrigin', `http://127.0.0.1:${PORT}`);
  project.provide('githubOrigin', `http://127.0.0.1:${GITHUB_PORT}`);
}

export async function teardown() {
  github?.close();
  if (child?.pid) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
  }
  await new Promise((r) => setTimeout(r, 500));
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows ではプロセスの終了が遅れて消せないことがある（一時フォルダなので残してよい）
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    apiOrigin: string;
    githubOrigin: string;
  }
}
