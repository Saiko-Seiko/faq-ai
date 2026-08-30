/* ============================================================
   AI面接官 — 面接フロー・評価エンジン・回答ログ保存
   ============================================================ */

/* ============================================================
   0. 回答ログの保存
   ------------------------------------------------------------
   ★ デモ限定 ★ localStorage に保存している。
   本番はサーバーのデータベースに保存し、保存期間と削除方針を
   個人情報保護方針に沿って定める必要がある。
   人事ダッシュボード（Phase 3）はここに保存された記録を読む。
   ============================================================ */
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

/* ============================================================
   1. 評価エンジン
   ============================================================ */

/* ---------- デモモード：規則ベースの採点 ----------
   APIを使わずに、その場で説明できる根拠から点をつける。
   「AIが勘で決めている」ように見せないため、
   何を見て加点したかを所見に必ず書き出す。
   ------------------------------------------------ */

/* 具体性の手がかり（数字・期間・固有の行動） */
const RE_NUMBER = /[0-9０-９]+\s*(%|％|人|名|件|社|倍|円|万|時間|日|週|ヶ月|か月|カ月|年|位|点|回)/;
const WORDS_TEAM = ['チーム', '相談', '共有', '協力', '連携', 'レビュー', '相手', '一緒', 'メンバー', '周り', '支え', '聞く', '伝え'];
const WORDS_LEARN = ['学', '身につけ', '挑戦', '改善', '成長', 'キャッチアップ', '勉強', '習得', '吸収'];
const WORDS_RESULT = ['結果', '改善', '削減', '向上', '達成', '解決', '短縮', '増え', '減ら'];

function countHits(text, words) {
  return words.filter((w) => text.includes(w)).length;
}

function clamp5(n) {
  return Math.max(1, Math.min(5, Math.round(n)));
}

function answersFor(answers, axis) {
  return answers.filter((a) => a.axis === axis).map((a) => a.text).join('\n');
}

function evaluateByRules(answers) {
  const all = answers.map((a) => a.text).join('\n');
  const totalLen = all.replace(/\s/g, '').length;
  const notes = [];

  /* --- 志望動機の具体性 --- */
  const motivationText = answersFor(answers, 'motivation');
  const mLen = motivationText.replace(/\s/g, '').length;
  // 会社の実情に触れているか（ナレッジのキーワードと突き合わせる）
  const companyRefs = KNOWLEDGE
    .flatMap((e) => e.keywords)
    .filter((kw) => kw.length >= 2 && motivationText.includes(kw)).length;
  let motivation = 1 + Math.min(2, mLen / 90) + Math.min(2, companyRefs * 0.7);
  if (companyRefs > 0) notes.push(`志望動機で当社の事業・制度に${companyRefs}箇所ふれている`);
  else notes.push('志望動機が一般論にとどまり、当社ならではの理由が読み取りにくい');

  /* --- 経験の裏付け --- */
  const expText = answersFor(answers, 'experience');
  const eLen = expText.replace(/\s/g, '').length;
  const hasNumber = RE_NUMBER.test(expText);
  const resultHits = countHits(expText, WORDS_RESULT);
  let experience = 1 + Math.min(2, eLen / 130) + (hasNumber ? 1.4 : 0) + Math.min(1.2, resultHits * 0.5);
  notes.push(hasNumber
    ? '取り組みの結果が数字で語られている'
    : '取り組みは語られているが、結果が数値で示されていない');

  /* --- コミュニケーション --- */
  // 質問数に対して回答が過不足なく返っているか、を長さのばらつきで見る
  const lens = answers.map((a) => a.text.replace(/\s/g, '').length);
  const avg = lens.reduce((s, n) => s + n, 0) / (lens.length || 1);
  const tooShort = lens.filter((n) => n < 25).length;
  const polite = /です|ます|ございます/.test(all);
  let communication = 1 + Math.min(2.4, avg / 110) + (polite ? 1 : 0) - tooShort * 0.6;
  if (tooShort > 0) notes.push(`${tooShort}問で回答が極端に短く、意図が読み取りにくい`);

  /* --- カルチャーフィット --- */
  const cultureText = answersFor(answers, 'culture');
  const teamHits = countHits(cultureText || all, WORDS_TEAM);
  const learnHits = countHits(all, WORDS_LEARN);
  let culture = 1 + Math.min(2.2, teamHits * 0.7) + Math.min(1.6, learnHits * 0.6);
  if (teamHits >= 2) notes.push('チームでの関わり方が具体的な場面とともに語られている');

  // 全体が極端に短い場合は、どの軸も高く出ないよう抑える
  if (totalLen < 120) {
    motivation -= 1; experience -= 1; communication -= 1; culture -= 1;
    notes.push('回答全体の情報量が少なく、判断材料が不足している');
  }

  const scores = {
    motivation: clamp5(motivation),
    experience: clamp5(experience),
    communication: clamp5(communication),
    culture: clamp5(culture),
  };

  const total = Object.values(scores).reduce((s, n) => s + n, 0);

  const comment = [
    `${AXES.map((a) => `${a.label}${scores[a.key]}点`).join('／')}の計${total}点（20点満点）。`,
    ...notes.map((n) => `・${n}`),
    '',
    '※この評価は一次スクリーニングの参考値です。合否は人事担当者が回答内容を確認したうえで判断してください。',
  ].join('\n');

  return { scores, total, comment };
}

