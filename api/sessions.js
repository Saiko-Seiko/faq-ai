/* ============================================================
   /api/sessions — 面接記録の保存と取得
   ------------------------------------------------------------
   GET    一覧を返す        … 人事用。鍵が必要
   POST   面接記録を保存する … 応募者側から。鍵は不要
   PATCH  合否とメモを記録   … 人事用。鍵が必要

   読み書きで必要な権限が違う点が重要。
   応募者は「自分の回答を出す」ことはできるが、
   「他人の回答を読む」ことはできない。
   ============================================================ */

const store = require('./_store.js');
const auth = require('./_auth.js');

const MAX_ANSWERS = 20;
const MAX_TEXT = 8000;

/* ------------------------------------------------------------
   Stage 3: 共有の鍵から、担当者ごとのログインへ
   ------------------------------------------------------------
   Stage 1 では全員が同じ鍵を使っていたため、操作ログに
   「誰がやったか」を残せなかった。いまはセッションから担当者が分かる。

   必要な権限:
     viewer   … 一覧と詳細の閲覧
     reviewer … 合否とメモの記録
   ------------------------------------------------------------ */

function readBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return req.body || {};
}

/* 応募者側から届く記録を、そのまま信用せずに整える */
function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.id || !raw.candidate || !raw.candidate.name) return null;

  const answers = Array.isArray(raw.answers) ? raw.answers.slice(0, MAX_ANSWERS) : [];

  return {
    id: String(raw.id).slice(0, 200),
    token: raw.token ? String(raw.token).slice(0, 200) : null,
    candidate: {
      name: String(raw.candidate.name).slice(0, 200),
      role: String(raw.candidate.role || '').slice(0, 200),
    },
    startedAt: raw.startedAt || new Date().toISOString(),
    finishedAt: raw.finishedAt || new Date().toISOString(),
    durationSec: Number(raw.durationSec) || 0,
    mode: raw.mode === 'live' ? 'live' : 'demo',
    answers: answers.map((a) => ({
      id: String(a.id || '').slice(0, 50),
      axis: String(a.axis || '').slice(0, 50),
      question: String(a.question || '').slice(0, MAX_TEXT),
      text: String(a.text || '').slice(0, MAX_TEXT),
      seconds: Number(a.seconds) || 0,
    })),
    scores: (raw.scores && typeof raw.scores === 'object') ? raw.scores : {},
    total: Number(raw.total) || 0,
    comment: String(raw.comment || '').slice(0, MAX_TEXT),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // データベース未設定なら、画面側は localStorage で動く。
  // 「保存先が無い」ことを伝えて、画面側にそのまま処理させる。
  if (!store.isEnabled()) {
    res.status(501).json({ error: '保存先が未設定です。', storage: 'local' });
    return;
  }

  try {
    /* ---------- 一覧（人事） ---------- */
    if (req.method === 'GET') {
      const me = await auth.requireRole(req, res, 'viewer');
      if (!me) return;
      const records = await store.listSessions();
      res.status(200).json({ records });
      return;
    }

    /* ---------- 保存（応募者） ---------- */
    if (req.method === 'POST') {
      const rec = sanitize(readBody(req));
      if (!rec) {
        res.status(400).json({ error: '記録の形式が正しくありません。' });
        return;
      }
      await store.saveSession(rec);
      res.status(200).json({ ok: true, id: rec.id });
      return;
    }

    /* ---------- 合否の記録（人事） ---------- */
    if (req.method === 'PATCH') {
      // 合否の記録は reviewer 以上。閲覧のみの担当者は押せない。
      const me = await auth.requireRole(req, res, 'reviewer');
      if (!me) return;

      const body = readBody(req);
      if (!body.id) {
        res.status(400).json({ error: '対象が指定されていません。' });
        return;
      }
      const record = await store.decideSession(String(body.id), {
        decision: body.decision === undefined ? null : body.decision,
        memo: String(body.memo || '').slice(0, MAX_TEXT),
        actor: me, // 誰が判断したかを記録に残す
      });
      res.status(200).json({ ok: true, record });
      return;
    }

    res.status(405).json({ error: '対応していないメソッドです。' });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || '処理に失敗しました。' });
  }
};

