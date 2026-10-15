/* 技术（M48）：顶级页面。数据：technologies.json（每周 run_bottlenecks.py 生成 + 网站构建时附近期相关新闻）
   #/tech            看板：瓶颈时间线（每项技术一行）+ 技术卡片（等权走势、近 3 个月、最新信号）
   #/tech/<id>       单项技术：说明与产业链位置 → 行业信息（规模 / 份额 / 价格趋势 / 要点）→ 合并图（相关公司走势 + 顶部信号带
                     （类型着色、可开关、大小 = 影响力）+ 扩产 / 缓解）与右侧联动信号列表 → 逐家公司小图 → 公司表 → 相关新闻
   图上标记的内容显示在图下方的固定信息栏（悬停或点击更新）。 */

const TK_KIND = { leader: ["龙头表态 / 指引", "diamond"], report: ["行业报道", "circle"], price: ["提价", "triangle"], capacity: ["抢产能 / 售罄 / 协议", "rect"], order: ["订单", "pin"], product: ["产品发布", "roundRect"] };
// 技术页面按信号类型着色（个股页仍统一用紫色）
const TK_COLOR = { leader: "#e8590c", report: "#1c7ed6", price: "#d6336c", capacity: "#7c5cff", order: "#2f9e44", product: "#f59f00", plan: "#0ca678" };
const TK_GLYPH = { diamond: "◆", circle: "●", triangle: "▲", rect: "■", pin: "📍", roundRect: "▢" };
const TK_STATUS = { ongoing: "仍紧缺", eased: "已缓解" };
// 主图“突出显示”筛选：返回要突出的公司代码；null = 该技术没有可用数据
const TK_TOP = 5;
const TK_FOCUS = [
  ["all", "全部", "不突出任何公司", () => null],
  ["us", "仅美股", "美国上市的公司（含 ADR）", (t) => t.companies.filter((c) => c.market === "US").map((c) => c.ticker)],
  ["pool", "选股池", "已在你选股池中的公司", (t) => t.companies.filter((c) => c.in_pool).map((c) => c.ticker)],
  ["share", "份额最大", `行业信息里市场份额最大的 ${TK_TOP} 家（只含有份额数字且有股价的公司）`, (t) => {
    const have = new Set(t.companies.map((c) => c.ticker));
    const best = {};
    for (const tb of t.shares || []) for (const x of tb.items) if (x.ticker && isNum(x.share) && have.has(x.ticker)) best[x.ticker] = Math.max(best[x.ticker] || 0, x.share);
    return Object.entries(best).sort((a, b) => b[1] - a[1]).slice(0, TK_TOP).map(([k]) => k);
  }],
  ["mcap", "市值最大", `美元市值最大的 ${TK_TOP} 家（行业龙头的近似）`, (t) => [...t.companies].filter((c) => isNum(c.mcap_usd)).sort((a, b) => b.mcap_usd - a.mcap_usd).slice(0, TK_TOP).map((c) => c.ticker)],
  ["pure", "高纯度", "这项业务占公司收入大头的公司（瓶颈库中纯度为“高”）：股价最能反映这项技术", (t) => t.companies.filter((c) => c.purity === "high").map((c) => c.ticker)],
  ["strong", "近 6 月最强", `近 6 个月相对本地大盘涨得最多的 ${TK_TOP} 家：市场正在押注谁`, (t) => [...t.companies].filter((c) => isNum(c.rel?.["6m"])).sort((a, b) => b.rel["6m"] - a.rel["6m"]).slice(0, TK_TOP).map((c) => c.ticker)],
  ["weak", "近 6 月最弱", `近 6 个月相对本地大盘涨得最少（或跌得最多）的 ${TK_TOP} 家：落后者或被替代者`, (t) => [...t.companies].filter((c) => isNum(c.rel?.["6m"])).sort((a, b) => a.rel["6m"] - b.rel["6m"]).slice(0, TK_TOP).map((c) => c.ticker)],
];
function techFocus(t, key) {
  const f = TK_FOCUS.find((x) => x[0] === key);
  const tk = f ? f[3](t) : null;
  return tk && tk.length ? new Set(tk) : null;
}
const TK_MODES = [["index", "指数化（起点 = 100）"], ["rel", "相对本地大盘"], ["abs", "绝对价格"]];
const TK_STARTS = ["2017-01-01", "2020-01-01", "2022-01-01", "2023-01-01", "2024-01-01", "2025-01-01"];
const TK_PREF = "invest.tech.view";
let TK_DATA = null;

