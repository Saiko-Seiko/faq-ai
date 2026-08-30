/* ============================================================
   共通処理 — 設定 / 保存 / Claude API 呼び出し / モード切替
   全ページで読み込む。
   ============================================================ */

const CONFIG = {
  /* サーバー側（Vercel の /api）の窓口。
     ブラウザは Claude を直接呼ばない。APIキーはサーバーにしか無い。 */
  API_BASE: '/api',

  /* localStorage のキー */
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
   面接の回答ログ
   ------------------------------------------------------------
   ★ デモ限定 ★ localStorage に保存している。
   本番はサーバーのデータベースに保存し、保存期間と削除方針を
   個人情報保護方針に沿って定める必要がある。

   AI面接（interview.js）が書き込み、
   人事ダッシュボード（dashboard.js）が読み書きするため、共通側に置く。
   ------------------------------------------------------------ */
const Sessions = {
  all() {
    const list = Store.get(CONFIG.KEY_SESSIONS, []);
    return Array.isArray(list) ? list : [];
  },
  save(record) {
    const list = Sessions.all();
    const at = list.findIndex((r) => r.id === record.id);
    if (at >= 0) list[at] = record; else list.push(record);
    Store.set(CONFIG.KEY_SESSIONS, list);
    return record;
  },
};

/* ------------------------------------------------------------
   モード — demo（APIキー不要）／ live（Claude API を実際に呼ぶ）
   既定は必ず demo。商談中に通信やキーの都合で止まらないための保険。
   ------------------------------------------------------------ */
const Mode = {
  /* サーバーが応答し、かつAPIキーが設定されているときだけライブが使える。
     ローカルで index.html を直接開いた場合は false のまま。 */
  serverReady: false,

  get() {
    return Store.get(CONFIG.KEY_MODE, 'demo') === 'live' && Mode.serverReady ? 'live' : 'demo';
  },
  set(mode) {
    Store.set(CONFIG.KEY_MODE, mode === 'live' ? 'live' : 'demo');
    document.dispatchEvent(new CustomEvent('modechange', { detail: { mode: Mode.get() } }));
  },
  isLive() { return Mode.get() === 'live'; },

  /** 起動時に1度だけ、サーバーが使えるかを確かめる。 */
  async probe() {
    try {
      const res = await fetch(`${CONFIG.API_BASE}/health`, { cache: 'no-store' });
      if (!res.ok) throw new Error('unavailable');
      const info = await res.json();
      Mode.serverReady = !!info.configured;
      Mode.model = info.model || '';
    } catch (_) {
      // file:// で開いた場合や、未デプロイの場合はここに来る。デモモードで動かす。
      Mode.serverReady = false;
    }
    document.dispatchEvent(new CustomEvent('modechange', { detail: { mode: Mode.get() } }));
    return Mode.serverReady;
  },
};

/* ------------------------------------------------------------
   サーバー側の窓口を呼ぶ
   ------------------------------------------------------------
   Claude を呼ぶのはサーバー（/api/*）だけ。
   ブラウザにAPIキーは一切置かない。
   ------------------------------------------------------------ */
async function callApi(path, payload) {
  const res = await fetch(`${CONFIG.API_BASE}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let data = null;
  try { data = await res.json(); } catch (_) { /* 本文が無い場合もある */ }

  if (!res.ok) {
    throw new Error((data && data.error) || `サーバーエラー (${res.status})`);
  }
  return data || {};
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

        <label class="mode-option" id="liveOption">
          <input type="radio" name="mode" value="live">
          <span>
            <strong>ライブモード</strong>
            <span class="hint" id="liveHint">サーバー経由で Claude を呼び出します。</span>
          </span>
        </label>

        <div class="note note--accent">
          APIキーは<strong>サーバー側の環境変数にのみ</strong>保管しています。
          ブラウザからは見えず、この画面で入力する必要もありません。
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn--ghost" type="button" id="settingsClose">閉じる</button>
          <button class="btn" type="button" id="settingsSave">保存する</button>
        </div>
      </div>
    </div>
  `);

  const modal = document.getElementById('settingsModal');
  const liveRadio = modal.querySelector('input[value="live"]');

  function paintButton() {
    const live = Mode.isLive();
    document.getElementById('modeLabel').textContent = live ? 'ライブモード' : 'デモモード';
    document.getElementById('modeDot').className = `mode-dot ${live ? 'mode-dot--live' : ''}`;
  }

  /* サーバーが使えるかどうかで、ライブモードの選択可否を切り替える */
  function paintAvailability() {
    const ready = Mode.serverReady;
    liveRadio.disabled = !ready;
    document.getElementById('liveOption').style.opacity = ready ? '1' : '.5';
    document.getElementById('liveHint').textContent = ready
      ? `サーバー経由で Claude（${Mode.model || 'claude-opus-5'}）を呼び出します。`
      : 'このページはサーバーに接続されていないため使用できません。'
        + '（ローカルでファイルを直接開いた場合、または環境変数 ANTHROPIC_API_KEY が未設定の場合）';
  }

  function open() {
    const want = Store.get(CONFIG.KEY_MODE, 'demo');
    modal.querySelector(`input[value="${want === 'live' && Mode.serverReady ? 'live' : 'demo'}"]`).checked = true;
    paintAvailability();
    modal.hidden = false;
  }

  document.getElementById('modeBtn').addEventListener('click', open);
  document.getElementById('settingsClose').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });

  document.getElementById('settingsSave').addEventListener('click', () => {
    const picked = modal.querySelector('input[name="mode"]:checked').value;
    Mode.set(picked);
    modal.hidden = true;
    paintButton();
  });

  document.addEventListener('modechange', () => { paintButton(); paintAvailability(); });
  paintButton();

  // サーバーの状態を確認（失敗してもデモモードで動き続ける）
  Mode.probe();
}

document.addEventListener('DOMContentLoaded', mountSettings);
