/* 个股页“信息透明度”（M71；数据 transparency.json）：这家公司公开了多少可核实的经营信息、多快、多稳定。
   披露范围 7 项 + 质量参考（季报申报天数、数字被后续改动的比例、分析师覆盖），与选股池比较。不是涨跌信号。 */

let TR_D = null;
async function trData() {
  if (!TR_D) TR_D = await load("transparency.json").catch(() => null);
  return TR_D;
}
// 没有时的说明：结构化数据里没有，不等于公司完全不说（如 Vertiv 的积压订单只在新闻稿与业绩会中）
const TR_MISSING = { rpo: "财报结构化数据中没有（可能只在新闻稿 / 业绩会中提到）", purchase: "财报结构化数据中没有",
  customers: "财报中未披露占比 ≥ 10% 的客户（或客户分散）", seg_profit: "没有按分部的利润", business: "只有单一业务或未拆分", geography: "未按地区拆分" };
const trLevel = (n) => (n >= 5 ? ["高", "pos"] : n >= 3 ? ["中", "neu"] : ["低", "neg-soft"]);
const trPct = (p, lowGood) => (isNum(p) ? `选股池中${lowGood ? (p <= 0.33 ? "较好" : p >= 0.67 ? "较差" : "居中") : (p >= 0.67 ? "较高" : p <= 0.33 ? "较低" : "居中")}` : "");

async function fillTransparencyCard(t) {
  const el = byId("tr-card");
  const d = await trData();
  const r = d?.companies?.[t];
  if (!el || !r) return;
  el.hidden = false;
  const [lv, lc] = trLevel(r.score);
  const med = d.median || {};
  el.innerHTML = `<h3>信息透明度 ${badge("fact")}${badge("derived")}</h3>
    <p><span class="brief-view ${lc}">${lv}</span> 公开了 <b>${r.score} / ${d.items.length}</b> 类可核实的经营信息 <span class="muted small">（选股池中位数 ${num(med.score, 0)} 类）</span></p>
    <div class="tr-grid">${d.items.map((it) => `<div class="tr-item ${r.have[it.key] ? "on" : ""}" title="${esc(it.desc)}">
      <b>${r.have[it.key] ? "✓" : "✗"} ${esc(it.name)}</b><span class="muted small">${esc(r.notes[it.key] || (r.have[it.key] ? "" : TR_MISSING[it.key] || "未披露"))}</span></div>`).join("")}</div>
    <div class="kpis">
      <div class="kpi"><span class="muted">季末到季报申报</span><b>${isNum(r.lag_days) ? `${r.lag_days} 天` : "–"}</b><span class="muted small">${isNum(r.lag_days) ? `中位数 ${num(med.lag_days, 0)} 天 · ${trPct(r.pct.lag_days, true)}` : "没有季度结构化数据"}</span></div>
      <div class="kpi"><span class="muted">近 3 年数字被后续改动</span><b>${isNum(r.restated) ? pct(r.restated, 0) : "–"}</b><span class="muted small">${r.restated_n ? `${r.restated_n[0]} / ${r.restated_n[1]} 个期间 · ${trPct(r.pct.restated, true)}` : ""}</span></div>
      <div class="kpi"><span class="muted">分析师覆盖</span><b>${isNum(r.analysts) ? `${r.analysts} 家` : "–"}</b><span class="muted small">${isNum(r.analysts) ? `中位数 ${num(med.analysts, 0)} 家 · ${trPct(r.pct.analysts, false)}` : ""}</span></div>
    </div>
    <p class="muted small">怎么理解：透明度高低<b>不是涨跌信号</b>，它决定你能多大程度依赖财报证据来判断——披露少的公司，技术页“财报硬数据”、分部趋势、客户集中度等指标看不到或不完整，需要更多依赖管理层表态与新闻（M69 回测中相当一部分瓶颈在财报里看不出来）。
      “数字被后续改动”包括重分类、终止经营调整等，不全是会计差错，只说明首次公布的数字有多稳定。悬停各项查看含义。</p>`;
}
