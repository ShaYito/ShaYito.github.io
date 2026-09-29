"use strict";
/* ETF / 大类资产页（个股页中的专用版式）：SPY / QQQ / GLD / SMH / XLC。
   通用：它是什么与在系统里的作用、K 线（背景 = 系统的市场状态）、收益与风险表、在系统里的仓位。
   专属：SPY = 市场状态三项依据 + 成分与集中度 + 现金层；QQQ / SMH / XLC = 相对 SPY 强弱 + 成分与重叠 + 主题内个股相对它；
        GLD = 实际利率 / 美元驱动 + 对冲效果 + 黄金新闻。 */

const SECTOR_ZH = { technology: "信息技术", communication_services: "通信服务", consumer_cyclical: "可选消费", consumer_defensive: "必需消费",
  financial_services: "金融", healthcare: "医疗保健", industrials: "工业", energy: "能源", utilities: "公用事业", realestate: "房地产", basic_materials: "原材料" };
const KIND_ZH = { broad: "大盘指数", growth: "成长科技指数", gold: "黄金", sector: "行业指数" };
const STATE_ORDER = ["risk_on", "neutral", "risk_off"];
function isEtf(t) { return (META.etfs || []).some((e) => e.ticker === t); }

function etfHowto(e) {
  return [
    `${e.info.what}`,
    ...e.info.read,
    "页面上每一块都标明了性质：基金资料、价格与宏观数据是[[fact|事实]]；收益、波动、相关性是[[derived|计算]]；系统仓位是[[model|模型]]给出的。成分股与行业分布来自 yfinance（每天更新一次，只有前 10 大持仓）；SPY 的成分来自 SSGA 官方完整持仓。",
  ];
}

function etfInsights(e, t) {
  const out = [];
  const st = e.stats[t] || {};
  const spy = e.stats.SPY || {};
  const last = e.ohlc[e.ohlc.length - 1]?.[1], ma200 = e.ma200[e.ma200.length - 1];
  if (isNum(last) && isNum(ma200)) out.push({ level: "info", kind: "derived", text: `当前价格${last >= ma200 ? "高于" : "低于"} [[ma|200 日均线]] ${pct(Math.abs(last / ma200 - 1), 1)}，长期趋势${last >= ma200 ? "向上" : "向下"}。` });
  if (isNum(st.dd_now) && st.dd_now < -0.1) out.push({ level: "medium", kind: "derived", text: `距历史高点回撤 ${pct(st.dd_now, 1)}（近 5 年最大回撤 ${pct(st.max_dd_5y, 1)}）。` });
  if (t !== "SPY" && isNum(st["1Y"]) && isNum(spy["1Y"])) out.push({ level: "info", kind: "derived", text: `近 1 年 ${pct(st["1Y"], 1, true)}，${st["1Y"] >= spy["1Y"] ? "跑赢" : "跑输"} SPY ${pct(Math.abs(st["1Y"] - spy["1Y"]), 1)}；年化波动 ${pct(st.vol_1y, 1)}（SPY ${pct(spy.vol_1y, 1)}）。` });
  if (e.gold) {
    const g = e.gold, a = g.worst_months_avg;
    out.push({ level: isNum(g.corr_spy_now) && g.corr_spy_now > 0.3 ? "medium" : "good", kind: "derived", text: `当前与 SPY 的 60 日[[correlation|相关系数]] ${num(g.corr_spy_now, 2)}${g.corr_spy_now > 0.3 ? "：近期和股市同涨同跌较多，分散效果变弱" : "：与股市关联较低，分散效果正常"}。` });
    if (a?.n) out.push({ level: "info", kind: "derived", text: `SPY 最差的 ${a.n} 个月里，GLD 平均 ${pct(a.gld, 1, true)}（SPY 平均 ${pct(a.spy, 1, true)}），其中 ${a.gld_up} 个月上涨。` });
  }
  if (e.members?.length) {
    const up = e.members.filter((m) => isNum(m["3M"]) && m["3M"] > 0);
    out.push({ level: "info", kind: "derived", text: `以 ${t} 为基准的 ${e.members.length} 只股票中，近 3 个月有 ${up.length} 只跑赢它${up.length ? `（最强：${up[0].ticker} ${pct(up[0]["3M"], 1, true)}）` : ""}。` });
  }
  if (e.regime_inputs?.dates?.length) {
    const r = e.regime_inputs, i = r.dates.length - 1;
    out.push({ level: "info", kind: "model", text: `系统当前判断：${REGIME_ZH[r.regime[i]] || r.regime[i]}（总分 ${num(r.score[i], 0, true)}：SPY 相对 200 日均线 ${pct(r.spy_vs_ma200[i], 1, true)}，VIX ${num(r.vix[i], 1)}，利差 ${num(r.curve[i], 2, true)}）。` });
  }
  return out;
}

