/* 总览（首页）：只放事实与高置信信息。
   顺序（M87 按作用大小重排）：市场现状（AI 每日归纳）→ 我的持仓 → 近期日程（含财报期权预期波动）→ 短期信号极端名单 → 近期要闻 / 本周涨跌 → 市场 → 内部人买入。
   “本周目标价变动”已删除（检验无效）；“回调期间相对强弱”移到 市场 → 相对表现。
   持仓数据只在本机计算：本机账本优先，否则用个人数据包里的账本（解锁后），都没有时提示录入。 */

const HOME_HOWTO = [
  "首页只放[[fact|事实]]与高置信度的信息：你的账户与持仓（由你的交易记录推算）、未来几周的财报 / 除息 / 宏观日程、市场行情，以及最近的新闻。",
  "“持仓走势与成本价”每张小图是一只持仓近 6 个月的实际价格，横线是你的[[avg_cost|平均成本]]：价格在线上方 = 浮盈。",
];
const SCHED_ZH = { earnings: "财报", ex_dividend: "除息", fomc: "FOMC", cpi: "CPI", nfp: "非农", ppi: "PPI", pce: "PCE", gdp: "GDP",
  jolts: "就业", retail: "消费", umich: "信心", claims: "就业", ism: "PMI", minutes: "FOMC", opex: "期权", holiday: "休市", kr_export: "产业", tw_rev: "产业", conf: "大会" };
const SCHED_LOW_KEY = "invest.sched_low"; // 是否显示次要日程（每周初请失业金、月度期权到期等）

// 当前账本：本机账本优先，否则个人数据包里的账本（只读，不写入本机）
function currentLedger() {
  const start = loadReconStart();
  if (start) return { start, trades: loadTrades(), source: "本机账本" };
  if (personalOn() && window.PERSONAL.ledger) return { start: window.PERSONAL.ledger.start, trades: window.PERSONAL.ledger.trades, source: "个人数据包" };
  return null;
}
async function currentBook() {
  const led = currentLedger();
  if (!led) return null;
  const { P, raw } = await simData();
  try {
    return { P, raw, led, book: Recon.ledgerBook(P, raw, led.start, led.trades, { cashInterest: HOLD_CFG.cashInterest }) };
  } catch (e) { console.error(e); return { P, raw, led, error: e.message }; }
}

PAGES.overview = async () => {
  const [h, mine, mb] = await Promise.all([load("home.json"), currentBook(), load("market_brief.json").catch(() => null)]);
  const held = new Set((mine?.book?.rows || []).map((r) => r.ticker));
  const watch = new Set(META.universe.filter((u) => u.watchlist).map((u) => u.ticker));
  app().innerHTML = `
    <h2>总览 <span class="muted">行情截至 ${esc(h.asof)} 收盘</span></h2>
    ${marketBriefCard(mb, h.asof)}
    ${howto(HOME_HOWTO)}${insightBox(homeInsights(h, mine, held), 6)}
    ${homeHoldings(mine)}
    ${homeSchedule(h, held, watch)}
    <section class="card" id="se-home" hidden></section>
    <div class="grid two">
      ${card("近期要闻", homeHeadlines(h, held), "", ["fact", "model"])}
      ${card("选股池本周涨跌（近 5 个交易日）", homeMovers(h, held), "", ["fact"])}
    </div>
    <section class="card"><h3>市场 ${badge("fact")}</h3>${homeMarket(h)}</section>
    ${homeInsiderBuys(h, held, watch)}`;
  if (mine?.book) drawHomeHoldings(mine);
  drawSparks(h);
  fillShortExtremes(held); // 短期信号极端名单（M87，short_evidence.js）
  byId("sched-low-btn")?.addEventListener("click", (ev) => {
    const on = byId("sched-card").classList.toggle("show-low");
    try { localStorage.setItem(SCHED_LOW_KEY, on ? "1" : "0"); } catch { /* 无存储时只本次生效 */ }
    const n = document.querySelectorAll("#sched-card span.sched-low").length;
    ev.target.textContent = on ? "收起次要事件" : `显示次要事件（${n}）`;
  });
};

