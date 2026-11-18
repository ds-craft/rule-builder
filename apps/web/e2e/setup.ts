// E2E の前に wrangler dev を起動する（apps/server の結合テストと同じ方法。状態は毎回まっさらな一時フォルダ）。
// 止めるのは Playwright が globalSetup の戻り値（teardown）を呼んだとき。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeGitHub } from '../../server/test/helpers/fakeGitHubServer.ts';
import { API_PORT, APP_PORT, GITHUB_PORT, RULES_REPO } from './ports.ts';

const SERVER = join(import.meta.dirname, '..', '..', 'server');

function wrangler(args: string[], log: (s: string) => void): ChildProcess {
  const p = spawn('npx', ['wrangler', ...args], {
    cwd: SERVER,
    shell: true,
    detached: process.platform !== 'win32',
    env: { ...process.env, CI: '1' },
  });
  p.on('error', (e) => log(String(e)));
  p.stdout?.on('data', (d) => log(String(d)));
  p.stderr?.on('data', (d) => log(String(d)));
  return p;
}

function stop(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

export default async function setup() {
  // 自動反映の先（発議・採決は模擬の OpsBot で行う）
  const github = await startFakeGitHub(GITHUB_PORT, RULES_REPO);
  const dir = mkdtempSync(join(tmpdir(), 'rb-e2e-'));
  const envFile = join(dir, 'dev.env');
  writeFileSync(
    envFile,
    [
      'DISCORD_CLIENT_SECRET=dummy',
      'SESSION_SECRET=e2e-test-secret',
      `APP_ORIGIN=http://localhost:${APP_PORT}`,
      `API_ORIGIN=http://localhost:${API_PORT}`,
      'ALLOW_DEV_LOGIN=true',
      'OPSBOT_PROPOSALS=sim',
      'SIM_DISCUSSION_HOURS=0',
      `RULES_REPO=${RULES_REPO}`,
      `GITHUB_API=http://127.0.0.1:${GITHUB_PORT}`,
      'GITHUB_TOKEN=e2e-token',
      'GITHUB_APP_ID=',
      'GITHUB_APP_PRIVATE_KEY=',
    ].join('\n'),
  );
  const state = join(dir, 'state');
  let out = '';
  await new Promise<void>((resolve, reject) => {
    wrangler(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state], (s) => {
      out += s;
    }).on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`マイグレーションに失敗しました\n${out}`)),
    );
  });
  out = '';
  const child = wrangler(
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
      String(API_PORT),
      '--ip',
      'localhost',
      '--show-interactive-dev-session=false',
    ],
    (s) => (out += s),
  );
  const deadline = Date.now() + 90_000;
  while (!/Ready on/.test(out)) {
    if (child.exitCode !== null || Date.now() > deadline) {
      stop(child);
      throw new Error(`wrangler dev が起動しませんでした\n${out}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return async () => {
    github.close();
    stop(child);
    await new Promise((r) => setTimeout(r, 500));
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows ではプロセスの終了が遅れて消せないことがある（一時フォルダなので残してよい）
    }
  };
}
