-- ============================================================
-- Stage 4: 個人情報の運用（保存期間・削除・削除請求）
-- ------------------------------------------------------------
--   psql "$DATABASE_URL" -f db/003_privacy.sql
-- 001 / 002 を適用済みの前提。何度実行しても同じ結果になる。
-- ============================================================

-- ------------------------------------------------------------
-- 削除請求
-- ------------------------------------------------------------
-- 応募者から「自分のデータを消してほしい」と言われたときの受け口。
-- 依頼を受けた記録自体を残す（対応の証跡になるため）。
-- ただし、対応完了後に残すのは「いつ・どの依頼に対応したか」だけで、
-- 氏名やメールアドレスは削除時に消す。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deletion_requests (
  id           BIGSERIAL PRIMARY KEY,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  token        TEXT,                -- 分かる場合のみ
  name         TEXT,                -- 対応後に NULL にする
  email        TEXT,                -- 対応後に NULL にする
  message      TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'done', 'rejected')),
  handled_at   TIMESTAMPTZ,
  handled_by   TEXT,
  note         TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_deletion_status ON deletion_requests (status, requested_at DESC);

-- ------------------------------------------------------------
-- 自動削除のための索引
-- ------------------------------------------------------------
-- 保存期間を過ぎた記録を毎日消す。その走査を軽くするためのもの。
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sessions_purge   ON interview_sessions (finished_at);
CREATE INDEX IF NOT EXISTS idx_candidates_purge ON candidates (created_at);

-- ------------------------------------------------------------
-- 保存期間についての覚え書き
-- ------------------------------------------------------------
-- 期間はアプリ側の環境変数で決める（クライアントの規程に合わせて変えるため）。
--
--   RETENTION_DAYS_SESSION    面接記録        既定 180日（6ヶ月）
--   RETENTION_DAYS_CANDIDATE  候補者          既定 365日
--   RETENTION_DAYS_AUDIT      操作ログ         既定 730日
--
-- 面接記録より候補者を長く持つのは、
-- 「同じ方が再応募したときに前回の経緯を確認したい」という
-- 採用側の要望が一般にあるため。
-- 不要であれば同じ日数にしてよい。クライアントと決める項目。
-- ------------------------------------------------------------
