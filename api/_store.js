/* ============================================================
   Stage 1: 面接記録の保存先（データベース）
   ------------------------------------------------------------
   DATABASE_URL が設定されていればデータベースを使う。
   設定されていなければ「保存先なし」として扱い、
   これまで通りブラウザの localStorage だけで動く（デモとして無傷）。

   この切り分けにより、
     ・クライアントに渡しているデモURL … これまで通り
     ・本番環境                        … データベース
   を同じコードで運用できる。
   ============================================================ */

let sql = null;
let driverError = null;

function db() {
  if (sql || driverError) return sql;
  if (!process.env.DATABASE_URL) return null;

  try {
    // Neon / Vercel Postgres / Supabase いずれも DATABASE_URL で接続できる。
    // HTTP 経由のドライバなので、サーバーレスでも接続が枯渇しない。
    const { neon } = require('@neondatabase/serverless');
    sql = neon(process.env.DATABASE_URL);
  } catch (err) {
    // ドライバ未導入などで落ちても、デモとしての動作は止めない
    driverError = err;
    sql = null;
  }
  return sql;
}

function isEnabled() {
  return !!db();
}

/* ------------------------------------------------------------
   行 ⇄ 画面で使う形 の変換
   画面側は既存の形（camelCase）のままにしておきたいので、ここで吸収する。
   ------------------------------------------------------------ */
function toRecord(row) {
  return {
    id: row.id,
    token: row.token,
    candidate: { name: row.candidate_name, role: row.candidate_role },
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationSec: row.duration_sec,
    mode: row.mode,
    answers: row.answers || [],
    scores: row.scores || {},
    total: row.total,
    comment: row.comment || '',
    humanDecision: row.human_decision,
    humanMemo: row.human_memo || '',
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
  };
}

/* ------------------------------------------------------------
   操作ログ
   記録に失敗しても本処理は止めない（ログのために面接が失敗しては本末転倒）
   ------------------------------------------------------------ */
async function audit(action, target, detail = {}, actor = 'system') {
  const q = db();
  if (!q) return;
  try {
    await q`INSERT INTO audit_log (actor, action, target, detail)
            VALUES (${actor}, ${action}, ${target}, ${JSON.stringify(detail)}::jsonb)`;
  } catch (_) { /* 記録できなくても処理は続ける */ }
}

/* ------------------------------------------------------------
   面接記録の保存（応募者側から呼ばれる）
   同じ id での再送信は上書きする（回線が切れた際の二重送信対策）
   ------------------------------------------------------------ */
async function saveSession(rec) {
  const q = db();
  if (!q) return null;

  await q`
    INSERT INTO interview_sessions (
      id, token, candidate_name, candidate_role,
      started_at, finished_at, duration_sec, mode,
      answers, scores, total, comment
    ) VALUES (
      ${rec.id}, ${rec.token || null}, ${rec.candidate.name}, ${rec.candidate.role},
      ${rec.startedAt}, ${rec.finishedAt}, ${rec.durationSec || 0}, ${rec.mode || 'demo'},
      ${JSON.stringify(rec.answers || [])}::jsonb,
      ${JSON.stringify(rec.scores || {})}::jsonb,
      ${rec.total || 0}, ${rec.comment || ''}
    )
    ON CONFLICT (id) DO UPDATE SET
      answers = EXCLUDED.answers,
      scores  = EXCLUDED.scores,
      total   = EXCLUDED.total,
      comment = EXCLUDED.comment
  `;
  // 合否（human_decision / human_memo）はここでは触らない。
  // 応募者側からの送信で、人事の判断が上書きされることがあってはならない。

  await audit('session.save', rec.id, { total: rec.total, mode: rec.mode }, 'candidate');
  return rec.id;
}

/* ------------------------------------------------------------
   一覧・詳細（人事側から呼ばれる。鍵が必要）
   ------------------------------------------------------------ */
async function listSessions(limit = 200) {
  const q = db();
  if (!q) return [];
  const rows = await q`
    SELECT * FROM interview_sessions
    ORDER BY total DESC, finished_at DESC
    LIMIT ${limit}
  `;
  return rows.map(toRecord);
}

/* ------------------------------------------------------------
   人事による判断の記録
   AIはここに書き込めない。人事の操作だけがこの経路を通る。
   ------------------------------------------------------------ */
async function decideSession(id, { decision, memo, actor = 'hr' }) {
  const q = db();
  if (!q) return null;

  const valid = ['pass', 'hold', 'reject', null];
  if (!valid.includes(decision)) throw Object.assign(new Error('不正な判断値です。'), { status: 400 });

  const rows = await q`
    UPDATE interview_sessions SET
      human_decision = ${decision},
      human_memo     = ${memo || ''},
      decided_by     = ${decision === null ? null : actor},
      decided_at     = ${decision === null ? null : new Date().toISOString()}
    WHERE id = ${id}
    RETURNING *
  `;
  if (!rows.length) throw Object.assign(new Error('該当する記録がありません。'), { status: 404 });

  await audit('session.decide', id, { decision, memo: (memo || '').slice(0, 200) }, actor);
  return toRecord(rows[0]);
}

module.exports = { isEnabled, saveSession, listSessions, decideSession, audit };