function homeInsights(h, mine, held) {
  const out = [];
  const a = mine?.book?.account;
  if (a) {
    out.push({ level: "info", kind: "fact", text: `账户 ${a.asof} 收盘 ${money(a.total_value)}，当日 ${signed(a.day_change)}（${pct(a.day_pct, 2, true)}）；自 ${a.start_date} 起[[twr|时间加权收益]] ${pct(a.twr, 1, true)}。` });
  }
  const soon = (h.schedule || []).filter((e) => e.ticker && held.has(e.ticker) && e.kind === "earnings");
  if (soon.length) {
    const days = (d) => Math.round((new Date(`${d}T12:00:00Z`) - new Date(`${h.asof}T12:00:00Z`)) / 864e5);
    out.push({ level: "high", kind: "fact", text: `你持有的 ${soon.slice(0, 4).map((e) => `${e.ticker}（${e.date}，${days(e.date)} 天后${e.exp_move ? `，期权预期 ±${pct(e.exp_move.move, 0)}` : ""}）`).join("、")} 即将发布财报：财报前后是个股波动最大的时候。` });
  }
  const spy = (h.market || []).find((m) => m.ticker === "SPY");
  if (spy && isNum(spy.vs_ma200)) out.push({ level: spy.vs_ma200 < 0 ? "high" : "info", kind: "fact", text: `SPY ${spy.vs_ma200 >= 0 ? "高于" : "低于"} [[ma|200 日均线]] ${pct(Math.abs(spy.vs_ma200), 1)}，距 52 周高点 ${pct(spy.from_high, 1)}。` });
  if (h.vix && isNum(h.vix.close)) out.push({ level: h.vix.close >= 25 ? "high" : h.vix.close >= 20 ? "medium" : "info", kind: "fact", text: `[[vix|VIX]] ${num(h.vix.close, 1)}（一周 ${pct(h.vix.w1, 0, true)}）：${h.vix.close >= 25 ? "市场明显恐慌" : h.vix.close >= 20 ? "波动偏高" : "波动处于平常水平"}。` });
  const days = (d) => Math.round((new Date(`${h.asof}T12:00:00Z`) - new Date(`${d}T12:00:00Z`)) / 864e5);
  const myBuys = (h.insider_buys || []).filter((x) => held.has(x.ticker) && days(x.date) <= 30);
  if (myBuys.length) out.push({ level: "medium", kind: "fact", text: `你持有的 ${[...new Set(myBuys.map((x) => x.ticker))].join("、")} 近 30 天有内部人在公开市场买入（${myBuys.slice(0, 2).map((x) => `${x.insider}，${insiderMoney(x.value)}`).join("；")}）。` });
  const plannedSoon = (h.schedule || []).filter((e) => e.ticker && !held.has(e.ticker) && isPlanned(e.ticker) && e.kind === "earnings");
  if (plannedSoon.length) out.push({ level: "info", kind: "fact", text: `买入计划中的 ${[...new Set(plannedSoon.map((e) => e.ticker))].join("、")} 近期发布财报（${plannedSoon.slice(0, 3).map((e) => esc(e.date.slice(5))).join("、")}），可以考虑等财报后再决定是否按计划买入。` });
  const planBuys = (h.insider_buys || []).filter((x) => !held.has(x.ticker) && isPlanned(x.ticker) && days(x.date) <= 30);
  if (planBuys.length) out.push({ level: "info", kind: "fact", text: `买入计划中的 ${[...new Set(planBuys.map((x) => x.ticker))].join("、")} 近 30 天有内部人在公开市场买入。` });
  const bigMove = (mine?.book?.rows || []).filter((r) => isNum(r.day_pct) && Math.abs(r.day_pct) >= 0.05);
  for (const r of bigMove.slice(0, 2)) out.push({ level: "medium", kind: "fact", text: `持仓 ${r.ticker} 当日 ${pct(r.day_pct, 1, true)}。` });
  return out;
}

