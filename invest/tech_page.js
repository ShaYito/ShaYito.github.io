/* 技术（M48）：顶级页面。数据：technologies.json（每周 run_bottlenecks.py 生成 + 网站构建时附近期相关新闻）
   #/tech            看板：瓶颈时间线（每项技术一行）+ 技术卡片（等权走势、近 3 个月、最新信号）
   #/tech/<id>       单项技术：说明与产业链位置 → 行业信息（规模 / 份额 / 价格趋势 / 扩产时间表 / 要点）→ 信号与扩产时间线
                     → 主图（相关公司走势叠加信号，指数化 / 相对本地大盘 / 绝对价格）→ 逐家公司小图 → 公司表 → 相关新闻
   图上标记的内容显示在图下方的固定信息栏（悬停或点击更新）。 */

const TK_KIND = { leader: ["龙头表态 / 指引", "diamond"], report: ["行业报道", "circle"], price: ["提价", "triangle"], capacity: ["抢产能 / 售罄 / 协议", "rect"], order: ["订单", "pin"], product: ["产品发布", "roundRect"] };
const TK_STATUS = { ongoing: "仍紧缺", eased: "已缓解" };
const TK_MODES = [["index", "指数化（起点 = 100）"], ["rel", "相对本地大盘"], ["abs", "绝对价格"]];
const TK_STARTS = ["2020-01-01", "2022-01-01", "2023-01-01", "2024-01-01", "2025-01-01"];
const TK_PREF = "invest.tech.view";
let TK_DATA = null;

async function techData() {
  if (!TK_DATA) TK_DATA = await load("technologies.json");
  return TK_DATA?.technologies ? TK_DATA : null;
}
function techView() {
  const v = { mode: "index", start: "2023-01-01", log: true, legs: false };
  try { Object.assign(v, JSON.parse(localStorage.getItem(TK_PREF) || "{}")); } catch { /* 忽略 */ }
  return v;
}
function saveTechView(v) { try { localStorage.setItem(TK_PREF, JSON.stringify(v)); } catch { /* 忽略 */ } }

// 某公司在 [起点, ...] 的序列：index = 起点为 100；rel = 公司 ÷ 本地大盘（起点为 100）；abs = 当地货币价格
function techSeries(d, t, c, mode, start) {
  const w = d.weeks, cl = t.series.closes[c.ticker] || [], bm = t.series.bench[c.market] || [];
  const k0 = w.findIndex((x) => x >= start);
  if (k0 < 0) return [];
  const raw = cl.map((v, k) => (mode === "rel" ? (isNum(v) && isNum(bm[k]) ? v / bm[k] : null) : v));
  const base = raw.slice(k0).find(isNum);
  const out = [];
  for (let k = k0; k < w.length; k++) {
    const v = raw[k];
    out.push([w[k], !isNum(v) ? null : mode === "abs" ? v : (100 * v) / base]);
  }
  return out;
}
// 等权指数：起点有数据的公司各自指数化后取平均（mode = index / rel）。
// 缺失值（各市场休市不同、本周未结束时部分市场还没有价格）沿用该公司上一个值，避免平均值因成分变化而跳动
function techEqual(d, t, mode, start, tickers) {
  const ser = t.companies.filter((c) => !tickers || tickers.includes(c.ticker)).map((c) => techSeries(d, t, c, mode === "abs" ? "index" : mode, start)).filter((s) => s.length && isNum(s[0][1]));
  if (!ser.length) return [];
  const filled = ser.map((s) => { let last = null; return s.map(([, v]) => (isNum(v) ? (last = v) : last)); });
  return ser[0].map(([x], k) => { const v = filled.map((f) => f[k]).filter(isNum); return [x, v.length ? v.reduce((a, b) => a + b, 0) / v.length : null]; });
}
function techMarkLines(t, compact) {
  return t.signals.map((m, k) => ({ xAxis: m.date, sig: m, n: k + 1,
    label: { formatter: `${k + 1}`, color: css("--ink-2"), fontSize: compact ? 9 : 10 },
    lineStyle: { color: "#7c5cff", type: "dashed", width: 1, opacity: 0.75 } }));
}
function techSignalHtml(m, n) {
  return `<b>${n}. ${esc(m.date)}${m.precision === "month" ? "（约）" : ""}</b> <span class="chip">${esc(TK_KIND[m.kind]?.[0] || m.kind)}</span> <span class="muted">${esc(m.round_name)}</span><br>${esc(m.text)} <a href="${esc(m.url)}" target="_blank" rel="noopener">来源</a>`;
}

