-- 発議・採決・自動反映（手順書 Phase 10）。
-- 手続の記録の正は OpsBot（rule_proposals）。ここには一覧の表示用の写しと、反映に使う固定した内容を置く。

-- 一覧の表示用：題名（件名）・投票の締切・確定した改正ルール番号
ALTER TABLE proposals ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE proposals ADD COLUMN vote_closes_at TEXT;
ALTER TABLE proposals ADD COLUMN final_number TEXT;
CREATE INDEX proposals_status ON proposals (status);

-- 運営投票の開始時に固定した内容（10-3.2）。改正案1件につき最新の1件だけを置く（取り下げて発議し直すと置き換える）。
--   proposal：固定した改正案（packages/core の Proposal の JSON）。可決後の番号の付け替えと反映はここから組み立てる
--   content_hash：内容のハッシュ（sha256:…）。運営投票の本文に載せたもの
--   base_shas：改正・廃止するルールの元の版（{"rules/R0701001.md": "<blob SHA>"}）。反映の前に変わっていないか確かめる
CREATE TABLE proposal_freezes (
  proposal_id TEXT PRIMARY KEY REFERENCES proposals(id),
  frozen_at TEXT NOT NULL,
  frozen_by TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  proposal TEXT NOT NULL,
  base_shas TEXT NOT NULL
);

-- 改正ルール番号の採番表（10-6.1）。可決して確定した番号だけを入れる
CREATE TABLE amending_numbers (
  kind TEXT NOT NULL,
  year INTEGER NOT NULL,
  number INTEGER NOT NULL,
  proposal_id TEXT NOT NULL UNIQUE,
  fixed_at TEXT NOT NULL,
  PRIMARY KEY (kind, year, number)
);

-- 模擬の OpsBot（ステージングと手元の開発。wrangler.jsonc の OPSBOT_PROPOSALS が "sim" のとき）。
-- 本物の OpsBot の rule_proposals と同じ流れを、投票の可決・否決を画面のボタンで決める形でまねる。
CREATE TABLE sim_rule_proposals (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL
);