// ---------- 我的持仓 ----------
function homeHoldings(mine) {
  if (!mine) {
    return `<section class="card"><h3>我的持仓 ${badge("fact")}</h3><p>这里会显示你的账户曲线、每只持仓的走势与成本价。${personalOn() ? "" : "解锁右上角的 🔒 个人版，或"}到 <a href="#/holdings?tab=ledger">我的持仓 → 交易记录</a> 录入起始持仓与交易（数据只保存在本机浏览器）。</p></section>`;
  }
  if (mine.error) return `<section class="card"><h3>我的持仓</h3><p class="warn">账本推算失败：${esc(mine.error)}</p></section>`;
  const a = mine.book.account;
  const kpi = (label, v, sub = "", c = "") => `<div class="kpi"><span class="muted">${label}</span><b class="${c}">${v}</b>${sub ? `<span class="muted">${sub}</span>` : ""}</div>`;
  const gc = (v) => (isNum(v) ? cls(v) : "");
  const rows = mine.book.rows.filter((r) => isNum(r.market_value));
  return `<section class="card"><h3>我的持仓 ${badge("fact")}${badge("derived")}<span class="muted" style="font-weight:400"> ${esc(mine.led.source)} · 截至 ${esc(a.asof)} 收盘 · <a href="#/holdings">完整持仓 →</a></span></h3>
    <div class="kpis">
      ${kpi("账户总值", money(a.total_value))}
      ${kpi("当日", signed(a.day_change), pct(a.day_pct, 2, true), gc(a.day_change))}
      ${kpi(`总盈亏（自 ${esc(a.start_date)}）`, signed(a.total_gain), `收益率 ${pct(a.twr, 1, true)}`, gc(a.total_gain))}
      ${kpi("浮动盈亏", signed(a.unrealized), a.cost_basis > 0 ? pct(a.unrealized / a.cost_basis, 1, true) : "", gc(a.unrealized))}
      ${kpi("现金", money(a.cash), pct(a.cash / a.total_value, 1))}</div>
    <div class="row" style="margin-top:8px"><div class="seg" id="hm-cp">${[["3M", "3 个月"], ["YTD", "今年"], ["1Y", "1 年"], ["ALL", "全部"]].map(([k, n]) => `<button type="button" data-p="${k}" class="${k === "ALL" ? "on" : ""}">${n}</button>`).join("")}</div></div>
    ${chartDiv("c-hm-curve")}
    <p class="muted">蓝线 = 账户价值；灰色虚线 = 投入成本（起始价值 + 之后的净存入），两线之差就是总盈亏。</p>
    <h4>持仓走势与成本价（近 6 个月实际价格）</h4>
    <div class="spark-grid">${rows.map((r, i) => `<div class="spark-cell"><div class="spark-head"><a href="#/stock/${esc(r.ticker)}"><b>${esc(r.ticker)}</b></a> <span class="muted">${esc(META.names_zh?.[r.ticker] || "")}</span>
      <span class="num ${gc(r.unrealized_pct)}" style="float:right">${pct(r.unrealized_pct, 1, true)}</span></div>
      <div class="muted">现价 ${money2(r.price)} · <span ${r.est_cost ? `title="${esc(estCostNote(r))}"` : ""}>成本 ${r.est_cost ? "≈" : ""}${money2(r.avg_cost)}</span> · 占 ${pct(r.weight, 1)}</div>
      <div id="hm-sp-${i}" class="chart spark"></div></div>`).join("")}</div></section>`;
}

