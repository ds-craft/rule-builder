// ds-craft/rules からルール一覧・本文を取得する。
// 匿名の GitHub API は 60回／時のため、main のSHAと一覧は sessionStorage にキャッシュする。
// 本文は raw.githubusercontent.com からSHA指定で取る（内容が変わらないのでSHAごとにキャッシュできる）。

import { parseRule, type RuleMeta } from '@rule-builder/core';

export const RULES_REPO = 'ds-craft/rules';
const API = `https://api.github.com/repos/${RULES_REPO}`;
const RAW = `https://raw.githubusercontent.com/${RULES_REPO}`;

/** main のSHAを使い回す時間（この間は API を呼ばない）。 */
const SHA_TTL_MS = 5 * 60 * 1000;

export type RemoteRule = {
  id: string;
  /** リポジトリ内のパス（rules/R0701001.md・rules/repealed/R0401003.md） */
  path: string;
  repealed: boolean;
  meta: RuleMeta;
  /** ファイルの blob SHA */
  blobSha: string;
};

export type RuleList = { sha: string; fetchedAt: number; rules: RemoteRule[] };

export class GitHubError extends Error {
  readonly rateLimited: boolean;
  constructor(message: string, rateLimited = false) {
    super(message);
    this.rateLimited = rateLimited;
  }
}

/** 利用者向けのエラー文言。 */
export function errorMessage(e: unknown): string {
  if (e instanceof GitHubError && e.rateLimited) {
    return 'GitHub への問い合わせが上限に達しました。時間をおいて再試行してください。';
  }
  return 'ルールを取得できませんでした。時間をおいて再試行してください。';
}

type Fetch = typeof fetch;

const store = {
  get<T>(key: string): T | null {
    try {
      const v = sessionStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 保存できなくても動く（毎回取得するだけ）
    }
  },
};

async function getJson<T>(url: string, f: Fetch): Promise<T> {
  const res = await f(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) {
    const limited = res.status === 403 || res.status === 429;
    throw new GitHubError(`GitHub API ${res.status}: ${url}`, limited);
  }
  return (await res.json()) as T;
}

/** main の最新のコミットSHA。 */
export async function fetchMainSha(f: Fetch = fetch, force = false): Promise<string> {
  const cached = store.get<{ sha: string; at: number }>('rb:main-sha');
  if (!force && cached && Date.now() - cached.at < SHA_TTL_MS) return cached.sha;
  const commit = await getJson<{ sha: string }>(`${API}/commits/main`, f);
  store.set('rb:main-sha', { sha: commit.sha, at: Date.now() });
  return commit.sha;
}

/** SHA を指定してファイルの中身を取る。 */
export async function fetchRuleMarkdown(
  sha: string,
  path: string,
  f: Fetch = fetch,
): Promise<string> {
  const key = `rb:raw:${sha}:${path}`;
  const cached = store.get<string>(key);
  if (cached !== null) return cached;
  const res = await f(`${RAW}/${sha}/${path}`);
  if (!res.ok) throw new GitHubError(`raw ${res.status}: ${path}`);
  const text = await res.text();
  store.set(key, text);
  return text;
}

type ContentItem = { name: string; path: string; sha: string; type: string };

/** 施行中と廃止のルールの一覧（番号の空き計算のため廃止も含む）。 */
export async function fetchRuleList(f: Fetch = fetch, force = false): Promise<RuleList> {
  const sha = await fetchMainSha(f, force);
  const cached = store.get<RuleList>('rb:rule-list');
  if (cached && cached.sha === sha) return cached;

  const [active, repealed] = await Promise.all([
    getJson<ContentItem[]>(`${API}/contents/rules?ref=${sha}`, f),
    getJson<ContentItem[]>(`${API}/contents/rules/repealed?ref=${sha}`, f).catch(() => []),
  ]);
  const files = [
    ...active
      .filter((x) => x.type === 'file' && x.name.endsWith('.md'))
      .map((x) => ({ ...x, repealed: false })),
    ...repealed
      .filter((x) => x.type === 'file' && x.name.endsWith('.md'))
      .map((x) => ({ ...x, repealed: true })),
  ];
  const rules = await Promise.all(
    files.map(async (x): Promise<RemoteRule> => {
      const md = await fetchRuleMarkdown(sha, x.path, f);
      return {
        id: x.name.replace(/\.md$/, ''),
        path: x.path,
        repealed: x.repealed,
        meta: parseRule(md).doc.meta,
        blobSha: x.sha,
      };
    }),
  );
  rules.sort((a, b) => (a.meta.order ?? 999) - (b.meta.order ?? 999) || a.id.localeCompare(b.id));
  const list: RuleList = { sha, fetchedAt: Date.now(), rules };
  store.set('rb:rule-list', list);
  return list;
}
