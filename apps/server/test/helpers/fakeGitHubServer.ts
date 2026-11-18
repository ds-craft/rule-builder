// テスト用：メモリ上の GitHub（fakeGitHub.ts）を HTTP で出す（結合テストと画面の E2E で使う）。
//   /repos/<repo>/...      GitHub の REST API の代わり（wrangler dev の GITHUB_API に向ける）
//   /raw/<sha>/<path>      raw.githubusercontent.com の代わり（画面の読み込み用）
//   /__fake/main           main の先頭のコミット・ファイル・PR（テストの確認用）
import { createServer, type Server } from 'node:http';
import { FakeGitHub } from './fakeGitHub.ts';
import { remoteFiles } from './fixtures.ts';

export type FakeGitHubServer = { gh: FakeGitHub; close: () => void };

export function startFakeGitHub(
  port: number,
  repo: string,
  authors: string[] = ['令和8年ルール第1号'],
): Promise<FakeGitHubServer> {
  const gh = new FakeGitHub(repo, remoteFiles(), authors);
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      // 画面（ブラウザ）からの読み込みにも答える
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', '*');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.url === '/__fake/main') {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            head: gh.head(),
            files: Object.fromEntries(gh.mainFiles()),
            pulls: gh.pulls,
          }),
        );
        return;
      }
      const raw = /^\/raw\/(\w+)\/(.+)$/.exec(req.url ?? '');
      if (raw) {
        const sha = gh.commits.has(raw[1]!) ? raw[1]! : gh.refs.get(raw[1]!);
        const text = sha ? gh.files(sha).get(decodeURIComponent(raw[2]!)) : undefined;
        res.statusCode = text === undefined ? 404 : 200;
        res.end(text ?? 'not found');
        return;
      }
      const body = chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined;
      const r = await gh.fetch(`http://127.0.0.1:${port}${req.url}`, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body,
      });
      res.statusCode = r.status;
      r.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await r.arrayBuffer()));
    });
  });
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve({ gh, close: () => server.close() })),
  );
}