function drawHomeHoldings(mine) {
  const { P, raw, book } = mine;
  const c = book.curve;
  const draw = (period) => {
    const lastD = c.dates[c.dates.length - 1];
    const back = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
    const from = period === "ALL" ? c.dates[0] : period === "YTD" ? `${lastD.slice(0, 4)}-01-01` : back(lastD, period === "3M" ? 91 : 365);
    let k0 = Math.max(0, c.dates.findIndex((d) => d >= from));
    if (k0 > 0) k0 -= 1;
    let invested = c.value[0];
    const inv = c.flow.map((f) => (invested += f));
    mkChart(byId("c-hm-curve"), { tooltip: { trigger: "axis", valueFormatter: (v) => money(v) }, legend: { top: 0 },
      grid: { left: 70, right: 20, top: 30, bottom: 30 }, xAxis: { type: "category", data: c.dates.slice(k0), boundaryGap: false },
      yAxis: { type: "value", scale: true, axisLabel: { formatter: (v) => money(v) } },
      series: [{ name: "账户价值", type: "line", showSymbol: false, lineStyle: { width: 2 }, color: palette()[0], data: c.value.slice(k0).map((v) => +v.toFixed(2)) },
        { name: "投入成本", type: "line", step: "end", showSymbol: false, lineStyle: { width: 1.4, type: "dashed" }, color: BENCH_GRAY(), data: inv.slice(k0).map((v) => +v.toFixed(2)) }] });
  };
  draw("ALL");
  document.querySelectorAll("#hm-cp button").forEach((b) => (b.onclick = () => {
    b.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); draw(b.dataset.p);
  }));
  const n = 126; // 约 6 个月
  book.rows.filter((r) => isNum(r.market_value)).forEach((r, i) => {
    const el = byId(`hm-sp-${i}`);
    if (!el || !P.C[r.ticker]) { if (el) el.innerHTML = empty("没有行情数据"); return; }
    const px = Recon.rawPrice(P, raw, r.ticker);
    const i0 = Math.max(0, P.n - n);
    const dates = P.dates.slice(i0), vals = dates.map((_, k) => { const v = px.close(i0 + k); return isNum(v) ? +v.toFixed(2) : null; });
    const up = isNum(r.avg_cost) && isNum(r.price) && r.price >= r.avg_cost;
    const lo = Math.min(...vals.filter(isNum), r.avg_cost || Infinity), hi = Math.max(...vals.filter(isNum), r.avg_cost || -Infinity);
    mkChart(el, { animation: false, tooltip: { trigger: "axis", valueFormatter: (v) => num(v, 2) }, legend: { show: false },
      grid: { left: 4, right: 4, top: 6, bottom: 4 }, xAxis: { type: "category", data: dates, show: false, boundaryGap: false },
      yAxis: { type: "value", show: false, min: lo - (hi - lo) * 0.05, max: hi + (hi - lo) * 0.05 },
      series: [{ name: r.ticker, type: "line", showSymbol: false, lineStyle: { width: 1.5 }, color: up ? css("--pos") : css("--neg"), data: vals,
        markLine: isNum(r.avg_cost) ? { symbol: "none", silent: true, lineStyle: { color: palette()[6], type: "dashed", width: 1.2 }, label: { show: false }, data: [{ yAxis: +r.avg_cost.toFixed(2) }] } : undefined }] });
  });
}

