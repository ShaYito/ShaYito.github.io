/* 市场 →“证据检验”（数据 evidence_tests.json）：哪些证据对 1 周 – 3 个月真的有用。
   上：全市场大样本检验（P1，2,500+ 只美股，2012 年起）；下：证据前瞻账本（P2，选股池每周记录，之后自动检验）。
   两者的判定标准都在看结果之前写下（docs/PROGRESS.md P1 / P2）。 */

const ET_VERDICT = {
  useful: ["evid-strong", "有用"], weak: ["evid-weak", "方向一致但弱"], none: ["evid-against", "无效"],
  accumulating: ["", "积累中"],
};
function etChip(v, extra = "") { const [c, n] = ET_VERDICT[v] || ["", v]; return `<span class="chip ${c}">${n}${extra}</span>`; }
function etIc(r) { return isNum(r.ic) ? `${r.ic >= 0 ? "+" : ""}${num(r.ic, 3)}${isNum(r.t) ? `（t ${num(r.t, 1)}）` : ""}` : "–"; }

function etP1(p1) {
  if (!p1?.rows?.length) return card("全市场大样本检验", empty("尚无检验结果（run_short_horizon.py）"));
  const hs = p1.config.horizons;
  const keys = Object.keys(p1.signals);
  const cell = (k, h) => { const r = p1.rows.find((x) => x.signal === k && x.h === h); return r ? `<td title="前段 t ${r.early.t ?? "–"} · 后段 t ${r.late.t ?? "–"} · 科技股 IC ${r.tech.mean ?? "–"} · BH q ${r.q}${r.q5q1.mean != null ? ` · 最高减最低五分之一每期 ${pct(r.q5q1.mean, 2, true)}` : ""}">${etIc(r)}<br>${etChip(r.verdict)}</td>` : "<td>–</td>"; };
  return `<section class="card"><h3>全市场大样本检验 ${badge("derived")}</h3>
    <p class="muted">${(p1.universe.stocks || 0).toLocaleString()} 只美股（当前市值 ≥ $300M，排除金融 / 房地产），${esc(p1.config.start)} 至 ${esc(p1.asof)}，每周比较同一周所有股票：信号排序与之后 1 / 4 / 13 周相对表现排序的相关（IC）。悬停看前后两段、科技股子样本与五等分。</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>信号</th><th>文献预期</th>${hs.map((h) => `<th>${h} 周</th>`).join("")}</tr></thead>
    <tbody>${keys.map((k) => `<tr><td>${esc(p1.signals[k].name)}</td><td class="small">${p1.signals[k].expected > 0 ? "越高越好" : "越低越好"}</td>${hs.map((h) => cell(k, h)).join("")}</tr>`).join("")}</tbody></table></div>
    <details class="small"><summary>判定标准与局限</summary>
      <p>“有用” = 四条全满足（看结果前写下）：全样本 |t| ≥ ${p1.config.t_min} 且 ${p1.rows.length} 个检验做多重比较（BH）校正后 q ≤ ${p1.config.q_max}；${esc(p1.config.split.slice(0, 4))} 年前后两段同向且各自 |t| ≥ ${p1.config.half_t_min}；科技股子样本同向；五等分最高减最低与 IC 同号。只满足后三条为“方向一致但弱”。</p>
      <p>IC 0.01–0.03 已经是统计上可靠的水平，但对单只股票的解释力很小。股票池是现在仍上市的公司（幸存者偏差）；未扣交易成本；不预测大盘涨跌。</p></details></section>`;
}

function etLedger(L) {
  const hs = L.horizons || [];
  const n = L.snapshots?.length || 0;
  const head = n
    ? `已记录 <b>${n}</b> 周（${esc(L.snapshots[0])} 起，最近 ${esc(L.snapshots[n - 1])}）。最近一次记录的结果到期：${hs.map((h) => `${h} 个交易日 → ${esc(L.pending?.[h] || "–")}`).join("；")}。`
    : "尚未开始记录：每周最后一个交易日收盘后的每日流程会自动记录。";
  const groups = [...new Set(L.fields.map((f) => f.group))];
  const cell = (k, h) => {
    const r = L.rows.find((x) => x.field === k && x.h === h);
    if (!r || !r.weeks) return `<td class="muted small">未到期</td>`;
    const extra = r.verdict === "accumulating" ? ` ${r.weeks}/${L.config.min_weeks} 周` : "";
    return `<td title="前一半 IC ${r.first ?? "–"} · 后一半 ${r.second ?? "–"} · BH q ${r.q}">${etIc(r)}<br>${etChip(r.verdict, extra)}</td>`;
  };
  const cov = L.coverage || {};
  return `<section class="card"><h3>证据前瞻账本（选股池） ${badge("fact")}${badge("derived")}</h3>
    <p>${head}</p>
    <p class="muted">每周把选股池各股在网站上的证据读数存下来（与页面所见同一份），之后自动计算 ${hs.map((h) => `${h}`).join(" / ")} 个交易日的表现（相对选股池等权平均），按事先标准检验。用来检验没有历史数据可回测的证据：EPS 预期修正、目标价变动、新闻情绪、散户热度、AI 归纳的判断等。</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>证据</th><th class="small">最近有值</th>${hs.map((h) => `<th>${h} 个交易日</th>`).join("")}</tr></thead>
    <tbody>${groups.map((g) => `<tr><td colspan="${hs.length + 2}" class="muted"><b>${esc(g)}</b></td></tr>${L.fields.filter((f) => f.group === g).map((f) => `<tr><td>${esc(f.name)}</td><td class="small">${cov[f.key] ?? "–"}</td>${hs.map((h) => cell(f.key, h)).join("")}</tr>`).join("")}`).join("")}</tbody></table></div>
    <details class="small"><summary>判定标准与局限</summary>
      <p>每个记录日：当时有值的股票（≥ ${L.config.min_n} 只）中，读数排序与之后表现排序的相关（IC）；各周平均，t 值考虑相邻周的重叠（Newey-West）。“有用”（看结果前写下）：已到期 ≥ ${L.config.min_weeks} 周、|t| ≥ ${L.config.t_min}、全部字段 × 期限做 BH 校正后 q ≤ ${L.config.q_max}、前后两半方向相同。不足 ${L.config.min_weeks} 周显示“积累中”，数字仅供观察，不能下结论。</p>
      <p>AI 归纳的判断按 偏弱 −2 / 中性偏弱 −1 / 中性 0 / 中性偏强 +1 / 偏强 +2 计。目标价隐含空间、P/E 等越高不代表越好，IC 为负同样是有用的信息（方向相反）。</p>
      <p>局限：选股池约 70 只、事后挑选、集中在 AI 硬件，每周截面很小，噪声大；结果只说明选股池内部谁相对更强，不说明大盘方向。价格类信号已在全市场检验过（上表），这里作为对照：如果它们在选股池里也成立，说明账本的方法可信。</p></details></section>`;
}

PAGES.evidence = async () => {
  const d = await load("evidence_tests.json");
  app().innerHTML = `<h2>证据检验 <span class="muted small">哪些证据对 1 周 – 3 个月的判断真的有用</span></h2>
    ${etP1(d.p1)}${etLedger(d.ledger)}`;
};
