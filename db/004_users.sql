-- ============================================================
-- Stage 3: 人事担当者のログインと権限
-- ------------------------------------------------------------
--   psql "$DATABASE_URL" -f db/004_users.sql
-- 001〜003 を適用済みの前提。何度実行しても同じ結果になる。
-- ============================================================

-- ------------------------------------------------------------
-- 担当者
-- ------------------------------------------------------------
-- アクセスキーは平文で保存しない（sha256 のハッシュだけを持つ）。
-- データベースが漏れても、そのまま鍵として使えないようにするため。
--
-- 権限は3段階:
--   viewer   … 閲覧のみ。合否は押せない
--   reviewer … 合否とメモを記録できる
--   admin    … 候補者の登録・データの削除・担当者の管理
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'reviewer'
                 CHECK (role IN ('viewer', 'reviewer', 'admin')),
  key_hash     TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   TEXT,
  disabled_at  TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (lower(email));

-- ------------------------------------------------------------
-- 操作ログの補強
-- ------------------------------------------------------------
-- Stage 1 では actor が 'hr' 固定だった（全員が同じ鍵を使っていたため）。
-- Stage 3 以降は担当者を特定できるので、誰の操作かを別列で持つ。
-- ------------------------------------------------------------
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_id    TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_email TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor_id, at DESC);

-- ------------------------------------------------------------
-- 共有鍵からの移行について
-- ------------------------------------------------------------
-- users が1件も無いあいだは、環境変数 HR_ACCESS_TOKEN で
-- 「最初の管理者」を登録できる（初期設定のためだけの経路）。
--
-- 管理者を1人でも登録したら、HR_ACCESS_TOKEN では
-- データにアクセスできなくなる。移行が済んだら環境変数から削除すること。
-- ------------------------------------------------------------
