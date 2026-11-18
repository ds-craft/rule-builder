-- 改正案の一覧（「運営の改正案」の表示用）。本文の実体は Durable Object（ProposalRoom）の SQLite にある。
-- status はサーバーだけが変える（Yjs 文書の meta.status は画面から書き換えられるため使わない）。
CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  amending_kind TEXT NOT NULL DEFAULT 'ルール',
  amending_year INTEGER NOT NULL DEFAULT 0,
  amending_number INTEGER NOT NULL DEFAULT 0,
  enforcement_date TEXT NOT NULL DEFAULT '',
  -- 含まれるルール：[{ "name": "...", "op": "create" | "amend" | "repeal" }]
  rules TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  -- 公開リンク（発議後に発行。改正案 ID とは別の乱数）
  public_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE INDEX proposals_updated_at ON proposals (updated_at DESC);

-- ログインした運営者（編集者名・アイコンの表示用。判定は毎回 OpsBot に問い合わせる）
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  last_login_at TEXT NOT NULL
);

-- 監査記録（誰が・いつ・何を）
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);
CREATE INDEX audit_log_at ON audit_log (at DESC);