/* ---------- ライブモード：Claude による評価 ---------- */
function buildEvalSystemPrompt() {
  return [
    `あなたは${COMPANY.name}の採用一次スクリーニングを補助するAIです。`,
    '候補者のオンライン面接の回答を読み、4つの観点で評価してください。',
    '',
    '評価軸（各1〜5点の整数）:',
    ...AXES.map((a) => `- ${a.key}（${a.label}）: ${a.desc}`),
    '',
    '守ること:',
    '1. 回答に書かれている事実だけを根拠にする。書かれていないことを補って評価しない。',
    '2. 合否は判定しない。あなたの役割はスコアと所見の作成まで。',
    '3. 年齢・性別・出身・家族構成など、業務と関係のない属性を評価に含めない。',
    '4. comment には、各点数の根拠を候補者の発言に触れながら日本語で書く（300文字程度）。',
    '',
    '出力は次のJSONのみ。前後に説明文やコードブロックを付けないこと:',
    '{"motivation":3,"experience":4,"communication":3,"culture":4,"comment":"…"}',
  ].join('\n');
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

async function evaluateByClaude(answers) {
  const transcript = answers
    .map((a, i) => `【質問${i + 1}】${a.question}\n【回答】${a.text || '（無回答）'}`)
    .join('\n\n');

  const text = await callClaude({
    system: buildEvalSystemPrompt(),
    messages: [{ role: 'user', content: transcript }],
    maxTokens: 4096,
    effort: 'high', // 人の選考に関わる判断なので、速度より精度を優先する
  });

  const parsed = extractJson(text);
  if (!parsed) throw new Error('評価結果を解釈できませんでした。');

  const scores = {};
  for (const axis of AXES) {
    const v = Number(parsed[axis.key]);
    scores[axis.key] = Number.isFinite(v) ? clamp5(v) : 3;
  }
  const total = Object.values(scores).reduce((s, n) => s + n, 0);

  const comment = `${String(parsed.comment || '').trim()}\n\n`
    + '※この評価は一次スクリーニングの参考値です。合否は人事担当者が回答内容を確認したうえで判断してください。';

  return { scores, total, comment };
}

/* ---------- 深掘り質問 ---------- */
async function followUpQuestion(answers) {
  const target = answers.find((a) => a.id === 'q3') || answers[answers.length - 1];
  const body = String(target?.text || '').trim();

  if (Mode.isLive() && body) {
    try {
      const text = await callClaude({
        system: [
          'あなたは採用面接官です。候補者の回答を読み、もう一歩踏み込んで聞く質問を1つだけ作ってください。',
          '条件: 日本語の丁寧語。80文字以内。質問文のみを出力し、前置きや記号を付けない。',
          '年齢・性別・家族構成など業務と無関係な属性は聞かない。',
        ].join('\n'),
        messages: [{ role: 'user', content: `候補者の回答:\n${body}` }],
        maxTokens: 1024,
        effort: 'low',
      });
      const q = text.trim().split('\n')[0];
      if (q) return q;
    } catch (_) {
      /* 失敗しても面接は止めない。下の定型question に落とす。 */
    }
  }

  // デモモード／失敗時：回答の傾向に合わせた定型の深掘り
  if (!RE_NUMBER.test(body)) {
    return 'ありがとうございます。もう少しだけ伺わせてください。その取り組みの結果は、数字で表すとどの程度の変化がありましたか。';
  }
  return 'ありがとうございます。もう少しだけ伺わせてください。その取り組みの中で、最も難しかったのはどの部分でしたか。';
}

/* ============================================================
   2. 画面制御
   ============================================================ */
const Interview = (() => {
  const screens = {};
  let candidate = null;
  let token = '';

  const answers = [];      // {id, axis, question, text, seconds}
  let queue = [];          // 出題予定
  let index = 0;
  let startedAt = null;
  let questionStartedAt = null;
  let followUpUsed = false;

  const $ = (id) => document.getElementById(id);

  function show(name) {
    Object.entries(screens).forEach(([key, el]) => { el.hidden = key !== name; });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- 入口 ---------- */
  function resolveCandidate() {
    token = new URLSearchParams(location.search).get('token') || '';
    candidate = CANDIDATES[token] || null;
    return candidate;
  }

  function paintInvalid() {
    $('tokenList').innerHTML = Object.entries(CANDIDATES)
      .map(([t, c]) => `<li><a href="interview.html?token=${encodeURIComponent(t)}">${escapeHtml(c.name)}（${escapeHtml(c.role)}）</a></li>`)
      .join('');
    show('invalid');
  }

  /* ---------- 質問 ---------- */
  function paintQuestion() {
    const q = queue[index];
    const total = queue.length;

    $('qStep').textContent = `質問 ${index + 1} / ${total}`;
    $('qProgress').style.width = `${(index / total) * 100}%`;
    $('qText').textContent = q.text;
    $('qHint').textContent = q.hint || '';
    $('qHint').hidden = !q.hint;

    $('answerInput').value = '';
    $('answerInput').focus();
    $('answerCount').textContent = '0 文字';
    $('nextBtn').textContent = index === total - 1 ? '回答を送信して終了する' : '次の質問へ';

    questionStartedAt = Date.now();
  }

  async function submitAnswer() {
    const q = queue[index];
    const text = $('answerInput').value.trim();

    if (text.length < 10) {
      if (!confirm('回答がとても短いようです。このまま次へ進みますか？')) return;
    }

    answers.push({
      id: q.id,
      axis: q.axis || 'communication',
      question: q.text,
      text,
      seconds: Math.round((Date.now() - questionStartedAt) / 1000),
    });

    // 共通質問を終えた時点で、最後の1問（深掘り）の内容を確定させる。
    // 枠は最初から queue に入れてあるので、質問数の表示はぶれない。
    if (!followUpUsed && index === QUESTIONS.length - 1) {
      followUpUsed = true;
      $('nextBtn').disabled = true;
      $('nextBtn').textContent = '考えています…';
      queue[QUESTIONS.length].text = await followUpQuestion(answers);
      $('nextBtn').disabled = false;
    }

    index += 1;
    if (index >= queue.length) {
      finish();
    } else {
      paintQuestion();
    }
  }

  /* ---------- 評価と保存 ---------- */
  async function finish() {
    show('analyzing');

    let result;
    let usedMode = Mode.isLive() ? 'live' : 'demo';
    try {
      result = usedMode === 'live'
        ? await evaluateByClaude(answers)
        : evaluateByRules(answers);
    } catch (err) {
      // ライブ評価に失敗しても面接は完了させる。規則ベースに落として記録を残す。
      result = evaluateByRules(answers);
      result.comment = `（AIによる評価に失敗したため、規則ベースの暫定評価です: ${err.message}）\n\n${result.comment}`;
      usedMode = 'demo';
    }

    const finishedAt = new Date();
    Sessions.save({
      id: `${token}-${startedAt.getTime()}`,
      token,
      candidate: { name: candidate.name, role: candidate.role },
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSec: Math.round((finishedAt - startedAt) / 1000),
      mode: usedMode,
      answers,
      scores: result.scores,
      total: result.total,
      comment: result.comment,
      // 合否は人が決める。AIは null のまま引き渡す。
      humanDecision: null,
      humanMemo: '',
    });

    $('doneName').textContent = candidate.name;
    $('doneCount').textContent = `${answers.length}問`;
    $('doneTime').textContent = `${Math.max(1, Math.round((finishedAt - startedAt) / 60000))}分`;
    show('done');
  }

  /* ---------- 音声入力（対応ブラウザのみ） ---------- */
  function setupVoice() {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btn = $('voiceBtn');
    if (!Rec) { btn.hidden = true; return; }

    const rec = new Rec();
    rec.lang = 'ja-JP';
    rec.continuous = true;
    rec.interimResults = false;
    let on = false;

    rec.addEventListener('result', (e) => {
      let add = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        if (e.results[i].isFinal) add += e.results[i][0].transcript;
      }
      if (!add) return;
      const box = $('answerInput');
      box.value = (box.value + add).trim();
      box.dispatchEvent(new Event('input'));
    });

    const stop = () => { on = false; btn.classList.remove('is-recording'); btn.textContent = '🎤 音声で入力'; };
    rec.addEventListener('end', stop);
    rec.addEventListener('error', stop);

    btn.addEventListener('click', () => {
      if (on) { rec.stop(); return; }
      try {
        rec.start();
        on = true;
        btn.classList.add('is-recording');
        btn.textContent = '■ 停止';
      } catch (_) { stop(); }
    });
  }

  /* ---------- 初期化 ---------- */
  function init() {
    ['invalid', 'intro', 'question', 'analyzing', 'done'].forEach((k) => {
      screens[k] = document.getElementById(`screen-${k}`);
    });

    if (!resolveCandidate()) { paintInvalid(); return; }

    $('introName').textContent = candidate.name;
    $('introRole').textContent = candidate.role;
    $('introCount').textContent = `${QUESTIONS.length + 1}問`;

    $('agree').addEventListener('change', (e) => { $('startBtn').disabled = !e.target.checked; });

    $('startBtn').addEventListener('click', () => {
      startedAt = new Date();
      // 共通質問＋深掘り1問ぶんの枠。深掘りの文面は5問目の回答後に埋める。
      queue = QUESTIONS.concat([{ id: 'follow', axis: 'communication', text: '', hint: '' }]);
      index = 0;
      show('question');
      paintQuestion();
    });

    $('answerInput').addEventListener('input', (e) => {
      $('answerCount').textContent = `${e.target.value.replace(/\s/g, '').length} 文字`;
      e.target.style.height = 'auto';
      e.target.style.height = `${Math.max(150, e.target.scrollHeight)}px`;
    });

    $('nextBtn').addEventListener('click', submitAnswer);

    setupVoice();
    show('intro');
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', Interview.init);
