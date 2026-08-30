/* ============================================================
   /api/cleanup — 保存期間を過ぎた記録の削除
   ------------------------------------------------------------
   Vercel Cron から1日1回呼ばれる（vercel.json の crons を参照）。

   「保存期間を決めた」だけでは守ったことにならない。
   実際に消える仕組みが動いていて初めて、
   「応募者のデータは○ヶ月で消えます」と言える。
   ============================================================ */

const crypto = require('crypto');
const store = require('./_store.js');

/* Vercel Cron は CRON_SECRET が設定されていれば
   Authorization: Bearer <CRON_SECRET> を付けて呼んでくる。
   外部から勝手に叩かれないよう、設定されていれば必ず検証する。 */
function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // 未設定なら検証しない（開発時）

  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!authorized(req)) {
    res.status(401).json({ error: '認証に失敗しました。' });
    return;
  }

  if (!store.isEnabled()) {
    res.status(200).json({ ok: true, skipped: '保存先が未設定のため何もしませんでした。' });
    return;
  }

  try {
    const deleted = await store.purgeExpired();
    res.status(200).json({
      ok: true,
      deleted,
      retention: store.retentionPolicy(),
      at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || '削除処理に失敗しました。' });
  }
};
