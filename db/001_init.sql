-- ============================================================
-- Stage 1: 記録の永続化
-- ------------------------------------------------------------
-- 適用方法（Neon / Supabase / Vercel Postgres 共通）:
--   psql "$DATABASE_URL" -f db/001_init.sql
-- もしくは各サービスのSQLコンソールに貼り付ける。
--
-- 何度実行しても同じ結果になるように書いてある（IF NOT EXISTS）。
-- ============================================================

-- ------------------------------------------------------------
-- 候補者
-- ------------------------------------------------------------
-- Stage 1 の時点では、候補者はあらかじめ登録されている前提。
-- URLの発行（署名・期限・使い切り）は Stage 2 で追加する。
-- expires_at / used_at は、そのときに使う列を先に用意してある。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS candidates (
  token       TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,
  email       TEXT,
  applied_on  DATE,
  expires_at  TIMESTAMPTZ,          -- Stage 2: 期限
  used_at     TIMESTAMPTZ,          -- Stage 2: 使い切り判定
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 面接記録
-- ------------------------------------------------------------
-- answers / scores は構造が変わる可能性があるため jsonb で持つ。
-- 一方 total と human_decision は一覧の並べ替えと絞り込みに使うので列にする。
--
-- human_decision に書き込めるのは人事だけ。AIは NULL のまま引き渡す。
-- この不変条件がこのシステムの肝なので、既定値も NULL にしてある。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interview_sessions (
  id              TEXT PRIMARY KEY,
  token           TEXT REFERENCES candidates(token) ON DELETE SET NULL,
  candidate_name  TEXT NOT NULL,
  candidate_role  TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL,
  finished_at     TIMESTAMPTZ NOT NULL,
  duration_sec    INTEGER NOT NULL DEFAULT 0,
  mode            TEXT NOT NULL DEFAULT 'demo',   -- demo | live
  answers         JSONB NOT NULL DEFAULT '[]'::jsonb,
  scores          JSONB NOT NULL DEFAULT '{}'::jsonb,
  total           INTEGER NOT NULL DEFAULT 0,
  comment         TEXT,
  human_decision  TEXT CHECK (human_decision IN ('pass', 'hold', 'reject')),
  human_memo      TEXT NOT NULL DEFAULT '',
  decided_by      TEXT,                            -- Stage 3 で実際の担当者名が入る
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_total    ON interview_sessions (total DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_decision ON interview_sessions (human_decision);
CREATE INDEX IF NOT EXISTS idx_sessions_finished ON interview_sessions (finished_at DESC);

-- ------------------------------------------------------------
-- 操作ログ
-- ------------------------------------------------------------
-- 「なぜこの人を不合格にしたのか」に後から答えるための記録。
-- Stage 3 で actor に実際の担当者が入る。Stage 1 では 'hr'（共有鍵の利用者）。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id      BIGSERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor   TEXT NOT NULL DEFAULT 'unknown',
  action  TEXT NOT NULL,        -- session.save / session.decide / session.view
  target  TEXT,                 -- interview_sessions.id
  detail  JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_at     ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log (target);

-- ------------------------------------------------------------
-- 動作確認用の候補者（デモと同じ3名）
-- 本番導入時はこの INSERT を実行しないこと。
-- ------------------------------------------------------------
-- INSERT INTO candidates (token, name, role, applied_on) VALUES
--   ('demo-tanaka', '田中 陽子', 'Webエンジニア（中途採用）',                 '2026-08-25'),
--   ('demo-suzuki', '鈴木 健',   'エンジニア（ポテンシャル採用・未経験可）', '2026-08-26'),
--   ('demo-kato',   '加藤 美咲', 'カスタマーサポート（中途採用）',           '2026-08-27')
-- ON CONFLICT (token) DO NOTHING;
