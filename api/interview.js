/* ============================================================
   POST /api/interview — AI面接官の評価と深掘り質問
   ------------------------------------------------------------
   受け取り: { action: 'evaluate' | 'followup', answers: [...] }
   返す:     evaluate → { scores, total, comment }
            followup → { question }

   ここは人の選考に関わるため、evaluate は effort を上げている。
   ただし返すのはスコアと所見まで。合否はサーバー側でも決めない。
   ============================================================ */

const { ask, guard, fail } = require('./_claude.js');
const { COMPANY } = require('../assets/js/knowledge.js');
const { AXES } = require('../assets/js/interview-data.js');

const MAX_ANSWERS = 12;
const MAX_CHARS = 4000;

const EVAL_SYSTEM = [
  `あなたは${COMPANY.name}の採用一次スクリーニングを補助するAIです。`,
  '候補者のオンライン面接の回答を読み、4つの観点で評価してください。',
  '',
  '評価軸（各1〜5点の整数）:',
  ...AXES.map((a) => `- ${a.key}（${a.label}）: ${a.desc}`),
  '',
  '守ること:',
  '1. 回答に書かれている事実だけを根拠にする。書かれていないことを補って評価しない。',
  '2. 合否は判定しない。あなたの役割はスコアと所見の作成まで。',
  '3. 年齢・性別・出身・国籍・家族構成・信条など、業務と関係のない属性を評価に含めない。',
  '4. comment には、各点数の根拠を候補者の発言に触れながら日本語で書く（300文字程度）。',
  '',
  '出力は次のJSONのみ。前後に説明文やコードブロックを付けないこと:',
  '{"motivation":3,"experience":4,"communication":3,"culture":4,"comment":"…"}',
].join('\n');

const FOLLOWUP_SYSTEM = [
  'あなたは採用面接官です。候補者の回答を読み、もう一歩踏み込んで聞く質問を1つだけ作ってください。',
  '条件: 日本語の丁寧語。80文字以内。質問文のみを出力し、前置きや記号を付けない。',
  '年齢・性別・家族構成など業務と無関係な属性は聞かない。',
].join('\n');

const DISCLAIMER = '※この評価は一次スクリーニングの参考値です。'
  + '合否は人事担当者が回答内容を確認したうえで判断してください。';

function clamp5(n) {
  return Math.max(1, Math.min(5, Math.round(n)));
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (_) { return null; }
}

function sanitizeAnswers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_ANSWERS)
    .filter((a) => a && typeof a.text === 'string')
    .map((a) => ({
      question: String(a.question || '').slice(0, MAX_CHARS),
      text: a.text.slice(0, MAX_CHARS),
    }));
}

module.exports = async function handler(req, res) {
  const body = guard(req, res);
  if (!body) return;

  const answers = sanitizeAnswers(body.answers);
  if (!answers.length) {
    res.status(400).json({ error: '回答が空です。' });
    return;
  }

  try {
    /* ---------- 深掘り質問 ---------- */
    if (body.action === 'followup') {
      const target = answers[answers.length - 1];
      const text = await ask({
        system: FOLLOWUP_SYSTEM,
        messages: [{ role: 'user', content: `候補者の回答:\n${target.text}` }],
        maxTokens: 1024,
        effort: 'low',
      });
      res.status(200).json({ question: text.split('\n')[0].trim() });
      return;
    }

    /* ---------- 評価 ---------- */
    const transcript = answers
      .map((a, i) => `【質問${i + 1}】${a.question}\n【回答】${a.text || '（無回答）'}`)
      .join('\n\n');

    const text = await ask({
      system: EVAL_SYSTEM,
      messages: [{ role: 'user', content: transcript }],
      maxTokens: 4096,
      effort: 'high', // 人の選考に関わる判断なので、速度より精度を優先する
    });

    const parsed = extractJson(text);
    if (!parsed) {
      res.status(502).json({ error: '評価結果を解釈できませんでした。' });
      return;
    }

    const scores = {};
    for (const axis of AXES) {
      const v = Number(parsed[axis.key]);
      scores[axis.key] = Number.isFinite(v) ? clamp5(v) : 3;
    }
    const total = Object.values(scores).reduce((s, n) => s + n, 0);
    const comment = `${String(parsed.comment || '').trim()}\n\n${DISCLAIMER}`;

    res.status(200).json({ scores, total, comment });
  } catch (err) {
    fail(res, err);
  }
};