// ---------- 日程 ----------
function homeSchedule(h, held, watch) {
  const ev = h.schedule || [];
  const mineFirst = held.size > 0;
  const tag = (e) => (e.ticker ? holdChip(e.ticker, held, watch).trim() : "");
  // 除息只列持有 / 计划 / 关注的；财报与宏观、行业事件都列
  const show = ev.filter((e) => e.kind !== "ex_dividend" || held.has(e.ticker) || isPlanned(e.ticker) || watch.has(e.ticker));
  const byDate = {};
  for (const e of show) (byDate[e.date] ||= []).push(e);
  const wd = (d) => "日一二三四五六"[new Date(`${d}T12:00:00Z`).getUTCDay()];
  const low = (e) => e.tier === "low";
  const tick = (e) => `<a href="#/stock/${esc(e.ticker)}"><b>${esc(e.ticker)}</b></a>`;
  const what = (e) => (e.kind === "earnings" || e.kind === "ex_dividend"
    ? `${tick(e)} <span class="muted">${esc(META.names_zh?.[e.ticker] || "")}</span>`
    : `${e.tier === "high" ? `<b>${esc(e.name)}</b>` : esc(e.name)}${e.ticker ? ` ${tick(e)}` : ""}`);
  const mv = (e) => (e.exp_move ? ` <span class="small exp-move" title="期权市场定价：到 ${esc(e.exp_move.expiry)}（${e.exp_move.days} 天，含财报日）股价约 1 个标准差的波动幅度（平值跨式期权估算）">预期 ±${pct(e.exp_move.move, 1)}</span>` : "");
  const line = (e) => `<span class="${low(e) ? "sched-low" : ""}"><span class="sched ${e.kind} ${e.tier || ""}">${esc(SCHED_ZH[e.kind] || e.kind)}</span> ${what(e)}${e.est ? ' <span class="muted small">（预估）</span>' : ""}${mv(e)} ${tag(e)}</span>`;
  const nLow = show.filter(low).length;
  const body = Object.keys(byDate).length
    ? `<div class="table-wrap"><table class="sched-table"><tbody>${Object.entries(byDate).map(([d, list]) => `<tr class="${list.every(low) ? "sched-low" : ""}"><td class="nowrap"><b>${esc(d.slice(5))}</b> <span class="muted">周${wd(d)}</span></td>
        <td>${list.sort((a, b) => (held.has(b.ticker) ? 1 : 0) - (held.has(a.ticker) ? 1 : 0) || (low(a) ? 1 : 0) - (low(b) ? 1 : 0)).map(line).join("<br>")}</td></tr>`).join("")}</tbody></table></div>`
    : empty(`未来 ${h.schedule_days} 天没有相关日程`);
  let showLow = false;
  try { showLow = localStorage.getItem(SCHED_LOW_KEY) === "1"; } catch { /* 无存储时默认收起 */ }
  const lowBtn = nLow ? `<button type="button" class="ghost small" id="sched-low-btn">${showLow ? "收起次要事件" : `显示次要事件（${nLow}）`}</button>` : "";
  return `<section class="card sched-card ${showLow ? "show-low" : ""}" id="sched-card"><h3>近期日程（未来 ${h.schedule_days} 天）${badge("fact")} ${lowBtn}</h3>${body}
    <p class="muted">${rich(`<b>加粗</b> = 对大盘影响最大的事件（FOMC、CPI、非农、PCE、GDP 初值等）；次要事件（每周初请失业金、月度期权到期）默认收起。财报日来自 yfinance（公司未正式公布前可能是预估日期）；“预期 ±x%”= 期权市场为财报日之后第一个到期日定价的约 1 个标准差波动幅度（含财报前的正常交易日，到期日越晚越偏大），用来估计这次财报可能带来多大的涨跌，不预测方向；除息日只列已公布的且与你相关的；FOMC、CPI / 非农 / PPI / JOLTS、GDP / PCE 来自美联储、美国劳工统计局、经济分析局官方日历，零售销售 / 消费者信心 / 初请失业金来自 FRED 发布日程；标“预估”的是按惯例推算（ISM PMI = 当月第 1 / 3 个交易日，FOMC 纪要 = 决议后 3 周，台积电月营收 = 10 日前，韩国出口 = 每月 1 日）；四巫日为季度期权与期货同日到期、标普指数季度调整生效，收盘前后成交量常放大。${mineFirst ? "“持有”按你的账本。" : ""}除息日前一天收盘持有才能拿到这次分红；除息当天股价会扣除分红金额，属于正常现象。`)}</p></section>`;
}

