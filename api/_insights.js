/* ============================================================
   Stage 6: 精度と運用改善
   ------------------------------------------------------------
   2つのことをする。

   1. 答えられなかった質問を集める → ナレッジの追加候補
   2. AIのスコアと人事の最終判断のズレを集計する
      → どの評価軸が判別に効いていないかを示す

   2つ目は「AIが正しいか」を測るものではない。
   人事の判断を正とし、AIがそこにどれだけ寄れているかを見る。
   ============================================================ */

const store = require('./_store.js');

const MISS_MAX = 200;

/* ------------------------------------------------------------
   1. 答えられなかった質問
   ------------------------------------------------------------ */
async function recordMiss({ question, bestScore, bestId }) {
  const q = store.client();
  if (!q) return null;

  const text = String(question || '').trim().slice(0, 200);
  if (!text) return null;

  await q`
    INSERT INTO chat_misses (question, best_score, best_id)
    VALUES (${text}, ${Number(bestScore) || 0}, ${bestId || null})
  `;
  return true;
}

/* 似た質問はまとめて数える。
   同じことを別の言い方で何度も聞かれている、が見えるようにするため。 */
async function listMisses() {
  const q = store.client();
  if (!q) return [];

  const rows = await q`
    SELECT * FROM chat_misses
    WHERE status = 'open'
    ORDER BY at DESC
    LIMIT ${MISS_MAX}
  `;

  // 先頭6文字が同じものを同一視する簡易なまとめ方。
  // 形態素解析を持ち込むほどの精度は要らない（人が見て判断する材料なので）。
  const groups = new Map();
  for (const r of rows) {
    const key = r.question.replace(/\s/g, '').slice(0, 6);
    if (!groups.has(key)) {
      groups.set(key, { key, count: 0, samples: [], lastAt: r.at, ids: [] });
    }
    const g = groups.get(key);
    g.count += 1;
    g.ids.push(r.id);
    if (g.samples.length < 3) g.samples.push(r.question);
  }

  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}

async function closeMisses(ids, status, actor) {
  const q = store.client();
  if (!q) return null;
  const label = (actor && actor.email) ? actor.email : 'hr';
  const list = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Number.isFinite);
  if (!list.length) return null;

  await q`
    UPDATE chat_misses
    SET status = ${status}, handled_at = now(), handled_by = ${label}
    WHERE id = ANY(${list})
  `;
  await store.audit('insight.miss', null, { status, count: list.length }, actor);
  return list.length;
}

/* 保存期間を過ぎたものを消す（cleanup から呼ばれる） */
async function purgeOldMisses(days) {
  const q = store.client();
  if (!q) return 0;
  const rows = await q`
    DELETE FROM chat_misses
    WHERE at < now() - ${`${Math.max(1, days)} days`}::interval
    RETURNING id
  `;
  return rows.length;
}

/* ------------------------------------------------------------
   2. AIのスコアと人事の判断のズレ
   ------------------------------------------------------------ */

function mean(nums) {
  if (!nums.length) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

async function agreement(axes) {
  const q = store.client();
  if (!q) return null;

  const rows = await q`
    SELECT total, scores, human_decision
    FROM interview_sessions
    WHERE human_decision IS NOT NULL
  `;

  const decided = rows.length;
  const byDecision = { pass: [], hold: [], reject: [] };
  for (const r of rows) {
    if (byDecision[r.human_decision]) byDecision[r.human_decision].push(r);
  }

  /* --- AIが低く付けたのに人が合格にした件数 ---
     この数字がこのシステムの存在理由。
     AIだけで切っていたら失っていた人が何人いたか。 */
  const rescued = byDecision.pass.filter((r) => r.total <= 10).length;
  /* --- AIが高く付けたのに人が不合格にした件数 --- */
  const overrated = byDecision.reject.filter((r) => r.total >= 16).length;

  /* --- 軸ごとの判別力 ---
     合格群と不合格群で平均点に差が出ない軸は、
     合否の判断に寄与していない＝観点の書き方を見直す候補。 */
  const axisStats = (axes || []).map((axis) => {
    const passAvg = mean(byDecision.pass.map((r) => Number((r.scores || {})[axis.key])).filter(Number.isFinite));
    const rejectAvg = mean(byDecision.reject.map((r) => Number((r.scores || {})[axis.key])).filter(Number.isFinite));
    const gap = (passAvg !== null && rejectAvg !== null) ? passAvg - rejectAvg : null;
    return { key: axis.key, label: axis.label, passAvg, rejectAvg, gap };
  });

  return {
    decided,
    // 10件に満たないうちは、数字を根拠に判断しないこと
    enough: decided >= 10,
    counts: {
      pass: byDecision.pass.length,
      hold: byDecision.hold.length,
      reject: byDecision.reject.length,
    },
    averages: {
      pass: mean(byDecision.pass.map((r) => r.total)),
      hold: mean(byDecision.hold.map((r) => r.total)),
      reject: mean(byDecision.reject.map((r) => r.total)),
    },
    rescued,
    overrated,
    axisStats,
  };
}

module.exports = { recordMiss, listMisses, closeMisses, purgeOldMisses, agreement };
