/* ============================================================
   /api/candidates — 候補者の登録とURLの発行
   ------------------------------------------------------------
   GET   ?token=xxx  … 応募者側。その1件の氏名と受験可否だけを返す（鍵不要）
   GET               … 人事側。一覧を返す（鍵必要）
   POST  {action:'start', token} … 受験開始の記録（鍵不要）
   POST  {name, role, ...}       … 候補者の登録とURL発行（鍵必要）
   PATCH {token, ...}            … 無効化・期限延長・案内送信済み（鍵必要）

   ★ 重要 ★
   応募者は「自分のトークン1件」しか引けない。
   一覧を引くには鍵が要る。ここを混ぜると、
   トークンを1つ持っている応募者が全員分を読めてしまう。
   ============================================================ */

const crypto = require('crypto');
const store = require('./_store.js');

const MAX_TEXT = 500;

function checkHr(req, res) {
  const expected = process.env.HR_ACCESS_TOKEN;
  if (!expected) {
    res.status(503).json({ error: '人事用の鍵が未設定です。環境変数 HR_ACCESS_TOKEN を設定してください。' });
    return false;
  }
  const given = String(req.headers['x-hr-token'] || '');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
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

/* 応募者に返してよい情報だけに絞る。
   メールアドレスや人事メモ、他の候補者の存在は返さない。 */
function publicView(c) {
  return {
    name: c.name,
    role: c.role,
    status: c.status,
    expiresAt: c.expiresAt,
    canStart: c.status === 'pending' || c.status === 'in_progress',
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!store.isEnabled()) {
    res.status(501).json({ error: '保存先が未設定です。', storage: 'local' });
    return;
  }

  try {
    const body = readBody(req);
    const queryToken = (req.query && req.query.token) ? String(req.query.token) : '';

    /* ---------- 応募者：自分のURLの状態を確認する ---------- */
    if (req.method === 'GET' && queryToken) {
      const c = await store.getCandidate(queryToken);
      if (!c) {
        res.status(404).json({ error: 'このURLは有効ではありません。' });
        return;
      }
      res.status(200).json({ candidate: publicView(c) });
      return;
    }

    /* ---------- 応募者：受験開始を記録する ---------- */
    if (req.method === 'POST' && body.action === 'start') {
      const token = String(body.token || '');
      const c = await store.getCandidate(token);
      if (!c) {
        res.status(404).json({ error: 'このURLは有効ではありません。' });
        return;
      }
      if (c.status !== 'pending' && c.status !== 'in_progress') {
        res.status(409).json({ error: 'このURLは使用できません。', candidate: publicView(c) });
        return;
      }
      const updated = await store.markStarted(token);
      res.status(200).json({ candidate: publicView(updated || c) });
      return;
    }

    /* ---------- ここから先は人事のみ ---------- */

    if (req.method === 'GET') {
      if (!checkHr(req, res)) return;
      const candidates = await store.listCandidates();
      res.status(200).json({ candidates });
      return;
    }

    if (req.method === 'POST') {
      if (!checkHr(req, res)) return;

      const name = String(body.name || '').trim().slice(0, MAX_TEXT);
      const role = String(body.role || '').trim().slice(0, MAX_TEXT);
      if (!name || !role) {
        res.status(400).json({ error: '氏名と応募職種を入力してください。' });
        return;
      }

      const candidate = await store.createCandidate({
        name,
        role,
        email: String(body.email || '').trim().slice(0, MAX_TEXT),
        note: String(body.note || '').trim().slice(0, MAX_TEXT),
        expiresInDays: Number(body.expiresInDays) || 14,
      });
      res.status(200).json({ candidate });
      return;
    }

    if (req.method === 'PATCH') {
      if (!checkHr(req, res)) return;
      const token = String(body.token || '');
      if (!token) {
        res.status(400).json({ error: '対象が指定されていません。' });
        return;
      }
      const candidate = await store.updateCandidate(token, {
        revoke: body.revoke,
        extendDays: body.extendDays,
        invited: body.invited,
      });
      if (!candidate) {
        res.status(404).json({ error: '該当する候補者がいません。' });
        return;
      }
      res.status(200).json({ candidate });
      return;
    }

    res.status(405).json({ error: '対応していないメソッドです。' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || '処理に失敗しました。' });
  }
};
