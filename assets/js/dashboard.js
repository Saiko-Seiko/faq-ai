/* ============================================================
   人事ダッシュボード
   ------------------------------------------------------------
   この画面の役割は「AIの評価を確定させること」ではなく、
   人事担当者が回答を読み、自分の判断で結論を出せるようにすること。
   AIが書き込むのは scores / comment まで。
   humanDecision に書き込めるのは、この画面の人間だけ。
   ============================================================ */

const DECISIONS = {
  pass:   { label: '合格',   tone: 'ok',     icon: '✓' },
  hold:   { label: '保留',   tone: 'warn',   icon: '—' },
  reject: { label: '不合格', tone: 'danger', icon: '×' },
};

const Dashboard = (() => {
  let records = [];
  let selectedId = null;

  const $ = (id) => document.getElementById(id);

  /* ---------- 読み込み ---------- */
  function load() {
    const saved = Sessions.all();
    // 記録が空のときだけ、見本データを流し込む（商談で空の画面を見せないため）
    records = saved.length ? saved : SEED_SESSIONS.slice();
    if (!saved.length) Store.set(CONFIG.KEY_SESSIONS, records);

    records.sort((a, b) => b.total - a.total);
  }

  function persist() {
    Store.set(CONFIG.KEY_SESSIONS, records);
  }

  function current() {
    return records.find((r) => r.id === selectedId) || null;
  }

  /* ---------- 一覧 ---------- */
  function paintList() {
    $('count').textContent = `${records.length}名`;

    if (!records.length) {
      $('list').innerHTML = '<p class="hint" style="padding:14px">記録がありません。</p>';
      return;
    }

    $('list').innerHTML = records.map((r) => {
      const band = scoreBand(r.total);
      const dec = r.humanDecision ? DECISIONS[r.humanDecision] : null;
      const statusBadge = dec
        ? `<span class="badge badge--${dec.tone}">${dec.icon} ${dec.label}</span>`
        : '<span class="badge">未判定</span>';

      return `
        <button class="row ${r.id === selectedId ? 'is-active' : ''}" type="button" data-id="${escapeHtml(r.id)}">
          <span class="row__score" title="AIによる参考スコア（20点満点）">
            <b>${r.total}</b><i>/20</i>
          </span>
          <span class="row__body">
            <span class="row__name">${escapeHtml(r.candidate.name)}</span>
            <span class="row__role">${escapeHtml(r.candidate.role)}</span>
            <span class="row__meta">
              ${statusBadge}
              <span class="badge badge--${band.tone}">${escapeHtml(band.label)}</span>
            </span>
          </span>
        </button>`;
    }).join('');
  }

  /* ---------- スコアの内訳 ----------
     4軸は「大きさの比較」なので単一色。軸の名前は棒の横に直接書くので、
     色で軸を区別する必要はない。色は点数の低さ（注意して見るべきか）だけを表す。
     ---------------------------------- */
  function severityOf(score) {
    if (score <= 2) return 'danger';
    if (score === 3) return 'warn';
    return 'accent';
  }

  function paintMeters(rec) {
    $('meters').innerHTML = AXES.map((axis) => {
      const v = rec.scores[axis.key] ?? 0;
      return `
        <div class="meter" title="${escapeHtml(axis.desc)}">
          <div class="meter__head">
            <span class="meter__label">${escapeHtml(axis.label)}</span>
            <span class="meter__value">${v}<i>/5</i></span>
          </div>
          <div class="meter__track">
            <span class="meter__fill meter__fill--${severityOf(v)}" style="width:${(v / 5) * 100}%"></span>
          </div>
          <p class="meter__desc">${escapeHtml(axis.desc)}</p>
        </div>`;
    }).join('');
  }

  /* ---------- 問答ログ ---------- */
  function paintTranscript(rec) {
    $('transcript').innerHTML = rec.answers.map((a, i) => `
      <li class="qa">
        <div class="qa__q"><span class="qa__n">Q${i + 1}</span>${escapeHtml(a.question)}</div>
        <div class="qa__a">${escapeHtml(a.text || '（無回答）')}</div>
        <div class="qa__t">回答時間 ${formatClock(a.seconds || 0)}</div>
      </li>`).join('');
  }

  /* ---------- 判断エリア ---------- */
  function paintDecision(rec) {
    const dec = rec.humanDecision ? DECISIONS[rec.humanDecision] : null;

    $('decisionState').innerHTML = dec
      ? `<span class="badge badge--${dec.tone}">${dec.icon} ${dec.label}（人事判断済み）</span>`
      : '<span class="badge">未判定 — 人事担当者の判断をお願いします</span>';

    document.querySelectorAll('[data-decision]').forEach((btn) => {
      btn.classList.toggle('is-on', btn.dataset.decision === rec.humanDecision);
    });

    $('memo').value = rec.humanMemo || '';
  }

  /* ---------- 詳細 ---------- */
  function paintDetail() {
    const rec = current();
    if (!rec) { $('empty').hidden = false; $('detail').hidden = true; return; }

    $('empty').hidden = true;
    $('detail').hidden = false;

    const band = scoreBand(rec.total);

    $('dName').textContent = rec.candidate.name;
    $('dRole').textContent = rec.candidate.role;
    $('dTotal').textContent = rec.total;
    $('dBand').textContent = band.label;
    $('dBand').className = `badge badge--${band.tone}`;
    $('dWhen').textContent = formatDateTime(rec.finishedAt);
    $('dDuration').textContent = `${Math.max(1, Math.round(rec.durationSec / 60))}分`;
    $('dMode').textContent = rec.mode === 'live' ? 'AI評価（ライブ）' : 'AI評価（デモ）';
    $('dComment').textContent = rec.comment;

    paintMeters(rec);
    paintTranscript(rec);
    paintDecision(rec);
  }

  function select(id) {
    selectedId = id;
    paintList();
    paintDetail();
    if (window.matchMedia('(max-width: 900px)').matches) {
      $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /* ---------- 操作 ---------- */
  function decide(value) {
    const rec = current();
    if (!rec) return;
    // 同じボタンをもう一度押したら未判定に戻す（誤操作を取り消せるように）
    rec.humanDecision = rec.humanDecision === value ? null : value;
    persist();
    paintList();
    paintDecision(rec);
  }

  function saveMemo() {
    const rec = current();
    if (!rec) return;
    rec.humanMemo = $('memo').value;
    persist();
    const btn = $('memoSave');
    btn.textContent = '保存しました';
    setTimeout(() => { btn.textContent = 'メモを保存'; }, 1600);
  }

  function resetSeed() {
    if (!confirm('保存されている面接記録をすべて削除し、見本データに戻します。よろしいですか？')) return;
    Store.set(CONFIG.KEY_SESSIONS, SEED_SESSIONS.slice());
    selectedId = null;
    load();
    paintList();
    paintDetail();
  }

  /* ---------- 初期化 ---------- */
  function init() {
    load();
    selectedId = records.length ? records[0].id : null;
    paintList();
    paintDetail();

    $('list').addEventListener('click', (e) => {
      const row = e.target.closest('[data-id]');
      if (row) select(row.dataset.id);
    });

    document.querySelectorAll('[data-decision]').forEach((btn) => {
      btn.addEventListener('click', () => decide(btn.dataset.decision));
    });

    $('memoSave').addEventListener('click', saveMemo);
    $('resetBtn').addEventListener('click', resetSeed);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', Dashboard.init);