// ---------------- 看板 ----------------
const TECH_HOWTO = [
  "按技术归类的行业看板：每项技术把它的几轮“瓶颈”（紧缺报道）、相关公司（包括外国公司）和行业信息放在一起，方便你自己观察“瓶颈报道”和“股价”的关系。",
  "时间线每行一项技术：色块 = 有紧缺报道的时期（从第一条到最后一条信号；仍紧缺的延续到今天），紫色点 = 每条信号（形状对应类型）。悬停或点击查看内容，点击行名进入该技术。",
  "卡片上的走势 = 相关公司等权指数（各公司从 2023 年初指数化后取平均，当地货币，未换汇），用来粗看这一组公司整体的方向。",
];

function techCardHtml(d, t) {
  const eq = techEqual(d, t, "index", "2023-01-01");
  const last = eq.filter((p) => isNum(p[1]));
  const r3 = (() => { if (last.length < 14) return null; const a = last[last.length - 14][1], b = last[last.length - 1][1]; return b / a - 1; })();
  const sig = t.signals[t.signals.length - 1];
  return `<a class="tk-card" href="#/tech/${t.id}">
    <div class="tk-card-h"><b>${esc(t.name)}</b> <span class="tk-st ${t.status}">${TK_STATUS[t.status]}</span></div>
    <div class="muted small tk-sum">${esc(t.summary.length > 60 ? `${t.summary.slice(0, 60)}…` : t.summary)}</div>
    <div class="tk-spark" id="tk-sp-${t.id}"></div>
    <div class="small">近 3 个月等权 <b class="${cls(r3)}">${pct(r3, 1, true)}</b> · ${t.companies.length} 家公司 · ${t.signals.length} 条信号</div>
    ${sig ? `<div class="muted small">最新信号 ${esc(sig.date)}：${esc(sig.text.length > 34 ? `${sig.text.slice(0, 34)}…` : sig.text)}</div>` : ""}</a>`;
}

PAGES.tech = async (r) => {
  const d = await techData();
  if (!d) { app().innerHTML = `<h2>技术</h2>${card("技术", empty("数据尚未生成（每周运行 run_bottlenecks.py）"))}`; return; }
  const ts = [...d.technologies].sort((a, b) => a.order - b.order);
  if (r.arg) { const t = ts.find((x) => x.id === r.arg); if (t) return renderTech(d, t, ts); }
  app().innerHTML = `<h2>技术 <span class="muted">${ts.length} 项技术 · 数据截至 ${esc(d.asof || "")}</span></h2>
    ${howto(TECH_HOWTO)}
    ${card("瓶颈时间线", `${chartDiv("c-tk-tl", "tall")}<div id="tk-tl-info" class="k-info muted">悬停或点击图上的紫色点查看信号内容；点击左侧技术名进入该技术。</div>`, "", ["fact"])}
    <section class="card"><h3>各项技术 ${badge("fact")}${badge("derived")}</h3><div class="tk-grid">${ts.map((t) => techCardHtml(d, t)).join("")}</div></section>`;
  drawTechTimeline(d, ts);
  for (const t of ts) {
    const eq = techEqual(d, t, "index", "2023-01-01");
    mkChart(byId(`tk-sp-${t.id}`), { animation: false, grid: { left: 2, right: 2, top: 4, bottom: 2 }, xAxis: { type: "time", show: false }, yAxis: { type: "log", show: false, scale: true },
      tooltip: { show: false }, legend: { show: false },
      series: [{ type: "line", showSymbol: false, data: eq, color: t.status === "ongoing" ? "#7c5cff" : BENCH_GRAY(), lineStyle: { width: 1.6 }, areaStyle: { opacity: 0.08 } }] });
  }
};

