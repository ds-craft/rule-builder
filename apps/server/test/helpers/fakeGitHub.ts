// テスト用：GitHub の REST API のうち、rule-builder が使う部分だけをメモリ上の git でまねる。
// RulesRepo に fetch として渡す（https://api.github.com/repos/<repo>/... への呼び出しを受ける）。

type Identity = { name: string; email: string; date: string };
export type FakeCommit = {
  sha: string;
  tree: string;
  parents: string[];
  message: string;
  author: Identity | null;
  committer: Identity | null;
};

let seq = 0;
const sha = (prefix: string) =>
  `${prefix}${String(++seq).padStart(39 - prefix.length, '0')}`.slice(0, 40);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export class FakeGitHub {
  readonly repo: string;
  readonly trees = new Map<string, Map<string, string>>();
  readonly commits = new Map<string, FakeCommit>();
  readonly refs = new Map<string, string>();
  readonly pulls: {
    number: number;
    head: string;
    title: string;
    body: string;
    state: 'open' | 'closed';
    draft: boolean;
    comments: string[];
  }[] = [];
  readonly calls: { method: string; path: string; body: unknown }[] = [];
  /** 次の書き込みを失敗させる回数（再試行の確認用） */
  failWrites = 0;
  /** 作者・コミッターのメールが空なら 422 にする（GitHub が空を受け付けない場合の確認用） */
  rejectEmptyEmail = false;

  constructor(repo: string, files: Record<string, string>, authors: string[] = []) {
    this.repo = repo;
    // 作者だけの古いコミット（改正ルール番号の使用済みを調べるため）
    let parent: string | null = null;
    for (const name of authors) {
      parent = this.commit({
        files: parent ? this.files(parent) : new Map(),
        parents: parent ? [parent] : [],
        message: `${name}`,
        author: { name, email: '', date: '2026-01-01T00:00:00+09:00' },
      });
    }
    const head = this.commit({
      files: new Map(Object.entries(files)),
      parents: parent ? [parent] : [],
      message: 'init',
      author: { name: 'gorodrich', email: 'x@example.com', date: '2026-11-01T00:00:00+09:00' },
    });
    this.refs.set('main', head);
  }

  private commit(args: {
    files: Map<string, string>;
    parents: string[];
    message: string;
    author: Identity | null;
  }): string {
    const tree = sha('t');
    this.trees.set(tree, args.files);
    const c: FakeCommit = {
      sha: sha('c'),
      tree,
      parents: args.parents,
      message: args.message,
      author: args.author,
      committer: args.author,
    };
    this.commits.set(c.sha, c);
    return c.sha;
  }

  files(commitSha: string): Map<string, string> {
    return new Map(this.trees.get(this.commits.get(commitSha)!.tree)!);
  }

  head(branch = 'main'): FakeCommit {
    return this.commits.get(this.refs.get(branch)!)!;
  }

  /** main の先頭のファイル */
  mainFiles(): Map<string, string> {
    return this.files(this.refs.get('main')!);
  }

  /** 手作業のコミット（F-57 の確認用：改正対象のファイルを先に変える） */
  pushManual(changes: Record<string, string | null>) {
    const files = this.mainFiles();
    for (const [p, v] of Object.entries(changes)) {
      if (v === null) files.delete(p);
      else files.set(p, v);
    }
    const c = this.commit({
      files,
      parents: [this.refs.get('main')!],
      message: 'manual',
      author: { name: 'gorodrich', email: '', date: '2026-11-10T00:00:00+09:00' },
    });
    this.refs.set('main', c);
  }

  /** main の履歴（新しい順） */
  log(): FakeCommit[] {
    const out: FakeCommit[] = [];
    let at: string | undefined = this.refs.get('main');
    while (at) {
      const c: FakeCommit = this.commits.get(at)!;
      out.push(c);
      at = c.parents[0];
    }
    return out;
  }

  private blobSha(content: string) {
    let h = 0;
    for (const ch of content) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return `b${(h >>> 0).toString(16).padStart(39, '0')}`;
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const prefix = `/repos/${this.repo}`;
    if (!url.pathname.startsWith(prefix)) return json({ message: 'Not Found' }, 404);
    const path = decodeURIComponent(url.pathname.slice(prefix.length));
    this.calls.push({ method, path: path + url.search, body });
    const accept = new Headers(init.headers).get('accept') ?? '';

    if (method !== 'GET' && this.failWrites > 0) {
      this.failWrites--;
      return json({ message: 'Server Error' }, 502);
    }

    let m: RegExpExecArray | null;
    if (method === 'GET' && (m = /^\/git\/ref\/heads\/(.+)$/.exec(path))) {
      const s = this.refs.get(m[1]!);
      return s ? json({ object: { sha: s } }) : json({ message: 'Not Found' }, 404);
    }
    if (method === 'GET' && (m = /^\/git\/commits\/(\w+)$/.exec(path))) {
      const c = this.commits.get(m[1]!);
      return c ? json({ sha: c.sha, tree: { sha: c.tree } }) : json({ message: 'Not Found' }, 404);
    }
    if (method === 'GET' && (m = /^\/contents\/(.+)$/.exec(path))) {
      const ref = url.searchParams.get('ref') ?? this.refs.get('main')!;
      const commitSha = this.commits.has(ref) ? ref : this.refs.get(ref);
      if (!commitSha) return json({ message: 'Not Found' }, 404);
      const files = this.files(commitSha);
      const p = m[1]!;
      if (files.has(p)) {
        if (accept.includes('raw')) return new Response(files.get(p)!, { status: 200 });
        return json({
          name: p.split('/').pop(),
          path: p,
          sha: this.blobSha(files.get(p)!),
          type: 'file',
        });
      }
      const items = new Map<string, { name: string; path: string; sha: string; type: string }>();
      for (const [fp, content] of files) {
        if (!fp.startsWith(`${p}/`)) continue;
        const rest = fp.slice(p.length + 1);
        const name = rest.split('/')[0]!;
        const isFile = !rest.includes('/');
        items.set(name, {
          name,
          path: `${p}/${name}`,
          sha: isFile ? this.blobSha(content) : 'dir',
          type: isFile ? 'file' : 'dir',
        });
      }
      return items.size ? json([...items.values()]) : json({ message: 'Not Found' }, 404);
    }
    if (method === 'POST' && path === '/git/trees') {
      const base = this.trees.get(body.base_tree);
      if (!base) return json({ message: 'base tree' }, 422);
      const next = new Map(base);
      for (const t of body.tree as { path: string; sha?: string | null; content?: string }[]) {
        if (t.sha === null) next.delete(t.path);
        else next.set(t.path, t.content ?? '');
      }
      const s = sha('t');
      this.trees.set(s, next);
      return json({ sha: s }, 201);
    }
    if (method === 'POST' && path === '/git/commits') {
      if (this.rejectEmptyEmail && body.author && body.author.email === '') {
        return json({ message: 'Invalid request. email is too short' }, 422);
      }
      const c: FakeCommit = {
        sha: sha('c'),
        tree: body.tree,
        parents: body.parents,
        message: body.message,
        author: body.author ?? {
          name: 'rule-builder[bot]',
          email: 'bot@example.com',
          date: new Date().toISOString(),
        },
        committer: body.committer ?? {
          name: 'GitHub',
          email: 'noreply@github.com',
          date: new Date().toISOString(),
        },
      };
      this.commits.set(c.sha, c);
      return json({ sha: c.sha }, 201);
    }
    if (method === 'PATCH' && (m = /^\/git\/refs\/heads\/(.+)$/.exec(path))) {
      const branch = m[1]!;
      const current = this.refs.get(branch);
      if (!current) return json({ message: 'Reference does not exist' }, 422);
      const next = this.commits.get(body.sha);
      if (!next) return json({ message: 'Object does not exist' }, 422);
      if (!body.force && !next.parents.includes(current))
        return json({ message: 'Update is not a fast forward' }, 422);
      this.refs.set(branch, body.sha);
      return json({ object: { sha: body.sha } });
    }
    if (method === 'POST' && path === '/git/refs') {
      const branch = String(body.ref).replace(/^refs\/heads\//, '');
      if (this.refs.has(branch)) return json({ message: 'Reference already exists' }, 422);
      this.refs.set(branch, body.sha);
      return json({ ref: body.ref }, 201);
    }
    if (method === 'DELETE' && (m = /^\/git\/refs\/heads\/(.+)$/.exec(path))) {
      if (!this.refs.delete(m[1]!)) return json({ message: 'Reference does not exist' }, 422);
      return new Response(null, { status: 204 });
    }
    if (method === 'GET' && path === '/pulls') {
      const head = url.searchParams.get('head')?.split(':')[1];
      return json(
        this.pulls
          .filter((p) => p.state === 'open' && p.head === head)
          .map((p) => ({
            number: p.number,
            state: p.state,
            html_url: `https://github.com/${this.repo}/pull/${p.number}`,
            draft: p.draft,
          })),
      );
    }
    if (method === 'POST' && path === '/pulls') {
      const pr = {
        number: this.pulls.length + 1,
        head: body.head,
        title: body.title,
        body: body.body,
        state: 'open' as const,
        draft: body.draft === true,
        comments: [],
      };
      this.pulls.push(pr);
      return json(
        {
          number: pr.number,
          state: pr.state,
          html_url: `https://github.com/${this.repo}/pull/${pr.number}`,
          draft: pr.draft,
        },
        201,
      );
    }
    if (method === 'PATCH' && (m = /^\/pulls\/(\d+)$/.exec(path))) {
      const pr = this.pulls.find((p) => p.number === Number(m![1]));
      if (!pr) return json({ message: 'Not Found' }, 404);
      Object.assign(pr, body);
      return json({
        number: pr.number,
        state: pr.state,
        html_url: `https://github.com/${this.repo}/pull/${pr.number}`,
      });
    }
    if (method === 'POST' && (m = /^\/issues\/(\d+)\/comments$/.exec(path))) {
      this.pulls.find((p) => p.number === Number(m![1]))?.comments.push(body.body);
      return json({}, 201);
    }
    if (method === 'GET' && path === '/commits') {
      const page = Number(url.searchParams.get('page') ?? 1);
      const per = Number(url.searchParams.get('per_page') ?? 30);
      const list = this.log().slice((page - 1) * per, page * per);
      return json(
        list.map((c) => ({ sha: c.sha, commit: { author: c.author, message: c.message } })),
      );
    }
    return json({ message: `fake: ${method} ${path} は未対応` }, 501);
  };
}
