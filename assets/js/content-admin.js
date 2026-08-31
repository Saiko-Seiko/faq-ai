/* ============================================================
   コンテンツ編集（管理者のみ）
   ------------------------------------------------------------
   ここを人事の方が使えるようにするのが Stage 5 の目的。
   制度が変わるたびに開発者へ依頼、という状態をなくす。
   ============================================================ */

const Editor = (() => {
  let data = { knowledge: [], questions: [], company: {}, video: {}, axes: [] };
  const $ = (id) => document.getElementById(id);

  async function api(method, payload) {
    const res = await fetch(`${CONFIG.API_BASE}/content?edit=1`, {
      method,
      headers: payload ? { 'content-type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      cache: 'no-store',
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `失敗しました (${res.status})`);
    return out;
  }

  function markDirty() {
    $('saveBar').hidden = false;
  }

  /* ---------- ナレッジ ---------- */
  function paintKnowledge() {
    $('kList').innerHTML = data.knowledge.map((k, i) => `
      <div class="edit-item" data-k="${i}">
        <div class="edit-item__head">
          <input class="input" data-kf="category" value="${escapeHtml(k.category || '')}"
                 placeholder="分類（出典として表示されます）" style="max-width:200px">
          <span style="flex:1"></span>
          <label class="hint" style="display:flex;align-items:center;gap:5px">
            <input type="checkbox" data-kf="published" ${k.published !== false ? 'checked' : ''}> 公開
          </label>
          <button class="btn btn--ghost btn--sm" data-kdel="${i}" type="button">削除</button>
        </div>
        <input class="input" data-kf="q" value="${escapeHtml(k.q || '')}"
               placeholder="代表的な質問（例：福利厚生を教えてください）" style="margin-top:8px">
        <input class="input" data-kf="keywords" value="${escapeHtml((k.keywords || []).join('、'))}"
               placeholder="検索語を「、」区切りで（表記ゆれを入れておくと当たりやすくなります）" style="margin-top:8px">
        <textarea class="textarea" data-kf="a" placeholder="回答"
                  style="margin-top:8px;min-height:100px">${escapeHtml(k.a || '')}</textarea>
      </div>`).join('');
  }

  function readKnowledge() {
    data.knowledge = Array.from($('kList').querySelectorAll('[data-k]')).map((row, i) => {
      const get = (f) => row.querySelector(`[data-kf="${f}"]`);
      return {
        id: data.knowledge[i] ? data.knowledge[i].id : `k${Date.now()}${i}`,
        category: get('category').value.trim(),
        q: get('q').value.trim(),
        keywords: get('keywords').value.split(/[、,]/).map((s) => s.trim()).filter(Boolean),
        a: get('a').value.trim(),
        published: get('published').checked,
        sortOrder: (i + 1) * 10,
      };
    });
  }

  /* ---------- 面接の質問 ---------- */
  function paintQuestions() {
    const axisOptions = (sel) => data.axes
      .map((a) => `<option value="${a.key}" ${sel === a.key ? 'selected' : ''}>${escapeHtml(a.label)}</option>`)
      .join('');

    $('qList').innerHTML = data.questions.map((q, i) => `
      <div class="edit-item" data-q="${i}">
        <div class="edit-item__head">
          <strong style="font-size:13px">質問 ${i + 1}</strong>
          <span style="flex:1"></span>
          <select class="input" data-qf="axis" style="width:auto;padding:5px 8px;font-size:12.5px">
            ${axisOptions(q.axis)}
          </select>
          <label class="hint" style="display:flex;align-items:center;gap:5px">
            <input type="checkbox" data-qf="enabled" ${q.enabled !== false ? 'checked' : ''}> 使用
          </label>
          <button class="btn btn--ghost btn--sm" data-qdel="${i}" type="button">削除</button>
        </div>
        <textarea class="textarea" data-qf="text" placeholder="設問"
                  style="margin-top:8px;min-height:70px">${escapeHtml(q.text || '')}</textarea>
        <input class="input" data-qf="hint" value="${escapeHtml(q.hint || '')}"
               placeholder="補足（応募者に表示される案内文・任意）" style="margin-top:8px">
      </div>`).join('');
  }

  function readQuestions() {
    data.questions = Array.from($('qList').querySelectorAll('[data-q]')).map((row, i) => {
      const get = (f) => row.querySelector(`[data-qf="${f}"]`);
      return {
        id: data.questions[i] ? data.questions[i].id : `q${Date.now()}${i}`,
        axis: get('axis').value,
        text: get('text').value.trim(),
        hint: get('hint').value.trim(),
        enabled: get('enabled').checked,
        sortOrder: (i + 1) * 10,
      };
    });
  }

  /* ---------- 会社情報・動画・評価軸 ---------- */
  function paintSettings() {
    $('cName').value = data.company.name || '';
    $('cTagline').value = data.company.tagline || '';
    $('vUrl').value = data.video.url || '';
    $('vDuration').value = data.video.duration || 600;

    $('vChapters').value = (data.video.chapters || [])
      .map((c) => `${Math.floor(c.at / 60)}:${String(c.at % 60).padStart(2, '0')}\t${c.title}\t${c.ask || ''}`)
      .join('\n');

    $('axList').innerHTML = data.axes.map((a, i) => `
      <div class="edit-item" data-ax="${i}">
        <div class="edit-item__head">
          <code style="font-size:11.5px;color:var(--text-faint)">${escapeHtml(a.key)}</code>
          <span style="flex:1"></span>
          <span class="hint">キーは変更できません（記録と結びつくため）</span>
        </div>
        <input class="input" data-axf="label" value="${escapeHtml(a.label)}" placeholder="表示名" style="margin-top:8px">
        <input class="input" data-axf="desc" value="${escapeHtml(a.desc)}" placeholder="評価の観点（AIへの指示になります）" style="margin-top:8px">
      </div>`).join('');
  }

  function readSettings() {
    data.company = { name: $('cName').value.trim(), tagline: $('cTagline').value.trim() };

    // 「1:15  タイトル  質問」の形で1行ずつ
    const chapters = $('vChapters').value.split('\n').map((line) => {
      const [time, title, ask] = line.split('\t');
      if (!time || !title) return null;
      const [m, s] = time.trim().split(':').map(Number);
      return { at: (m || 0) * 60 + (s || 0), title: title.trim(), ask: (ask || '').trim() };
    }).filter(Boolean);

    data.video = {
      url: $('vUrl').value.trim(),
      duration: Number($('vDuration').value) || 600,
      chapters: chapters.length ? chapters : data.video.chapters,
    };

    data.axes = Array.from($('axList').querySelectorAll('[data-ax]')).map((row, i) => ({
      key: data.axes[i].key, // キーは固定
      label: row.querySelector('[data-axf="label"]').value.trim(),
      desc: row.querySelector('[data-axf="desc"]').value.trim(),
    }));
  }

  /* ---------- 保存 ---------- */
  async function save() {
    readKnowledge();
    readQuestions();
    readSettings();

    const empty = data.knowledge.find((k) => !k.q || !k.a);
    if (empty) { alert('質問と回答が空のナレッジがあります。入力するか削除してください。'); return; }

    $('saveBtn').disabled = true;
    try {
      const out = await api('PUT', data);
      data = { knowledge: out.knowledge, questions: out.questions, company: out.company, video: out.video, axes: out.axes };
      paintAll();
      $('saveBar').hidden = true;
      $('savedNote').hidden = false;
      setTimeout(() => { $('savedNote').hidden = true; }, 2500);
    } catch (err) {
      alert(err.message);
    } finally {
      $('saveBtn').disabled = false;
    }
  }

  function paintAll() {
    paintKnowledge();
    paintQuestions();
    paintSettings();
  }

  /* ---------- 初期化 ---------- */
  async function init() {
    await Mode.ready();
    if (!Sessions.remote) { $('needsDb').hidden = false; $('main').hidden = true; return; }

    await Auth.ensure();
    Auth.paintWho();
    if (!Auth.can('admin')) { $('needsAdmin').hidden = false; $('main').hidden = true; return; }

    try {
      const out = await api('GET');
      data = { knowledge: out.knowledge, questions: out.questions, company: out.company, video: out.video, axes: out.axes };
      if (out.source !== 'db') $('notSeeded').hidden = false;
    } catch (err) {
      alert(err.message);
      return;
    }
    /* 振り返り画面の「ナレッジに追加」から来た場合、
       その質問を入れた空の項目を用意しておく。回答を書くだけで済むように。 */
    const pending = sessionStorage.getItem('faqai.newKnowledgeQuestion');
    if (pending) {
      sessionStorage.removeItem('faqai.newKnowledgeQuestion');
      data.knowledge.unshift({
        id: `k${Date.now()}`, category: 'その他', q: pending, keywords: [], a: '', published: true,
      });
      $('fromInsight').hidden = false;
      $('fromInsight').textContent = `「${pending}」を先頭に追加しました。回答を書いて保存してください。`;
      markDirty();
    }

    paintAll();

    // どこか触ったら保存バーを出す
    $('main').addEventListener('input', markDirty);
    $('main').addEventListener('change', markDirty);

    $('saveBtn').addEventListener('click', save);

    $('kAdd').addEventListener('click', () => {
      readKnowledge();
      data.knowledge.push({ id: `k${Date.now()}`, category: 'その他', q: '', keywords: [], a: '', published: true });
      paintKnowledge(); markDirty();
    });

    $('qAdd').addEventListener('click', () => {
      readQuestions();
      data.questions.push({ id: `q${Date.now()}`, axis: data.axes[0].key, text: '', hint: '', enabled: true });
      paintQuestions(); markDirty();
    });

    $('kList').addEventListener('click', (e) => {
      const del = e.target.closest('[data-kdel]');
      if (!del) return;
      readKnowledge();
      data.knowledge.splice(Number(del.dataset.kdel), 1);
      paintKnowledge(); markDirty();
    });

    $('qList').addEventListener('click', (e) => {
      const del = e.target.closest('[data-qdel]');
      if (!del) return;
      readQuestions();
      data.questions.splice(Number(del.dataset.qdel), 1);
      paintQuestions(); markDirty();
    });

    $('seedBtn').addEventListener('click', async () => {
      if (!confirm('現在の編集内容を破棄し、初期値（サンプルの会社情報）を読み込みます。よろしいですか？')) return;
      try {
        const out = await api('POST', { action: 'seed' });
        data = { knowledge: out.knowledge, questions: out.questions, company: out.company, video: out.video, axes: out.axes };
        paintAll();
        $('notSeeded').hidden = true;
      } catch (err) { alert(err.message); }
    });

    // タブ切り替え
    document.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('is-on', b === btn));
        document.querySelectorAll('[data-panel]').forEach((p) => {
          p.hidden = p.dataset.panel !== btn.dataset.tab;
        });
      });
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', Editor.init);