function drawTechTimeline(d, ts) {
  const today = d.weeks[d.weeks.length - 1];
  const bars = [], dots = [];
  ts.forEach((t, i) => {
    for (const r of t.rounds) bars.push({ value: [i, r.first, r.status === "ongoing" ? today : r.last], r, t });
    t.signals.forEach((m, k) => dots.push({ value: [m.date, i], symbol: TK_KIND[m.kind]?.[1] || "circle", m, n: k + 1, t }));
  });
  const ch = mkChart(byId("c-tk-tl"), {
    tooltip: { show: false }, legend: { show: false }, grid: { left: 110, right: 20, top: 16, bottom: 30 },
    xAxis: { type: "time", min: "2020-06-01" }, yAxis: { type: "category", data: ts.map((t) => t.name), inverse: true, triggerEvent: true },
    series: [
      { type: "custom", renderItem: (params, api) => {
        const y = api.value(0), a = api.coord([api.value(1), y]), b = api.coord([api.value(2), y]), h = api.size([0, 1])[1] * 0.42;
        return { type: "rect", shape: { x: a[0], y: a[1] - h / 2, width: Math.max(3, b[0] - a[0]), height: h }, style: { fill: "rgba(124, 92, 255, 0.18)" } };
      }, encode: { x: [1, 2], y: 0 }, data: bars, z: 1 },
      { type: "scatter", data: dots, symbolSize: 9, color: "#7c5cff", z: 3 },
    ],
  });
  const info = byId("tk-tl-info");
  const show = (p) => {
    if (p.componentType === "yAxis") { const t = ts.find((x) => x.name === p.value); if (t) location.hash = `#/tech/${t.id}`; return; }
    const x = p.data;
    if (!x) return;
    info.classList.remove("muted");
    info.innerHTML = x.m ? `<b>${esc(x.t.name)}</b> · ${techSignalHtml(x.m, x.n)}` : `<b>${esc(x.t.name)}</b> · ${esc(x.r.name)}：${esc(x.r.first)} → ${x.r.status === "ongoing" ? "至今仍紧缺" : esc(x.r.last)}`;
  };
  ch?.on("mouseover", show); ch?.on("click", show);
}

// ---------------- 单项技术 ----------------
function techNav(ts, cur) {
  return `<div class="tk-nav">${ts.map((t) => `<a href="#/tech/${t.id}" class="chip ${t.id === cur ? "on" : ""}">${esc(t.name)}</a>`).join("")}</div>`;
}
function srcLink(x) { return `<a href="${esc(x.url)}" target="_blank" rel="noopener" class="small">${esc(x.source)}（${esc(x.date)}）</a>`; }

function techIndustryHtml(t) {
  const none = `<p class="muted">未找到公开数据（或尚未整理）。</p>`;
  const market = t.market?.length ? `<div class="kpis">${t.market.map((m) => `<div class="kpi"><span class="muted">${esc(m.label)}</span><b>${num(m.value, m.value < 100 ? 1 : 0)} ${esc(m.unit)}</b><span class="muted small">${esc(m.note || "")}</span>${srcLink(m)}</div>`).join("")}</div>` : none;
  const shares = t.shares?.length ? `<div class="tk-shares">${t.shares.map((s, i) => `<div><b>${esc(s.label)}</b> <span class="muted small">${esc(s.basis)}</span>
      ${s.items.some((x) => isNum(x.share)) ? chartDiv(`c-tk-sh-${i}`, "short") : ""}
      <ul class="small">${s.items.filter((x) => !isNum(x.share) || x.value).map((x) => `<li>${esc(x.name)}${isNum(x.share) ? ` ${pct(x.share, 1)}` : ""}${x.value ? `：${esc(x.value)}` : ""}</li>`).join("")}</ul>
      ${s.note ? `<p class="muted small">${esc(s.note)}</p>` : ""}<p>${srcLink(s)}</p></div>`).join("")}</div>` : none;
  const prices = t.prices?.length ? t.prices.map((p, i) => `<div><b>${esc(p.label)}</b>${p.points.length > 1 ? chartDiv(`c-tk-pr-${i}`, "short") : `<p>${p.points.map((x) => `${esc(x.period)}：<b class="pos">+${Math.round(x.low * 100)}%${isNum(x.high) ? `–${Math.round(x.high * 100)}%` : "以上"}</b>（${x.kind === "actual" ? "实际" : "预测"}）`).join("；")}</p>`}
      ${p.note ? `<p class="muted small">${esc(p.note)}</p>` : ""}<p>${srcLink(p)}</p></div>`).join("") : none;
  const facts = t.facts?.length ? `<ul>${t.facts.map((f) => `<li>${esc(f.text)} ${srcLink(f)}</li>`).join("")}</ul>` : "";
  const unl = t.unlisted?.length ? `<p class="muted small">未上市的重要厂商：${t.unlisted.map((u) => `${esc(u.name)}（${esc(u.role)}）`).join("；")}</p>` : "";
  return `<section class="card"><h3>行业信息 ${badge("fact")}</h3>
      <h4>市场规模</h4>${market}
      <h4>市场份额与主要厂商</h4>${shares}
      <h4>价格趋势</h4><div class="grid two">${prices}</div>
      ${facts ? `<h4>其他要点</h4>${facts}` : ""}${unl}
      <p class="muted small">行业信息为人工整理（每条附来源与发布日期）；各机构口径不同（按收入 / 出货 / 产能），同一表格内才可比较。</p></section>`;
}

