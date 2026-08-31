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

  /* ---------- 読み込み ----------
     見本データは常に残す。
     「記録が空のときだけ入れる」方式にしていたところ、
     デモ中に1件でも面接を受けると見本が消え、
     商談で見せたい候補者（鈴木さん）がいなくなってしまった。
     実際に受けた面接は、見本データに追加される形にする。 */
  async function load() {
    if (Sessions.remote) {
      // 本番：サーバーの記録だけを見る。見本データは混ぜない。
      records = await Sessions.fetchAll();
      records.sort((a, b) => b.total - a.total);
      return;
    }

    // デモ：端末内の記録に見本を重ねる
    const byId = new Map(SEED_SESSIONS.map((s) => [s.id, s]));
    for (const r of Sessions.all()) byId.set(r.id, r);

    records = Array.from(byId.values());
    persist();
    records.sort((a, b) => b.total - a.total);
  }

  function persist() {
    if (Sessions.remote) return; // 本番の保存はサーバー側
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
  async function decide(value) {
    const rec = current();
    if (!rec) return;

    // 同じボタンをもう一度押したら未判定に戻す（誤操作を取り消せるように）
    const next = rec.humanDecision === value ? null : value;
    const before = rec.humanDecision;

    rec.humanDecision = next;
    persist();
    paintList();
    paintDecision(rec);

    if (!Sessions.remote) return;
    try {
      // サーバーが正とする値で上書きする（誰がいつ判断したかも記録される）
      const saved = await Sessions.decide(rec.id, next, rec.humanMemo || '');
      if (saved) Object.assign(rec, saved);
    } catch (err) {
      rec.humanDecision = before; // 保存できなかったので画面も戻す
      paintList();
      paintDecision(rec);
      alert(`判断を保存できませんでした。\n${err.message}`);
    }
  }

  /* ---------- 削除（Stage 4） ----------
     応募者からの削除請求に応じるための操作。
     論理削除ではなく完全に消す。取り消せないので確認を二重にする。 */
  async function purge() {
    const rec = current();
    if (!rec) return;
    if (!Sessions.remote) {
      alert('デモ表示のため、この操作は行えません。');
      return;
    }

    const label = `${rec.candidate.name}（${rec.candidate.role}）`;
    if (!confirm(`${label} の面接記録を完全に削除します。\n\n回答内容・スコア・所見がすべて消え、元に戻せません。\n続けますか？`)) return;
    if (!confirm('取り消せません。本当に削除しますか？')) return;

    try {
      const res = await fetch(`${CONFIG.API_BASE}/privacy?id=${encodeURIComponent(rec.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `削除できませんでした (${res.status})`);
      }
      selectedId = null;
      await load();
      paintList();
      paintDetail();
      alert('削除しました。');
    } catch (err) {
      alert(err.message);
    }
  }

  async function saveMemo() {
    const rec = current();
    if (!rec) return;
    rec.humanMemo = $('memo').value;
    persist();

    const btn = $('memoSave');
    if (Sessions.remote) {
      try {
        await Sessions.decide(rec.id, rec.humanDecision || null, rec.humanMemo);
      } catch (err) {
        alert(`メモを保存できませんでした。\n${err.message}`);
        return;
      }
    }
    btn.textContent = '保存しました';
    setTimeout(() => { btn.textContent = 'メモを保存'; }, 1600);
  }

  async function resetSeed() {
    if (Sessions.remote) {
      alert('本番のデータベースに接続されているため、この操作は行えません。');
      return;
    }
    if (!confirm('この端末に保存された面接記録（実際に受けたものを含む）をすべて削除し、見本データだけの状態に戻します。よろしいですか？')) return;
    Store.set(CONFIG.KEY_SESSIONS, SEED_SESSIONS.slice());
    selectedId = null;
    await load();
    paintList();
    paintDetail();
  }

  /* ---------- 表示の切り替え ---------- */
  function paintSource() {
    const el = $('sourceNote');
    if (!el) return;
    if (Sessions.remote) {
      el.innerHTML = '<span class="badge badge--ok">サーバー保存</span> '
        + '記録はデータベースに保存され、他の担当者の画面にも反映されます。';
      $('resetBtn').hidden = true;
      // 候補者管理はデータベースがある場合のみ意味を持つ
      const link = $('candLink');
      if (link) link.hidden = false;
    } else {
      el.innerHTML = '<span class="badge">この端末のみ</span> '
        + 'デモ表示です。記録はご覧の端末内にのみ保存され、他の方には共有されません。';
    }
  }

  /* 権限に応じて操作を出し分ける（閲覧のみの担当者には押させない） */
  function paintPermissions() {
    const canDecide = Auth.can('reviewer');
    document.querySelectorAll('[data-decision]').forEach((b) => { b.disabled = !canDecide; });
    $('memo').disabled = !canDecide;
    $('memoSave').disabled = !canDecide;
    $('purgeBtn').hidden = !(Sessions.remote && Auth.can('admin'));

    if (Auth.required && !canDecide) {
      $('decisionState').insertAdjacentHTML('afterend',
        '<p class="hint" style="margin:6px 0 0">閲覧のみの権限のため、合否の記録はできません。</p>');
    }
  }

  /* ---------- 初期化 ---------- */
  async function init() {
    await Mode.ready();      // 保存先がサーバーかどうか
    await Auth.ensure();     // サーバー保存ならログインを求める
    Auth.paintWho();

    try {
      await load();
    } catch (err) {
      $('list').innerHTML = `<p class="hint" style="padding:14px">読み込めませんでした。<br>${escapeHtml(err.message)}</p>`;
    }

    selectedId = records.length ? records[0].id : null;
    paintSource();
    paintList();
    paintDetail();
    paintPermissions();

    $('list').addEventListener('click', (e) => {
      const row = e.target.closest('[data-id]');
      if (row) select(row.dataset.id);
    });

    document.querySelectorAll('[data-decision]').forEach((btn) => {
      btn.addEventListener('click', () => decide(btn.dataset.decision));
    });

    $('memoSave').addEventListener('click', saveMemo);
    $('resetBtn').addEventListener('click', resetSeed);
    $('purgeBtn').addEventListener('click', purge);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', Dashboard.init);
