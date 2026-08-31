/* ============================================================
   POST /api/chat — 会社説明会ページのAI人事担当
   ------------------------------------------------------------
   受け取り: { messages: [{ role, content }] }
   返す:     { text }

   ナレッジは assets/js/knowledge.js を共有している。
   ブラウザ側と同じ1つのファイルを見ているので、内容がずれない。
   ============================================================ */

const { ask, guard, fail } = require('./_claude.js');
const content = require('./_content.js');

const MAX_TURNS = 20;
const MAX_CHARS = 2000;

/* Stage 5: ナレッジと社名は人事が画面から編集できる。
   編集されていなければ、リポジトリ内の定義がそのまま使われる。

   プロンプトは同じ内容であるほどキャッシュが効くので、
   ナレッジが変わらないかぎり同じ文字列になるよう組み立てる。
   日時など変動する値は混ぜないこと。 */
function buildSystemPrompt(company, knowledge) {
  return [
  `あなたは${company.name}の採用担当AIです。会社説明会ページで、求職者からの質問に答えます。`,
  '',
  '守ること:',
  '1. 回答は必ず下記の「社内資料」の内容だけを根拠にすること。書かれていないことは推測で答えない。',
  '2. 資料にない質問には「手元の資料では確認できないため、採用担当（recruit@example.invalid）へお繋ぎします」と答えること。',
  '3. 求職者に向けた、丁寧で温かい日本語で答えること。',
  '4. 200文字程度を目安に簡潔に。箇条書きが分かりやすい場合は使ってよい。',
  '5. 合否や選考結果の見通しについては答えず、「選考は人事担当者が判断します」と伝えること。',
  '6. 応募者本人の年齢・性別・家族構成などを尋ねないこと。',
  '',
  '=== 社内資料 ===',
  knowledge.map((e) => `## ${e.category}｜${e.q}\n${e.a}`).join('\n\n'),
  ].join('\n');
}

module.exports = async function handler(req, res) {
  const body = guard(req, res);
  if (!body) return;

  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    res.status(400).json({ error: '質問が空です。' });
    return;
  }

  // 送られてきた履歴をそのまま信用せず、形と量を整えてから渡す
  const safe = messages
    .slice(-MAX_TURNS)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

  if (!safe.length || safe[safe.length - 1].role !== 'user') {
    res.status(400).json({ error: 'リクエストの形式が正しくありません。' });
    return;
  }

  try {
    const [knowledge, company] = await Promise.all([
      content.getKnowledge(),
      content.getSetting('company', { name: '当社' }),
    ]);

    const text = await ask({
      system: buildSystemPrompt(company, knowledge),
      messages: safe,
      maxTokens: 2048,
      effort: 'low', // 資料を引く用途。速度を優先する
    });
    res.status(200).json({ text });
  } catch (err) {
    fail(res, err);
  }
};