function drawTechIndustry(t) {
  (t.shares || []).forEach((s, i) => {
    const el = byId(`c-tk-sh-${i}`);
    if (!el) return;
    const items = s.items.filter((x) => isNum(x.share));
    mkChart(el, { tooltip: { show: false }, legend: { show: false }, grid: { left: 150, right: 50, top: 6, bottom: 10 },
      xAxis: { type: "value", max: 1, show: false }, yAxis: { type: "category", inverse: true, data: items.map((x) => x.name), axisLabel: { fontSize: 11 } },
      series: [{ type: "bar", barMaxWidth: 14, data: items.map((x) => x.share), color: "#7c5cff", label: { show: true, position: "right", formatter: (p) => pct(p.value, 1), fontSize: 11, color: css("--ink-2") } }] });
  });
  (t.prices || []).forEach((p, i) => {
    const el = byId(`c-tk-pr-${i}`);
    if (!el) return;
    mkChart(el, { tooltip: { trigger: "axis", formatter: (ps) => { const x = p.points[ps[0].dataIndex]; return `${x.period}：+${Math.round(x.low * 100)}%${isNum(x.high) ? `–${Math.round(x.high * 100)}%` : ""}（${x.kind === "actual" ? "实际" : "预测"}）`; } },
      legend: { show: false }, grid: { left: 44, right: 16, top: 16, bottom: 24 }, xAxis: { type: "category", data: p.points.map((x) => x.period) },
      yAxis: { type: "value", axisLabel: { formatter: (v) => `${Math.round(v * 100)}%` } },
      series: [{ type: "bar", barMaxWidth: 26, data: p.points.map((x) => ({ value: isNum(x.high) ? (x.low + x.high) / 2 : x.low,
        itemStyle: { color: x.kind === "actual" ? "#7c5cff" : "rgba(124, 92, 255, 0.35)", borderColor: "#7c5cff", borderType: x.kind === "actual" ? "solid" : "dashed" } })),
        label: { show: true, position: "top", fontSize: 10, color: css("--ink-2"), formatter: (q) => { const x = p.points[q.dataIndex]; return `${Math.round(x.low * 100)}${isNum(x.high) ? `–${Math.round(x.high * 100)}` : ""}%`; } } }] });
  });
}

