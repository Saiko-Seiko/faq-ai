/* ============================================================
   /api/insights — 運用の振り返り
   ------------------------------------------------------------
   POST {action:'miss', question} … 答えられなかった質問の記録（公開）
   GET                            … 集計とナレッジ候補（担当者）
   PATCH {ids, status}            … 候補の処理済み・除外（担当者）

   記録の POST が公開なのは、会社説明会ページが
   誰でも見られる場所にあるため。記録するのは質問文のみで、
   誰が入力したかは一切残さない。
   ============================================================ */

const insights = require('./_insights.js');
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

  if (!store.isEnabled()) {
    res.status(501).json({ error: '保存先が未設定です。', storage: 'local' });
    return;
  }

  try {
    const body = readBody(req);

    /* ---------- 答えられなかった質問を記録（公開） ---------- */
    if (req.method === 'POST' && body.action === 'miss') {
      await insights.recordMiss({
        question: body.question,
        bestScore: body.bestScore,
        bestId: body.bestId,
      });
      // 記録できたかどうかは閲覧者に関係ない。常に成功として返す。
      res.status(200).json({ ok: true });
      return;
    }

    /* ---------- ここから担当者のみ ---------- */
    const me = await auth.requireRole(req, res, 'viewer');
    if (!me) return;

    if (req.method === 'GET') {
      const axes = await content.getSetting('axes', null)
        .then((a) => (Array.isArray(a) && a.length ? a : require('../assets/js/interview-data.js').AXES));

      const [misses, agreementReport] = await Promise.all([
        insights.listMisses(),
        insights.agreement(axes),
      ]);
      res.status(200).json({ misses, agreement: agreementReport });
      return;
    }

    if (req.method === 'PATCH') {
      const status = body.status === 'added' ? 'added' : 'ignored';
      const n = await insights.closeMisses(body.ids, status, me);
      res.status(200).json({ ok: true, updated: n });
      return;
    }

    res.status(405).json({ error: '対応していないメソッドです。' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || '処理に失敗しました。' });
  }
};
