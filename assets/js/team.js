/* ============================================================
   担当者管理（管理者のみ）— 追加・権限変更・停止・操作ログ
   ============================================================ */

const ROLES = {
  viewer:   { label: '閲覧のみ', desc: '記録を読めます。合否は押せません。' },
  reviewer: { label: '選考担当', desc: '合否とメモを記録できます。候補者も登録できます。' },
  admin:    { label: '管理者',   desc: '担当者の管理とデータの削除ができます。' },
};

const Team = (() => {
  let users = [];
  const $ = (id) => document.getElementById(id);

  async function api(method, payload, query = '') {
    const res = await fetch(`${CONFIG.API_BASE}/users${query}`, {
      method,
      headers: payload ? { 'content-type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `失敗しました (${res.status})`);
    return data;
  }

  /* アクセスキーは発行時の1回しか表示できない（保存はハッシュのみ） */
  function showKey(user, key) {
    $('keyBox').hidden = false;
    $('keyFor').textContent = `${user.name}（${user.email}）`;
    $('keyValue').textContent = key;
    $('keyBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function paint() {
    $('list').innerHTML = users.map((u) => {
      const role = ROLES[u.role] || { label: u.role };
      const off = !!u.disabledAt;
      return `
        <div class="member ${off ? 'is-off' : ''}">
          <div class="member__head">
            <div>
              <div class="member__name">${escapeHtml(u.name)}</div>
              <div class="member__mail">${escapeHtml(u.email)}</div>
            </div>
            <span class="badge ${off ? 'badge--danger' : 'badge--accent'}">${off ? '停止中' : role.label}</span>
          </div>
          <div class="member__meta">
            ${u.lastLoginAt ? `<span>最終ログイン ${formatDateTime(u.lastLoginAt)}</span>` : '<span class="faint">未ログイン</span>'}
          </div>
          <div class="member__actions">
            <select class="input" style="width:auto;padding:5px 8px;font-size:12.5px" data-role="${escapeHtml(u.id)}">
              ${Object.entries(ROLES).map(([k, v]) =>
                `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
            <button class="btn btn--ghost btn--sm" data-rekey="${escapeHtml(u.id)}">キーを再発行</button>
            <span style="flex:1"></span>
            <button class="btn btn--ghost btn--sm" data-toggle="${escapeHtml(u.id)}">${off ? '再開する' : '停止する'}</button>
          </div>
        </div>`;
    }).join('');
  }

  async function reload() {
    users = (await api('GET')).users || [];
    paint();
  }

  async function onAction(e) {
    const rekey = e.target.closest('[data-rekey]');
    if (rekey) {
      const u = users.find((x) => x.id === rekey.dataset.rekey);
      if (!confirm(`${u.name} さんのアクセスキーを再発行します。\n古いキーは使えなくなります。よろしいですか？`)) return;
      try {
        const { user, accessKey } = await api('PATCH', { id: u.id, regenerateKey: true });
        await reload();
        showKey(user, accessKey);
      } catch (err) { alert(err.message); }
      return;
    }

    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const u = users.find((x) => x.id === toggle.dataset.toggle);
      const turningOff = !u.disabledAt;
      if (turningOff && !confirm(`${u.name} さんのログインを停止します。よろしいですか？`)) return;
      try {
        await api('PATCH', { id: u.id, disabled: turningOff });
        await reload();
      } catch (err) { alert(err.message); }
    }
  }

  async function onRoleChange(e) {
    const sel = e.target.closest('[data-role]');
    if (!sel) return;
    try {
      await api('PATCH', { id: sel.dataset.role, role: sel.value });
      await reload();
    } catch (err) {
      alert(err.message);
      await reload();
    }
  }

  async function create(e) {
    e.preventDefault();
    const btn = $('addBtn');
    btn.disabled = true;
    try {
      const { user, accessKey } = await api('POST', {
        name: $('uName').value.trim(),
        email: $('uEmail').value.trim(),
        role: $('uRole').value,
      });
      $('addForm').reset();
      await reload();
      showKey(user, accessKey);
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  /* 操作ログ：誰がいつ何をしたか */
  async function loadAudit() {
    try {
      const { entries } = await api('GET', null, '?audit=1');
      $('audit').innerHTML = entries.map((a) => `
        <tr>
          <td>${formatDateTime(a.at)}</td>
          <td>${escapeHtml(a.actorEmail || a.actor || '—')}</td>
          <td><code>${escapeHtml(a.action)}</code></td>
          <td class="faint">${escapeHtml(a.target || '')}</td>
        </tr>`).join('');
    } catch (err) {
      $('audit').innerHTML = `<tr><td colspan="4" class="faint">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  async function init() {
    await Mode.ready();
    if (!Sessions.remote) {
      $('needsDb').hidden = false;
      $('main').hidden = true;
      return;
    }

    await Auth.ensure();
    Auth.paintWho();

    if (!Auth.can('admin')) {
      $('needsAdmin').hidden = false;
      $('main').hidden = true;
      return;
    }

    await reload();
    await loadAudit();

    $('addForm').addEventListener('submit', create);
    $('list').addEventListener('click', onAction);
    $('list').addEventListener('change', onRoleChange);
    $('keyCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('keyValue').textContent); } catch (_) { /* 無視 */ }
      $('keyCopy').textContent = 'コピーしました';
      setTimeout(() => { $('keyCopy').textContent = 'キーをコピー'; }, 1500);
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', Team.init);