async function techData() {
  if (!TK_DATA) TK_DATA = await load("technologies.json");
  return TK_DATA?.technologies ? TK_DATA : null;
}
function techView() {
  const v = { mode: "index", start: "2023-01-01", log: true, legs: false, hidden: [], focus: "all" };
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
function techMarkLines(t, compact, hidden) {
  return t.signals.map((m, k) => ({ xAxis: m.date, sig: m, n: k + 1,
    label: { formatter: `${k + 1}`, color: TK_COLOR[m.kind], fontSize: compact ? 9 : 10 },
    lineStyle: { color: TK_COLOR[m.kind], type: "dashed", width: 1, opacity: 0.75 } })).filter((x) => !hidden?.has(x.sig.kind));
}
function techSignalHtml(m, n) {
  return `<b>${n}. ${esc(m.date)}${m.precision === "month" ? "（约）" : ""}</b> <span class="tk-glyph" style="color:${TK_COLOR[m.kind]}">${TK_GLYPH[TK_KIND[m.kind]?.[1]] || "●"}</span>${esc(TK_KIND[m.kind]?.[0] || m.kind)} <span class="muted">${esc(m.round_name)}</span><br>${esc(m.text)} <a href="${esc(m.url)}" target="_blank" rel="noopener">来源</a>`;
}

// ---------------- 看板 ----------------
const TECH_HOWTO = [
  "按技术归类的行业看板：每项技术把它的几轮“瓶颈”（紧缺报道）、相关公司（包括外国公司）和行业信息放在一起，方便你自己观察“瓶颈报道”和“股价”的关系。",
  "时间线每行一项技术：色块 = 有紧缺报道的时期（从第一条到最后一条信号；仍紧缺的延续到今天），点 = 每条信号（颜色与形状对应类型，见图上方图例）。悬停或点击查看内容，点击行名进入该技术。",
  "卡片上的走势 = 相关公司等权指数（各公司从 2023 年初指数化后取平均，当地货币，未换汇），用来粗看这一组公司整体的方向。",
];

// 卡片走势起点：AI 技术从 2023 年初；历史周期从第一轮紧缺所在年份的年初
const techCardStart = (t) => (t.history ? `${t.rounds.map((r) => r.first).sort()[0].slice(0, 4)}-01-01` : "2023-01-01");
function techCardHtml(d, t) {
  const eq = techEqual(d, t, "index", techCardStart(t));
  const last = eq.filter((p) => isNum(p[1]));
  const r3 = (() => { if (last.length < 14) return null; const a = last[last.length - 14][1], b = last[last.length - 1][1]; return b / a - 1; })();
  const sig = t.signals[t.signals.length - 1];
  const years = t.history ? `${t.rounds.map((r) => r.first).sort()[0].slice(0, 4)}–${t.rounds.map((r) => r.last).sort().at(-1).slice(0, 4)} · ` : "";
  return `<a class="tk-card" href="#/tech/${t.id}">
    <div class="tk-card-h"><b>${esc(t.name)}</b> <span class="tk-st ${t.status}">${TK_STATUS[t.status]}</span></div>
    <div class="muted small tk-sum">${esc(t.summary.length > 60 ? `${t.summary.slice(0, 60)}…` : t.summary)}</div>
    <div class="tk-spark" id="tk-sp-${t.id}"></div>
    <div class="small">${t.history ? years : `近 3 个月等权 <b class="${cls(r3)}">${pct(r3, 1, true)}</b> · `}${t.companies.length} 家公司 · ${t.signals.length} 条信号</div>
    ${sig ? `<div class="muted small">最新信号 ${esc(sig.date)}：${esc(sig.text.length > 34 ? `${sig.text.slice(0, 34)}…` : sig.text)}</div>` : ""}</a>`;
}

PAGES.tech = async (r) => {
  const d = await techData();
  if (!d) { app().innerHTML = `<h2>技术</h2>${card("技术", empty("数据尚未生成（每周运行 run_bottlenecks.py）"))}`; return; }
  const ts = [...d.technologies].sort((a, b) => a.order - b.order);
  if (r.arg) { const t = ts.find((x) => x.id === r.arg); if (t) return renderTech(d, t, ts); }
  const ai = ts.filter((t) => !t.history), hist = ts.filter((t) => t.history);
  app().innerHTML = `<h2>技术 <span class="muted">${ts.length} 项技术 · 数据截至 ${esc(d.asof || "")}</span></h2>
    ${howto(TECH_HOWTO)}
    ${card("瓶颈时间线", `${techKindLegend()}${chartDiv("c-tk-tl", "tall")}<div id="tk-tl-info" class="k-info muted">悬停或点击图上的点查看信号内容；点击左侧技术名进入该技术。</div>`, "", ["fact"])}
    <section class="card"><h3>各项技术 ${badge("fact")}${badge("derived")}</h3><div class="tk-grid">${ai.map((t) => techCardHtml(d, t)).join("")}</div></section>
    ${hist.length ? `<section class="card"><h3>历史对照：非 AI 紧缺周期 ${badge("fact")}${badge("derived")}</h3><p class="muted small">AI 之前的几轮紧缺，不在上方时间线里；卡片走势从第一轮紧缺所在年份的年初开始。</p><div class="tk-grid">${hist.map((t) => techCardHtml(d, t)).join("")}</div></section>` : ""}`;
  drawTechTimeline(d, ai);
  for (const t of ts) {
    const eq = techEqual(d, t, "index", techCardStart(t));
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
    t.signals.forEach((m, k) => dots.push({ value: [m.date, i], symbol: TK_KIND[m.kind]?.[1] || "circle", m, n: k + 1, t, itemStyle: { color: TK_COLOR[m.kind] } }));
  });
  const ch = mkChart(byId("c-tk-tl"), {
    tooltip: { show: false }, legend: { show: false }, grid: { left: 110, right: 20, top: 16, bottom: 30 },
    xAxis: { type: "time", min: "2020-06-01" }, yAxis: { type: "category", data: ts.map((t) => t.name), inverse: true, triggerEvent: true },
    series: [
      { type: "custom", renderItem: (params, api) => {
        const y = api.value(0), a = api.coord([api.value(1), y]), b = api.coord([api.value(2), y]), h = api.size([0, 1])[1] * 0.42;
        return { type: "rect", shape: { x: a[0], y: a[1] - h / 2, width: Math.max(3, b[0] - a[0]), height: h }, style: { fill: "rgba(124, 92, 255, 0.18)" } };
      }, encode: { x: [1, 2], y: 0 }, data: bars, z: 1 },
      { type: "scatter", data: dots, symbolSize: 9, z: 3 },
    ],
  });
  const info = byId("tk-tl-info");
  // 悬停只更新信息栏；点击左侧技术名才进入该技术（此前悬停与点击共用同一处理函数，鼠标经过技术名就会跳转）
  const show = (p) => {
    if (p.componentType === "yAxis") {
      info.classList.remove("muted");
      info.innerHTML = `点击「${esc(p.value)}」进入该技术的页面`;
      return;
    }
    const x = p.data;
    if (!x) return;
    info.classList.remove("muted");
    info.innerHTML = x.m ? `<b>${esc(x.t.name)}</b> · ${techSignalHtml(x.m, x.n)}` : `<b>${esc(x.t.name)}</b> · ${esc(x.r.name)}：${esc(x.r.first)} → ${x.r.status === "ongoing" ? "至今仍紧缺" : esc(x.r.last)}`;
  };
  ch?.on("mouseover", show);
  ch?.on("click", (p) => {
    if (p.componentType === "yAxis") { const t = ts.find((x) => x.name === p.value); if (t) location.hash = `#/tech/${t.id}`; return; }
    show(p);
  });
}