function techTimelineHtml(t) {
  return card("信号与扩产时间线", `${chartDiv("c-tk-ev", "short")}<div id="tk-ev-info" class="k-info muted">紫色 = 紧缺信号（形状对应类型，编号与下方走势图上的竖线一致）；绿色 = 扩产 / 缓解时间点（预计）。悬停或点击查看内容。</div>
    <details class="howto"><summary>全部信号与扩产计划（列表）</summary><ol>${t.signals.map((m, k) => `<li>${techSignalHtml(m, k + 1)}</li>`).join("")}</ol>
    ${t.capacity?.length ? `<h4>扩产 / 缓解时间表</h4><ul>${t.capacity.map((c) => `<li><b>${esc(c.date.slice(0, c.precision === "year" ? 4 : 7))}</b> ${esc(c.company)}：${esc(c.text)} <a href="${esc(c.url)}" target="_blank" rel="noopener">来源</a></li>`).join("")}</ul>` : ""}</details>`, "", ["fact"]);
}
function drawTechTimelineSub(d, t) {
  const rows = [...t.rounds.map((r) => r.name), ...(t.capacity?.length ? ["扩产 / 缓解（预计）"] : [])];
  const dots = t.signals.map((m, k) => ({ value: [m.date, t.rounds.findIndex((r) => r.id === m.round)], symbol: TK_KIND[m.kind]?.[1] || "circle", m, n: k + 1, itemStyle: { color: "#7c5cff" } }));
  const cap = (t.capacity || []).map((c) => ({ value: [c.date, rows.length - 1], symbol: "triangle", symbolRotate: 180, c, itemStyle: { color: css("--good") } }));
  const today = d.weeks[d.weeks.length - 1];
  const ch = mkChart(byId("c-tk-ev"), { tooltip: { show: false }, legend: { show: false }, grid: { left: 160, right: 20, top: 10, bottom: 26 },
    xAxis: { type: "time", min: (() => { const f = t.signals[0]?.date || "2022-01-01"; return `${+f.slice(0, 4) - 1}-01-01`; })() },
    yAxis: { type: "category", data: rows, inverse: true, axisLabel: { fontSize: 11 } },
    series: [{ type: "scatter", data: [...dots, ...cap], symbolSize: 11,
      markLine: { symbol: "none", silent: true, label: { formatter: "今天", color: css("--muted") }, lineStyle: { color: css("--axis"), type: "dotted" }, data: [{ xAxis: today }] } }] });
  const info = byId("tk-ev-info");
  const show = (p) => { const x = p.data; if (!x?.value) return; info.classList.remove("muted");
    info.innerHTML = x.m ? techSignalHtml(x.m, x.n) : `<b>${esc(x.c.date.slice(0, 7))}（预计）</b> ${esc(x.c.company)}：${esc(x.c.text)} <a href="${esc(x.c.url)}" target="_blank" rel="noopener">来源</a>`; };
  ch?.on("mouseover", show); ch?.on("click", show);
}

function techMainHtml(v) {
  return `<section class="card" id="tk-main"><h3>相关公司走势与信号 ${badge("fact")}</h3>
    <div class="row"><span class="muted">显示</span><div class="seg" id="tk-mode">${TK_MODES.map(([k, n]) => `<button type="button" data-v="${k}" class="${v.mode === k ? "on" : ""}">${n}</button>`).join("")}</div>
      <span class="muted">起点</span><div class="seg" id="tk-start">${TK_STARTS.map((s) => `<button type="button" data-v="${s}" class="${v.start === s ? "on" : ""}">${s.slice(0, 4)}</button>`).join("")}</div>
      <label><input type="checkbox" id="tk-log" ${v.log ? "checked" : ""}> 对数刻度</label>
      <label><input type="checkbox" id="tk-legs" ${v.legs ? "checked" : ""}> 小图显示相对大盘上涨波段</label></div>
    <p class="muted small">${v.mode === "index" ? "各公司股价（当地货币，周收盘）以起点为 100；粗线 = 等权指数。" : v.mode === "rel" ? "公司 ÷ 本地大盘（美股 SPY、台股加权、日经、KOSPI、沪深 300 ETF、恒生、DAX 等），起点为 100：线往上 = 跑赢本地大盘；粗线 = 等权平均。" : "当地货币的周收盘价（不同货币不可直接比较，建议配合对数刻度）。"}点击图例可隐藏 / 显示公司。紫色编号竖线 = 信号。</p>
    ${chartDiv("c-tk-main", "tall")}<div id="tk-main-info" class="k-info muted">把鼠标移到紫色编号竖线上（或点击），这里显示信号内容。</div></section>`;
}

function drawTechMain(d, t, v) {
  const ser = t.companies.map((c, i) => ({ name: `${c.name}（${c.ticker}）`, type: "line", showSymbol: false, connectNulls: true, data: techSeries(d, t, c, v.mode, v.start), color: palette()[i % 10], lineStyle: { width: 1.3 } })).filter((s) => s.data.some((p) => isNum(p[1])));
  if (v.mode !== "abs") ser.unshift({ name: "等权指数", type: "line", showSymbol: false, data: techEqual(d, t, v.mode, v.start), color: css("--ink"), lineStyle: { width: 3 }, z: 5 });
  if (ser.length) ser[0].markLine = { symbol: "none", tooltip: { show: false }, data: techMarkLines(t, false).filter((m) => m.xAxis >= v.start) };
  const ch = mkChart(byId("c-tk-main"), {
    tooltip: { trigger: "axis", valueFormatter: (x) => (x == null ? "–" : num(x, v.mode === "abs" ? 2 : 0)), order: "valueDesc" },
    legend: { type: "scroll", top: 0 }, grid: { left: 54, right: 20, top: 40, bottom: 60 },
    xAxis: { type: "time" }, yAxis: { type: v.log ? "log" : "value", scale: true, axisLabel: { formatter: (x) => num(x, 0) } },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 10 }], series: ser,
  });
  const info = byId("tk-main-info");
  const show = (p) => { if (p.componentType === "markLine" && p.data?.sig) { info.classList.remove("muted"); info.innerHTML = techSignalHtml(p.data.sig, p.data.n); } };
  ch?.on("mouseover", show); ch?.on("click", show);
}

