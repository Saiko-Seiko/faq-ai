/* ============================================================
   Stage 5: 編集できるコンテンツ（ナレッジ・質問・会社情報）
   ------------------------------------------------------------
   データベースに内容があればそれを使い、
   無ければリポジトリ内の定義（assets/js/*.js）にそのまま落ちる。

   これにより、
     ・デモとして配ったURL … これまで通りファイルの内容で動く
     ・本番              … 人事が画面から書き換えた内容で動く
   が同じコードで成立する。
   ============================================================ */

const store = require('./_store.js');

/* 初期値。データベースが空のときはこれが使われ、
   「初期値を読み込む」で、この内容をデータベースへ投入できる。 */
const seed = require('../assets/js/knowledge.js');
const interviewSeed = require('../assets/js/interview-data.js');

/* ------------------------------------------------------------
   読み出し
   ------------------------------------------------------------ */
async function getKnowledge({ includeDrafts = false } = {}) {
  const q = store.client();
  if (!q) return seed.KNOWLEDGE;

  const rows = includeDrafts
    ? await q`SELECT * FROM knowledge ORDER BY sort_order, id`
    : await q`SELECT * FROM knowledge WHERE published = true ORDER BY sort_order, id`;

  if (!rows.length) return seed.KNOWLEDGE; // 未投入ならファイルの内容
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    q: r.question,
    keywords: Array.isArray(r.keywords) ? r.keywords : [],
    a: r.answer,
    sortOrder: r.sort_order,
    published: r.published,
  }));
}

async function getQuestions({ includeDisabled = false } = {}) {
  const q = store.client();
  if (!q) return interviewSeed.QUESTIONS;

  const rows = includeDisabled
    ? await q`SELECT * FROM interview_questions ORDER BY sort_order, id`
    : await q`SELECT * FROM interview_questions WHERE enabled = true ORDER BY sort_order, id`;

  if (!rows.length) return interviewSeed.QUESTIONS;
  return rows.map((r) => ({
    id: r.id,
    axis: r.axis,
    text: r.text,
    hint: r.hint,
    sortOrder: r.sort_order,
    enabled: r.enabled,
  }));
}

async function getSetting(key, fallback) {
  const q = store.client();
  if (!q) return fallback;
  const rows = await q`SELECT value FROM settings WHERE key = ${key} LIMIT 1`;
  return rows.length ? rows[0].value : fallback;
}

/* 画面が1回の呼び出しで必要なものを揃える */
async function getAll({ includeDrafts = false } = {}) {
  const [knowledge, questions, company, video, axes] = await Promise.all([
    getKnowledge({ includeDrafts }),
    getQuestions({ includeDisabled: includeDrafts }),
    getSetting('company', { name: seed.COMPANY.name, tagline: seed.COMPANY.tagline }),
    getSetting('video', { url: '', duration: seed.VIDEO_DURATION, chapters: seed.VIDEO_CHAPTERS }),
    getSetting('axes', interviewSeed.AXES),
  ]);
  return {
    knowledge, questions, company, video, axes,
    source: store.isEnabled() ? 'db' : 'file',
  };
}

/* ------------------------------------------------------------
   書き込み（管理者のみ。呼び出し側で権限を確認する）
   ------------------------------------------------------------
   全置き換えにしている。並び替えと削除を素直に反映できるため。
   件数は多くても数十件なので、差分を取る複雑さに見合わない。
   ------------------------------------------------------------ */
async function saveKnowledge(items, actor) {
  const q = store.client();
  if (!q) return;
  const label = (actor && actor.email) ? actor.email : 'admin';

  await q`DELETE FROM knowledge`;
  for (let i = 0; i < items.length; i += 1) {
    const k = items[i];
    await q`
      INSERT INTO knowledge (id, category, question, keywords, answer, sort_order, published, updated_by)
      VALUES (
        ${String(k.id || `k${i + 1}`).slice(0, 100)},
        ${String(k.category || 'その他').slice(0, 100)},
        ${String(k.q || '').slice(0, 500)},
        ${JSON.stringify(Array.isArray(k.keywords) ? k.keywords.slice(0, 40) : [])}::jsonb,
        ${String(k.a || '').slice(0, 4000)},
        ${Number(k.sortOrder) || (i + 1) * 10},
        ${k.published !== false},
        ${label}
      )
    `;
  }
  await store.audit('content.knowledge', null, { count: items.length }, actor);
}

async function saveQuestions(items, actor) {
  const q = store.client();
  if (!q) return;
  const label = (actor && actor.email) ? actor.email : 'admin';

  await q`DELETE FROM interview_questions`;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    await q`
      INSERT INTO interview_questions (id, axis, text, hint, sort_order, enabled, updated_by)
      VALUES (
        ${String(item.id || `q${i + 1}`).slice(0, 50)},
        ${String(item.axis || 'communication').slice(0, 50)},
        ${String(item.text || '').slice(0, 1000)},
        ${String(item.hint || '').slice(0, 500)},
        ${Number(item.sortOrder) || (i + 1) * 10},
        ${item.enabled !== false},
        ${label}
      )
    `;
  }
  await store.audit('content.questions', null, { count: items.length }, actor);
}

async function saveSetting(key, value, actor) {
  const q = store.client();
  if (!q) return;
  const label = (actor && actor.email) ? actor.email : 'admin';

  await q`
    INSERT INTO settings (key, value, updated_by)
    VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${label})
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by
  `;
  await store.audit('content.setting', key, {}, actor);
}

/* リポジトリ内の初期値をデータベースへ投入する（最初の1回） */
async function seedFromFiles(actor) {
  await saveKnowledge(seed.KNOWLEDGE.map((k, i) => ({ ...k, sortOrder: (i + 1) * 10 })), actor);
  await saveQuestions(interviewSeed.QUESTIONS.map((x, i) => ({ ...x, sortOrder: (i + 1) * 10 })), actor);
  await saveSetting('company', { name: seed.COMPANY.name, tagline: seed.COMPANY.tagline }, actor);
  await saveSetting('video', { url: '', duration: seed.VIDEO_DURATION, chapters: seed.VIDEO_CHAPTERS }, actor);
  await saveSetting('axes', interviewSeed.AXES, actor);
}

module.exports = {
  getKnowledge, getQuestions, getSetting, getAll,
  saveKnowledge, saveQuestions, saveSetting, seedFromFiles,
};
