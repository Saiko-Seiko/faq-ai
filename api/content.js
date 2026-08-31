/* ============================================================
   /api/content — 編集できるコンテンツの取得と保存
   ------------------------------------------------------------
   GET             … 公開中の内容（誰でも可。画面が起動時に読む）
   GET ?edit=1     … 下書きも含む内容（管理者）
   PUT             … 保存（管理者）
   POST {action:'seed'} … リポジトリの初期値を投入（管理者）

   GET が公開なのは、ここにある内容がもともと
   応募者に見せるもの（チャットの回答・面接の設問）だから。
   ============================================================ */

const content = require('./_content.js');
const auth = require('./_auth.js');
const store = require('./_store.js');

function readBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return req.body || {};
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    /* ---------- 公開中の内容 ---------- */
    if (req.method === 'GET' && !(req.query && req.query.edit)) {
      res.status(200).json(await content.getAll());
      return;
    }

    /* ---------- ここから管理者のみ ---------- */
    if (!store.isEnabled()) {
      res.status(501).json({ error: '保存先が未設定です。編集にはデータベースが必要です。' });
      return;
    }

    const me = await auth.requireRole(req, res, 'admin');
    if (!me) return;

    if (req.method === 'GET') {
      res.status(200).json(await content.getAll({ includeDrafts: true }));
      return;
    }

    if (req.method === 'POST' && readBody(req).action === 'seed') {
      await content.seedFromFiles(me);
      res.status(200).json({ ok: true, ...(await content.getAll({ includeDrafts: true })) });
      return;
    }

    if (req.method === 'PUT') {
      const body = readBody(req);

      if (Array.isArray(body.knowledge)) await content.saveKnowledge(body.knowledge, me);
      if (Array.isArray(body.questions)) await content.saveQuestions(body.questions, me);
      if (body.company) await content.saveSetting('company', body.company, me);
      if (body.video) await content.saveSetting('video', body.video, me);
      if (Array.isArray(body.axes)) await content.saveSetting('axes', body.axes, me);

      res.status(200).json({ ok: true, ...(await content.getAll({ includeDrafts: true })) });
      return;
    }

    res.status(405).json({ error: '対応していないメソッドです。' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || '処理に失敗しました。' });
  }
};
