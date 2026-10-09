"use strict";
/* 产业链页“高成长科技股候选池”（data/growth.json，每周扫描）：
   全市场科技股（Nasdaq 筛选器：科技 / 电信板块，其他板块看研发投入）→ 市值与成交额门槛 → SEC 财务成长指标 + 相对强度
   → 在全部参与比较的股票（候选 + 选股池）中按百分位打分；附时点正确的历史回测。
   与 AI 候选池共用审核按钮（candReview）与审核记录。 */

const GROWTH_COMP = { growth: "收入增速", accel: "收入加速", gross_margin: "毛利率", op_leverage: "经营杠杆", rule40: "Rule of 40", rs: "相对强度" };
const GROWTH_W_KEY = "invest.growth.weights";
let GROWTH_STATE = { filter: "pending", all: false, uni: true };

const GROWTH_METHOD = [
  ["growth", "近 4 季收入合计（TTM）同比增速（SEC 季报；没有季报的外国公司用年报）。", "高",
    "真实收入、首次披露口径；但收购会抬高增速（不区分内生增长）；基数小的公司增速天然高；没有季报的外国公司数据最多滞后一年。"],
  ["accel", "本期同比增速 − 一年前的同比增速（增速在加快还是放缓）。", "中",
    "加速往往领先于股价重估，但也可能来自收购、疫情后复苏或行业周期反弹；历史不足两年的公司按 0 分。"],
  ["gross_margin", "毛利率水平（占 70%）+ 毛利率同比变化（占 30%）；毛利 = 毛利润，或收入 − 营业成本。", "中–高",
    "反映产品定价权与商业模式（软件高、硬件低），不同行业之间不完全可比；不披露毛利的公司（如部分平台、金融科技）按 0 分。"],
  ["op_leverage", "营业利润率同比变化：规模扩大时利润率是否提升。", "中",
    "一次性费用（重组、减值、股权激励大幅波动）会造成噪音；亏损公司亏损收窄也会得高分。"],
  ["rule40", "收入增速 + 自由现金流率（经营现金流 − 资本支出，占收入）：常用于衡量成长与盈利是否平衡，≥ 40% 被视为优秀。", "中",
    "原本用于软件公司；重资产行业（半导体制造、数据中心）资本支出大，自由现金流率天然低；营运资金波动会影响单季现金流。"],
  ["rs", "近 {RS} 个月股价涨幅 − SPY 同期涨幅：市场是否已在认可。", "中",
    "滞后指标、容易追高；反映的是已经发生的重估，与基本面指标互补。"],
];

function growthWeights(def) {
  try { const w = JSON.parse(localStorage.getItem(GROWTH_W_KEY) || "null"); if (w && Object.keys(GROWTH_COMP).every((k) => isNum(w[k]))) return w; } catch { /* 忽略 */ }
  return { ...def };
}
function growthScore(r, w) {
  const ks = Object.keys(GROWTH_COMP), ws = ks.reduce((a, k) => a + (w[k] || 0), 0);
  return ws > 0 ? (ks.reduce((a, k) => a + (w[k] || 0) * (r.components[k] ?? 0), 0) / ws) * 100 : 0;
}