function techSmallHtml(t) {
  return `<section class="card"><h3>逐家公司 ${badge("fact")}${badge("derived")}</h3>
    <div id="tk-sm-info" class="k-info muted">每张小图一家公司（与上方主图同样的显示方式与起点）；紫色编号竖线 = 信号，悬停或点击查看内容。</div>
    <div class="bn-sm">${t.companies.map((c, i) => `<div><b>${c.in_pool ? `<a href="#/stock/${esc(c.pool_ticker)}">${esc(c.name)}</a>` : esc(c.name)}</b> <span class="muted small">${esc(c.ticker)} · ${esc(c.market_zh)}${isNum(c.mcap_usd) ? ` · 市值 ${num(c.mcap_usd, c.mcap_usd < 10 ? 1 : 0)}B 美元` : ""}</span>${chartDiv(`c-tk-sm-${i}`, "short")}</div>`).join("")}</div></section>`;
}
function drawTechSmall(d, t, v) {
  const info = byId("tk-sm-info");
  t.companies.forEach((c, i) => {
    const el = byId(`c-tk-sm-${i}`);
    if (!el) return;
    const data = techSeries(d, t, c, v.mode, v.start);
    const lo = data[0]?.[0], hi = data[data.length - 1]?.[0];
    const legs = v.legs ? (c.legs || []).filter((l) => l.peak >= (lo || "") && l.t0 <= (hi || "")).map((l) => [{ xAxis: l.t0 < lo ? lo : l.t0, name: pct(l.gain, 0, true), itemStyle: { color: "rgba(124, 92, 255, 0.10)" } }, { xAxis: l.peak > hi ? hi : l.peak }]) : [];
    const ch = mkChart(el, { tooltip: { trigger: "axis", valueFormatter: (x) => (x == null ? "–" : num(x, v.mode === "abs" ? 2 : 0)) }, legend: { show: false }, grid: { left: 44, right: 10, top: 16, bottom: 22 },
      xAxis: { type: "time", min: lo, max: hi }, yAxis: { type: v.log ? "log" : "value", scale: true, axisLabel: { fontSize: 10, formatter: (x) => num(x, 0) } },
      series: [{ type: "line", showSymbol: false, connectNulls: true, data, color: palette()[i % 10], lineStyle: { width: 1.5 },
        markArea: { silent: true, label: { show: true, position: "insideTop", color: "#7c5cff", fontSize: 10 }, data: legs },
        markLine: { symbol: "none", tooltip: { show: false }, data: techMarkLines(t, true).filter((m) => m.xAxis >= (lo || "")) } }] });
    const show = (p) => { if (p.componentType === "markLine" && p.data?.sig) { info.classList.remove("muted"); info.innerHTML = `<b>${esc(c.name)}</b> · ${techSignalHtml(p.data.sig, p.data.n)}`; } };
    ch?.on("mouseover", show); ch?.on("click", show);
  });
}

