-- ============================================================
-- Stage 2: 候補者URLの発行
-- ------------------------------------------------------------
--   psql "$DATABASE_URL" -f db/002_candidates.sql
-- 001 を適用済みの前提。何度実行しても同じ結果になる。
-- ============================================================

-- ------------------------------------------------------------
-- 候補者テーブルに、受験状況を管理する列を足す
-- ------------------------------------------------------------
-- token はランダムな文字列（推測不可）。
-- 署名付きトークン（JWT等）ではなくDB管理にしたのは、
--   ・発行後に無効化できる
--   ・「1回きり」を確実に判定できる
-- の2点が採用業務では必要なため。署名だけでは取り消せない。
-- ------------------------------------------------------------
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS started_at  TIMESTAMPTZ;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS revoked_at  TIMESTAMPTZ;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS invited_at  TIMESTAMPTZ;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS created_by  TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS note        TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_candidates_created ON candidates (created_at DESC);

-- ------------------------------------------------------------
-- 受験状況の考え方（アプリ側で判定する。ここは覚え書き）
-- ------------------------------------------------------------
--   revoked_at IS NOT NULL                     → 無効化
--   used_at    IS NOT NULL                     → 完了（URLは開けない）
--   expires_at < now()                         → 期限切れ
--   started_at IS NOT NULL                     → 受験中（再開は可能）
--   それ以外                                    → 未受験
--
-- 「完了したURLは二度と開けない」を優先している。
-- 受験途中の離脱だけは、期限内であればやり直せる。
-- 回線切断で応募者が受験機会を失うのは避けたいため。
-- ------------------------------------------------------------
