/* ============================================================
   GET /api/health — ライブモードが使える状態かを画面に伝える
   ------------------------------------------------------------
   ローカルで index.html を直接開いた場合、この呼び出しは失敗する。
   その場合は「デモモードのみ」と案内し、混乱させないようにする。
   ============================================================ */

const { isConfigured, MODEL } = require('./_claude.js');

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    configured: isConfigured(), // 環境変数が設定済みか（鍵そのものは返さない）
    model: MODEL,
  });
};