// ---------- 市场 ----------
function homeMarket(h) {
  const name = (t) => (META.etfs || []).find((x) => x.ticker === t)?.name_zh || "";
  const td = (v, d = 1) => `<td class="num ${cls(v)}">${pct(v, d, true)}</td>`;
  const rows = (h.market || []).map((m, i) => `<tr><td><a href="#/stock/${esc(m.ticker)}"><b>${esc(m.ticker)}</b></a> <span class="muted">${esc(name(m.ticker))}</span></td>
    <td class="num">${num(m.close, 2)}</td>${td(m.d1, 2)}${td(m.w1)}${td(m.m1)}${td(m.ytd)}${td(m.vs_ma200)}${td(m.from_high)}<td><div id="mk-sp-${i}" class="chart spark-inline"></div></td></tr>`).join("");
  const v = h.vix;
  const macro = (h.macro || []).map((x) => `<div class="kpi"><span class="muted">${esc(x.name)}</span><b>${num(x.value, x.key === "DTWEXBGS" ? 1 : 2)}${x.key === "DTWEXBGS" ? "" : "%"}</b>
    <span class="muted">一周 ${num(x.w1_change, 2, true)}${x.key === "DTWEXBGS" ? "" : " 个百分点"} · ${esc(x.date)}</span></div>`).join("");
  return `<div class="table-wrap"><table><thead><tr><th>ETF</th><th class="num">收盘</th><th class="num">当日</th><th class="num">1 周</th><th class="num">1 个月</th><th class="num">今年</th>
      <th class="num">${term("ma", "距 200 日均线")}</th><th class="num">距 52 周高点</th><th>近 3 个月</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="kpis" style="margin-top:8px">${v ? `<div class="kpi"><span class="muted">${term("vix")}</span><b>${num(v.close, 1)}</b><span class="muted">一周 ${pct(v.w1, 0, true)} · ${esc(v.date)}</span></div>` : ""}${macro}</div>
    <p class="muted">${rich("涨跌含分红（复权价）。[[yield_curve|利差]]为负（长端利率低于短端）历史上常出现在经济放缓之前；实际利率上升通常压制黄金与高估值成长股；美元走强对海外收入占比高的公司不利。宏观数据来自 FRED，可能比行情晚一两天。")}</p>`;
}
function drawSparks(h) {
  (h.market || []).forEach((m, i) => {
    const el = byId(`mk-sp-${i}`);
    if (!el || !m.spark?.length) return;
    const up = m.spark[m.spark.length - 1] >= m.spark[0];
    mkChart(el, { animation: false, tooltip: { show: false }, legend: { show: false }, grid: { left: 0, right: 0, top: 2, bottom: 2 },
      xAxis: { type: "category", show: false, data: m.spark.map((_, k) => k) }, yAxis: { type: "value", show: false, scale: true },
      series: [{ type: "line", showSymbol: false, lineStyle: { width: 1.2 }, color: up ? css("--pos") : css("--neg"), data: m.spark }] });
  });
}

function homeMovers(h, held) {
  const row = (m) => `<tr><td><a href="#/stock/${esc(m.ticker)}"><b>${esc(m.ticker)}</b></a> <span class="muted">${esc(META.names_zh?.[m.ticker] || "")}</span>${holdChip(m.ticker, held, null)}</td>
    <td class="num ${cls(m.w1)}">${pct(m.w1, 1, true)}</td><td class="num ${cls(m.d1)}">${pct(m.d1, 1, true)}</td></tr>`;
  const t = (title, list) => `<h4>${title}</h4><div class="table-wrap"><table><thead><tr><th>股票</th><th class="num">1 周</th><th class="num">当日</th></tr></thead><tbody>${list.map(row).join("")}</tbody></table></div>`;
  return `${t("涨幅最大", h.movers?.up || [])}${t("跌幅最大", h.movers?.down || [])}<p class="muted"><a href="#/performance">更多：相对表现 →</a></p>`;
}

function homeHeadlines(h, held) {
  const list = h.headlines || [];
  if (!list.length) return empty("最近两天没有新闻事件");
  const dir = { positive: "pos", negative: "neg" };
  return `<ul class="headlines">${list.map((e) => `<li><span class="chip">${esc(e.date.slice(5))}</span>
      <a href="#/news?date=${esc(e.date)}&event=${esc(e.id)}">${esc(e.headline)}</a>
      ${(e.tickers || []).slice(0, 3).map((t) => `<span class="muted">${esc(t)}${held.has(t) ? "（持有）" : isPlanned(t) ? "（计划）" : ""}</span>`).join(" ")}
      ${e.direction ? `<span class="${dir[e.direction] || "muted"}">${esc(DIR_ZH[e.direction] || "")}</span>` : ""}</li>`).join("")}</ul>
    <p class="muted">标题与摘要来自新闻原文；“利好 / 利空”是 AI 的判断${list.some((e) => e.tier && e.tier !== "gemini" && e.tier !== "groq") ? "（部分为规则降级）" : ""}，仅供参考。<a href="#/news">全部新闻 →</a></p>`;
}

