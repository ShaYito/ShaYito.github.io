/* 个股页顶部“现状与展望”（M52）：AI 根据证据包归纳的现状 / 未来几周 / 未来几个月判断（stock_briefs.json，每周生成），
   合并原来的“本页重点”（规则提醒）与“个股体检”（逐项证据，可展开）。判断不是买卖建议；每个论点后的编号可悬停查看证据原文。 */

const BRIEF_VIEW_CLS = { 偏强: "pos", 中性偏强: "pos-soft", 中性: "neu", 中性偏弱: "neg-soft", 偏弱: "neg" };

function briefRefs(refs, evMap) {
  return refs.map((r) => `<span class="ev-ref" title="${esc(evMap[r] ? `${r}：${evMap[r]}` : r)}" data-ref="${esc(r)}">${esc(r)}</span>`).join("");
}
function briefList(points, evMap, mark) {
  return points.length ? `<ul class="brief-pts">${points.map((p) => `<li>${mark ? `<span class="brief-mark ${mark === "+" ? "pos" : "neg"}">${mark === "+" ? "▲" : "▼"}</span>` : ""}${esc(p.text)} ${briefRefs(p.evidence, evMap)}</li>`).join("")}</ul>` : "";
}
function briefHorizon(title, sub, h, evMap) {
  return `<div class="brief-col"><div class="brief-h"><b>${title}</b><span class="muted small">${sub}</span></div>
    <div><span class="brief-view ${BRIEF_VIEW_CLS[h.view] || "neu"}">${esc(h.view)}</span> <span class="muted small">把握度：${esc(h.confidence)}</span></div>
    <p>${esc(h.summary)}</p>
    ${h.drivers.length ? `<div class="muted small">支持</div>${briefList(h.drivers, evMap, "+")}` : ""}
    ${h.risks.length ? `<div class="muted small">风险</div>${briefList(h.risks, evMap, "-")}` : ""}</div>`;
}
// insights：规则提醒（原“本页重点”）；返回整张卡片 HTML
function briefCard(t, row, insights) {
  const alerts = insightItems(insights, 8);
  const evMap = Object.fromEntries((row?.evidence || []).map((e) => [e.id, e.text]));
  const b = row?.brief;
  const top = b ? `<div class="brief-grid">
      <div class="brief-col"><div class="brief-h"><b>现状</b><span class="muted small">${esc(row.date)} · 收盘 ${num(row.price, 2)}</span></div>
        <p>${esc(b.now.summary)}</p>${briefList(b.now.points, evMap)}</div>
      ${briefHorizon("未来几周", "约 2–6 周", b.weeks, evMap)}
      ${briefHorizon("未来几个月", "约 3–6 个月", b.months, evMap)}
    </div>
    <div class="brief-watch"><b>什么情况会改变判断</b>${briefList(b.watch, evMap)}</div>`
    : `<p class="muted">暂无（每周日根据最新数据生成一次；新加入选股池的股票下次生成后才有）。</p>`;
  return `<section class="card" id="brief-card" data-nav="现状与展望"><h3>现状与展望 ${badge("model")}${b ? `<span class="muted" style="font-weight:400"> AI 根据下方证据归纳 · ${esc(row.provider || "")}</span>` : ""}</h3>
    ${top}
    ${b ? `<p class="muted small">“偏强 / 中性 / 偏弱”描述证据整体的倾向，不是买卖建议；短期（几周）涨跌本质上很难预测，把握度通常为“低”。每个论点后的编号是所依据的证据（悬停查看原文，全部证据见下方“逐项证据”）；文中数字都经过校验，必须出现在证据里。判断每周存档，将来用于检验准确率。</p>` : ""}
    ${alerts ? `<h4>需要留意的数据 <span class="muted small" style="font-weight:400">按固定规则提取，🔍 = 读数提醒（单看数字容易读错的情形）</span></h4>${alerts}` : ""}
    <details class="brief-ev"><summary>逐项证据（个股体检${b ? ` + AI 使用的 ${row.evidence.length} 条证据` : ""}）</summary>
      <div id="health-card"></div>
      ${b ? `<h4>AI 使用的证据</h4><table class="brief-evt"><tbody>${row.evidence.map((e) => `<tr id="ev-${esc(e.id)}"><td class="muted small">${esc(e.id)}</td><td class="muted small">${esc(e.cat)}</td><td>${esc(e.text)}</td></tr>`).join("")}</tbody></table>` : ""}
    </details></section>`;
}
// 点击证据编号：展开“逐项证据”并高亮该行
function bindBriefRefs() {
  document.querySelectorAll("#brief-card .ev-ref").forEach((el) => (el.onclick = () => {
    const det = document.querySelector("#brief-card details.brief-ev");
    if (det) det.open = true;
    const row = byId(`ev-${el.dataset.ref}`);
    if (!row) return;
    document.querySelectorAll("#brief-card tr.hl").forEach((x) => x.classList.remove("hl"));
    row.classList.add("hl");
    row.scrollIntoView({ block: "center" });
  }));
}