function growthBacktestHtml(bt) {
  if (!bt?.summary?.months) return `<p class="muted">回测尚未运行（每周与扫描一起更新）。</p>`;
  const s = bt.summary, ic = s.ic, a = s.annual;
  const icRow = (name, x) => `<td>${esc(name)}</td>${[1, 6, 12].map((h) => { const v = x?.[h]; return `<td class="num ${cls(v?.mean)}">${v?.mean == null ? "–" : `${num(v.mean, 3)}${v.t != null ? `<span class="muted">（t ${num(v.t, 1)}）</span>` : ""}`}</td>`; }).join("")}`;
  const compIc = Object.keys(GROWTH_COMP).map((k) => { const x = s.component_ic?.[k] || {}; return `<tr><td><span class="cand-dot g-${k}"></span>${GROWTH_COMP[k]}</td><td class="num ${cls(x[1]?.mean)}">${x[1]?.mean == null ? "–" : num(x[1].mean, 3)}</td><td class="num ${cls(x[12]?.mean)}">${x[12]?.mean == null ? "–" : num(x[12].mean, 3)}</td></tr>`; }).join("");
  const years = Object.entries(s.by_year || {});
  // 自动结论：哪些单项在 12 个月上统计可靠（t > 2）、哪些接近 0
  const strong = Object.keys(GROWTH_COMP).filter((k) => (s.component_ic?.[k]?.[12]?.t ?? 0) > 2).map((k) => GROWTH_COMP[k]);
  const weak = Object.keys(GROWTH_COMP).filter((k) => Math.abs(s.component_ic?.[k]?.[12]?.mean ?? 0) < 0.01).map((k) => GROWTH_COMP[k]);
  const q = s.quintiles || [], mono = q.length === 5 && q.every((v, i) => i === 0 || v >= q[i - 1] - 0.005);
  const verdict = `<p><b>结论</b>：得分前 ${s.top_n} 只年化 ${pct(a.top, 1)}，比全部可选科技股等权高 ${pp(a.top - a.pool).replace(" 个百分点", "")} 个百分点，但波动与回撤也更大；五等分${mono ? "大致单调" : "并不单调"}（超额主要来自得分最高的一组）；总分 IC ${num(ic[1]?.mean, 3)}（t ${num(ic[1]?.t, 1)}）${(ic[1]?.t ?? 0) > 2 ? "统计上显著" : "统计上不显著"}。${strong.length ? `单项中 ${strong.join("、")} 在 12 个月上统计可靠（t > 2）` : "没有单项在 12 个月上统计可靠"}${weak.length ? `；${weak.join("、")} 单独几乎没有预测力（IC 接近 0）` : ""}。可以用上方权重调节器提高可靠项的权重，但按回测结果调权重本身有过拟合风险。</p>`;
  return `<p class="muted">${esc(s.period[0])} 至 ${esc(s.period[1])}，共 ${s.months} 个月；每月末用<b>当时已披露</b>的财报与当时的价格打分（与上表同一套代码与默认权重），在当时市值 ≥ ${capFmt(bt.min_cap)} 美元的科技股中（平均 ${num(s.avg_eligible, 0)} 只）买入得分前 ${s.top_n} 只、等权、持有一个月。</p>
    <div class="grid two">
      <div><div id="growth-bt-chart" class="chart"></div></div>
      <div><div class="table-wrap"><table><thead><tr><th></th><th class="num">年化收益</th><th class="num">年化波动</th><th class="num">最大回撤</th></tr></thead><tbody>
        <tr><td><b>得分前 ${s.top_n} 只</b></td><td class="num">${pct(a.top, 1)}<br><span class="muted">扣成本约 ${pct(s.annual_top_net, 1)}</span></td><td class="num">${pct(s.vol.top, 0)}</td><td class="num neg">${pct(s.max_dd.top, 0)}</td></tr>
        <tr><td>全部可选科技股等权</td><td class="num">${pct(a.pool, 1)}</td><td class="num">${pct(s.vol.pool, 0)}</td><td class="num neg">${pct(s.max_dd.pool, 0)}</td></tr>
        <tr><td>SPY</td><td class="num">${pct(a.spy, 1)}</td><td class="num">${pct(s.vol.spy, 0)}</td><td class="num neg">${pct(s.max_dd.spy, 0)}</td></tr></tbody></table></div>
        <p class="muted">逐月跑赢全部可选股票的比例 ${pct(s.beat_pool, 0)}、跑赢 SPY ${pct(s.beat_spy, 0)}；每月平均换手 ${pct(s.turnover, 0)}（成本按单边 ${pct(s.cost_per_side, 1)} 估算）。</p>
        <p><b>按得分五等分</b>（低 → 高）的年化收益：${(s.quintiles || []).map((q, i) => `<span class="chip ${i === 4 ? "on" : ""}">Q${i + 1} ${pct(q, 1)}</span>`).join(" ")}</p></div></div>
    ${verdict}
    <div class="grid two"><div><div class="table-wrap"><table><thead><tr><th>总分与未来收益的秩相关（IC）</th><th class="num">1 个月</th><th class="num">6 个月</th><th class="num">12 个月</th></tr></thead>
      <tbody><tr>${icRow("总分", ic)}</tr></tbody></table></div>
      <div class="table-wrap"><table><thead><tr><th>单项指标的 IC</th><th class="num">1 个月</th><th class="num">12 个月</th></tr></thead><tbody>${compIc}</tbody></table></div></div>
      <div>${years.length ? `<div class="table-wrap"><table><thead><tr><th>年份</th><th class="num">前 ${s.top_n} 只</th><th class="num">可选股票等权</th><th class="num">SPY</th></tr></thead><tbody>
        ${years.map(([y, v]) => `<tr><td>${esc(y)}</td><td class="num ${v.top > v.pool ? "pos" : "neg"}">${pct(v.top, 0)}</td><td class="num">${pct(v.pool, 0)}</td><td class="num">${pct(v.spy, 0)}</td></tr>`).join("")}</tbody></table></div>` : ""}</div></div>
    <p class="muted">怎么读：IC 是每月“得分排名”与“之后收益排名”的相关系数，> 0 说明得分高的股票之后平均涨得更多；单个股票因子的 IC 通常只有 0.02–0.05，t 值 > 2 才算统计上可靠（6 / 12 个月的样本相互重叠，t 值偏高）。<b>已知偏差</b>：股票池来自现在仍上市的公司（股票池 ${bt.pool_size} 只，当前市值 ≥ ${capFmt(bt.min_cap_now)} 美元），被收购或退市的公司不在其中，所有组合的收益都偏乐观——更应看“前 ${s.top_n} 只”与“全部可选股票等权”之间的差距，以及五等分是否单调；历史财报来自 SEC 首次披露数值，只有年报的外国公司数据更滞后；Yahoo 兜底数据不进入回测。过去有效不代表未来有效。</p>`;
}