function techCompanyTable(t) {
  const shareOf = (tk) => { for (const s of t.shares || []) { const x = s.items.find((i) => i.ticker === tk); if (x) return `${s.label.replace(/（.*?）/g, "")}：${isNum(x.share) ? pct(x.share, 1) : esc(x.value)}`; } return ""; };
  const pur = { high: "高", medium: "中", low: "低" };
  return `<section class="card"><h3>公司一览 ${badge("fact")}${badge("derived")}</h3><div class="table-wrap"><table><thead><tr><th>公司</th><th>市场</th><th>在这项技术中的角色</th><th>份额</th><th>业务纯度</th><th class="num">市值（美元）</th><th class="num">预期市盈率</th><th class="num">近 1 月</th><th class="num">近 6 月</th><th class="num">近 1 年</th><th class="num">1 年相对大盘</th><th class="num">距 52 周高点</th><th class="num">分析师</th></tr></thead>
    <tbody>${t.companies.map((c) => `<tr><td class="nowrap"><b>${c.in_pool ? `<a href="#/stock/${esc(c.pool_ticker)}">${esc(c.name)}</a>` : esc(c.name)}</b><br><span class="muted small">${esc(c.ticker)}${c.in_pool ? " · 选股池" : ""}</span></td>
      <td>${esc(c.market_zh)}</td><td class="small">${(c.roles || []).map(esc).join("<br>")}</td><td class="small">${shareOf(c.ticker)}</td><td>${pur[c.purity] || "–"}</td>
      <td class="num">${isNum(c.mcap_usd) ? `${num(c.mcap_usd, c.mcap_usd < 10 ? 1 : 0)}B` : "–"}</td><td class="num">${isNum(c.fwd_pe) ? num(c.fwd_pe, 1) : "–"}</td>
      ${["1m", "6m", "1y"].map((k) => `<td class="num ${cls(c.ret?.[k])}">${pct(c.ret?.[k], 0, true)}</td>`).join("")}
      <td class="num ${cls(c.rel?.["1y"])}">${pct(c.rel?.["1y"], 0, true)}</td><td class="num">${pct(c.from_high, 0, true)}</td><td class="num">${c.analysts ?? "–"}</td></tr>`).join("")}</tbody></table></div>
    <p class="muted small">市值按最新汇率换算成美元（B = 十亿美元）；涨跌为当地货币价格；“1 年相对大盘”= 公司 ÷ 本地大盘的 1 年变化。业务纯度 = 这项技术相关业务占公司收入的大致比重（人工判断，仅瓶颈案例中的公司有）。</p></section>`;
}

function techNewsHtml(t) {
  const n = t.news || [];
  return card(`近 30 天相关新闻（${n.length} 篇）`, n.length ? `<ul class="tk-news">${n.map((x) => `<li><span class="muted small">${esc(x.date)}</span> <a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a> <span class="muted small">${esc(x.publisher || "")}</span>${(x.tickers || []).map((tk) => ` <a class="chip" href="#/stock/${esc(tk)}">${esc(tk)}</a>`).join("")}</li>`).join("")}</ul>
    <p class="muted small">来自每日新闻存档：标题含这项技术的关键词，或涉及选股池中的相关公司（关键词匹配的排在前面）。</p>` : empty("近 30 天新闻存档中没有匹配的文章"), "", ["fact"]);
}

function renderTech(d, t, ts) {
  const v = techView();
  app().innerHTML = `${techNav(ts, t.id)}
    <h2>${esc(t.name)} <span class="tk-st ${t.status}">${TK_STATUS[t.status]}</span> <span class="muted">数据截至 ${esc(d.asof || "")}</span></h2>
    <section class="card"><p>${esc(t.summary)}</p>
      <div class="tk-chain"><div><span class="muted small">上游</span><br>${esc(t.chain.up)}</div><div class="tk-arrow">→</div><div class="tk-self"><b>${esc(t.name)}</b></div><div class="tk-arrow">→</div><div><span class="muted small">下游</span><br>${esc(t.chain.down)}</div></div>
      <p class="muted small">包含的瓶颈轮次：${t.rounds.map((r) => `${esc(r.name)}（${esc(r.first.slice(0, 7))} 起，${TK_STATUS[r.status]}）`).join("；")}</p></section>
    ${techIndustryHtml(t)}
    ${techTimelineHtml(t)}
    ${techMainHtml(v)}
    ${techSmallHtml(t)}
    ${techCompanyTable(t)}
    ${techNewsHtml(t)}`;
  drawTechIndustry(t);
  drawTechTimelineSub(d, t);
  drawTechMain(d, t, v);
  drawTechSmall(d, t, v);
  const redraw = () => {
    saveTechView(v);
    for (const c of charts) c.dispose(); // 整页重绘前释放旧图表
    charts = [];
    renderTech(d, t, ts);
    byId("tk-main")?.scrollIntoView({ block: "start" });
  };
  document.querySelectorAll("#tk-mode button").forEach((b) => (b.onclick = () => { v.mode = b.dataset.v; redraw(); }));
  document.querySelectorAll("#tk-start button").forEach((b) => (b.onclick = () => { v.start = b.dataset.v; redraw(); }));
  byId("tk-log").onchange = (e) => { v.log = e.target.checked; redraw(); };
  byId("tk-legs").onchange = (e) => { v.legs = e.target.checked; redraw(); };
}
