-- ============================================================
-- Stage 5: 運用の引き渡し（ナレッジ・質問・会社情報の編集）
-- ------------------------------------------------------------
--   psql "$DATABASE_URL" -f db/005_content.sql
-- 001〜004 を適用済みの前提。何度実行しても同じ結果になる。
--
-- ねらい:
--   福利厚生が変わるたびに開発者へ依頼、という状態をなくす。
--   ここに入っている内容は、すべて人事の方が画面から書き換えられる。
-- ============================================================

-- ------------------------------------------------------------
-- ナレッジ（会社説明会チャットが答える内容）
-- ------------------------------------------------------------
-- keywords は配列。デモモードの照合に使う表記ゆれの一覧。
-- published を false にすると、公開せずに下書きとして持てる。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge (
  id         TEXT PRIMARY KEY,
  category   TEXT NOT NULL,
  question   TEXT NOT NULL,
  keywords   JSONB NOT NULL DEFAULT '[]'::jsonb,
  answer     TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100,
  published  BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_knowledge_order ON knowledge (published, sort_order, id);

-- ------------------------------------------------------------
-- 面接の質問
-- ------------------------------------------------------------
-- axis は評価軸のキー。どの観点の設問かを示す。
-- 深掘りの1問は自動生成なので、ここには入らない。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interview_questions (
  id         TEXT PRIMARY KEY,
  axis       TEXT NOT NULL,
  text       TEXT NOT NULL,
  hint       TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 100,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_questions_order ON interview_questions (enabled, sort_order, id);

-- ------------------------------------------------------------
-- 設定（会社情報・動画・評価軸の説明）
-- ------------------------------------------------------------
-- 項目が増えても表を変えずに済むよう、キーと値の形にしている。
--   company … { name, tagline }
--   video   … { url, poster, duration, chapters: [{at,title,ask}] }
--   axes    … [{ key, label, desc }]  ※ key は変更しない（記録と結びつくため）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);
