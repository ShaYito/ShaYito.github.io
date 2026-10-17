/* 总览首页“市场现状”（M70；数据 market_brief.json，每日流程生成）：AI 根据证据包归纳的近期发生的事、情绪与风向、
   选股池各板块状态、明显的风险、值得留意的机会线索、接下来要看的事。每条后的编号可悬停查看证据原文。不是买卖建议。 */

const MB_MOOD_CLS = { 偏乐观: "pos", 中性: "neu", 偏谨慎: "neg-soft", "恐慌 / 避险": "neg" };
const MB_SECTIONS = [
  ["events", "近期发生的事", ""], ["sectors", "选股池各板块", ""], ["risks", "明显的风险", "-"],
  ["opportunities", "值得留意的线索", "+"], ["watch", "接下来要看", ""],
];

function marketBriefCard(d, priceAsof) {
  if (!d?.brief) return "";
  const b = d.brief;
  const evMap = Object.fromEntries((d.evidence || []).map((e) => [e.id, e.text]));
  const stale = priceAsof && d.asof < priceAsof ? `<p class="warn small">这份现状基于 ${esc(d.asof)} 的数据，行情已更新到 ${esc(priceAsof)}（每日流程运行后更新）。</p>` : "";
  const cats = [...new Set((d.evidence || []).map((e) => e.cat))];
  return `<section class="card mb-card" id="mb-card"><h3>市场现状 ${badge("model")}<span class="muted" style="font-weight:400"> AI 根据下方证据归纳 · 数据截至 ${esc(d.asof)} · ${esc(d.provider || "")}</span></h3>
    ${stale}
    <p class="mb-head"><span class="brief-view ${MB_MOOD_CLS[b.mood] || "neu"}">${esc(b.mood)}</span> <b>${esc(b.headline)}</b></p>
    <p>${esc(b.summary)}</p>
    <p class="small"><b>情绪与风向</b>：${esc(b.mood_text)}</p>
    <div class="mb-grid">${MB_SECTIONS.map(([k, title, mark]) => (b[k]?.length ? `<div class="brief-col"><div class="brief-h"><b>${title}</b></div>${briefList(b[k], evMap, mark)}</div>` : "")).join("")}</div>
    <details class="small"><summary>证据（${(d.evidence || []).length} 条）与说明</summary>
      <p class="muted">每天在每日新闻之后生成：AI 只能使用下列证据中的事实与数字（输出里出现证据外的数字会被拒绝并重试）；写的是现状，不是涨跌预测或买卖建议。编号：M 市场与宏观、S 板块与个股、E 事件、C 日程、R 规律与数据说明。</p>
      ${cats.map((c) => `<p><b>${esc(c)}</b></p><ul>${d.evidence.filter((e) => e.cat === c).map((e) => `<li><span class="ev-ref">${esc(e.id)}</span> ${esc(e.text)}</li>`).join("")}</ul>`).join("")}
    </details></section>`;
}
