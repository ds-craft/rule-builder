// ds-craft/rules（ステージングは ds-craft/rules-staging）の読み書き。Git Data API で blob → tree → commit を作り、
// main の ref を進める（手順書 10-6）。GitHub のマージボタンは使わない（作者・コミッター日時が変わるため）。
// 書き込みは GitHub App のインストールトークンで行う。App の設定がなければ読み取りだけ（匿名）で動く。

import { InstallationTokens } from './app.ts';

export const GITHUB_API = 'https://api.github.com';

export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type DirEntry = { name: string; path: string; sha: string; type: string };

export type TreeChange = { path: string; content: string } | { path: string; delete: true };

export type GitIdentity = { name: string; email: string; date: string };

export type Pull = { number: number; state: 'open' | 'closed'; html_url: string; draft?: boolean };

export interface GitHubOptions {
  repo: string;
  fetch?: typeof fetch;
  api?: string;
  /** インストールトークンを返す（null なら匿名。書き込みはできない） */
  token?: () => Promise<string | null>;
}

export class RulesRepo {
  readonly repo: string;
  private readonly fetchFn: typeof fetch;
  private readonly api: string;
  private readonly token: () => Promise<string | null>;

  constructor(opts: GitHubOptions) {
    this.repo = opts.repo;
    this.fetchFn = opts.fetch ?? ((...a) => fetch(...a));
    this.api = opts.api ?? GITHUB_API;
    this.token = opts.token ?? (async () => null);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    accept?: string,
  ): Promise<T> {
    const token = await this.token();
    if (!token && method !== 'GET') {
      throw new GitHubError(
        0,
        'GitHub App が設定されていないため、ds-craft/rules に書き込めません',
      );
    }
    const res = await this.fetchFn(`${this.api}/repos/${this.repo}${path}`, {
      method,
      headers: {
        accept: accept ?? 'application/vnd.github+json',
        'user-agent': 'rule-builder',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GitHubError(
        res.status,
        `GitHub API ${method} ${path}: ${res.status} ${text.slice(0, 300)}`,
      );
    }
    if (res.status === 204) return undefined as T;
    if (accept === 'application/vnd.github.raw') return (await res.text()) as T;
    return (await res.json()) as T;
  }

  /** ブランチの先頭のコミット SHA（ブランチがなければ null） */
  async headSha(branch = 'main'): Promise<string | null> {
    try {
      const r = await this.request<{ object: { sha: string } }>('GET', `/git/ref/heads/${branch}`);
      return r.object.sha;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }

  async treeOf(commitSha: string): Promise<string> {
    const c = await this.request<{ tree: { sha: string } }>('GET', `/git/commits/${commitSha}`);
    return c.tree.sha;
  }

  /** フォルダの中身（なければ空） */
  async listDir(path: string, ref: string): Promise<DirEntry[]> {
    try {
      const items = await this.request<DirEntry[]>('GET', `/contents/${path}?ref=${ref}`);
      return Array.isArray(items) ? items : [];
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return [];
      throw e;
    }
  }

  /** ファイルの中身（なければ null） */
  async readFile(path: string, ref: string): Promise<string | null> {
    try {
      return await this.request<string>(
        'GET',
        `/contents/${path}?ref=${ref}`,
        undefined,
        'application/vnd.github.raw',
      );
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }

  /** ファイルの blob SHA（なければ null）。フォルダの一覧から引く */
  async blobSha(path: string, ref: string): Promise<string | null> {
    const dir = path.slice(0, path.lastIndexOf('/'));
    const items = await this.listDir(dir, ref);
    return items.find((x) => x.path === path && x.type === 'file')?.sha ?? null;
  }

  /** base の木の上に変更を重ねた木を作る（content を直接渡すので blob は API が作る。delete は sha: null） */
  async createTree(baseTree: string, changes: TreeChange[]): Promise<string> {
    const tree = changes.map((c) =>
      'delete' in c
        ? { path: c.path, mode: '100644', type: 'blob', sha: null }
        : { path: c.path, mode: '100644', type: 'blob', content: c.content },
    );
    const r = await this.request<{ sha: string }>('POST', '/git/trees', {
      base_tree: baseTree,
      tree,
    });
    return r.sha;
  }

  /** コミットを作る。author・committer を省くと GitHub App が作者になる */
  async createCommit(args: {
    message: string;
    tree: string;
    parents: string[];
    author?: GitIdentity;
    committer?: GitIdentity;
  }): Promise<string> {
    const r = await this.request<{ sha: string }>('POST', '/git/commits', args);
    return r.sha;
  }

  /** ブランチを進める（force でなければ早送りだけ。先に進んでいたら 422） */
  async updateRef(branch: string, sha: string, force = false): Promise<void> {
    await this.request('PATCH', `/git/refs/heads/${branch}`, { sha, force });
  }

  async createRef(branch: string, sha: string): Promise<void> {
    await this.request('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha });
  }

  /** ブランチを作るか、あれば置き換える */
  async putBranch(branch: string, sha: string): Promise<void> {
    if (await this.headSha(branch)) await this.updateRef(branch, sha, true);
    else await this.createRef(branch, sha);
  }

  async deleteBranch(branch: string): Promise<void> {
    try {
      await this.request('DELETE', `/git/refs/heads/${branch}`);
    } catch (e) {
      if (e instanceof GitHubError && (e.status === 404 || e.status === 422)) return;
      throw e;
    }
  }

  /** ブランチから main への開いている PR（なければ null） */
  async findPull(branch: string): Promise<Pull | null> {
    const owner = this.repo.split('/')[0];
    const list = await this.request<Pull[]>(
      'GET',
      `/pulls?state=open&head=${owner}:${encodeURIComponent(branch)}`,
    );
    return list[0] ?? null;
  }

  async createDraftPull(args: { title: string; head: string; body: string }): Promise<Pull> {
    return this.request<Pull>('POST', '/pulls', {
      title: args.title,
      head: args.head,
      base: 'main',
      body: args.body,
      draft: true,
    });
  }

  async updatePull(
    number: number,
    patch: { title?: string; body?: string; state?: 'open' | 'closed' },
  ) {
    return this.request<Pull>('PATCH', `/pulls/${number}`, patch);
  }

  async comment(number: number, body: string): Promise<void> {
    await this.request('POST', `/issues/${number}/comments`, { body });
  }

  /** そのコミットがブランチにもう入っているか（やり直しのときに作り直さないため） */
  async contains(sha: string, branch = 'main'): Promise<boolean> {
    try {
      const r = await this.request<{ status: string }>('GET', `/compare/${sha}...${branch}`);
      return r.status === 'identical' || r.status === 'ahead';
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return false;
      throw e;
    }
  }

  /** main のコミットの作者名（改正ルール番号の使用済みを調べる。古い順でなくてよい） */
  async commitAuthors(maxPages = 10): Promise<string[]> {
    const out: string[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const list = await this.request<{ commit: { author: { name: string } | null } }[]>(
        'GET',
        `/commits?sha=main&per_page=100&page=${page}`,
      );
      for (const c of list) if (c.commit.author?.name) out.push(c.commit.author.name);
      if (list.length < 100) break;
    }
    return out;
  }
}

/**
 * Workers の設定から ds-craft/rules の読み書きを作る。
 * GitHub App（GITHUB_APP_ID・GITHUB_APP_PRIVATE_KEY）がなく GITHUB_TOKEN があれば、そのトークンを使う
 * （手元の開発と結合テストだけ。本番・ステージングでは GitHub App を使う）。
 */
export function rulesRepo(env: Env, fetchFn: typeof fetch = (...a) => fetch(...a)): RulesRepo {
  const extra = env as { GITHUB_API?: string; GITHUB_TOKEN?: string };
  const api = extra.GITHUB_API || GITHUB_API;
  const appId = env.GITHUB_APP_ID;
  const key = env.GITHUB_APP_PRIVATE_KEY;
  const tokens =
    appId && key
      ? new InstallationTokens({ appId, privateKey: key }, env.RULES_REPO, fetchFn, api)
      : null;
  const plain = extra.GITHUB_TOKEN || null;
  return new RulesRepo({
    repo: env.RULES_REPO,
    fetch: fetchFn,
    api,
    token: async () => (tokens ? tokens.get() : plain),
  });
}
