/* ============================================================
   会社説明会ページ — 動画プレーヤー（デモ）＋ AI人事担当チャット
   ============================================================ */

/* ============================================================
   1. 動画プレーヤー
   ------------------------------------------------------------
   ★ 差し替えポイント ★
   ここは実際の <video> ではなく、尺と再生位置だけを持つ疑似プレーヤー。
   本番では video 要素に置き換え、
     tick()          → video の timeupdate イベント
     seekTo(sec)     → video.currentTime = sec
     togglePlay()    → video.play() / video.pause()
   に差し替えれば、チャプター連動はそのまま使える。
   ============================================================ */
const Player = (() => {
  let current = 0;
  let playing = false;
  let timer = null;
  let video = null;   // 実際の動画がある場合のみ。無ければ疑似プレーヤー。

  const el = {
    stage:   document.getElementById('playBtn'),
    barBtn:  document.getElementById('playBtn2'),
    seek:    document.getElementById('seek'),
    fill:    document.getElementById('seekFill'),
    now:     document.getElementById('tNow'),
    all:     document.getElementById('tAll'),
    kicker:  document.getElementById('slideKicker'),
    title:   document.getElementById('slideTitle'),
    sub:     document.getElementById('slideSub'),
    list:    document.getElementById('chapters'),
  };

  function chapterIndexAt(sec) {
    let idx = 0;
    Content.video.chapters.forEach((c, i) => { if (sec >= c.at) idx = i; });
    return idx;
  }

  function paint() {
    const pct = (current / Content.video.duration) * 100;
    el.fill.style.width = `${Math.min(100, pct)}%`;
    el.now.textContent = formatClock(current);

    const idx = chapterIndexAt(current);
    el.kicker.textContent = `CHAPTER ${idx + 1}`;
    el.title.textContent = Content.video.chapters[idx].title;

    el.list.querySelectorAll('.chapter').forEach((b, i) => {
      b.setAttribute('aria-current', String(i === idx));
    });

    const mark = playing ? '❚❚' : '▶';
    el.barBtn.textContent = mark;
    el.stage.dataset.playing = String(playing);
    el.stage.setAttribute('aria-label', playing ? '一時停止' : '再生');
  }

  function tick() {
    current += 1;
    if (current >= Content.video.duration) {
      current = Content.video.duration;
      pause();
    }
    paint();
  }

  function play() {
    if (video) { video.play(); return; }
    if (playing) return;
    if (current >= Content.video.duration) current = 0;
    playing = true;
    timer = setInterval(tick, 1000);
    paint();
  }

  function pause() {
    if (video) { video.pause(); return; }
    playing = false;
    clearInterval(timer);
    timer = null;
    paint();
  }

  function toggle() { playing ? pause() : play(); }

  function seekTo(sec) {
    if (video) { video.currentTime = Math.max(0, Math.min(video.duration || sec, sec)); return; }
    current = Math.max(0, Math.min(Content.video.duration, Math.round(sec)));
    paint();
  }

  function buildChapters() {
    el.list.innerHTML = Content.video.chapters.map((c, i) => `
      <li>
        <button class="chapter" type="button" data-seek="${c.at}" aria-current="${i === 0}">
          <time>${formatClock(c.at)}</time>
          <span>${escapeHtml(c.title)}</span>
        </button>
        <button class="chapter-ask" type="button" data-ask="${escapeHtml(c.ask)}"
                title="この章について質問する">質問する</button>
      </li>
    `).join('');

    el.list.addEventListener('click', (e) => {
      const seekBtn = e.target.closest('[data-seek]');
      if (seekBtn) { seekTo(Number(seekBtn.dataset.seek)); return; }

      const askBtn = e.target.closest('[data-ask]');
      if (askBtn) Chat.send(askBtn.dataset.ask);
    });
  }

  /* ------------------------------------------------------------
     Stage 5: 実際の動画が設定されていれば、疑似プレーヤーを差し替える。
     チャプターの時刻はそのまま video.currentTime に対応する。
     ------------------------------------------------------------ */
  function useRealVideo(url) {
    const stage = document.querySelector('.player__stage');
    stage.innerHTML = `<video id="realVideo" controls playsinline preload="metadata"
                              style="width:100%;height:100%;object-fit:contain;background:#000"
                              src="${escapeHtml(url)}"></video>`;

    const v = document.getElementById('realVideo');
    video = v;

    v.addEventListener('loadedmetadata', () => {
      if (v.duration && Number.isFinite(v.duration)) {
        Content.video.duration = Math.round(v.duration);
        el.all.textContent = formatClock(Content.video.duration);
      }
      paint();
    });
    v.addEventListener('timeupdate', () => { current = v.currentTime; paint(); });
    v.addEventListener('play', () => { playing = true; paint(); });
    v.addEventListener('pause', () => { playing = false; paint(); });
  }

  function init() {
    el.all.textContent = formatClock(Content.video.duration);
    el.sub.textContent = `${Content.company.name} 会社説明会`;
    buildChapters();

    if (Content.video.url) {
      useRealVideo(Content.video.url);
      el.barBtn.addEventListener('click', toggle);
      el.seek.addEventListener('click', (e) => {
        const rect = el.seek.getBoundingClientRect();
        seekTo(((e.clientX - rect.left) / rect.width) * Content.video.duration);
      });
      paint();
      return;
    }

    el.stage.addEventListener('click', toggle);
    el.barBtn.addEventListener('click', toggle);
    el.seek.addEventListener('click', (e) => {
      const rect = el.seek.getBoundingClientRect();
      seekTo(((e.clientX - rect.left) / rect.width) * Content.video.duration);
    });

    paint();
  }

  return { init, seekTo };
})();

