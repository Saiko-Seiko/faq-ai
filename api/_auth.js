/* ============================================================
   Stage 3: 担当者の認証と権限
   ------------------------------------------------------------
   仕組み:
     1. 担当者は自分専用のアクセスキーでログインする
     2. サーバーは署名付きのセッションCookieを返す（有効期限つき）
     3. 以降のリクエストはCookieで判定する

   キーは平文で保存せず sha256 のハッシュだけを持つ。
   Cookie は HttpOnly なので、画面のスクリプトからは読めない。

   ※ メールリンク方式（パスワードを持たない認証）を当初想定していたが、
     メール送信の経路をまだ用意していないため、担当者ごとの
     アクセスキーで代替している。得られるもの（誰の操作かが分かる、
     個別に停止できる）は同じ。メール送信を入れる段階で差し替えられるよう、
     ログインの入口はこのファイルに閉じてある。
   ============================================================ */

const crypto = require('crypto');
const store = require('./_store.js');

const COOKIE = 'faqai_session';
const SESSION_HOURS = 12;

/* 権限の強さ。上位は下位の操作をすべて含む。 */
const RANK = { viewer: 1, reviewer: 2, admin: 3 };

function secret() {
  // 専用の値が無ければ、他の秘密値から導出する（設定漏れで落とさないため）
  return process.env.AUTH_SECRET
    || process.env.HR_ACCESS_TOKEN
    || process.env.ANTHROPIC_API_KEY
    || 'faq-ai-development-only';
}

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

function newAccessKey() {
  return crypto.randomBytes(24).toString('base64url');
}

function equal(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ------------------------------------------------------------
   セッションCookie（署名付き。サーバー側に保存を持たない）
   失効はユーザーの disabled_at で判定するため、
   停止した担当者は Cookie が残っていても弾かれる。
   ------------------------------------------------------------ */
function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function issue(userId) {
  const expires = Date.now() + SESSION_HOURS * 3600 * 1000;
  const payload = `${userId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

function verify(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [userId, expires, mac] = parts;
  if (!equal(mac, sign(`${userId}.${expires}`))) return null;
  if (Date.now() > Number(expires)) return null;
  return userId;
}

function setCookie(res, value, maxAgeSec) {
  const bits = [
    `${COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSec}`,
  ];
  // 本番は https。ローカルの vercel dev は http なので付けない。
  if (process.env.VERCEL) bits.push('Secure');
  res.setHeader('Set-Cookie', bits.join('; '));
}

function readCookie(req) {
  const raw = req.headers.cookie || '';
  const hit = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
  return hit ? hit.slice(COOKIE.length + 1) : '';
}

/* ------------------------------------------------------------
   現在のログイン者を取得する
   ------------------------------------------------------------ */
async function currentUser(req) {
  const userId = verify(readCookie(req));
  if (!userId) return null;

  const user = await store.getUser(userId);
  if (!user || user.disabledAt) return null; // 停止された担当者は即座に無効
  return user;
}

/* ------------------------------------------------------------
   権限の確認
   ------------------------------------------------------------
   使い方:  const me = await require('./_auth.js').require(req, res, 'reviewer');
            if (!me) return;   // 応答済み
   ------------------------------------------------------------ */
async function requireRole(req, res, minimum = 'viewer') {
  const me = await currentUser(req);

  if (!me) {
    res.status(401).json({ error: 'ログインが必要です。', login: true });
    return null;
  }
  if (RANK[me.role] < RANK[minimum]) {
    res.status(403).json({
      error: 'この操作を行う権限がありません。担当者の権限をご確認ください。',
    });
    return null;
  }
  return me;
}

/* ------------------------------------------------------------
   初期設定のための経路
   ------------------------------------------------------------
   担当者が1人も登録されていないあいだだけ、
   環境変数 HR_ACCESS_TOKEN で最初の管理者を作れる。
   1人でも登録されたら、この経路は閉じる。
   ------------------------------------------------------------ */
async function bootstrapAllowed() {
  if (!process.env.HR_ACCESS_TOKEN) return false;
  return (await store.countUsers()) === 0;
}

function bootstrapTokenValid(req) {
  const given = String(req.headers['x-hr-token'] || '');
  return !!process.env.HR_ACCESS_TOKEN && equal(given, process.env.HR_ACCESS_TOKEN);
}

module.exports = {
  COOKIE, SESSION_HOURS, RANK,
  hashKey, newAccessKey, equal,
  issue, verify, setCookie, readCookie,
  currentUser, requireRole,
  bootstrapAllowed, bootstrapTokenValid,
};