function techKindLegend() {
  return `<p class="small tk-legend">${Object.entries(TK_KIND).map(([k, [n, sh]]) => `<span><span class="tk-glyph" style="color:${TK_COLOR[k]}">${TK_GLYPH[sh]}</span>${esc(n)}</span>`).join("")}<span><span style="display:inline-block;width:22px;height:8px;background:rgba(124,92,255,.18);vertical-align:middle;margin-right:4px"></span>有紧缺报道的时期</span></p>`;
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

// ---------------- 走势 + 信号 + 扩产（合并图）与右侧信号列表 ----------------
// 顶部一条“信号带”（与价格图共用时间轴）：上排 = 紧缺信号（颜色 / 形状 = 类型，大小 = 影响力），下排 = 扩产 / 缓解（预计）；
// 下方价格图上用同色细竖线标出信号位置。右侧列表与图联动：悬停图上的点高亮对应条目，悬停条目高亮图上的点。
function techImpactText(m) {
  const x = m.impact;
  if (!x) return m.precision === "month" ? "日期只精确到月，未计算影响力" : "数据不足，未计算影响力";
  return `前后 3 个交易日相关公司相对本地大盘平均 ${pct(x.ret, 1, true)}，约为平时波动的 ${num(Math.abs(x.z), 1)} 倍（${x.n} 家）`;
}
function techSigSize(m) { return m.impact ? 8 + Math.min(16, Math.abs(m.impact.z) * 5) : 9; }
function techKinds(t) { return Object.keys(TK_KIND).filter((k) => t.signals.some((m) => m.kind === k)); }

function techComboHtml(t, v) {
  const hid = new Set(v.hidden || []);
  const chip = (k, name, color, shape, n) => `<button type="button" class="tk-kind ${hid.has(k) ? "off" : ""}" data-k="${k}"><span class="tk-glyph" style="color:${color}">${shape}</span>${esc(name)} <span class="muted">${n}</span></button>`;
  const kinds = techKinds(t).map((k) => chip(k, TK_KIND[k][0], TK_COLOR[k], TK_GLYPH[TK_KIND[k][1]], t.signals.filter((m) => m.kind === k).length)).join("");
  const plan = t.capacity?.length ? chip("plan", "扩产 / 缓解（预计）", TK_COLOR.plan, "▼", t.capacity.length) : "";
  return `<section class="card" id="tk-main"><h3>相关公司走势、信号与扩产 ${badge("fact")}${badge("derived")}</h3>
    <div class="row"><span class="muted">显示</span><div class="seg" id="tk-mode">${TK_MODES.map(([k, n]) => `<button type="button" data-v="${k}" class="${v.mode === k ? "on" : ""}">${n}</button>`).join("")}</div>
      <span class="muted">起点</span><div class="seg" id="tk-start">${TK_STARTS.map((s) => `<button type="button" data-v="${s}" class="${v.start === s ? "on" : ""}">${s.slice(0, 4)}</button>`).join("")}</div>
      <label><input type="checkbox" id="tk-log" ${v.log ? "checked" : ""}> 对数刻度</label>
      <label><input type="checkbox" id="tk-legs" ${v.legs ? "checked" : ""}> 小图显示相对大盘上涨波段</label></div>
    <div class="row tk-kinds"><span class="muted">突出显示</span>${TK_FOCUS.map(([k, n, tip, fn]) => {
      const tk = k === "all" ? [] : fn(t) || [];
      const off = k !== "all" && !tk.length;
      return `<button type="button" class="tk-kind tk-focus ${(v.focus || "all") === k ? "on" : ""}" data-f="${k}" ${off ? "disabled" : ""} title="${esc(off ? "这项技术没有符合条件的公司（或没有带代码的份额数据）" : tip)}">${esc(n)}${k === "all" ? "" : ` <span class="muted">${tk.length}</span>`}</button>`;
    }).join("")}</div>
    <div class="row tk-kinds"><span class="muted">信号类型（点击开关）</span>${kinds}${plan}</div>
    <p class="muted small">${v.mode === "index" ? "各公司股价（当地货币，周收盘）以起点为 100；粗黑线 = 等权指数。" : v.mode === "rel" ? "公司 ÷ 本地大盘（美股 SPY、台股加权、日经、KOSPI、沪深 300 ETF、恒生、DAX 等），起点为 100：线往上 = 跑赢本地大盘；粗黑线 = 等权平均。" : "当地货币的周收盘价（不同货币不可直接比较，建议配合对数刻度）。"}
      顶部信号带：点越大 = 影响力越大（信号前后 3 个交易日，相关公司相对本地大盘的平均涨跌是平时波动的几倍；同日的其他消息也会混在里面，只作参考）；空心 = 日期只精确到月。点击图例可隐藏 / 显示公司；“突出显示”把其余公司调淡，并加一条所选公司的等权线（虚线）。</p>
    <div class="tk-combo"><div>${chartDiv("c-tk-main", "tk-tall")}</div><div class="tk-list" id="tk-list">${techListHtml(t, hid)}</div></div></section>`;
}
function techListHtml(t, hid) {
  const items = [
    ...t.signals.map((m, k) => ({ date: m.date, html: `<div class="tk-it" data-i="${k}" style="border-left-color:${TK_COLOR[m.kind]}">
      <div><span class="tk-num" style="background:${TK_COLOR[m.kind]}">${k + 1}</span> <b>${esc(m.date)}${m.precision === "month" ? "（约）" : ""}</b> <span class="tk-glyph" style="color:${TK_COLOR[m.kind]}">${TK_GLYPH[TK_KIND[m.kind][1]]}</span><span class="small">${esc(TK_KIND[m.kind][0])}</span> <span class="muted small">${esc(m.round_name)}</span></div>
      <div>${esc(m.text)} <a href="${esc(m.url)}" target="_blank" rel="noopener" class="small">来源</a></div>
      <div class="muted small">${esc(techImpactText(m))}</div></div>`, hidden: hid.has(m.kind) })),
    ...(t.capacity || []).map((c, k) => ({ date: c.date, html: `<div class="tk-it tk-plan" data-p="${k}" style="border-left-color:${TK_COLOR.plan}">
      <div><span class="tk-glyph" style="color:${TK_COLOR.plan}">▼</span> <b>${esc(c.date.slice(0, c.precision === "year" ? 4 : 7))}（预计）</b> <span class="small">扩产 / 缓解</span> <span class="muted small">${esc(c.company)}</span></div>
      <div>${esc(c.text)} <a href="${esc(c.url)}" target="_blank" rel="noopener" class="small">来源</a></div></div>`, hidden: hid.has("plan") })),
  ].filter((x) => !x.hidden).sort((a, b) => a.date.localeCompare(b.date));
  return items.length ? items.map((x) => x.html).join("") : `<p class="muted">没有选中的信号类型。</p>`;
}

function drawTechCombo(d, t, v) {
  const el = byId("c-tk-main");
  const hid = new Set(v.hidden || []);
  const comps = t.companies.map((c, i) => ({ c, i, data: techSeries(d, t, c, v.mode, v.start) })).filter((x) => x.data.some((p) => isNum(p[1])));
  const focus = techFocus(t, v.focus);
  const focusName = focus ? `所选等权（${TK_FOCUS.find((x) => x[0] === v.focus)[1]}）` : null;
  const names = [...(v.mode !== "abs" ? ["等权指数", ...(focus ? [focusName] : [])] : []), ...comps.map(({ c }) => `${c.name}（${c.ticker}）`)];
  // 图例多行：按名称长度估算每行能放几个，算出图例高度，信号带与价格图依次往下排
  const width = el.clientWidth || 800;
  let rows = 1, line = 0;
  for (const n of names) { const w = 30 + n.length * 12; if (line + w > width - 20) { rows++; line = 0; } line += w; }
  const top = 8 + rows * 22, stripH = t.capacity?.length ? 96 : 72;
  const lastWeek = d.weeks[d.weeks.length - 1];
  const showPlan = t.capacity?.length && !hid.has("plan");
  const xmax = showPlan ? [lastWeek, ...t.capacity.map((c) => c.date)].sort().pop() : lastWeek;
  const sigs = t.signals.map((m, k) => ({ m, k })).filter(({ m }) => !hid.has(m.kind) && m.date >= v.start);
  // 相近日期（时间轴上 30 天内）的信号错开叠放，避免互相遮住
  const span = (Date.parse(xmax) - Date.parse(v.start)) / 86400000;
  const near = Math.max(20, span / 60);
  sigs.forEach((x, j) => {
    let lv = 0;
    for (let q = j - 1; q >= 0 && (Date.parse(x.m.date) - Date.parse(sigs[q].m.date)) / 86400000 < near; q--) lv = Math.max(lv, sigs[q].lv + 1);
    x.lv = lv % 3;
  });
  const stripY = showPlan ? ["信号", "扩产 / 缓解"] : ["信号"];
  const series = [
    { name: "__sig", type: "scatter", xAxisIndex: 0, yAxisIndex: 0, z: 5, legendHoverLink: false,
      data: sigs.map(({ m, k, lv }) => ({ value: [m.date, "信号"], k, symbol: TK_KIND[m.kind][1], symbolSize: techSigSize(m), symbolOffset: [0, 16 - lv * 19],
        itemStyle: m.precision === "month" ? { color: "transparent", borderColor: TK_COLOR[m.kind], borderWidth: 2 } : { color: TK_COLOR[m.kind], opacity: 0.85 },
        label: { show: true, position: "top", formatter: `${k + 1}`, fontSize: 9, color: css("--ink-2") } })),
      emphasis: { scale: 1.6 } },
    ...(showPlan ? [{ name: "__plan", type: "scatter", xAxisIndex: 0, yAxisIndex: 0, symbol: "triangle", symbolRotate: 180, symbolSize: 11, color: TK_COLOR.plan, z: 5, legendHoverLink: false,
      data: t.capacity.map((c, p) => ({ value: [c.date, "扩产 / 缓解"], p })), emphasis: { scale: 1.6 } }] : []),
    ...(v.mode !== "abs" ? [{ name: "等权指数", type: "line", xAxisIndex: 1, yAxisIndex: 1, showSymbol: false, data: techEqual(d, t, v.mode, v.start), color: css("--ink"), lineStyle: { width: 3, opacity: focus ? 0.35 : 1 }, z: 4 }] : []),
    ...(v.mode !== "abs" && focus ? [{ name: focusName, type: "line", xAxisIndex: 1, yAxisIndex: 1, showSymbol: false, data: techEqual(d, t, v.mode, v.start, [...focus]), color: css("--ink"), lineStyle: { width: 3, type: "dashed" }, z: 4 }] : []),
    ...comps.map(({ c, i, data }) => {
      const dim = focus && !focus.has(c.ticker);
      return { name: `${c.name}（${c.ticker}）`, type: "line", xAxisIndex: 1, yAxisIndex: 1, showSymbol: false, connectNulls: true, data, color: palette()[i % 10],
        lineStyle: { width: dim ? 1 : focus ? 2.2 : 1.3, opacity: dim ? 0.12 : 1 }, z: dim ? 1 : 3 };
    }),
  ];
  const firstLine = series.findIndex((s) => s.type === "line");
  if (firstLine >= 0) series[firstLine].markLine = { symbol: "none", silent: true, label: { show: false },
    data: sigs.map(({ m }) => ({ xAxis: m.date, lineStyle: { color: TK_COLOR[m.kind], type: "dashed", width: 1, opacity: 0.55 } })) };
  const ch = mkChart(el, {
    legend: { type: "plain", top: 0, left: 0, right: 0, data: names, itemGap: 8, textStyle: { fontSize: 11 } },
    // 只列价格线；信号带的内部序列（__sig / __plan）不进提示框，其内容显示在右侧列表
    tooltip: { trigger: "axis", formatter: (ps) => {
      const keep = (n) => !focus || !/（([^（）]+)）$/.test(n) || n.startsWith("所选等权") || focus.has(n.match(/（([^（）]+)）$/)[1]);
      const rows = (Array.isArray(ps) ? ps : [ps]).filter((p) => !p.seriesName.startsWith("__") && isNum(p.value?.[1]) && keep(p.seriesName))
        .sort((a, b) => b.value[1] - a.value[1]);
      if (!rows.length) return "";
      return `${esc(rows[0].axisValueLabel)}<br>${rows.map((p) => `${p.marker}${esc(p.seriesName)} <b>${num(p.value[1], v.mode === "abs" ? 2 : 0)}</b>`).join("<br>")}`;
    } },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [{ left: 64, right: 16, top, height: stripH }, { left: 64, right: 16, top: top + stripH + 12, bottom: 56 }],
    xAxis: [{ type: "time", gridIndex: 0, min: v.start, max: xmax, axisLabel: { show: false }, axisTick: { show: false }, splitLine: { show: false } },
      { type: "time", gridIndex: 1, min: v.start, max: xmax }],
    yAxis: [{ type: "category", gridIndex: 0, data: stripY, inverse: true, axisLabel: { fontSize: 10 }, axisTick: { show: false } },
      { type: v.log ? "log" : "value", gridIndex: 1, scale: true, axisLabel: { formatter: (x) => num(x, 0) } }],
    dataZoom: [{ type: "inside", xAxisIndex: [0, 1] }, { type: "slider", xAxisIndex: [0, 1], height: 18, bottom: 10 }],
    series,
  });
  // 联动：图 → 列表
  const list = byId("tk-list");
  const mark = (sel) => {
    list.querySelectorAll(".tk-it.hl").forEach((x) => x.classList.remove("hl"));
    const it = sel && list.querySelector(sel);
    if (!it) return;
    it.classList.add("hl");
    // 只滚动列表本身：用视口坐标算条目相对列表可视区的位置（offsetTop 的参照物会因定位方式而变，之前因此滚错位置）
    const a = it.getBoundingClientRect(), b = list.getBoundingClientRect();
    if (a.top < b.top || a.bottom > b.bottom) list.scrollTop += a.top - b.top - list.clientHeight / 3;
  };
  ch?.on("mouseover", (p) => { if (p.seriesName === "__sig") mark(`.tk-it[data-i="${p.data.k}"]`); else if (p.seriesName === "__plan") mark(`.tk-it[data-p="${p.data.p}"]`); });
  ch?.on("click", (p) => { if (p.seriesName === "__sig") mark(`.tk-it[data-i="${p.data.k}"]`); else if (p.seriesName === "__plan") mark(`.tk-it[data-p="${p.data.p}"]`); });
  // 联动：列表 → 图
  const sigIdx = Object.fromEntries(sigs.map(({ k }, j) => [k, j]));
  list.querySelectorAll(".tk-it").forEach((it) => {
    const on = (type) => {
      if (it.dataset.i != null && sigIdx[it.dataset.i] != null) ch?.dispatchAction({ type, seriesName: "__sig", dataIndex: sigIdx[it.dataset.i] });
      if (it.dataset.p != null && showPlan) ch?.dispatchAction({ type, seriesName: "__plan", dataIndex: +it.dataset.p });
    };
    it.addEventListener("mouseenter", () => { it.classList.add("hl"); on("highlight"); });
    it.addEventListener("mouseleave", () => { it.classList.remove("hl"); on("downplay"); });
  });
}

function techSmallHtml(t) {
  return `<section class="card"><h3>逐家公司 ${badge("fact")}${badge("derived")}</h3>
    <div id="tk-sm-info" class="k-info muted">每张小图一家公司（与上方主图同样的显示方式、起点与信号类型开关）；彩色编号竖线 = 信号（颜色对应类型），悬停或点击查看内容。</div>
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
        markLine: { symbol: "none", tooltip: { show: false }, data: techMarkLines(t, true, new Set(v.hidden || [])).filter((m) => m.xAxis >= (lo || "")) } }] });
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
  const aiStart = v.start; // 历史周期用单独的起点（默认 2017），不影响 AI 技术记住的起点
  if (t.history) v.start = v.hstart || "2017-01-01";
  app().innerHTML = `${techNav(ts, t.id)}
    <h2>${esc(t.name)} <span class="tk-st ${t.status}">${TK_STATUS[t.status]}</span> <span class="muted">数据截至 ${esc(d.asof || "")}</span></h2>
    <section class="card"><p>${esc(t.summary)}</p>
      <div class="tk-chain"><div><span class="muted small">上游</span><br>${esc(t.chain.up)}</div><div class="tk-arrow">→</div><div class="tk-self"><b>${esc(t.name)}</b></div><div class="tk-arrow">→</div><div><span class="muted small">下游</span><br>${esc(t.chain.down)}</div></div>
      <p class="muted small">包含的瓶颈轮次：${t.rounds.map((r) => `${esc(r.name)}（${esc(r.first.slice(0, 7))} 起，${TK_STATUS[r.status]}）`).join("；")}</p></section>
    ${techIndustryHtml(t)}
    <section class="card" id="tk-chips" data-nav="财报披露" hidden></section>
    <section class="card" id="tk-infra" hidden></section>
    ${techComboHtml(t, v)}
    ${techSmallHtml(t)}
    ${techCompanyTable(t)}
    ${techNewsHtml(t)}`;
  drawTechIndustry(t);
  if (!t.history) fillTechInfra(t); // 大公司投入（infra_tech_page.js，M61c）
  fillTechChips(t); // 财报披露的 AI 收入与指引（chip_page.js，M62；目前只有 AI 加速芯片）
  drawTechCombo(d, t, v);
  drawTechSmall(d, t, v);
  const redraw = () => {
    saveTechView(t.history ? { ...v, hstart: v.start, start: aiStart } : v);
    for (const c of charts) c.dispose(); // 整页重绘前释放旧图表
    charts = [];
    renderTech(d, t, ts);
    byId("tk-main")?.scrollIntoView({ block: "start" });
  };
  document.querySelectorAll("#tk-mode button").forEach((b) => (b.onclick = () => { v.mode = b.dataset.v; redraw(); }));
  document.querySelectorAll("#tk-start button").forEach((b) => (b.onclick = () => { v.start = b.dataset.v; redraw(); }));
  byId("tk-log").onchange = (e) => { v.log = e.target.checked; redraw(); };
  byId("tk-legs").onchange = (e) => { v.legs = e.target.checked; redraw(); };
  document.querySelectorAll(".tk-focus").forEach((b) => (b.onclick = () => { v.focus = b.dataset.f; redraw(); }));
  document.querySelectorAll(".tk-kind:not(.tk-focus)").forEach((b) => (b.onclick = () => {
    const h = new Set(v.hidden || []);
    if (h.has(b.dataset.k)) h.delete(b.dataset.k); else h.add(b.dataset.k);
    v.hidden = [...h];
    redraw();
  }));
}
