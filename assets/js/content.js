/* ============================================================
   Stage 5: 画面が使うコンテンツの取得
   ------------------------------------------------------------
   既定値はリポジトリ内の定義（knowledge.js / interview-data.js）。
   サーバーがあれば、人事が編集した内容で置き換える。

   これにより file:// で直接開いた場合も動き続ける
   （クライアントに渡したデモURLの挙動を変えないため）。
   ============================================================ */

const Content = {
  knowledge: (typeof KNOWLEDGE !== 'undefined') ? KNOWLEDGE.slice() : [],
  questions: (typeof QUESTIONS !== 'undefined') ? QUESTIONS.slice() : [],
  axes: (typeof AXES !== 'undefined') ? AXES.slice() : [],
  company: (typeof COMPANY !== 'undefined') ? { ...COMPANY } : { name: '', tagline: '' },
  video: {
    url: '',
    duration: (typeof VIDEO_DURATION !== 'undefined') ? VIDEO_DURATION : 600,
    chapters: (typeof VIDEO_CHAPTERS !== 'undefined') ? VIDEO_CHAPTERS.slice() : [],
  },
  source: 'file',

  _loaded: null,

  /** 起動時に1度だけ読み込む。失敗しても既定値のまま動く。 */
  load() {
    if (Content._loaded) return Content._loaded;

    Content._loaded = (async () => {
      try {
        const res = await fetch(`${CONFIG.API_BASE}/content`, { cache: 'no-store' });
        if (!res.ok) throw new Error('unavailable');
        const data = await res.json();

        if (Array.isArray(data.knowledge) && data.knowledge.length) Content.knowledge = data.knowledge;
        if (Array.isArray(data.questions) && data.questions.length) Content.questions = data.questions;
        if (Array.isArray(data.axes) && data.axes.length) Content.axes = data.axes;
        if (data.company && data.company.name) Content.company = data.company;
        if (data.video) {
          Content.video = {
            url: data.video.url || '',
            duration: Number(data.video.duration) || Content.video.duration,
            chapters: Array.isArray(data.video.chapters) && data.video.chapters.length
              ? data.video.chapters
              : Content.video.chapters,
          };
        }
        Content.source = data.source || 'file';
      } catch (_) {
        // サーバーが無い（file:// で開いた等）。既定値のまま進む。
        Content.source = 'file';
      }
      return Content;
    })();

    return Content._loaded;
  },
};
