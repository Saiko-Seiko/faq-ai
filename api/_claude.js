/* ============================================================
   Claude API 呼び出しの共通処理（サーバー側）
   ------------------------------------------------------------
   APIキーは環境変数 ANTHROPIC_API_KEY からのみ読む。
   ブラウザへは一切渡さない。ここが「本番構成」との一番大きな差分だった箇所。
   ============================================================ */

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-5';

/* 拒否された場合に別モデルへ自動で切り替える。
   採用の文脈で応答が止まると候補者の体験を損なうため有効にしている。 */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let client = null;
function getClient() {
  if (!client) client = new Anthropic(); // ANTHROPIC_API_KEY を環境から解決
  return client;
}

function isConfigured() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * Claude にテキストを1往復投げて、本文だけを返す。
 *
 * @param {object}   opts
 * @param {string}   opts.system     システムプロンプト（安定部分。キャッシュ対象）
 * @param {Array}    opts.messages   会話履歴
 * @param {number}   opts.maxTokens
 * @param {string}   opts.effort     'low' | 'high' など
 */
async function ask({ system, messages, maxTokens = 2048, effort = 'low' }) {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    // ナレッジを含む長いシステムプロンプトは毎回同じなので、
    // キャッシュして2回目以降の費用と待ち時間を下げる
    system: [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ],
    messages,
    output_config: { effort },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
  });

  // 安全性の判定で断られた場合。content を読む前に必ず確認する。
  if (response.stop_reason === 'refusal') {
    const err = new Error('この内容にはお答えできませんでした。');
    err.status = 422;
    throw err;
  }

  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

/* ------------------------------------------------------------
   リクエストの前処理
   ------------------------------------------------------------ */

function readBody(req) {
  // Vercel は JSON を自動で解釈するが、文字列で届く場合に備える
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return req.body || {};
}

/**
 * POST 以外・未設定・本文不正をここで弾く。
 * 問題なければ本文を返し、応答済みなら null を返す。
 */
function guard(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST のみ受け付けます。' });
    return null;
  }
  if (!isConfigured()) {
    res.status(503).json({
      error: 'サーバーにAPIキーが設定されていません。',
      hint: 'Vercel の環境変数 ANTHROPIC_API_KEY を設定してください。',
      configured: false,
    });
    return null;
  }
  return readBody(req);
}

/** 例外を、画面にそのまま出せる日本語のメッセージへ変換する。 */
function fail(res, err) {
  const status = err.status || err.statusCode || 500;
  const known = {
    401: '認証に失敗しました。APIキーをご確認ください。',
    429: 'ただいま混み合っています。少し時間をおいてお試しください。',
    529: 'ただいま混み合っています。少し時間をおいてお試しください。',
  };
  const message = known[status] || err.message || '応答の取得に失敗しました。';
  // 鍵やスタックトレースが混ざらないよう、返すのはメッセージだけに絞る
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
}

module.exports = { ask, guard, fail, isConfigured, MODEL };
