-- ============================================================
-- Stage 6: 精度と運用改善
-- ------------------------------------------------------------
--   psql "$DATABASE_URL" -f db/006_insights.sql
-- 001〜005 を適用済みの前提。何度実行しても同じ結果になる。
--
-- ★ このステージは「先に仕込む」ことに意味がある ★
-- 答えられなかった質問は、その場で記録しないと後から復元できない。
-- 分析そのものは運用が始まってからだが、記録は今から始める必要がある。
-- ============================================================

-- ------------------------------------------------------------
-- 答えられなかった質問
-- ------------------------------------------------------------
-- 会社説明会のチャットで、ナレッジに該当が無く
-- 「採用担当へお繋ぎします」と返した質問を残す。
-- ここに溜まった質問が、そのままナレッジの追加候補になる。
--
-- ⚠ 個人情報について
--   閲覧者が自由に入力した文章なので、氏名や連絡先が
--   紛れ込む可能性がある。そのため
--     ・誰が入力したかは一切記録しない（IPも識別子も持たない）
--     ・本文は200文字で切る
--     ・保存期間を設け、自動削除の対象にする
--   としている。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_misses (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  question    TEXT NOT NULL,
  best_score  REAL NOT NULL DEFAULT 0,   -- 最も近かった項目の一致度（閾値未満）
  best_id     TEXT,                      -- 最も近かった項目
  status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'added', 'ignored')),
  handled_at  TIMESTAMPTZ,
  handled_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_misses_status ON chat_misses (status, at DESC);
CREATE INDEX IF NOT EXISTS idx_misses_at     ON chat_misses (at);