async function drawGrowth() {
  const host = byId("growth-card");
  if (!host) return;
  const d = await load("growth.json").catch(() => null);
  if (!d?.candidates) { host.innerHTML = `<h3>高成长科技股候选池</h3>${empty("尚未扫描（每周日自动更新）")}`; return; }
  const uniRows = (d.universe || []).map((r) => ({ ...r, group: "universe" }));
  const status = (r) => (r.group === "universe" || r.in_universe ? "add" : r.review?.action || "pending");
  const counts = { pending: 0, watch: 0, add: 0, ignore: 0 };
  d.candidates.forEach((r) => { counts[status(r)] = (counts[status(r)] || 0) + 1; });
  const seg = [["pending", "待审核"], ["watch", "已关注"], ["add", "已加入"], ["ignore", "已忽略"], ["all", "全部"]];
  const th = d.thresholds;
  host.innerHTML = `<h3>高成长科技股候选池 ${badge("fact")}${badge("derived")}<span class="muted" style="font-weight:400"> 扫描于 ${esc(d.generated)} · ${d.stats.passed} 只通过门槛，显示前 ${d.max_candidates}</span></h3>
    <p class="muted">不看 AI 关键词，只看<b>发展快不快、质量好不好、市场是否认可</b>，用来发现 AI 以外的高成长科技股。范围：全部美国上市股票（含 ADR，来自 Nasdaq 股票筛选器）中，${esc(d.sectors_always.join("、"))} 板块全部纳入；${esc(d.sectors_if_rnd.join("、"))} 板块只纳入研发投入 ≥ 收入 ${pct(th.min_rnd_intensity, 0)} 的公司（如亚马逊、优步、特斯拉），另外 ${esc(d.industries_always.join("、"))} 行业直接纳入。门槛：市值 ≥ ${capFmt(th.min_market_cap)} 美元、近 3 个月日均成交额 ≥ ${num(th.min_dollar_volume / 1e6, 0)} 百万美元。财务数据来自 SEC（首次披露口径）${d.stats.yahoo_fallback ? `，${d.stats.yahoo_fallback} 只 SEC 没有近期数据的改用 Yahoo 年报` : ""}。</p>
    ${manualTodoHtml(d.manual_todo)}
    <details class="howto"><summary>六项指标怎么算、可信度如何</summary>
      <div class="table-wrap"><table class="cand-method"><thead><tr><th style="width:12%">指标</th><th>怎么算</th><th style="width:7%">可信度</th><th style="width:40%">已知问题</th></tr></thead><tbody>
      ${GROWTH_METHOD.map(([k, how, rel, issue]) => `<tr><td><span class="cand-dot g-${k}"></span><b>${GROWTH_COMP[k]}</b></td><td>${esc(how.replace("{RS}", d.rs_months))}</td><td><b>${esc(rel)}</b></td><td class="muted">${esc(issue)}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted">每项先在全部参与比较的股票（候选 + 选股池）中排百分位（0–100%，最好的为 100%），缺数据按 0 分；总分 = 六项按权重加权平均 × 100。百分位是相对排名：同一家公司的分数会随其他公司变化。这个得分只看成长与质量，<b>不看估值</b>——高成长股往往估值也高，需要结合个股页的估值曲线判断。</p></details>
    <details class="howto" id="growth-bt"><summary>历史回测：得分高的股票之后是否涨得更多</summary>${growthBacktestHtml(d.backtest)}</details>
    <div class="cand-weights"><b>权重</b> <span class="muted">（拖动即时重算；只影响本页显示，记在这台设备）</span>
      ${Object.keys(GROWTH_COMP).map((k) => `<label class="cand-w"><span class="cand-dot g-${k}"></span>${GROWTH_COMP[k]} <input type="range" min="0" max="50" step="5" data-gw="${k}"><b data-gwv="${k}"></b></label>`).join("")}
      <button type="button" class="ghost sm" id="growth-w-reset">恢复默认（${Object.keys(GROWTH_COMP).map((k) => d.weights[k] ?? 0).join(" / ")}）</button></div>
    <div class="row"><div class="seg" id="growth-f">${seg.map(([k, n]) => `<button type="button" data-v="${k}" class="${GROWTH_STATE.filter === k ? "on" : ""}">${n}${k !== "all" ? `（${counts[k] || 0}）` : ""}</button>`).join("")}</div>
      <label><input type="checkbox" id="growth-uni" ${GROWTH_STATE.uni ? "checked" : ""}> 同时显示选股池（${uniRows.length} 只，对比）</label></div>
    <div id="growth-body"></div>`;

  let W = growthWeights(d.weights);
  const total = () => Object.values(W).reduce((a, b) => a + b, 0) || 1;
  const sync = () => {
    host.querySelectorAll("[data-gw]").forEach((el) => { el.value = W[el.dataset.gw]; });
    host.querySelectorAll("[data-gwv]").forEach((el) => { el.textContent = `${W[el.dataset.gwv]}（${Math.round((W[el.dataset.gwv] / total()) * 100)}%）`; });
  };
  const bar = (r) => `<div class="cand-bar" title="${esc(Object.entries(r.components).map(([k, v]) => `${GROWTH_COMP[k]}：${Math.round(v * 100)}%`).join("\n"))}">
      ${Object.entries(r.components).map(([k, v]) => `<span class="g-${k}" style="width:${(v * W[k]) / total() * 100}%"></span>`).join("")}</div>`;
  const mv = (v, signed = false) => `<span class="${signed ? cls(v) : ""}">${pct(v, 0, signed)}</span>`;
  const row = (r, i) => {
    const m = r.metrics || {}, st = status(r), isUni = r.group === "universe";
    const basis = m.basis === "annual" ? "年报" : m.basis === "yahoo_annual" ? "Yahoo 年报" : "近 4 季";
    return `<tr class="${st === "ignore" ? "muted" : ""} ${isUni ? "uni-row" : ""}"><td class="num">${i + 1}</td>
      <td><b>${esc(r.ticker)}</b>${isUni ? ' <span class="chip on">选股池</span>' : ""} <span class="muted">${esc((r.name || "").slice(0, 40))}</span><br><span class="muted">${esc(r.industry || r.sector || "")}${r.country && r.country !== "United States" ? ` · ${esc(r.country)}` : ""}</span></td>
      <td class="num">${capFmt(r.market_cap)}</td><td class="num"><b>${num(r._score, 0)}</b>${bar(r)}</td>
      <td class="wrap"><span class="muted">${r.metrics ? `${basis}（截至 ${esc(m.end)}）` : "无近期财务数据"}</span><br>
        收入 ${mv(m.growth, true)}<span class="muted">（上年 ${pct(m.growth_prev, 0, true)}）</span> · 毛利率 ${mv(m.gm)}<span class="muted">（${isNum(m.gm_chg) ? pp(m.gm_chg) : "–"}）</span><br>
        营业利润率 ${mv(m.om)}<span class="muted">（${isNum(m.op_leverage) ? pp(m.op_leverage) : "–"}）</span> · FCF 率 ${mv(m.fcf_margin)} · Rule of 40 <b>${pct(m.rule40, 0)}</b><br>
        <span class="muted">研发 / 收入 ${pct(m.rnd, 0)} · 近 ${d.rs_months} 个月相对 SPY</span> ${mv(r.rs, true)}</td>
      <td>${!isUni && st !== "pending" ? `<span class="chip ${st === "add" ? "on" : ""}">${CAND_REVIEW_ZH[st] || st}</span>` : ""}
        ${isUni || r.in_universe ? `<a href="#/stock/${esc(r.ticker)}">个股页</a>` : `<div class="cand-act cand-quick" data-t="${esc(r.ticker)}">
          ${st !== "watch" ? '<button type="button" class="ghost sm" data-act="watch">关注</button>' : ""}
          ${st !== "ignore" ? '<button type="button" class="ghost sm" data-act="ignore">忽略</button>' : ""}
          ${st !== "pending" ? '<button type="button" class="ghost sm" data-act="reset">撤销</button>' : ""}
          <button type="button" class="ghost sm cand-open">加入选股池…</button></div>
          <div class="cand-act g-add" data-t="${esc(r.ticker)}" hidden>
            <select class="cand-theme">${META.themes.map((t) => `<option value="${t.key}" ${t.key === r.suggested_theme ? "selected" : ""}>${esc(t.name)}${t.key === r.suggested_theme ? "（建议）" : ""}</option>`).join("")}</select>
            <input class="cand-name" value="${esc(r.suggested_name_zh || "")}" placeholder="中文名（可不填）" maxlength="30" style="width:120px" data-en="${esc((r.name || r.ticker).replace(/,? (Inc|Corp|Corporation|Ltd|Holdings?|Group|plc|N\.V|S\.A)\.?$/i, "").slice(0, 30))}">
            ${candTagPicker(r)}
            <button type="button" class="primary sm" data-act="add">加入</button></div>
          <a class="muted" href="https://finance.yahoo.com/quote/${esc(r.ticker)}" target="_blank" rel="noopener">Yahoo</a>`}</td></tr>`;
  };
  const renderTable = () => {
    const cands = d.candidates.filter((r) => GROWTH_STATE.filter === "all" || status(r) === GROWTH_STATE.filter);
    const all = [...cands, ...(GROWTH_STATE.uni ? uniRows : [])];
    all.forEach((r) => { r._score = growthScore(r, W); });
    all.sort((a, b) => b._score - a._score);
    const shown = GROWTH_STATE.all ? all : all.slice(0, 40);
    byId("growth-body").innerHTML = `<div class="table-wrap"><table class="cand-table"><colgroup><col style="width:4%"><col style="width:22%"><col style="width:9%"><col style="width:10%"><col style="width:39%"><col style="width:16%"></colgroup>
      <thead><tr><th class="num">#</th><th>公司</th><th class="num">市值（美元）</th><th class="num">得分</th><th>成长指标（括号内为同比变化）</th><th>审核</th></tr></thead>
      <tbody>${shown.map(row).join("") || `<tr><td colspan="6" class="muted">没有符合条件的候选</td></tr>`}</tbody></table></div>
      ${all.length > shown.length ? `<p><button type="button" class="ghost" id="growth-more">显示全部 ${all.length} 只</button></p>` : ""}`;
    byId("growth-more")?.addEventListener("click", () => { GROWTH_STATE.all = true; renderTable(); });
    host.querySelectorAll(".cand-act button[data-act]").forEach((b) => (b.onclick = () => candReview(b)));
    host.querySelectorAll(".cand-open").forEach((b) => (b.onclick = () => {
      const box = b.closest("td").querySelector(".g-add");
      box.hidden = false;
      b.closest(".cand-quick").hidden = true;
      box.querySelector(".cand-name")?.focus();
    }));
  };
  host.querySelectorAll("[data-gw]").forEach((el) => (el.oninput = () => {
    W = { ...W, [el.dataset.gw]: +el.value };
    try { localStorage.setItem(GROWTH_W_KEY, JSON.stringify(W)); } catch { /* 忽略 */ }
    sync(); renderTable();
  }));
  byId("growth-w-reset").onclick = () => { W = { ...d.weights }; try { localStorage.removeItem(GROWTH_W_KEY); } catch { /* 忽略 */ } sync(); renderTable(); };
  host.querySelectorAll("#growth-f button").forEach((b) => (b.onclick = () => {
    GROWTH_STATE = { ...GROWTH_STATE, filter: b.dataset.v, all: false };
    host.querySelectorAll("#growth-f button").forEach((x) => x.classList.toggle("on", x === b));
    renderTable();
  }));
  byId("growth-uni").onchange = (e) => { GROWTH_STATE.uni = e.target.checked; renderTable(); };
  sync(); renderTable();
  // 回测曲线：展开时再画（折叠状态下宽度为 0）
  const bt = d.backtest;
  byId("growth-bt")?.addEventListener("toggle", (e) => {
    const el = byId("growth-bt-chart");
    if (!e.target.open || !el || el.dataset.done || !bt?.curve) return;
    el.dataset.done = "1";
    const p = palette(), c = bt.curve;
    mkChart(el, {
      legend: { top: 4, data: [`得分前 ${bt.summary.top_n} 只`, "可选科技股等权", "SPY"] }, grid: { left: 56, right: 24, top: 56, bottom: 40 },
      xAxis: { type: "time" }, yAxis: { type: "log", name: "累计净值（对数）", scale: true },
      series: [["top", `得分前 ${bt.summary.top_n} 只`, p[0], 2.4], ["pool", "可选科技股等权", p[2], 1.6], ["spy", "SPY", p[7], 1.6]]
        .map(([k, n, col, w]) => ({ name: n, type: "line", showSymbol: false, color: col, lineStyle: { width: w }, data: c.dates.map((x, i) => [x, c[k][i]]) })),
    });
  });
}
