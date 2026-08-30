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

const crypto = require('crypto');
const store = require('./_store.js');

const MAX_ANSWERS = 20;
const MAX_TEXT = 8000;

/* ------------------------------------------------------------
   人事用の鍵
   ------------------------------------------------------------
   ⚠ Stage 1 の暫定措置。全員が同じ鍵を共有するため、
     「誰が操作したか」までは分からない（操作ログの actor は 'hr' 固定）。
     Stage 3 で担当者ごとのログインに置き換える。

   それでも今これを入れるのは、応募者の回答が個人情報であり、
   URLを知っていれば誰でも読める状態のまま本番のデータを
   置くわけにいかないため。
   ------------------------------------------------------------ */
function hrTokenRequired() {
  return !!process.env.HR_ACCESS_TOKEN;
}

function checkHr(req, res) {
  const expected = process.env.HR_ACCESS_TOKEN;

  // 鍵が未設定なら、データベースも使っていない想定（デモ運用）。
  // 本番でデータベースだけ設定して鍵を忘れると危険なので、その場合は拒否する。
  if (!expected) {
    if (store.isEnabled()) {
      res.status(503).json({
        error: '人事用の鍵が未設定です。環境変数 HR_ACCESS_TOKEN を設定してください。',
      });
      return false;
    }
    return true;
  }

  const given = String(req.headers['x-hr-token'] || '');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // 長さが違うと timingSafeEqual は例外を投げるため、先に長さで弾く
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    res.status(401).json({ error: '人事用の鍵が正しくありません。' });
    return false;
  }
  return true;
}

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
      if (!checkHr(req, res)) return;
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
      if (!checkHr(req, res)) return;
      const body = readBody(req);
      if (!body.id) {
        res.status(400).json({ error: '対象が指定されていません。' });
        return;
      }
      const record = await store.decideSession(String(body.id), {
        decision: body.decision === undefined ? null : body.decision,
        memo: String(body.memo || '').slice(0, MAX_TEXT),
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

module.exports.hrTokenRequired = hrTokenRequired;