// ---------- 内部人公开市场买入（SEC Form 4，经 yfinance）----------
const insiderMoney = (v) => (!isNum(v) || v <= 0 ? "–" : usdAmt(v, v >= 1e6 ? 1 : 0));
function homeInsiderBuys(h, held, watch) {
  const list = h.insider_buys || [];
  const head = `<h3>内部人公开市场买入（近 ${h.insider_days || 90} 天）${badge("fact")}</h3>`;
  if (!list.length) return `<section class="card">${head}${empty("选股池近期没有高管或董事在公开市场买入")}</section>`;
  const exec = /chief|ceo|cfo|president|chairman/i;
  const notable = (x) => (x.value || 0) >= 1e6 || exec.test(x.position || "");
  const tag = (t) => holdChip(t, held, watch, true);
  return `<section class="card">${head}
    <div class="table-wrap"><table><thead><tr><th>日期</th><th>股票</th><th>人员 / 职务</th><th class="num">股数</th><th class="num">金额</th><th></th></tr></thead><tbody>
    ${list.map((x) => `<tr class="${(x.value || 0) < 5e4 ? "muted" : ""}"><td class="nowrap">${esc(x.date)}</td>
      <td class="nowrap"><a href="#/stock/${esc(x.ticker)}"><b>${esc(x.ticker)}</b></a> <span class="muted">${esc(META.names_zh?.[x.ticker] || "")}</span>${tag(x.ticker)}</td>
      <td>${esc(x.insider)}<br><span class="muted">${esc(x.position || "")}${x.direct ? "" : "（间接持有）"}</span></td>
      <td class="num">${isNum(x.shares) ? Math.round(x.shares).toLocaleString() : "–"}</td><td class="num">${insiderMoney(x.value)}</td>
      <td>${notable(x) ? '<span class="chip warnchip" title="金额 ≥ $1M，或由 CEO / CFO 等核心高管买入">值得注意</span>' : (x.value || 0) < 5e4 ? '<span class="muted" title="金额很小，常见于定期小额买入，信息量低">金额很小</span>' : ""}</td></tr>`).join("")}</tbody></table></div>
    <p class="muted">${rich("高管与董事用自己的钱在公开市场买入自家股票，申报在交易后 2 个工作日内（SEC Form 4）。与卖出不同（卖出常因分散资产、缴税或事先约定的计划），买入通常意味着内部人认为股价被低估；研究中，金额较大、由核心高管买入、或多人在同一时期集中买入的情况更有信息量，但单笔买入的预测力有限，也不代表一定上涨。股票授予、行权不计入。详细记录见各股票页“内部人交易”。")}</p></section>`;
}

