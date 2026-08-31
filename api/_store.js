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

/* 他のモジュール（_content.js）から同じ接続を使うための入口。
   返るのはタグ付きテンプレート関数なので、必ず sql`...` の形で使うこと。 */
function client() {
  return db();
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

  // actor は文字列（'system' など）でも、担当者オブジェクトでも受ける。
  // Stage 3 以降は担当者が渡ってくるので、誰の操作かを列に残す。
  const isUser = actor && typeof actor === 'object';
  const label = isUser ? (actor.email || actor.id) : String(actor);
  const actorId = isUser ? actor.id : null;
  const actorEmail = isUser ? actor.email : null;

  try {
    await q`INSERT INTO audit_log (actor, actor_id, actor_email, action, target, detail)
            VALUES (${label}, ${actorId}, ${actorEmail}, ${action}, ${target},
                    ${JSON.stringify(detail)}::jsonb)`;
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

  // 受験完了。このURLは以降開けなくなる（Stage 2: 使い切り）
  if (rec.token) {
    try { await markUsed(rec.token); } catch (_) { /* 記録は保存済み。ここで失敗しても中断しない */ }
  }

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

  // actor は担当者オブジェクト（Stage 3）か文字列。表示用の名前を取り出す。
  const actorLabel = (actor && typeof actor === 'object')
    ? (actor.name ? `${actor.name}（${actor.email}）` : actor.email)
    : String(actor);

  const rows = await q`
    UPDATE interview_sessions SET
      human_decision = ${decision},
      human_memo     = ${memo || ''},
      decided_by     = ${decision === null ? null : actorLabel},
      decided_at     = ${decision === null ? null : new Date().toISOString()}
    WHERE id = ${id}
    RETURNING *
  `;
  if (!rows.length) throw Object.assign(new Error('該当する記録がありません。'), { status: 404 });

  await audit('session.decide', id, { decision, memo: (memo || '').slice(0, 200) }, actor);
  return toRecord(rows[0]);
}

/* ============================================================
   Stage 2: 候補者と受験用URL
   ============================================================ */

const crypto = require('crypto');

/* 推測できない長さのランダム文字列。URLにそのまま載せられる形にする。 */
function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

/* 受験状況の判定。画面と応募者側の両方がこの1箇所を見る。 */
function statusOf(row) {
  const now = Date.now();
  if (row.revoked_at) return 'revoked';
  if (row.used_at) return 'done';
  if (row.expires_at && new Date(row.expires_at).getTime() < now) return 'expired';
  if (row.started_at) return 'in_progress';
  return 'pending';
}

function toCandidate(row) {
  return {
    token: row.token,
    name: row.name,
    role: row.role,
    email: row.email || '',
    note: row.note || '',
    appliedOn: row.applied_on,
    expiresAt: row.expires_at,
    startedAt: row.started_at,
    usedAt: row.used_at,
    invitedAt: row.invited_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    status: statusOf(row),
  };
}

async function listCandidates(limit = 300) {
  const q = db();
  if (!q) return [];
  const rows = await q`SELECT * FROM candidates ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map(toCandidate);
}

/* 担当者オブジェクトでも文字列でも受けられるようにする（列は TEXT のため） */
function actorLabel(actor) {
  if (actor && typeof actor === 'object') return actor.email || actor.id || 'unknown';
  return String(actor);
}

async function createCandidate({ name, role, email, note, expiresInDays = 14, actor = 'hr' }) {
  const q = db();
  if (!q) return null;

  const token = newToken();
  const expiresAt = new Date(Date.now() + Math.max(1, expiresInDays) * 86400000).toISOString();

  const rows = await q`
    INSERT INTO candidates (token, name, role, email, note, applied_on, expires_at, created_by)
    VALUES (${token}, ${name}, ${role}, ${email || null}, ${note || ''}, CURRENT_DATE, ${expiresAt}, ${actorLabel(actor)})
    RETURNING *
  `;
  await audit('candidate.create', token, { name, role, expiresAt }, actor);
  return toCandidate(rows[0]);
}

/* 応募者側が開いたときに使う。一覧は返さず、その1件だけを返す。 */
async function getCandidate(token) {
  const q = db();
  if (!q) return null;
  const rows = await q`SELECT * FROM candidates WHERE token = ${token} LIMIT 1`;
  return rows.length ? toCandidate(rows[0]) : null;
}

/* 受験開始を記録する（初回のみ）。中断からの再開では上書きしない。 */
async function markStarted(token) {
  const q = db();
  if (!q) return null;
  const rows = await q`
    UPDATE candidates SET started_at = COALESCE(started_at, now())
    WHERE token = ${token} AND revoked_at IS NULL AND used_at IS NULL
    RETURNING *
  `;
  return rows.length ? toCandidate(rows[0]) : null;
}

/* 受験完了。以降このURLは開けない（使い切り）。 */
async function markUsed(token) {
  const q = db();
  if (!q || !token) return null;
  const rows = await q`
    UPDATE candidates SET used_at = COALESCE(used_at, now())
    WHERE token = ${token}
    RETURNING *
  `;
  return rows.length ? toCandidate(rows[0]) : null;
}

/* 無効化・期限延長・案内送信済みの記録 */
async function updateCandidate(token, { revoke, extendDays, invited, actor = 'hr' }) {
  const q = db();
  if (!q) return null;

  if (revoke === true) {
    await q`UPDATE candidates SET revoked_at = now() WHERE token = ${token}`;
    await audit('candidate.revoke', token, {}, actor);
  }
  if (revoke === false) {
    await q`UPDATE candidates SET revoked_at = NULL WHERE token = ${token}`;
    await audit('candidate.unrevoke', token, {}, actor);
  }
  if (extendDays) {
    const days = Math.max(1, Math.min(365, Number(extendDays)));
    const until = new Date(Date.now() + days * 86400000).toISOString();
    await q`UPDATE candidates SET expires_at = ${until} WHERE token = ${token}`;
    await audit('candidate.extend', token, { days }, actor);
  }
  if (invited) {
    await q`UPDATE candidates SET invited_at = now() WHERE token = ${token}`;
    await audit('candidate.invite', token, {}, actor);
  }

  const rows = await q`SELECT * FROM candidates WHERE token = ${token} LIMIT 1`;
  return rows.length ? toCandidate(rows[0]) : null;
}

/* ============================================================
   Stage 4: 個人情報の運用
   ============================================================ */

/* 保存期間。クライアントの規程に合わせて環境変数で変える。 */
const RETENTION = {
  session:   Number(process.env.RETENTION_DAYS_SESSION   || 180),
  candidate: Number(process.env.RETENTION_DAYS_CANDIDATE || 365),
  audit:     Number(process.env.RETENTION_DAYS_AUDIT     || 730),
};

function retentionPolicy() {
  return { ...RETENTION };
}

/* ------------------------------------------------------------
   完全削除
   ------------------------------------------------------------
   応募者からの削除請求と、保存期間切れの両方で使う。
   論理削除（フラグを立てるだけ）にはしない。
   「消してほしい」に対して「見えなくしました」では答えになっていないため。
   ------------------------------------------------------------ */
async function purgeCandidate(token, actor = 'hr') {
  const q = db();
  if (!q) return null;

  const sessions = await q`DELETE FROM interview_sessions WHERE token = ${token} RETURNING id`;
  await q`DELETE FROM candidates WHERE token = ${token}`;

  // 監査ログには氏名も回答も残さない。「消したという事実」だけを残す。
  await audit('data.purge', token, { sessions: sessions.length, reason: 'request' }, actor);
  return { sessions: sessions.length };
}

async function purgeSession(id, actor = 'hr') {
  const q = db();
  if (!q) return null;
  await q`DELETE FROM interview_sessions WHERE id = ${id}`;
  await audit('data.purge', id, { reason: 'request' }, actor);
  return true;
}

/* ------------------------------------------------------------
   保存期間切れの自動削除（毎日1回、cron から呼ばれる）
   ------------------------------------------------------------ */
async function purgeExpired() {
  const q = db();
  if (!q) return null;

  const days = (n) => `${Math.max(1, n)} days`;

  // 面接記録
  const sessions = await q`
    DELETE FROM interview_sessions
    WHERE finished_at < now() - ${days(RETENTION.session)}::interval
    RETURNING id
  `;

  // 候補者（面接記録が残っているものは消さない。先に記録が消えてから）
  const candidates = await q`
    DELETE FROM candidates
    WHERE created_at < now() - ${days(RETENTION.candidate)}::interval
      AND NOT EXISTS (
        SELECT 1 FROM interview_sessions s WHERE s.token = candidates.token
      )
    RETURNING token
  `;

  // 操作ログ
  const audits = await q`
    DELETE FROM audit_log
    WHERE at < now() - ${days(RETENTION.audit)}::interval
    RETURNING id
  `;

  const result = {
    sessions: sessions.length,
    candidates: candidates.length,
    auditEntries: audits.length,
  };

  // 何を消したかは件数だけ記録する（個人を特定できる情報は書かない）
  await audit('data.purge_expired', null, { ...result, retention: RETENTION }, 'system');
  return result;
}

/* ------------------------------------------------------------
   削除請求
   ------------------------------------------------------------ */
async function createDeletionRequest({ token, name, email, message }) {
  const q = db();
  if (!q) return null;
  const rows = await q`
    INSERT INTO deletion_requests (token, name, email, message)
    VALUES (${token || null}, ${name || null}, ${email || null}, ${message || ''})
    RETURNING id, requested_at
  `;
  // 依頼内容そのものは監査ログに書かない（本文に個人情報が含まれうるため）
  await audit('deletion.request', String(rows[0].id), {}, 'candidate');
  return rows[0];
}

async function listDeletionRequests() {
  const q = db();
  if (!q) return [];
  const rows = await q`
    SELECT * FROM deletion_requests
    ORDER BY (status = 'open') DESC, requested_at DESC
    LIMIT 200
  `;
  return rows.map((r) => ({
    id: r.id,
    requestedAt: r.requested_at,
    token: r.token,
    name: r.name,
    email: r.email,
    message: r.message,
    status: r.status,
    handledAt: r.handled_at,
    note: r.note,
  }));
}

/* 対応済みにする。対応と同時に、依頼に含まれる個人情報も消す。 */
async function closeDeletionRequest(id, { status = 'done', note = '', actor = 'hr' }) {
  const q = db();
  if (!q) return null;
  const rows = await q`
    UPDATE deletion_requests SET
      status     = ${status},
      handled_at = now(),
      handled_by = ${actorLabel(actor)},
      note       = ${note},
      name       = NULL,
      email      = NULL,
      message    = ''
    WHERE id = ${id}
    RETURNING id, status
  `;
  await audit('deletion.close', String(id), { status }, actor);
  return rows.length ? rows[0] : null;
}

/* ============================================================
   Stage 3: 担当者
   ============================================================ */

function toUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
    lastLoginAt: row.last_login_at,
  };
}

async function countUsers() {
  const q = db();
  if (!q) return 0;
  const rows = await q`SELECT count(*)::int AS n FROM users WHERE disabled_at IS NULL`;
  return rows[0] ? rows[0].n : 0;
}

async function getUser(id) {
  const q = db();
  if (!q) return null;
  const rows = await q`SELECT * FROM users WHERE id = ${id} LIMIT 1`;
  return rows.length ? toUser(rows[0]) : null;
}

/* ログイン。メールとキーの両方が合ったときだけ担当者を返す。 */
async function authenticate(email, keyHash) {
  const q = db();
  if (!q) return null;
  const rows = await q`
    SELECT * FROM users
    WHERE lower(email) = lower(${email}) AND key_hash = ${keyHash} AND disabled_at IS NULL
    LIMIT 1
  `;
  if (!rows.length) return null;
  await q`UPDATE users SET last_login_at = now() WHERE id = ${rows[0].id}`;
  return toUser(rows[0]);
}

async function listUsers() {
  const q = db();
  if (!q) return [];
  const rows = await q`SELECT * FROM users ORDER BY disabled_at NULLS FIRST, created_at ASC`;
  return rows.map(toUser);
}

async function createUser({ email, name, role, keyHash, actor = 'system' }) {
  const q = db();
  if (!q) return null;
  const id = crypto.randomBytes(12).toString('base64url');
  const rows = await q`
    INSERT INTO users (id, email, name, role, key_hash, created_by)
    VALUES (${id}, ${email}, ${name}, ${role}, ${keyHash}, ${actor})
    RETURNING *
  `;
  return toUser(rows[0]);
}

async function updateUser(id, { role, disabled, keyHash }) {
  const q = db();
  if (!q) return null;
  if (role) await q`UPDATE users SET role = ${role} WHERE id = ${id}`;
  if (disabled === true) await q`UPDATE users SET disabled_at = now() WHERE id = ${id}`;
  if (disabled === false) await q`UPDATE users SET disabled_at = NULL WHERE id = ${id}`;
  if (keyHash) await q`UPDATE users SET key_hash = ${keyHash} WHERE id = ${id}`;
  return getUser(id);
}

/* 操作ログ（担当者つき）。誰が何をしたかを追えるようにする。 */
async function listAudit({ limit = 200, target = null } = {}) {
  const q = db();
  if (!q) return [];
  const rows = target
    ? await q`SELECT * FROM audit_log WHERE target = ${target} ORDER BY at DESC LIMIT ${limit}`
    : await q`SELECT * FROM audit_log ORDER BY at DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action,
    target: r.target,
    actor: r.actor,
    actorEmail: r.actor_email,
    detail: r.detail,
  }));
}

module.exports = {
  isEnabled, client, saveSession, listSessions, decideSession, audit,
  countUsers, getUser, authenticate, listUsers, createUser, updateUser, listAudit,
  listCandidates, createCandidate, getCandidate,
  markStarted, markUsed, updateCandidate, statusOf,
  retentionPolicy, purgeCandidate, purgeSession, purgeExpired,
  createDeletionRequest, listDeletionRequests, closeDeletionRequest,
};