async function renderEtfPage(t) {
  const e = await load(`etf/${t}.json`);
  const f = e.fund || {};
  const info = e.info;
  const subtitle = [info.name, KIND_ZH[info.kind], f.family, isNum(f.expense_ratio) ? `[[expense_ratio|费率]] ${pct(f.expense_ratio, 2)}/年` : ""].filter(Boolean).join(" · ");
  const statRows = Object.entries(e.stats);
  const cols = [["1M", "1 月"], ["3M", "3 月"], ["YTD", "今年"], ["1Y", "1 年"], ["3Y", "3 年（年化）"], ["5Y", "5 年（年化）"], ["vol_1y", "波动（1 年）"], ["max_dd_5y", "最大回撤（5 年）"], ["dd_now", "距高点"]];
  const role = e.role;
  const myW = personalOn() ? window.PERSONAL.weights?.[t] : null;
  const roleHtml = role.layer
    ? `<div class="table-wrap"><table><thead><tr><th>市场状态</th>${STATE_ORDER.map((k) => `<th class="num ${role.regime === k ? "hl" : ""}">${esc((REGIME_ZH[k] || k).split("（")[1]?.replace("）", "") || k)}${role.regime === k ? "（当前）" : ""}</th>`).join("")}</tr></thead>
        <tbody><tr><td>${esc({ core: "核心层", hedge: "对冲层" }[role.layer])}建议比例</td>${STATE_ORDER.map((k) => `<td class="num">${pct(role.regime_weights[k], 0)}</td>`).join("")}</tr></tbody></table></div>
      <p>当前建议 ${pct(role.current, 1)}${isNum(myW) ? `；你的实际比例 <b>${pct(myW, 1)}</b>` : ""}。${role.layer === "core" ? "市场越偏防守，核心仓越低、现金越高。" : "市场越偏防守，黄金对冲比例越高。"}</p>`
    : `<p>${rich(`系统不直接配置 ${t}；它是${role.benchmark_of.length ? `「${role.benchmark_of.map(themeName).join("」「")}」主题的[[benchmark|基准]]：这些主题里个股的[[relative_strength|相对强弱]]是相对它计算的。` : "业绩比较基准。"}`)}${isNum(myW) ? `你的实际比例 <b>${pct(myW, 1)}</b>。` : ""}</p>`;
  app().innerHTML = `
    <div class="stock-layout">${stockSidebar(t)}<div class="stock-main">
    <h2>${esc(t)} ${esc(info.name_zh)} <span class="muted">${rich(subtitle)}</span></h2>
    ${myPositionLine(t, e)}
    ${howto(etfHowto(e))}${insightBox(etfInsights(e, t))}
    <section class="card"><h3>它是什么 · 在系统里的作用 ${badge("fact")}${badge("model")}</h3>
      <p>${esc(info.what)}</p><p><b>在系统里：</b>${esc(info.role)}</p>${info.watch ? `<p class="muted"><b>需要关注：</b>${esc(info.watch)}</p>` : ""}</section>
    <section class="card"><h3>价格走势 ${badge("fact")}${badge("model")}</h3><p class="muted">${rich("K 线与 50 / 200 日[[ma|均线]]（复权价格）；背景色 = 系统当时判断的[[regime|市场状态]]（绿 = 进攻，黄 = 中性，红 = 防守）。")}</p>${chartDiv("c-etf-k", "tall")}</section>
    <section class="card"><h3>收益与风险（与 SPY / QQQ / GLD 并列）${badge("derived")}</h3>
      <div class="table-wrap"><table><thead><tr><th>标的</th>${cols.map(([, n]) => `<th class="num">${n}</th>`).join("")}</tr></thead>
      <tbody>${statRows.map(([k, s]) => `<tr class="${k === t ? "hl" : ""}"><td><a href="#/stock/${k}"><b>${esc(k)}</b></a></td>${cols.map(([c]) => `<td class="num ${c.startsWith("vol") ? "" : cls(s[c])}">${pct(s[c], 1, !c.startsWith("vol") && !c.startsWith("max") && c !== "dd_now")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="muted">${rich("3 年、5 年为年化收益；[[volatility|波动]]为近 1 年日收益的年化标准差；[[drawdown|回撤]]按复权价格（含分红）计算。")}</p></section>
    <section class="card"><h3>在系统里的仓位 ${badge("model")}</h3>${roleHtml}${role.layer && role.history.dates.length ? chartDiv("c-etf-role", "short") : ""}</section>
    ${info.kind === "broad" ? spyBlocks(e) : ""}${info.kind === "growth" || info.kind === "sector" ? sectorBlocks(e, t) : ""}${info.kind === "gold" ? goldBlocks(e) : ""}
    </div></div>`;
  document.querySelector(".stock-side a.on")?.scrollIntoView({ block: "nearest", inline: "center" });
  drawEtfK(e, t);
  if (role.layer && role.history.dates.length) {
    mkChart(byId("c-etf-role"), { tooltip: { trigger: "axis", valueFormatter: (v) => pct(v, 1) }, legend: { show: false }, grid: { left: 48, right: 20, top: 16, bottom: 30 },
      xAxis: { type: "category", data: role.history.dates }, yAxis: { type: "value", axisLabel: { formatter: (v) => pct(v, 0) } },
      series: [{ name: "建议比例", type: "bar", barMaxWidth: 14, color: palette()[0], itemStyle: { borderRadius: [3, 3, 0, 0] }, data: role.history.weights }] });
  }
  if (info.kind === "broad") drawSpyBlocks(e);
  if (info.kind === "growth" || info.kind === "sector") drawSectorBlocks(e, t);
  if (info.kind === "gold") drawGoldBlocks(e);
}

function drawEtfK(e, t) {
  const r = e.regimes || { dates: [], regime: [] };
  const d0 = e.dates[0], d1 = e.dates[e.dates.length - 1];
  const near = (d) => e.dates.find((x) => x >= d) || d1;
  const areas = [];
  let s = 0;
  for (let i = 1; i <= r.dates.length; i++) {
    if (i === r.dates.length || r.regime[i] !== r.regime[i - 1]) {
      const a = r.dates[s], b = i < r.dates.length ? r.dates[i] : d1;
      if (b >= d0) areas.push([{ xAxis: near(a < d0 ? d0 : a), itemStyle: { color: REGIME_COLOR[r.regime[s]], opacity: 0.08 } }, { xAxis: near(b) }]);
      s = i;
    }
  }
  mkChart(byId("c-etf-k"), {
    tooltip: { trigger: "axis", axisPointer: { type: "cross" } }, grid: { left: 56, right: 20, top: 36, bottom: 60 },
    xAxis: { type: "category", data: e.dates, boundaryGap: true }, yAxis: { type: "value", scale: true },
    dataZoom: [{ type: "inside", start: 40, end: 100 }, { type: "slider", start: 40, end: 100, height: 18, bottom: 10 }],
    series: [
      { name: t, type: "candlestick", data: e.ohlc, itemStyle: { color: css("--good"), color0: css("--bad"), borderColor: css("--good"), borderColor0: css("--bad") }, markArea: { silent: true, data: areas } },
      { name: "MA50", type: "line", showSymbol: false, data: e.ma50, color: palette()[0], lineStyle: { width: 1.4 } },
      { name: "MA200", type: "line", showSymbol: false, data: e.ma200, color: palette()[1], lineStyle: { width: 1.4 } },
    ],
  });
}

function holdingsTable(e, t) {
  if (!e.holdings?.length) return empty("暂无成分数据（数据源获取失败时显示为空）");
  const spyCol = t !== "SPY";
  const myVia = personalOn() && t === "SPY" ? window.PERSONAL.weights?.SPY : null;
  return `<div class="table-wrap"><table><thead><tr><th>成分</th><th class="num">占 ${esc(t)}</th>${spyCol ? `<th class="num">占 SPY</th>` : ""}${isNum(myVia) ? `<th class="num" title="你的 SPY 比例 × 成分权重">你经 SPY 间接持有</th>` : ""}</tr></thead><tbody>
    ${e.holdings.map((h) => `<tr><td>${h.in_universe ? `<a href="#/stock/${esc(h.ticker)}"><b>${esc(h.ticker)}</b></a>` : `<b>${esc(h.ticker)}</b>`} <span class="muted">${esc(META.names_zh?.[h.ticker] || h.name || "")}</span>${h.in_universe ? ' <span class="chip">选股池</span>' : ""}</td>
      <td class="num">${pct(h.weight, 1)}</td>${spyCol ? `<td class="num">${h.spy_weight > 0 ? pct(h.spy_weight, 1) : "–"}</td>` : ""}${isNum(myVia) ? `<td class="num">${pct(myVia * h.weight, 2)}</td>` : ""}</tr>`).join("")}</tbody></table></div>
    <p class="muted">前 10 大合计 ${pct(e.top10_sum, 1)}${spyCol ? "；“占 SPY”一栏越高，说明它和 SPY 的重叠越大、同时持有时分散效果越有限；“–”= 不在 SPY 中（如在美国上市的外国公司）" : ""}。“选股池”= 本系统也在单独跟踪的股票。</p>`;
}
function sectorChartDiv(e) { return e.fund?.sectors && Object.keys(e.fund.sectors).length ? chartDiv("c-etf-sec", "short") : empty("暂无行业数据"); }
function drawSectors(e) {
  const sec = Object.entries(e.fund?.sectors || {}).filter(([, v]) => v > 0.001).sort((a, b) => b[1] - a[1]);
  if (!sec.length || !byId("c-etf-sec")) return;
  mkChart(byId("c-etf-sec"), { tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => pct(v, 1) }, legend: { show: false },
    grid: { left: 80, right: 50, top: 8, bottom: 20 }, xAxis: { type: "value", axisLabel: { formatter: (v) => pct(v, 0) } },
    yAxis: { type: "category", inverse: true, data: sec.map(([k]) => SECTOR_ZH[k] || k) },
    series: [{ type: "bar", barMaxWidth: 14, color: palette()[0], itemStyle: { borderRadius: 3 }, data: sec.map(([, v]) => v),
      label: { show: true, position: "right", formatter: (p) => pct(p.value, 1), fontSize: 11, color: css("--ink-2"), textBorderWidth: 0 } }] });
}

// ---------- SPY ----------
function spyBlocks(e) {
  const c = e.cash;
  return `<section class="card"><h3>市场状态的三项依据 ${badge("fact")}${badge("model")}</h3>
      <p class="muted">${rich(`系统每周按三项打分，合计决定[[regime|市场状态]]：① SPY 在 200 日均线之上 +1、之下 −1；② [[vix|VIX]] 低于 ${num(e.thresholds.vix_low, 0)} +1、高于 ${num(e.thresholds.vix_high, 0)} −1；③ [[yield_curve|收益率曲线]]（10 年 − 3 个月）倒挂（< 0）−1。虚线为阈值；背景色为当时的状态。`)}</p>
      <div class="grid three">${chartDiv("c-ri-ma", "short")}${chartDiv("c-ri-vix", "short")}${chartDiv("c-ri-curve", "short")}</div></section>
    <div class="grid two"><section class="card"><h3>成分与集中度（前 10 大，SSGA 官方持仓）${badge("fact")}</h3>${holdingsTable(e, "SPY")}</section>
      <section class="card"><h3>行业分布 ${badge("fact")}</h3>${sectorChartDiv(e)}</section></div>
    ${c ? `<section class="card"><h3>现金层（${esc(c.ticker)}）${badge("fact")}${badge("model")}</h3>
      <p>${rich(`系统把没有配置出去的资金放在[[cash|现金]]（${c.ticker} 货币基金），收益按 13 周美国国债收益率（^IRX）近似。各状态下的现金比例：${STATE_ORDER.map((k) => `${(REGIME_ZH[k] || k).split("（")[1]?.replace("）", "") || k} ${pct(c.regime_weights[k], 0)}`).join(" · ")}。`)}</p>${chartDiv("c-cash", "short")}</section>` : ""}`;
}
function drawSpyBlocks(e) {
  const r = e.regime_inputs;
  const areas = [];
  let s = 0;
  for (let i = 1; i <= r.dates.length; i++) {
    if (i === r.dates.length || r.regime[i] !== r.regime[i - 1]) { areas.push([{ xAxis: r.dates[s], itemStyle: { color: REGIME_COLOR[r.regime[s]], opacity: 0.08 } }, { xAxis: r.dates[i - 1] }]); s = i; }
  }
  const small = (id, name, data, lines, fmt) => mkChart(byId(id), {
    title: { text: name, left: 0, top: 0, textStyle: { fontSize: 12, fontWeight: 500, color: css("--ink-2") } },
    tooltip: { trigger: "axis", valueFormatter: fmt }, legend: { show: false }, grid: { left: 44, right: 12, top: 28, bottom: 24 },
    xAxis: { type: "category", data: r.dates, boundaryGap: false }, yAxis: { type: "value", scale: true, axisLabel: { formatter: fmt } },
    series: [{ name, type: "line", showSymbol: false, color: palette()[0], lineStyle: { width: 1.6 }, data, markArea: { silent: true, data: areas },
      markLine: { symbol: "none", silent: true, lineStyle: { color: css("--bad"), type: "dashed" }, label: { color: css("--muted"), fontSize: 10 }, data: lines.map((y) => ({ yAxis: y })) } }],
  });
  small("c-ri-ma", "① SPY 相对 200 日均线", r.spy_vs_ma200, [0], (v) => pct(v, 0));
  small("c-ri-vix", "② VIX", r.vix, [e.thresholds.vix_low, e.thresholds.vix_high], (v) => num(v, 0));
  small("c-ri-curve", "③ 收益率曲线（百分点）", r.curve, [0], (v) => num(v, 1));
  drawSectors(e);
  if (e.cash && byId("c-cash")) mkChart(byId("c-cash"), { tooltip: { trigger: "axis", valueFormatter: (v) => pct(v, 2) }, legend: { show: false }, grid: { left: 48, right: 20, top: 12, bottom: 24 },
    xAxis: { type: "category", data: e.cash.rate.dates, boundaryGap: false }, yAxis: { type: "value", axisLabel: { formatter: (v) => pct(v, 1) } },
    series: [{ name: "年化收益率", type: "line", showSymbol: false, color: palette()[2], data: e.cash.rate.values }] });
}

// ---------- QQQ / SMH / XLC ----------
function sectorBlocks(e, t) {
  const m = e.members || [];
  return `<section class="card"><h3>${esc(t)} / SPY 相对强弱（近 3 年，起点 = 100）${badge("derived")}</h3>
      <p class="muted">${rich(`${t} 价格 ÷ SPY 价格。线往上 = ${t} 跑赢大盘，往下 = 跑输；看的是“这个板块 / 风格相对大盘处在强势还是弱势周期”。参见[[relative_strength|相对强弱]]。`)}</p>${e.vs_spy ? chartDiv("c-vs-spy", "short") : empty("暂无")}</section>
    <div class="grid two"><section class="card"><h3>成分与集中度（前 10 大）${badge("fact")}</h3>${holdingsTable(e, t)}</section>
      <section class="card"><h3>行业分布 ${badge("fact")}</h3>${sectorChartDiv(e)}</section></div>
    ${m.length ? `<section class="card"><h3>主题内个股相对 ${esc(t)} ${badge("derived")}</h3>
      <p class="muted">${rich(`以 ${t} 为基准的主题（${e.role.benchmark_of.map(themeName).join("、")}）中，每只股票近 1 / 3 个月的收益减去 ${t} 同期收益（[[excess_return|超额收益]]）。为正 = 个股跑赢板块，说明涨跌不只是板块整体在动。`)}</p>
      <div class="table-wrap"><table><thead><tr><th>股票</th><th>主题</th><th class="num">近 1 月超额</th><th class="num">近 3 月超额</th></tr></thead><tbody>
      ${m.map((x) => `<tr><td><a href="#/stock/${esc(x.ticker)}">${isHeld(x.ticker) ? "● " : ""}<b>${esc(x.ticker)}</b></a> <span class="muted">${esc(META.names_zh?.[x.ticker] || "")}</span></td><td>${esc(themeName(x.theme))}</td>
        <td class="num ${cls(x["1M"])}">${pct(x["1M"], 1, true)}</td><td class="num ${cls(x["3M"])}">${pct(x["3M"], 1, true)}</td></tr>`).join("")}</tbody></table></div></section>` : ""}`;
}
function drawSectorBlocks(e, t) {
  if (e.vs_spy && byId("c-vs-spy")) mkChart(byId("c-vs-spy"), { tooltip: { trigger: "axis", valueFormatter: (v) => num(v, 1) }, legend: { show: false }, grid: { left: 44, right: 20, top: 12, bottom: 24 },
    xAxis: { type: "category", data: e.vs_spy.dates, boundaryGap: false }, yAxis: { type: "value", scale: true },
    series: [{ name: `${t} / SPY`, type: "line", showSymbol: false, color: palette()[0], lineStyle: { width: 2 }, data: e.vs_spy.values,
      markLine: { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" }, label: { show: false }, data: [{ yAxis: 100 }] } }] });
  drawSectors(e);
}

// ---------- GLD ----------
function goldBlocks(e) {
  const g = e.gold, d = g.drivers;
  return `<section class="card"><h3>黄金的驱动因素 ${badge("fact")}${badge("derived")}</h3>
      <p class="muted">${rich("[[real_yield|实际利率]]越高，持有不生息的黄金越“吃亏”，金价通常承压，所以中间的图把实际利率倒过来画（越往上 = 实际利率越低 = 越利好黄金）；[[dollar_index|美元]]走强时，以美元计价的金价也常承压。[[correlation|相关系数]]用近 52 周的周度变化计算：负值说明“实际利率 / 美元上升时金价下跌”的关系仍然成立，越接近 −1 越明显。")}</p>
      <div class="kpis"><div class="kpi"><span class="muted">与实际利率变化的相关（1 年）</span><b>${num(d.real_yield_corr_1y, 2)}</b></div>
        <div class="kpi"><span class="muted">与美元涨跌的相关（1 年）</span><b>${num(d.dollar_corr_1y, 2)}</b></div></div>
      <div class="grid three">${chartDiv("c-g-gold", "short")}${d.real_yield ? chartDiv("c-g-ry", "short") : empty("暂无实际利率数据")}${d.dollar ? chartDiv("c-g-usd", "short") : empty("暂无美元数据")}</div></section>
    <section class="card"><h3>对冲效果：股市下跌时黄金有没有用 ${badge("derived")}</h3>
      <p class="muted">${rich("[[hedge|对冲]]的价值在于“股市跌的时候它不跟着跌”。三个角度：① 与 SPY 的滚动 60 日[[correlation|相关系数]]（越低 / 为负，分散效果越好）；② SPY 表现最差的月份里 GLD 的表现；③ SPY 历次[[drawdown|回撤]]超过 10% 期间（高点到最低点）GLD 的涨跌。")}</p>
      ${chartDiv("c-g-corr", "short")}
      <div class="grid two"><div><h4>SPY 最差的 ${g.worst_months.length} 个月</h4><div class="table-wrap"><table><thead><tr><th>月份</th><th class="num">SPY</th><th class="num">GLD</th></tr></thead><tbody>
        ${g.worst_months.map((m) => `<tr><td>${esc(m.month)}</td><td class="num neg">${pct(m.spy, 1, true)}</td><td class="num ${cls(m.gld)}">${pct(m.gld, 1, true)}</td></tr>`).join("")}</tbody></table></div></div>
      <div><h4>SPY 回撤超过 10% 的区间</h4><div class="table-wrap"><table><thead><tr><th>区间（高点 → 最低点）</th><th class="num">SPY</th><th class="num">GLD</th></tr></thead><tbody>
        ${g.drawdowns.map((x) => `<tr><td>${esc(x.start)} → ${esc(x.end)}</td><td class="num neg">${pct(x.spy, 1, true)}</td><td class="num ${cls(x.other)}">${pct(x.other, 1, true)}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">数据区间内没有</td></tr>`}</tbody></table></div></div></div>
      <p class="muted">历史表现不代表未来：上表中也有股市下跌时黄金一起下跌的时期（例如市场恐慌、大家抛售一切换现金，或利率快速上升时）。黄金更像“降低组合整体波动”的工具，而不是每次都能对冲。</p></section>
    <section class="card"><h3>黄金相关新闻（近期）${badge("fact")}</h3>${g.news.length ? `<div class="table-wrap"><table><tbody>${g.news.map((a) => `<tr><td class="num ${cls(a.sentiment)}">${num(a.sentiment, 2, true)}</td><td class="wrap"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a> <span class="muted">${esc(a.publisher || "")} · ${esc(a.date)}</span></td></tr>`).join("")}</tbody></table></div><p class="muted">${rich("左侧数字为新闻[[sentiment|情绪]]（−1 ~ 1）。")}</p>` : empty("近期没有黄金相关报道")}</section>`;
}
function drawGoldBlocks(e) {
  const g = e.gold, d = g.drivers;
  const line = (id, name, s, color, inverse = false, fmt = (v) => num(v, 1)) => mkChart(byId(id), {
    title: { text: name, left: 0, top: 0, textStyle: { fontSize: 12, fontWeight: 500, color: css("--ink-2") } },
    tooltip: { trigger: "axis", valueFormatter: fmt }, legend: { show: false }, grid: { left: 44, right: 12, top: 28, bottom: 24 },
    xAxis: { type: "category", data: s.dates, boundaryGap: false }, yAxis: { type: "value", scale: true, inverse, axisLabel: { formatter: fmt } },
    series: [{ name, type: "line", showSymbol: false, color, lineStyle: { width: 1.6 }, data: s.values }],
  });
  line("c-g-gold", "GLD（5 年前 = 100）", d.gold, palette()[3]);
  if (d.real_yield) line("c-g-ry", "10 年实际利率 %（倒置）", d.real_yield, palette()[0], true, (v) => num(v, 1));
  if (d.dollar) line("c-g-usd", "美元指数（广义）", d.dollar, BENCH_GRAY());
  mkChart(byId("c-g-corr"), { tooltip: { trigger: "axis", valueFormatter: (v) => num(v, 2) }, legend: { show: false }, grid: { left: 44, right: 20, top: 12, bottom: 24 },
    xAxis: { type: "category", data: g.corr_spy.dates, boundaryGap: false }, yAxis: { type: "value", min: -1, max: 1 },
    series: [{ name: "GLD 与 SPY 60 日相关", type: "line", showSymbol: false, color: palette()[0], data: g.corr_spy.values,
      markLine: { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" }, label: { show: false }, data: [{ yAxis: 0 }] } }] });
}