// ---------- 回调期间相对强弱（M79；M87 起显示在 市场 → 相对表现）----------
function homePullback(p, held) {
  if (!p?.available) return "";
  const title = "回调期间相对强弱";
  if (!p.in_pullback) {
    return card(title, `<p class="muted">${esc(p.ref_name)}（${esc(p.ref)}）距最近波段高点 ${esc(p.peak_date)} ${pct(p.ref_dd, 1, true)}，跌幅不到 ${pct(p.min_drawdown, 0)}，当前不在回调中。</p>`, "", ["fact"]);
  }
  const name = (t) => `<a href="#/stock/${esc(t)}"><b>${esc(t)}</b></a> <span class="muted">${esc(META.names_zh?.[t] || "")}</span>${holdChip(t, held, null)}`;
  const tag = (r) => esc(r.tag_name.replace(/（.*）/, ""));
  const row = (r, full) => `<tr><td>${name(r.ticker)}</td><td class="small">${tag(r)}</td>
    <td class="num ${cls(r.since_peak)}"><b>${pct(r.since_peak, 1, true)}</b></td><td class="num ${cls(r.rel)}">${pct(r.rel, 1, true)}</td>
    ${full ? `<td class="num ${cls(r.max_dd)}">${pct(r.max_dd, 1, true)}</td><td class="num ${cls(r.from_low)}">${pct(r.from_low, 1, true)}</td>` : ""}
    <td class="num ${cls(r.w1)}">${pct(r.w1, 1, true)}</td></tr>`;
  const head = (full) => `<thead><tr><th>股票</th><th>主要业务</th><th class="num">高点以来</th><th class="num">相对 ${esc(p.ref)}</th>${full ? '<th class="num">期间最大回撤</th><th class="num">自低点反弹</th>' : ""}<th class="num">近 5 日</th></tr></thead>`;
  const tbl = (rows, full = false) => `<div class="table-wrap"><table>${head(full)}<tbody>${rows.map((r) => row(r, full)).join("")}</tbody></table></div>`;
  const bench = p.benchmarks.map((b) => `${esc(b.name)} <b class="${cls(b.since_peak)}">${pct(b.since_peak, 1, true)}</b>`).join("，");
  const ctx = p.window_peak_date !== p.peak_date ? `更早的高点是 ${esc(p.window_peak_date)}，距它 ${pct(p.window_dd, 1, true)}。` : "";
  const top = p.rows.slice(0, 8), bottom = p.rows.slice(-8).reverse();
  return card(title, `
    <p>本轮起点：${esc(p.ref_name)}（${esc(p.ref)}）最近的波段高点 <b>${esc(p.peak_date)}</b>，至 ${esc(p.asof)} 共 ${p.days} 个交易日。同期 ${bench}。${ctx}
    选股池 ${p.n} 只中，${p.n_up} 只上涨，${p.n_beat} 只跑赢 ${esc(p.ref)}。</p>
    <h4>按主要业务（中位数，高点以来）</h4>${chartDiv("c-pullback", "tall")}
    <div class="grid two"><div><h4>最抗跌</h4>${tbl(top)}</div><div><h4>跌得最多</h4>${tbl(bottom)}</div></div>
    <details><summary>全部 ${p.n} 只（含期间最大回撤、自低点反弹）</summary>${tbl(p.rows, true)}</details>
    <p class="muted small">本轮高点 = 最近一个“较前一低点反弹 ≥ ${pct(p.swing_rebound, 0)}、之后再跌 ≥ ${pct(p.min_drawdown, 0)}”的 ${esc(p.ref)} 收盘高点（找不到则用近 ${p.lookback_days} 个交易日最高点）。
    期间最大回撤 = 高点日收盘到期间最低收盘；自低点反弹 = 最新收盘相对期间最低收盘。业务按个股标签的第一个（主要业务）。
    <b>抗跌不代表之后跑赢</b>：本系统检验（2,568 只美股，2012 年起，SPY 距近半年高点 ≥ 5% 的回调期）中，回调里跌得最多的五分之一之后 13 周相对全市场平均 +2.6%，最抗跌的五分之一 −1.3%，方向与“强者恒强”相反，但未达到事先定的显著标准（t −1.8）。这张卡片适合看资金在回避什么，不适合用来挑之后会领涨的股票。</p>`, "", ["fact"]);
}

function drawPullback(p) {
  const el = byId("c-pullback");
  if (!el || !p?.tags?.length) return;
  const tags = [...p.tags].reverse();  // 横向柱状图自下而上，最好的放在最上面
  el.style.height = `${Math.max(260, tags.length * 22 + 30)}px`;
  mkChart(el, {
    grid: { left: 8, right: 56, top: 24, bottom: 8, containLabel: true },
    tooltip: { trigger: "item", formatter: (x) => { const t = tags[x.dataIndex]; return `<b>${esc(t.name)}</b>（${t.n} 只）<br>高点以来中位数 ${pct(t.median, 1, true)}；自低点反弹中位数 ${pct(t.median_from_low, 1, true)}<br>${t.tickers.map(esc).join("、")}`; } },
    xAxis: { type: "value", axisLabel: { formatter: (v) => `${Math.round(v * 100)}%` } },
    yAxis: { type: "category", data: tags.map((t) => `${t.name.replace(/（.*）/, "")}（${t.n}）`), axisLabel: { fontSize: 11 } },
    series: [{ type: "bar", barMaxWidth: 14, data: tags.map((t) => ({ value: t.median, itemStyle: { color: t.color || css("--ink-2") } })),
      label: { show: true, position: "right", fontSize: 10, formatter: (x) => pct(x.value, 1, true) },
      markLine: { symbol: "none", silent: true, label: { formatter: `${p.ref} ${pct(p.ref_ret, 1, true)}`, fontSize: 10 }, lineStyle: { type: "dashed", color: css("--ink-2") }, data: [{ xAxis: p.ref_ret }] } }],
  });
}

