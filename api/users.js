/* ============================================================
   /api/users — 担当者の管理（管理者のみ）
   ------------------------------------------------------------
   GET            … 担当者の一覧
   GET ?audit=1   … 操作ログ（誰がいつ何をしたか）
   POST           … 担当者の追加（アクセスキーを発行して1回だけ返す）
   PATCH          … 権限の変更・停止・キーの再発行
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

  if (!store.isEnabled()) {
    res.status(501).json({ error: '保存先が未設定です。', storage: 'local' });
    return;
  }

  try {
    const me = await auth.requireRole(req, res, 'admin');
    if (!me) return;

    const q = req.query || {};
    const body = readBody(req);

    /* ---------- 操作ログ ---------- */
    if (req.method === 'GET' && q.audit) {
      const entries = await store.listAudit({ limit: 300 });
      res.status(200).json({ entries });
      return;
    }

    if (req.method === 'GET') {
      res.status(200).json({ users: await store.listUsers() });
      return;
    }

    /* ---------- 追加 ---------- */
    if (req.method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      const name = String(body.name || '').trim();
      const role = ['viewer', 'reviewer', 'admin'].includes(body.role) ? body.role : 'reviewer';

      if (!email || !name) {
        res.status(400).json({ error: '氏名とメールアドレスを入力してください。' });
        return;
      }

      const key = auth.newAccessKey();
      let user;
      try {
        user = await store.createUser({ email, name, role, keyHash: auth.hashKey(key), actor: me.id });
      } catch (err) {
        // UNIQUE 制約に当たった場合
        res.status(409).json({ error: 'このメールアドレスはすでに登録されています。' });
        return;
      }
      await store.audit('user.create', user.id, { email, role }, me);

      // 平文のキーを返すのはこの1回だけ。保存しているのはハッシュのみ。
      res.status(200).json({ user, accessKey: key });
      return;
    }

    /* ---------- 変更 ---------- */
    if (req.method === 'PATCH') {
      const id = String(body.id || '');
      if (!id) {
        res.status(400).json({ error: '対象が指定されていません。' });
        return;
      }

      // 自分自身を停止・降格できないようにする（管理者が居なくなるのを防ぐ）
      if (id === me.id && (body.disabled === true || (body.role && body.role !== 'admin'))) {
        res.status(400).json({ error: 'ご自身の権限を下げる・停止することはできません。' });
        return;
      }

      let accessKey = null;
      const patch = {};
      if (body.role) patch.role = ['viewer', 'reviewer', 'admin'].includes(body.role) ? body.role : undefined;
      if (typeof body.disabled === 'boolean') patch.disabled = body.disabled;
      if (body.regenerateKey) {
        accessKey = auth.newAccessKey();
        patch.keyHash = auth.hashKey(accessKey);
      }

      const user = await store.updateUser(id, patch);
      if (!user) {
        res.status(404).json({ error: '該当する担当者がいません。' });
        return;
      }
      await store.audit('user.update', id, {
        role: patch.role, disabled: patch.disabled, keyReissued: !!accessKey,
      }, me);

      res.status(200).json({ user, accessKey });
      return;
    }

    res.status(405).json({ error: '対応していないメソッドです。' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || '処理に失敗しました。' });
  }
};