/* ============================================================
   2. ナレッジ検索（デモモードの回答エンジン）
   ------------------------------------------------------------
   日本語は分かち書きがないため、
     ・キーワードの部分一致（強い手がかり）
     ・代表質問との2-gram一致率（表記ゆれに強い）
   の2つを足し合わせて最も近い項目を選ぶ。
   どれも閾値に届かなければ「わかりません」と答え、人事へ引き継ぐ。
   ============================================================ */
const MATCH_THRESHOLD = 3;

function normalizeJa(s) {
  return String(s)
    .toLowerCase()
    .replace(/[！？。、，．,.\s　"'"'（）()「」『』【】・:：;；~〜ー-]/g, '');
}

/* 日本語の丁寧な言い回し（「〜はありますか」「〜を教えてください」など）は
   どの質問にも共通して出てくる。これを残したまま2-gram を比べると、
   中身が全く違う質問どうしが「文末が同じ」というだけで似てしまう。
   （例：「駐車場はありますか」と「賞与や昇給はありますか」）
   照合の前に、意味を持たない定型部分を落としておく。 */
const BOILERPLATE = [
  'について教えてください', 'を教えてください', 'について教えて', '教えてください', 'おしえてください',
  'はどうなっていますか', 'はどうですか', 'でしょうか', 'はありますか', 'がありますか',
  'ありますか', 'できますか', 'いますか', 'ますか', 'ですか', 'ください', 'について', 'とは',
];

function stripBoilerplate(s) {
  let out = s;
  for (const w of BOILERPLATE) out = out.split(w).join('');
  return out;
}

function bigrams(s) {
  const out = [];
  for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
  return out;
}

function scoreEntry(query, entry) {
  const nq = normalizeJa(query);
  if (!nq) return 0;

  let score = 0;

  for (const kw of entry.keywords) {
    const nk = normalizeJa(kw);
    if (nk && nq.includes(nk)) score += nk.length * 2;
  }

  // 2-gram の比較は、定型の言い回しを落とした「中身」どうしで行う
  const qCore = stripBoilerplate(nq);
  const eCore = stripBoilerplate(normalizeJa(entry.q));
  const qGrams = new Set(bigrams(qCore));
  const eGrams = bigrams(eCore);
  if (eGrams.length) {
    const hits = eGrams.filter((g) => qGrams.has(g)).length;
    score += (hits / eGrams.length) * 6;
  }

  return score;
}

function searchKnowledge(query) {
  return Content.knowledge
    .map((entry) => ({ entry, score: scoreEntry(query, entry) }))
    .sort((a, b) => b.score - a.score);
}

/* ============================================================
   3. チャット
   ============================================================ */
const Chat = (() => {
  const log = document.getElementById('log');
  const form = document.getElementById('chatForm');
  const input = document.getElementById('chatInput');
  const chips = document.getElementById('chips');
  const status = document.getElementById('chatStatus');

  let busy = false;
  const asked = new Set();
  const history = []; // ライブモードで文脈を保つための会話履歴

  /* ---------- 描画 ---------- */
  function bubble(who, html, sources = []) {
    const src = sources.length
      ? `<div class="msg__src">${sources.map((s) => `<span class="badge badge--accent">出典: ${escapeHtml(s)}</span>`).join('')}</div>`
      : '';
    const node = document.createElement('div');
    node.className = `msg msg--${who}`;
    node.innerHTML = `<div class="msg__bubble">${html}${src}</div>`;
    log.appendChild(node);
    log.scrollTop = log.scrollHeight;
    return node;
  }

  function showTyping() {
    const node = document.createElement('div');
    node.className = 'msg msg--ai';
    node.innerHTML = '<div class="msg__bubble"><span class="typing"><i></i><i></i><i></i></span></div>';
    log.appendChild(node);
    log.scrollTop = log.scrollHeight;
    return node;
  }

  /* ---------- サジェスト ---------- */
  function paintChips() {
    const pool = Content.knowledge.filter((e) => !asked.has(e.id) && e.id !== 'contact');
    chips.innerHTML = pool.slice(0, 4)
      .map((e) => `<button class="chip" type="button" data-q="${escapeHtml(e.q)}">${escapeHtml(e.q)}</button>`)
      .join('');
  }

  /* ---------- 回答（デモモード） ---------- */
  function answerFromKnowledge(query) {
    const ranked = searchKnowledge(query);
    const best = ranked[0];

    if (!best || best.score < MATCH_THRESHOLD) {
      const picks = Content.knowledge.slice(0, 3).map((e) => e.q);
      return {
        text: '申し訳ございません、その内容は私の手元の資料では確認できませんでした。\n'
            + '推測でお答えするとかえってご迷惑をおかけしますので、'
            + '採用担当（recruit@example.invalid）へお繋ぎいたします。\n\n'
            + `なお、次のようなご質問でしたらお答えできます：\n・${picks.join('\n・')}`,
        sources: [],
        id: null,
      };
    }

    asked.add(best.entry.id);
    const sources = [best.entry.category];

    // 僅差の2位があれば補足として添える
    const second = ranked[1];
    let extra = '';
    if (second && second.score >= MATCH_THRESHOLD && second.score > best.score * 0.72) {
      extra = `\n\n【あわせてご案内】${second.entry.a}`;
      sources.push(second.entry.category);
      asked.add(second.entry.id);
    }

    return { text: best.entry.a + extra, sources, id: best.entry.id };
  }

  /* ---------- 回答（ライブモード） ----------
     システムプロンプトとナレッジの組み立てはサーバー側（api/chat.js）が行う。
     ブラウザは会話履歴を渡すだけ。 */
  async function answerFromClaude(query) {
    history.push({ role: 'user', content: query });

    const { text } = await callApi('chat', { messages: history.slice(-10) });

    history.push({ role: 'assistant', content: text });

    // 出典は手元のナレッジ照合で補う（表示用）
    const ranked = searchKnowledge(query);
    const sources = ranked[0] && ranked[0].score >= MATCH_THRESHOLD ? [ranked[0].entry.category] : [];
    if (ranked[0]) asked.add(ranked[0].entry.id);

    return { text, sources };
  }

  /* ---------- 送信 ---------- */
  async function send(rawText) {
    const text = String(rawText || '').trim();
    if (!text || busy) return;

    busy = true;
    input.value = '';
    input.style.height = 'auto';
    bubble('me', escapeHtml(text));

    const typing = showTyping();

    try {
      let result;
      if (Mode.isLive()) {
        result = await answerFromClaude(text);
      } else {
        // 人が打っているように見せる程度の間を置く
        await new Promise((r) => setTimeout(r, 420 + Math.random() * 380));
        result = answerFromKnowledge(text);
      }
      typing.remove();
      bubble('ai', escapeHtml(result.text), result.sources);
    } catch (err) {
      typing.remove();
      bubble('ai',
        escapeHtml(`申し訳ございません、応答の取得に失敗しました。\n${err.message}\n\n`
          + '右上のボタンからデモモードに切り替えると、APIを使わずにお試しいただけます。'));
    } finally {
      busy = false;
      paintChips();
      input.focus();
    }
  }

  /* ---------- 初期化 ---------- */
  function paintStatus() {
    status.textContent = Mode.isLive() ? '24時間対応・ライブモード' : '24時間対応・デモモード';
  }

  function init() {
    bubble('ai', escapeHtml(
      `${Content.company.name}の採用担当AIです。ご覧いただきありがとうございます。\n`
      + '動画をご覧いただきながら、気になったことを何でもお聞きください。'
      + '勤務時間・給与・福利厚生・選考の流れなど、24時間いつでもお答えします。'
    ));
    paintChips();
    paintStatus();

    chips.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-q]');
      if (btn) send(btn.dataset.q);
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      send(input.value);
    });

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(120, input.scrollHeight)}px`;
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send(input.value);
      }
    });

    document.addEventListener('modechange', paintStatus);
  }

  return { init, send };
})();

document.addEventListener('DOMContentLoaded', async () => {
  await Content.load();   // 人事が編集した内容があれば取り込む
  Player.init();
  Chat.init();
});
