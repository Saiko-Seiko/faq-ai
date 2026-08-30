/* ============================================================
   共通処理 — 設定 / 保存 / Claude API 呼び出し / モード切替
   全ページで読み込む。
   ============================================================ */

const CONFIG = {
  /* Claude API */
  MODEL: 'claude-opus-5',
  API_URL: 'https://api.anthropic.com/v1/messages',
  API_VERSION: '2023-06-01',

  /* 拒否時の自動フォールバック。万一 400 になる環境では false にすれば切れる */
  USE_FALLBACKS: true,
  FALLBACK_BETA: 'server-side-fallback-2026-07-01',

  /* localStorage のキー */
  KEY_APIKEY: 'faqai.apikey',
  KEY_MODE: 'faqai.mode',
  KEY_SESSIONS: 'faqai.sessions',
};

/* ------------------------------------------------------------
   localStorage ラッパ
   シークレットウィンドウやサイトデータ遮断でも落ちないよう
   すべて try/catch で包む。
   ------------------------------------------------------------ */
const Store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (_) { /* 無視 */ }
  },
};

/* ------------------------------------------------------------
   モード — demo（APIキー不要）／ live（Claude API を実際に呼ぶ）
   既定は必ず demo。商談中に通信やキーの都合で止まらないための保険。
   ------------------------------------------------------------ */
const Mode = {
  get() {
    return Store.get(CONFIG.KEY_MODE, 'demo') === 'live' && Mode.hasKey() ? 'live' : 'demo';
  },
  set(mode) {
    Store.set(CONFIG.KEY_MODE, mode === 'live' ? 'live' : 'demo');
    document.dispatchEvent(new CustomEvent('modechange', { detail: { mode: Mode.get() } }));
  },
  isLive() { return Mode.get() === 'live'; },
  hasKey() { return !!Store.get(CONFIG.KEY_APIKEY, ''); },
  key() { return Store.get(CONFIG.KEY_APIKEY, ''); },
};

/* ------------------------------------------------------------
   Claude API（Messages API）をブラウザから直接呼ぶ
   ------------------------------------------------------------
   ⚠ これはデモ専用の割り切り。
   ブラウザにAPIキーを置くとページを開いた人に読まれる。
   本番ではキーをサーバ側に置き、ブラウザからは自社APIを叩く構成にする。
   ------------------------------------------------------------ */
async function callClaude({ system, messages, maxTokens = 4096, effort = 'low' }) {
  const apiKey = Mode.key();
  if (!apiKey) throw new Error('APIキーが設定されていません。');

  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': CONFIG.API_VERSION,
    // ブラウザから直接呼ぶための明示的なオプトイン
    'anthropic-dangerous-direct-browser-access': 'true',
  };

  const body = {
    model: CONFIG.MODEL,
    max_tokens: maxTokens,
    system,
    messages,
    output_config: { effort },
  };

  if (CONFIG.USE_FALLBACKS) {
    headers['anthropic-beta'] = CONFIG.FALLBACK_BETA;
    body.fallbacks = 'default';
  }

  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const err = await res.json();
      detail = err?.error?.message || '';
    } catch (_) { /* JSON でないエラー本文は無視 */ }
    throw new Error(`APIエラー (${res.status}) ${detail}`.trim());
  }

  const data = await res.json();

  // 安全性の判定で応答が断られた場合。content を読む前に必ず確認する。
  if (data.stop_reason === 'refusal') {
    throw new Error('この内容にはお答えできませんでした。質問を変えてお試しください。');
  }

  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  return text;
}

/* ------------------------------------------------------------
   小物
   ------------------------------------------------------------ */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ------------------------------------------------------------
   設定モーダル（モード切替とAPIキー）
   全ページ共通なので、ここでDOMごと差し込む。
   ------------------------------------------------------------ */
function mountSettings() {
  const host = document.querySelector('[data-settings-slot]');
  if (!host) return;

  host.insertAdjacentHTML('beforeend', `
    <button class="btn btn--ghost btn--sm" id="modeBtn" type="button">
      <span id="modeDot" class="mode-dot"></span><span id="modeLabel">デモモード</span>
    </button>
  `);

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal" id="settingsModal" hidden>
      <div class="modal__box stack" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
        <h2 id="settingsTitle" style="font-size:17px">動作モードの設定</h2>

        <label class="mode-option">
          <input type="radio" name="mode" value="demo">
          <span>
            <strong>デモモード</strong>
            <span class="hint">APIキー不要。登録済みのナレッジから回答します。通信環境に左右されず、必ず動きます。</span>
          </span>
        </label>

        <label class="mode-option">
          <input type="radio" name="mode" value="live">
          <span>
            <strong>ライブモード</strong>
            <span class="hint">Claude API（${CONFIG.MODEL}）を実際に呼び出します。APIキーと通信が必要です。</span>
          </span>
        </label>

        <div class="field">
          <label class="field__label" for="apiKeyInput">Anthropic APIキー</label>
          <input class="input" id="apiKeyInput" type="password" placeholder="sk-ant-..." autocomplete="off" spellcheck="false">
          <p class="hint" style="margin:6px 0 0">
            このブラウザの localStorage にのみ保存されます。サーバーへは送信しません。
          </p>
        </div>

        <div class="note note--warn">
          ⚠ ブラウザからAPIキーを使うのは<strong>デモ限定の構成</strong>です。
          本番ではキーをサーバー側で保持し、ブラウザからは自社API経由で呼び出します。
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn--ghost" type="button" id="settingsClose">閉じる</button>
          <button class="btn" type="button" id="settingsSave">保存する</button>
        </div>
      </div>
    </div>
  `);

  const modal = document.getElementById('settingsModal');
  const keyInput = document.getElementById('apiKeyInput');

  function paintButton() {
    const live = Mode.isLive();
    document.getElementById('modeLabel').textContent = live ? 'ライブモード' : 'デモモード';
    document.getElementById('modeDot').className = `mode-dot ${live ? 'mode-dot--live' : ''}`;
  }

  function open() {
    keyInput.value = Store.get(CONFIG.KEY_APIKEY, '') || '';
    const want = Store.get(CONFIG.KEY_MODE, 'demo');
    modal.querySelector(`input[value="${want === 'live' ? 'live' : 'demo'}"]`).checked = true;
    modal.hidden = false;
  }

  document.getElementById('modeBtn').addEventListener('click', open);
  document.getElementById('settingsClose').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });

  document.getElementById('settingsSave').addEventListener('click', () => {
    const key = keyInput.value.trim();
    if (key) Store.set(CONFIG.KEY_APIKEY, key); else Store.remove(CONFIG.KEY_APIKEY);

    const picked = modal.querySelector('input[name="mode"]:checked').value;
    if (picked === 'live' && !key) {
      alert('ライブモードにはAPIキーが必要です。キーを入力するか、デモモードをお選びください。');
      return;
    }
    Mode.set(picked);
    modal.hidden = true;
    paintButton();
  });

  document.addEventListener('modechange', paintButton);
  paintButton();
}

document.addEventListener('DOMContentLoaded', mountSettings);
