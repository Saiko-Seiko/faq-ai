/* ============================================================
   候補者管理（人事用）— 登録とURLの発行
   ------------------------------------------------------------
   この画面はサーバー（データベース）がある場合のみ意味を持つ。
   デモ運用のときは、その旨を表示して操作させない。
   ============================================================ */

const STATUS = {
  pending:     { label: '未受験',   tone: 'accent' },
  in_progress: { label: '受験中',   tone: 'warn' },
  done:        { label: '受験済み', tone: 'ok' },
  expired:     { label: '期限切れ', tone: 'danger' },
  revoked:     { label: '無効',     tone: 'danger' },
};

const Candidates = (() => {
  let rows = [];
  const $ = (id) => document.getElementById(id);

  function interviewUrl(token) {
    return `${location.origin}/interview?token=${encodeURIComponent(token)}`;
  }

  /* 案内メールの文面。人事がそのまま使えるように、URLと期限を差し込む。 */
  function inviteText(c) {
    const until = c.expiresAt ? formatDateTime(c.expiresAt) : '';
    return [
      `${c.name} 様`,
      '',
      'この度はご応募いただき、誠にありがとうございます。',
      '一次選考として、オンラインでの面接をお願いしております。',
      '',
      '下記のURLを開いていただくと、そのまま受験いただけます。',
      'アプリのインストールや会員登録は不要です。',
      '',
      interviewUrl(c.token),
      '',
      until ? `【受付期限】${until}` : '',
      '【所要時間】およそ15〜20分',
      '【ご準備】通信環境が安定した、静かな場所からご参加ください。カメラは使用しません。',
      '',
      'なお、本面接の結果のみで合否が決まることはございません。',
      'ご回答の内容は、採用担当者が確認したうえで判断いたします。',
      '',
      'ご不明な点がございましたら、本メールへご返信ください。',
      'どうぞよろしくお願いいたします。',
    ].filter((line) => line !== '').join('\n');
  }

  async function copy(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      // クリップボードが使えない環境向けの手段
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (__) { /* 諦める */ }
      ta.remove();
    }
    if (btn) {
      const original = btn.textContent;
      btn.textContent = 'コピーしました';
      setTimeout(() => { btn.textContent = original; }, 1500);
    }
  }

  /* ---------- 描画 ---------- */
  function paint() {
    $('count').textContent = `${rows.length}名`;

    if (!rows.length) {
      $('list').innerHTML = '<p class="hint" style="padding:16px">まだ候補者が登録されていません。</p>';
      return;
    }

    $('list').innerHTML = rows.map((c) => {
      const st = STATUS[c.status] || STATUS.pending;
      const url = interviewUrl(c.token);
      const canRevoke = c.status !== 'done';

      return `
        <div class="cand">
          <div class="cand__head">
            <div>
              <div class="cand__name">${escapeHtml(c.name)}</div>
              <div class="cand__role">${escapeHtml(c.role)}</div>
            </div>
            <span class="badge badge--${st.tone}">${st.label}</span>
          </div>

          <div class="cand__meta">
            ${c.email ? `<span>${escapeHtml(c.email)}</span>` : ''}
            ${c.expiresAt ? `<span>期限 ${formatDateTime(c.expiresAt)}</span>` : ''}
            ${c.invitedAt ? `<span>案内送信済み</span>` : '<span class="faint">案内未送信</span>'}
            ${c.usedAt ? `<span>受験 ${formatDateTime(c.usedAt)}</span>` : ''}
          </div>

          ${c.note ? `<p class="cand__note">${escapeHtml(c.note)}</p>` : ''}

          <div class="cand__url">
            <code>${escapeHtml(url)}</code>
          </div>

          <div class="cand__actions">
            <button class="btn btn--sm" data-copy-url="${escapeHtml(c.token)}">URLをコピー</button>
            <button class="btn btn--ghost btn--sm" data-copy-mail="${escapeHtml(c.token)}">案内文をコピー</button>
            ${c.email ? `<a class="btn btn--ghost btn--sm" data-mailto="${escapeHtml(c.token)}" href="#">メールを作成</a>` : ''}
            <span style="flex:1"></span>
            <button class="btn btn--ghost btn--sm" data-extend="${escapeHtml(c.token)}">期限を延長</button>
            ${canRevoke
              ? `<button class="btn btn--ghost btn--sm" data-revoke="${escapeHtml(c.token)}">${c.status === 'revoked' ? '無効を解除' : '無効にする'}</button>`
              : ''}
          </div>
        </div>`;
    }).join('');
  }

  /* ---------- 読み込み ---------- */
  async function load() {
    const res = await fetch(`${CONFIG.API_BASE}/candidates`, {
      cache: 'no-store',
    });
    if (res.status === 401) throw Object.assign(new Error('鍵が正しくありません。'), { code: 401 });
    if (!res.ok) throw new Error(`取得に失敗しました (${res.status})`);
    rows = (await res.json()).candidates || [];
  }

  async function send(method, payload) {
    const res = await fetch(`${CONFIG.API_BASE}/candidates`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `失敗しました (${res.status})`);
    }
    return res.json();
  }

  /* ---------- 操作 ---------- */
  async function create(e) {
    e.preventDefault();
    const btn = $('createBtn');
    btn.disabled = true;

    try {
      const { candidate } = await send('POST', {
        name: $('fName').value.trim(),
        role: $('fRole').value.trim(),
        email: $('fEmail').value.trim(),
        note: $('fNote').value.trim(),
        expiresInDays: Number($('fDays').value) || 14,
      });
      $('createForm').reset();
      $('fDays').value = 14;
      await load();
      paint();
      // 発行直後はURLをすぐ渡したいので、その場でコピーしておく
      await copy(interviewUrl(candidate.token), null);
      $('createdNote').textContent = `${candidate.name} さんのURLを発行し、クリップボードにコピーしました。`;
      $('createdNote').hidden = false;
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function onAction(e) {
    const find = (attr) => e.target.closest(`[${attr}]`);
    const byToken = (t) => rows.find((c) => c.token === t);

    const copyUrl = find('data-copy-url');
    if (copyUrl) { copy(interviewUrl(copyUrl.dataset.copyUrl), copyUrl); return; }

    const copyMail = find('data-copy-mail');
    if (copyMail) {
      const c = byToken(copyMail.dataset.copyMail);
      if (c) copy(inviteText(c), copyMail);
      return;
    }

    const mail = find('data-mailto');
    if (mail) {
      e.preventDefault();
      const c = byToken(mail.dataset.mailto);
      if (!c) return;
      const subject = encodeURIComponent('【一次選考】オンライン面接のご案内');
      const bodyText = encodeURIComponent(inviteText(c));
      window.location.href = `mailto:${encodeURIComponent(c.email)}?subject=${subject}&body=${bodyText}`;
      // メーラーを開いたら「案内送信済み」にしておく
      try { await send('PATCH', { token: c.token, invited: true }); await load(); paint(); } catch (_) { /* 表示だけの話 */ }
      return;
    }

    const extend = find('data-extend');
    if (extend) {
      const days = prompt('今日から何日後まで受け付けますか？', '14');
      if (!days) return;
      try {
        await send('PATCH', { token: extend.dataset.extend, extendDays: Number(days) });
        await load(); paint();
      } catch (err) { alert(err.message); }
      return;
    }

    const revoke = find('data-revoke');
    if (revoke) {
      const c = byToken(revoke.dataset.revoke);
      if (!c) return;
      const turningOff = c.status !== 'revoked';
      if (turningOff && !confirm(`${c.name} さんのURLを無効にします。以降このURLは開けなくなります。よろしいですか？`)) return;
      try {
        await send('PATCH', { token: c.token, revoke: turningOff });
        await load(); paint();
      } catch (err) { alert(err.message); }
    }
  }

  /* ---------- 初期化 ---------- */
  async function init() {
    await Mode.ready();

    if (!Sessions.remote) {
      $('needsDb').hidden = false;
      $('main').hidden = true;
      return;
    }

    await Auth.ensure();
    Auth.paintWho();

    try {
      await load();
    } catch (err) {
      $('list').innerHTML = `<p class="hint" style="padding:16px">読み込めませんでした。<br>${escapeHtml(err.message)}</p>`;
    }

    paint();

    // 閲覧のみの担当者は、候補者の登録・招待ができない
    if (!Auth.can('reviewer')) {
      $('createForm').hidden = true;
      $('createLocked').hidden = false;
    } else {
      $('createForm').addEventListener('submit', create);
    }
    $('list').addEventListener('click', onAction);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', Candidates.init);
