/* ============================================================
   /api/auth — 担当者のログイン
   ------------------------------------------------------------
   GET                    … 現在のログイン状態
   POST {email, key}      … ログイン（セッションCookieを発行）
   POST {action:'logout'} … ログアウト
   ============================================================ */

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

  // データベースが無い＝デモ運用。ログインの概念そのものが無い。
  if (!store.isEnabled()) {
    res.status(200).json({ authRequired: false, user: null, storage: 'local' });
    return;
  }

  try {
    /* ---------- 状態の確認 ---------- */
    if (req.method === 'GET') {
      const me = await auth.currentUser(req);
      res.status(200).json({
        authRequired: true,
        user: me,
        // 担当者が未登録なら、初期設定の画面を出す必要がある
        needsBootstrap: await auth.bootstrapAllowed(),
      });
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: '対応していないメソッドです。' });
      return;
    }

    const body = readBody(req);

    /* ---------- ログアウト ---------- */
    if (body.action === 'logout') {
      auth.setCookie(res, '', 0);
      res.status(200).json({ ok: true });
      return;
    }

    /* ---------- 初期設定：最初の管理者を作る ---------- */
    if (body.action === 'bootstrap') {
      if (!(await auth.bootstrapAllowed())) {
        res.status(409).json({ error: '担当者はすでに登録されています。' });
        return;
      }
      if (!auth.bootstrapTokenValid(req)) {
        res.status(401).json({ error: '初期設定用の鍵が正しくありません。' });
        return;
      }

      const email = String(body.email || '').trim().toLowerCase();
      const name = String(body.name || '').trim();
      if (!email || !name) {
        res.status(400).json({ error: '氏名とメールアドレスを入力してください。' });
        return;
      }

      const key = auth.newAccessKey();
      const user = await store.createUser({
        email, name, role: 'admin', keyHash: auth.hashKey(key), actor: 'bootstrap',
      });
      await store.audit('user.bootstrap', user.id, { email }, user);

      // アクセスキーを平文で返すのはこの1回だけ（保存はハッシュのみ）
      res.status(200).json({ user, accessKey: key });
      return;
    }

    /* ---------- ログイン ---------- */
    const email = String(body.email || '').trim();
    const key = String(body.key || '').trim();
    if (!email || !key) {
      res.status(400).json({ error: 'メールアドレスとアクセスキーを入力してください。' });
      return;
    }

    const user = await store.authenticate(email, auth.hashKey(key));
    if (!user) {
      // どちらが違うかは伝えない（総当たりの手がかりを与えない）
      res.status(401).json({ error: 'メールアドレスまたはアクセスキーが正しくありません。' });
      return;
    }

    auth.setCookie(res, auth.issue(user.id), auth.SESSION_HOURS * 3600);
    await store.audit('user.login', user.id, {}, user);
    res.status(200).json({ ok: true, user });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || '処理に失敗しました。' });
  }
};
