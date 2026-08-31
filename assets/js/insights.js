/* ============================================================
   運用の振り返り（Stage 6）
   ------------------------------------------------------------
   数字を出すだけでは意味がない。
   「だから次に何をすればよいか」まで書く。
   ============================================================ */

const Insights = (() => {
  let data = { misses: [], agreement: null };
  const $ = (id) => document.getElementById(id);

  async function api(method, payload) {
    const res = await fetch(`${CONFIG.API_BASE}/insights`, {
      method,
      headers: payload ? { 'content-type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      cache: 'no-store',
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `失敗しました (${res.status})`);
    return out;
  }

  const fmt = (n) => (n === null || n === undefined ? '—' : (Math.round(n * 10) / 10).toFixed(1));

  /* ---------- AIと人の判断のズレ ---------- */
  function paintAgreement() {
    const a = data.agreement;
    if (!a) return;

    $('decidedCount').textContent = `${a.decided}件`;

    // 件数が少ないうちに数字を根拠にしないこと
    if (!a.enough) {
      $('notEnough').hidden = false;
      $('notEnough').textContent =
        `判断済みの記録が${a.decided}件です。傾向を読むには10件以上を目安にしてください。`
        + '（それまでの数字は参考程度に）';
    }

    $('avgPass').textContent = fmt(a.averages.pass);
    $('avgHold').textContent = fmt(a.averages.hold);
    $('avgReject').textContent = fmt(a.averages.reject);
    $('cntPass').textContent = `${a.counts.pass}件`;
    $('cntHold').textContent = `${a.counts.hold}件`;
    $('cntReject').textContent = `${a.counts.reject}件`;

    /* この2つがこのシステムの効き目そのもの */
    $('rescued').textContent = `${a.rescued}名`;
    $('overrated').textContent = `${a.overrated}名`;

    $('rescuedNote').textContent = a.rescued > 0
      ? `AIのスコアだけで足切りしていた場合、この${a.rescued}名は選考から外れていました。`
      : 'いまのところ該当はありません。';

    $('overratedNote').textContent = a.overrated > 0
      ? `AIが高く評価したものの、人事のご判断では不合格となった方が${a.overrated}名います。`
        + '評価の観点が実態と合っているか確認する材料になります。'
      : 'いまのところ該当はありません。';

    /* 軸ごとの判別力 */
    $('axisTable').innerHTML = a.axisStats.map((s) => {
      const gap = s.gap;
      let verdict = '<span class="badge">判定できません</span>';
      let advice = '合格・不合格の両方の記録が必要です。';

      if (gap !== null) {
        if (gap >= 1.0) {
          verdict = '<span class="badge badge--ok">効いています</span>';
          advice = '合格された方と、そうでない方の差がはっきり出ています。';
        } else if (gap >= 0.4) {
          verdict = '<span class="badge badge--warn">やや弱い</span>';
          advice = '差が小さめです。観点の書き方をもう少し具体的にすると改善する可能性があります。';
        } else {
          verdict = '<span class="badge badge--danger">効いていません</span>';
          advice = '合格・不合格で点数がほとんど変わっていません。'
                 + 'この観点は判断に寄与していないため、書き直すか、別の観点に置き換えることをご検討ください。';
        }
      }

      return `
        <tr>
          <td><strong>${escapeHtml(s.label)}</strong></td>
          <td class="num">${fmt(s.passAvg)}</td>
          <td class="num">${fmt(s.rejectAvg)}</td>
          <td class="num">${gap === null ? '—' : (gap > 0 ? '+' : '') + fmt(gap)}</td>
          <td>${verdict}</td>
        </tr>
        <tr class="advice"><td colspan="5">${escapeHtml(advice)}</td></tr>`;
    }).join('');
  }

  /* ---------- 答えられなかった質問 ---------- */
  function paintMisses() {
    $('missCount').textContent = `${data.misses.length}件`;

    if (!data.misses.length) {
      $('missList').innerHTML =
        '<p class="hint" style="padding:16px">'
        + '答えられなかった質問はまだありません。'
        + '（会社説明会のチャットで、ナレッジに無いことを聞かれると、ここに溜まります）</p>';
      return;
    }

    $('missList').innerHTML = data.misses.map((g) => `
      <div class="miss">
        <div class="miss__head">
          <span class="badge badge--warn">${g.count}回</span>
          <span class="miss__when">最終 ${formatDateTime(g.lastAt)}</span>
          <span style="flex:1"></span>
          <button class="btn btn--sm" data-add='${escapeHtml(JSON.stringify(g.ids))}'
                  data-q="${escapeHtml(g.samples[0])}">ナレッジに追加</button>
          <button class="btn btn--ghost btn--sm" data-ignore='${escapeHtml(JSON.stringify(g.ids))}'>対象外</button>
        </div>
        <ul class="miss__samples">
          ${g.samples.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
        </ul>
      </div>`).join('');
  }

  async function reload() {
    data = await api('GET');
    paintAgreement();
    paintMisses();
  }

  async function onAction(e) {
    const add = e.target.closest('[data-add]');
    if (add) {
      // 質問文を持ってコンテンツ編集へ。人事はそのまま回答を書けばよい。
      const q = add.dataset.q || '';
      try {
        await api('PATCH', { ids: JSON.parse(add.dataset.add), status: 'added' });
      } catch (err) { alert(err.message); return; }
      sessionStorage.setItem('faqai.newKnowledgeQuestion', q);
      location.href = 'content.html';
      return;
    }

    const ignore = e.target.closest('[data-ignore]');
    if (ignore) {
      try {
        await api('PATCH', { ids: JSON.parse(ignore.dataset.ignore), status: 'ignored' });
        await reload();
      } catch (err) { alert(err.message); }
    }
  }

  async function init() {
    await Mode.ready();
    if (!Sessions.remote) { $('needsDb').hidden = false; $('main').hidden = true; return; }

    await Content.load();
    await Auth.ensure();
    Auth.paintWho();

    try {
      await reload();
    } catch (err) {
      $('missList').innerHTML = `<p class="hint" style="padding:16px">${escapeHtml(err.message)}</p>`;
      return;
    }

    $('missList').addEventListener('click', onAction);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', Insights.init);
