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

// M91：多维评分检验（当时市值 ≥ $10B 的大盘股，与选股池相当）
function etM91(m) {
  if (!m) return "";
  const ok = (b) => (b ? '<span class="chip evid-strong">通过</span>' : '<span class="chip evid-against">未通过</span>');
  const tr = Object.entries(m.short_transfer || {}).map(([h, v]) => `<tr><td>短期综合得分 · ${h} 周</td><td>全市场 2012–2018 估计的权重，大盘股 2019 起样本外 IC ${num(v.oos.mean, 3)}（t ${num(v.oos.t, 1)}）</td><td>${ok(v.oos_ok)}</td></tr>`).join("");
  const q = (m.quality || []).filter((r) => r.h === 52).map((r) => `<tr><td>质量 · ${esc(r.name)}（12 个月）</td><td>同板块内比较，IC ${r.mean >= 0 ? "+" : ""}${num(r.mean, 3)}（t ${num(r.t, 1)}；前 ${num(r.early.t, 1)} / 后 ${num(r.late.t, 1)}）</td><td>${ok(r.verdict === "useful")}</td></tr>`).join("");
  const rk = (m.risk || []).filter((r) => r.key === "risk").map((r) => `<tr><td>价格风险综合分 → ${r.target === "fvol" ? "之后 3 个月实际波动" : "之后半年最大回撤"}</td><td>排序相关 ${num(r.mean, 2)}（t ${num(r.t, 0)}；前 ${num(r.early.mean, 2)} / 后 ${num(r.late.mean, 2)}）</td><td>${ok(r.ok)}</td></tr>`).join("");
  const ds = Object.entries(m.distress || {}).map(([k, v]) => `<tr><td>财务困境 · ${k === "z" ? "Altman Z < 1.81" : "Z'' < 1.1（非制造业版）"}</td><td>同价格风险组内，之后半年跌超 40% 的发生率比 ${num(v.ratio, 2)}（差值 t ${num(v.diff.t, 1)}；困境区占 ${pct(v.flag_share, 0)}）</td><td>${ok(v.ok)}</td></tr>`).join("");
  const cr = (m.crowd?.rows || []).filter((r) => r.key === "crowd" || r.key === "crowd2").map((r) => `<tr><td>${esc(r.name)} → 之后 ${r.h} 周收益</td><td>越不拥挤越好的方向，IC ${r.mean >= 0 ? "+" : ""}${num(r.mean, 3)}（t ${num(r.t, 1)}）</td><td>${ok(r.verdict === "useful")}</td></tr>`).join("");
  const cts = m.crowd?.tests;
  const ddRow = (lab, v) => `同价格风险组内${lab}发生率比 ${num(v.ratio, 2)}（差值 t ${num(v.diff?.t, 1)}；前 ${v.early?.mean >= 0 ? "+" : ""}${pct(v.early?.mean, 1)} / 后 ${v.late?.mean >= 0 ? "+" : ""}${pct(v.late?.mean, 1)}；标准 ≥ 1.5）`;
  const cdr = cts
    ? Object.entries(cts).flatMap(([k, v]) => [
        `<tr><td>${esc(v.name)}最高 20% → 之后半年跌超 40%</td><td>${ddRow("", v.drawdown)}</td><td>${ok(v.drawdown.ok)}</td></tr>`,
        `<tr><td>${esc(v.name)}最高 20% → 大盘回调时之后 3 个月跌超 30%</td><td>${ddRow(`（${(m.crowd.stress_episodes || []).length} 次回调）`, v.stress)}</td><td>${ok(v.stress.ok)}</td></tr>`,
      ]).join("")
    : m.crowd?.drawdown
      ? `<tr><td>拥挤度最高 20% → 之后半年跌超 40%</td><td>同价格风险组内发生率比 ${num(m.crowd.drawdown.ratio, 2)}（差值 t ${num(m.crowd.drawdown.diff?.t, 1)}；标准 ≥ 1.5）</td><td>${ok(m.crowd.drawdown.ok)}</td></tr>`
      : "";
  const sr = (v) => `比 ${num(v.ratio, 2)}（前 ${num(v.ratio_early, 2)} / 后 ${num(v.ratio_late, 2)}；差值 t ${num(v.diff?.t, 1)}）`;
  const strict = Object.entries(m.crowd?.strict || {}).map(([k, v]) => `<tr><td>严格控制 · ${esc(v.name)}最高 20% → 之后半年跌超 40%${k === "lite" ? "（事先定的主候选）" : "（只报告）"}</td><td>价格风险十组内：${sr(v.group10)}<br>回归控制：${sr(v.regression)}<br><span class="muted">标准：两种控制都 ≥ 1.5、t ≥ 2、两段都 ≥ 1.3，≥ $2B 两种都 ≥ 1.3</span></td><td>${k === "lite" ? ok(v.ok) : `<span class="chip">只报告</span>${v.ok ? '<div class="small muted">数值达标，但为看过结果后挑出，不作判定</div>' : ""}`}</td></tr>`).join("");
  const rs = m.risk_source;
  const rsr = (v) => `比 ${num(v.ratio, 2)}（前 ${num(v.ratio_early, 2)} / 后 ${num(v.ratio_late, 2)}；t ${num(v.diff?.t, 1)}）`;
  const src = rs
    ? [
        ...Object.entries(rs.part1b || {}).map(([tg, v]) => `<tr><td>价格风险加入近 3 个月波动 → ${tg === "fvol" ? "之后 3 个月实际波动" : "之后半年最大回撤"}</td><td>排序相关 ${num(v.risk3.mean, 3)} → ${num(v.risk4.mean, 3)}（提高 ${num(v.gain.full, 3)}；前 ${num(v.gain.early, 3)} / 后 ${num(v.gain.late, 3)}；标准：都 ≥ 0.02）</td><td>${ok(rs.part1b_ok)}</td></tr>`),
        ...Object.entries(rs.part1 || {}).map(([k, v]) => `<tr><td>风险来源 · ${esc(v.name)}最高 20% → 之后半年跌超 40%</td><td>回归控制价格风险：${rsr(v.ctrl_risk)}${v.ctrl_risk_vtot ? `<br>再控制近 3 个月总波动：${rsr(v.ctrl_risk_vtot)}` : ""}</td><td>${k === "v_ind" ? ok(v.ctrl_risk_vtot?.ok) : '<span class="chip">只报告</span>'}</td></tr>`),
        ...Object.entries(rs.part2 || {}).map(([k, v]) => `<tr><td>行业拥挤度 · ${k === "abn" ? "组内同涨同跌相对此前一年的变化" : "组内同涨同跌水平（只报告）"}最高 20% → 之后半年行业组合跌超 25%</td><td>回归控制行业波动与回撤：${rsr(v)}（每周约 ${num(rs.part2_groups_per_week, 0)} 个行业）</td><td>${k === "abn" ? ok(v.ok) : '<span class="chip">只报告</span>'}</td></tr>`),
      ].join("")
    : "";
  const ps = Object.entries(m.persistence || {}).map(([k, v]) => `<tr><td>分散度 · ${k === "corr" ? "过去 1 年相关 → 之后 3 个月相关" : "下行相关（大盘下跌日）的持续性"}</td><td>排序相关 ${num(v.mean, 2)}（t ${num(v.t, 0)}；前 ${num(v.early?.mean, 2)} / 后 ${num(v.late?.mean, 2)}；标准 ≥ 0.5）</td><td>${ok(v.ok)}</td></tr>`).join("");
  const gcr = Object.entries(m.growth_capital || {}).flatMap(([dim, rows]) => rows.filter((r) => r.key === dim || r.key === "issue")
    .map((r) => `<tr><td>${esc(r.name)} · ${r.h} 周</td><td>同板块内比较，IC ${r.mean >= 0 ? "+" : ""}${num(r.mean, 3)}（t ${num(r.t, 1)}；前 ${num(r.early.t, 1)} / 后 ${num(r.late.t, 1)}${dim === "capital" ? "；方向：越少越好" : ""}）</td><td>${ok(r.verdict === "useful")}</td></tr>`)).join("");
  return `<section class="card"><h3>多维评分检验（大盘股） ${badge("derived")}</h3>
    <p class="muted">参照池 = 每个历史时点市值 ≥ $10B、股价 ≥ $5 的美股（每周约 ${num(m.per_week, 0)} 只，与选股池相当；排除金融 / 房地产），2012 年起每周；标准均在看结果前写入 PROGRESS（M91）。</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>检验</th><th>结果</th><th>判定</th></tr></thead><tbody>${tr}${rk}${ps}${q}${ds}${cr}${cdr}${strict}${src}${gcr}</tbody></table></div>
    <p class="small muted">已上线：短期综合得分（默认 1 周）、价格风险、与持仓的关系（分散度）、股本变化（6–12 个月）。成长与盈利动量、资本配置综合未通过，不上线。质量只作描述性画像；价格风险加入近 3 个月波动（M97 检验通过）；拥挤度只作参考（第二版回撤提示 1.49 倍、大盘回调时 1.34 倍；精简版（特质波动 + MAX）在更严格的回归控制下 1.44 倍，均未达 1.5 倍标准）；财务困境在价格风险之外只多提示一到两成风险，不在个股页提示。</p></section>`;
}

PAGES.evidence = async () => {
  const d = await load("evidence_tests.json");
  app().innerHTML = `<h2>证据检验 <span class="muted small">哪些证据对 1 周 – 3 个月的判断真的有用</span></h2>
    ${etP1(d.p1)}${etM91(d.m91)}${etLedger(d.ledger)}
    <h3 class="section-title">其他已检验的研究（行业研究相关，期限多为 6–12 个月）</h3>
    <div id="et-hard">${empty("加载中…")}</div>`;
  // 财报硬数据回测、全市场大样本重测、细分找规律（hard_page.js；M87 从技术页移来）
  hardBacktestHtml().then((h) => { const el = byId("et-hard"); if (el) el.innerHTML = h || empty("尚无数据"); }).catch(() => {});
};
