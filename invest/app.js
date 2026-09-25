"use strict";
/* 量化研究看板：静态单页，hash 路由，数据来自 data/*.json，图表使用 ECharts。
   统一口径：分位评分 0–100（越高越好）；相对收益指数 = 区间起点 100；颜色按主题固定。 */

// ---------------- 基础工具 ----------------
const cache = new Map();
function load(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(`data/${path}`, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(path);
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isNum = (v) => typeof v === "number" && isFinite(v);
const pct = (v, d = 1, signed = false) => (isNum(v) ? `${signed && v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%` : "–");
const num = (v, d = 2, signed = false) => (isNum(v) ? `${signed && v > 0 ? "+" : ""}${v.toFixed(d)}` : "–");
const cls = (v) => (isNum(v) ? (v > 0 ? "pos" : v < 0 ? "neg" : "") : "");
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const isDark = () => css("--page").toLowerCase() === "#0d0d0d";
const app = () => document.getElementById("app");

const PALETTE_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const PALETTE_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const palette = () => (isDark() ? PALETTE_DARK : PALETTE_LIGHT);
const BENCH_GRAY = () => (isDark() ? "#898781" : "#6f6e69");
const REGIME_ZH = { risk_on: "Risk-on（进攻）", neutral: "Neutral（中性）", risk_off: "Risk-off（防御）" };
const REGIME_COLOR = { risk_on: "#0ca30c", neutral: "#fab219", risk_off: "#d03b3b" };
const LAYER_ZH = { core: "核心", satellite: "卫星", hedge: "对冲", cash: "现金" };
const DIR_ZH = { positive: "利好", negative: "利空", neutral: "中性", mixed: "影响不一" };
const LEVEL_ZH = { high: "高", medium: "中", low: "低" };
const HORIZON_ZH = { short: "短期", medium: "中期", long: "长期" };
const REL_ZH = { supplier: "上游供应商", customer: "下游客户", competitor: "竞争对手", partner: "合作方",
  investor: "股东", holding: "持股对象", industry: "行业层面" };
const EVENT_ZH = { earnings: "财报", guidance: "业绩指引", regulation_export: "监管/出口管制", m_and_a: "并购",
  product: "产品发布", legal: "诉讼/法律", analyst: "分析师评级", macro: "宏观", other: "其他" };
const PRIORITY_ZH = { holding: "持仓", watchlist: "关注列表", other: "其他" };
const TIER_ZH = { gemini: "Gemini", groq: "Groq", rule: "规则降级", extractive: "标题摘录" };

let META = null;
let charts = [];
function themeOf(t) { return META.universe.find((u) => u.ticker === t)?.theme; }
function themeColor(key) {
  const th = META.themes.find((x) => x.key === key);
  return th ? (isDark() ? th.color_dark : th.color) : BENCH_GRAY();
}
function themeName(key) { return META.themes.find((x) => x.key === key)?.name ?? key ?? ""; }
function tickerLabel(t) {
  const u = META.universe.find((x) => x.ticker === t);
  return `${u?.held ? "● " : ""}${t}${u?.watchlist ? " ★" : ""}`;
}

// ---------------- 图表工具 ----------------
function baseOption(extra) {
  const ink2 = css("--ink-2"), grid = css("--grid"), axis = css("--axis");
  const o = {
    backgroundColor: "transparent",
    textStyle: { color: ink2, fontFamily: "system-ui, -apple-system, 'PingFang SC', sans-serif" },
    tooltip: { trigger: "axis", confine: true, backgroundColor: css("--surface"), borderColor: css("--border"),
      textStyle: { color: css("--ink") } },
    grid: { left: 56, right: 24, top: 36, bottom: 40, containLabel: false },
    legend: { top: 4, textStyle: { color: ink2 }, itemWidth: 14, itemHeight: 8 },
    ...extra,
  };
  const styleAxis = (ax) => ({ axisLine: { lineStyle: { color: axis } }, axisTick: { show: false },
    axisLabel: { color: css("--muted") }, splitLine: { lineStyle: { color: grid } }, ...ax });
  for (const k of ["xAxis", "yAxis"]) {
    if (o[k]) o[k] = Array.isArray(o[k]) ? o[k].map(styleAxis) : styleAxis(o[k]);
  }
  return o;
}
function mkChart(el, option) {
  if (!window.echarts) { el.innerHTML = '<div class="empty">图表库加载失败（需要访问 cdn.jsdelivr.net）</div>'; return null; }
  const c = echarts.init(el);
  c.setOption(baseOption(option));
  charts.push(c);
  return c;
}
function disposeCharts() { charts.forEach((c) => c.dispose()); charts = []; }
window.addEventListener("resize", () => charts.forEach((c) => c.resize()));

function lineSeries(name, payload, opts = {}) {
  return { name, type: "line", showSymbol: false, lineStyle: { width: opts.width ?? 2, type: opts.dash ?? "solid" },
    color: opts.color, data: payload.dates.map((d, i) => [d, payload.values[i]]), ...opts.extra };
}
function empty(msg) { return `<div class="empty">${esc(msg)}</div>`; }
function card(title, body, extra = "", kinds = null) {
  return `<section class="card" ${extra}><h3>${esc(title)}${badges(kinds ?? kindsFor(title))}</h3>${body}</section>`;
}
function chartDiv(id, size = "") { return `<div id="${id}" class="chart ${size}"></div>`; }
const byId = (id) => document.getElementById(id);
function srcLinks(sources, n = 3) {
  return (sources || []).slice(0, n).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.publisher || "来源")}</a>`).join(" · ");
}
// 分位热力色：0 → 红，50 → 灰，100 → 蓝
function divergingColors() { return [css("--neg"), css("--mid"), css("--pos")]; }


// ---------------- 数据类型标签、术语链接、说明与重点 ----------------
const KINDS = {
  fact: { label: "事实", tip: "市场上真实发生的数据或新闻原文" },
  derived: { label: "计算", tip: "由事实按固定公式算出，不含判断" },
  model: { label: "模型 / AI", tip: "模型或 AI 的判断与建议，可能出错" },
  simulated: { label: "模拟", tip: "假设过去按模型操作的结果，不是真实收益" },
};
function badge(kind) {
  const k = KINDS[kind];
  return k ? `<a class="badge b-${kind}" href="#/glossary?t=${kind}" title="${esc(k.tip)}（点击查看说明）">${k.label}</a>` : "";
}
function badges(kinds) { return (kinds || []).map(badge).join(""); }
// 卡片标题 → 数据类型（按关键词匹配，先匹配到先用）
const CARD_KINDS = [
  [/^实盘跟踪/, ["simulated"]], [/^Regime/, ["model"]], [/^调仓变化/, ["model"]], [/^相关报道/, ["fact", "model"]],
  [/^本周摘要/, ["model"]], [/^区间超额收益排名/, ["derived"]], [/基准 .*虚线/, ["derived"]], [/^风险 vs 收益/, ["derived"]],
  [/^量化分位 vs 新闻情绪/, ["model"]], [/相关性/, ["derived"]], [/^过去 26 周的配置变化/, ["model", "simulated"]],
  [/^综合信号分位历史/, ["model"]], [/^策略月度收益|^策略净值|^净值|^回撤|^指标|^参数敏感性/, ["simulated"]],
  [/^穿透暴露/, ["model", "derived"]], [/^相关事件/, ["model"]], [/^滚动 60 日年化波动/, ["derived"]],
  [/^每日新闻情绪/, ["model"]], [/^最新一期各模型贡献/, ["model"]], [/^明细$/, ["model"]],
  [/^总资产配置|^当前配置/, ["model"]], [/^其他要闻/, ["fact", "model"]], [/^产业链图谱/, ["model"]],
];
function kindsFor(title) { return (CARD_KINDS.find(([re]) => re.test(title)) || [null, []])[1]; }
const GLOSS_BY_ID = () => Object.fromEntries((window.GLOSSARY || []).map((g) => [g.id, g]));
function term(id, text) {
  const g = GLOSS_BY_ID()[id];
  if (!g) return esc(text || id);
  return `<a class="term" href="#/glossary?t=${id}" title="${esc(g.short)}">${esc(text || g.name)}</a>`;
}
// 文案中的 [[id]] 或 [[id|显示文字]] → 术语链接，其余文字转义
function rich(text) {
  return String(text).split(/(\[\[[^\]]+\]\])/).map((part) => {
    const m = part.match(/^\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/);
    return m ? term(m[1], m[2]) : esc(part);
  }).join("");
}
function howto(lines) {
  return `<details class="howto"><summary>如何阅读本页</summary>${lines.map((l) => `<p>${rich(l)}</p>`).join("")}
    <p class="muted">标签说明：${badges(["fact", "derived", "model", "simulated"])} —— 点击标签或带下划虚线的术语可查看解释。</p></details>`;
}
// 重点：{level: high|medium|good|info, text, kind?, target?}；按严重度排序，最多 max 条
function insightBox(list, max = 5) {
  const order = { high: 0, medium: 1, good: 2, info: 3 };
  const items = list.filter(Boolean).sort((a, b) => order[a.level] - order[b.level]).slice(0, max);
  if (!items.length) return "";
  return `<section class="insights"><h3>本页重点</h3><ul>${items.map((x) => `<li class="${x.level}">${rich(x.text)}${x.kind ? badge(x.kind) : ""}${
    x.target ? `<a class="goto" href="#" data-goto="${x.target}">查看图表 ↓</a>` : ""}</li>`).join("")}</ul></section>`;
}
function bindGoto() {
  document.querySelectorAll("a.goto").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    byId(a.dataset.goto)?.closest(".card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}
function heldTickers() { return META.universe.filter((u) => u.held).map((u) => u.ticker); }
const pp = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)} 个百分点`;

// ---------------- 路由 ----------------
function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  const parts = (path || "overview").split("/");
  return { page: parts[0] || "overview", arg: parts[1], query: Object.fromEntries(new URLSearchParams(qs || "")) };
}
const PAGES = {};
async function route() {
  const r = parseHash();
  disposeCharts();
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === r.page));
  const fn = PAGES[r.page] || PAGES.overview;
  app().innerHTML = empty("加载中…");
  try {
    await fn(r);
    bindGoto();
  } catch (e) {
    console.error(e);
    app().innerHTML = card("数据加载失败", `<p class="warn">${esc(e.message)}</p><p class="muted">可能尚未生成该部分数据（例如首份周报前）。</p>`);
  }
  if (!(r.page === "glossary" && r.query.t)) window.scrollTo(0, 0);
}

// ---------------- 1. 总览 ----------------
PAGES.overview = async () => {
  const o = await load("overview.json");
  if (!o.available) {
    app().innerHTML = `<h2>总览</h2>${howto(OVERVIEW_HOWTO)}${insightBox(overviewInsights(o))}${card("当前配置", empty("尚无正式周报存档：首份周报（周六自动运行）生成后显示当前配置、调仓与穿透暴露。"))}
      ${card("过去 26 周的配置变化（回测模拟）", o.allocation_history ? chartDiv("c-ahist") : empty("暂无"))}
      ${card("Regime 历史（总分与状态）", o.regimes ? chartDiv("c-regime", "short") : empty("暂无"))}
      ${card("策略净值（回测；对数坐标）", o.nav ? chartDiv("c-nav") : empty("暂无"))}`;
    if (o.allocation_history) allocHistoryChart(byId("c-ahist"), o.allocation_history, []);
    if (o.regimes) regimeChart(byId("c-regime"), o.regimes);
    if (o.nav) navChart(byId("c-nav"), o.nav, true);
    return;
  }
  const d = o.regime_detail || {};
  const warnings = (o.lookthrough?.warnings || []).map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("");
  app().innerHTML = `
    <h2>总览 <span class="muted">信号日 ${esc(o.signal_date)} · 建议 ${esc(o.exec_date)} 开盘执行</span></h2>
    ${howto(OVERVIEW_HOWTO)}${insightBox(overviewInsights(o))}
    <section class="card"><h3>市场状态与三项依据 ${badge("model")}${badge("fact")}</h3><div class="kpis">
      <div class="kpi"><span class="muted">${term("regime", "市场状态")}（模型判断）</span><b style="color:${REGIME_COLOR[o.regime] || "inherit"}">${esc(REGIME_ZH[o.regime] || o.regime)}</b></div>
      <div class="kpi"><span class="muted">Regime 总分</span><b>${num(d.score, 0, true)}</b></div>
      <div class="kpi"><span class="muted">SPY 相对 ${term("ma", "200 日均线")}</span><b>${pct(d.spy_vs_ma200, 1, true)}</b></div>
      <div class="kpi"><span class="muted">${term("vix")}</span><b>${num(d.vix, 1)}</b></div>
      <div class="kpi"><span class="muted">${term("yield_curve")}</span><b>${num(d.curve, 2, true)}</b></div>
    </div>${warnings}</section>
    <div class="grid two">
      ${card("总资产配置（层 → 标的）", chartDiv("c-alloc"))}
      ${card(`调仓变化（对比 ${o.prev_signal_date || "无上期"}）`, o.changes.filter((c) => c.action !== "持平").length ? chartDiv("c-changes") : empty(o.prev_signal_date ? "与上期相同" : "首期建议，无上期可比"))}
      ${card("穿透暴露：个股（直接 + 经 SPY）", o.lookthrough ? chartDiv("c-lt") : empty("暂无"))}
      ${card("穿透暴露：主题", o.lookthrough ? chartDiv("c-lt-theme", "short") : empty("暂无"))}
    </div>
    ${card("过去 26 周的配置变化（卫星按主题汇总；背景色 = 回测模拟区间，首份正式周报之前）", o.allocation_history ? chartDiv("c-ahist") : empty("暂无"))}
    ${card("Regime 历史（总分与状态）", o.regimes ? chartDiv("c-regime", "short") : empty("暂无"))}
    ${card("策略净值（回测，含最新数据；对数坐标）", o.nav ? chartDiv("c-nav") : empty("暂无"))}
    ${card("实盘跟踪", trackingTable(o.tracking))}`;
  // 配置树图
  const layers = {};
  for (const a of o.allocation) (layers[a.layer] ||= []).push(a);
  mkChart(byId("c-alloc"), {
    tooltip: { trigger: "item", formatter: (p) => `${esc(p.name)}：${pct(p.value, 1)}` }, legend: { show: false },
    series: [{ type: "treemap", roam: false, nodeClick: false, breadcrumb: { show: false }, left: 0, right: 0, top: 0, bottom: 0,
      label: { formatter: (p) => `${p.name}\n${pct(p.value, 1)}`, color: "#fff", overflow: "truncate" }, upperLabel: { show: true, height: 20, color: "#fff" },
      levels: [{ itemStyle: { gapWidth: 2, borderColor: css("--surface") } }, { itemStyle: { gapWidth: 1 } }],
      data: Object.entries(layers).map(([layer, arr], i) => ({ name: LAYER_ZH[layer] || layer,
        itemStyle: { color: layer === "satellite" ? palette()[0] : layer === "core" ? palette()[6] : layer === "hedge" ? palette()[3] : BENCH_GRAY() },
        children: arr.map((a) => ({ name: a.ticker, value: a.weight,
          itemStyle: layer === "satellite" && a.theme ? { color: themeColor(a.theme) } : undefined })) })) }],
  });
  const ch = o.changes.filter((c) => c.action !== "持平");
  if (ch.length) {
    mkChart(byId("c-changes"), {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => pct(v, 1, true) }, legend: { show: false },
      grid: { left: 90, right: 64, top: 10, bottom: 30 },
      xAxis: { type: "value", axisLabel: { formatter: (v) => pct(v, 0) } },
      yAxis: { type: "category", data: ch.map((c) => `${c.ticker}（${c.action}）`), inverse: true },
      series: [{ type: "bar", barMaxWidth: 16, data: ch.map((c) => ({ value: c.delta, itemStyle: { color: c.delta >= 0 ? css("--pos") : css("--neg"), borderRadius: 4 } })),
        label: { show: true, position: "right", formatter: (p) => pct(p.value, 1, true), color: css("--ink-2") } }],
    });
  }
  if (o.lookthrough) {
    const st = o.lookthrough.stocks.slice(0, 12);
    mkChart(byId("c-lt"), {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => pct(v, 1) },
      grid: { left: 60, right: 30, top: 44, bottom: 30 },
      xAxis: { type: "value", axisLabel: { formatter: (v) => pct(v, 0) } },
      yAxis: { type: "category", data: st.map((s) => s.ticker), inverse: true },
      series: [
        { name: "直接持仓", type: "bar", stack: "t", barMaxWidth: 14, color: palette()[0], data: st.map((s) => s.direct),
          markLine: { symbol: "none", lineStyle: { color: css("--bad"), type: "dashed" }, label: { formatter: `阈值 ${pct(o.thresholds.single, 0)}`, color: css("--bad"), position: "start" },
            data: [{ xAxis: o.thresholds.single }] } },
        { name: "经 SPY", type: "bar", stack: "t", barMaxWidth: 14, color: palette()[2], data: st.map((s) => s.via_spy) },
      ],
    });
    const th = o.lookthrough.themes;
    mkChart(byId("c-lt-theme"), {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => pct(v, 1) },
      grid: { left: 110, right: 30, top: 44, bottom: 30 },
      xAxis: { type: "value", axisLabel: { formatter: (v) => pct(v, 0) } },
      yAxis: { type: "category", data: th.map((t) => themeName(t.theme)), inverse: true },
      series: [
        { name: "直接持仓", type: "bar", stack: "t", barMaxWidth: 14, color: palette()[0], data: th.map((t) => t.direct),
          markLine: { symbol: "none", lineStyle: { color: css("--bad"), type: "dashed" }, label: { formatter: `阈值 ${pct(o.thresholds.theme, 0)}`, color: css("--bad"), position: "start" },
            data: [{ xAxis: o.thresholds.theme }] } },
        { name: "经 SPY", type: "bar", stack: "t", barMaxWidth: 14, color: palette()[2], data: th.map((t) => t.via_spy) },
      ],
    });
  }
  if (o.regimes) regimeChart(byId("c-regime"), o.regimes);
  if (o.nav) navChart(byId("c-nav"), o.nav, true);
  if (o.allocation_history) allocHistoryChart(byId("c-ahist"), o.allocation_history, o.real_signal_dates || []);
};

function allocHistoryChart(el, h, realDates) {
  const groups = [{ key: "core", name: "核心 SPY", color: palette()[6], match: (t) => t === "SPY" },
    ...META.themes.map((th) => ({ key: th.key, name: `卫星·${th.name}`, color: themeColor(th.key), match: (t) => themeOf(t) === th.key })),
    { key: "hedge", name: "对冲 GLD", color: palette()[4], match: (t) => t === "GLD" },
    { key: "cash", name: "现金", color: BENCH_GRAY(), match: (t) => t === "SPAXX" }];
  const firstReal = realDates.length ? [...realDates].sort()[0] : null;
  const simEnd = h.dates.filter((d) => !firstReal || d < firstReal).pop();
  const series = groups.map((g) => ({ name: g.name, type: "line", stack: "w", areaStyle: { opacity: 0.85 }, showSymbol: false,
    lineStyle: { width: 0 }, color: g.color,
    data: h.weights.map((w) => Object.entries(w).filter(([t]) => g.match(t)).reduce((a, [, v]) => a + v, 0)) }));
  if (simEnd) series[0].markArea = { silent: true, itemStyle: { color: css("--chip"), opacity: 0.5 }, label: { show: true, formatter: "回测模拟", color: css("--muted") },
    data: [[{ xAxis: h.dates[0] }, { xAxis: simEnd }]] };
  mkChart(el, { tooltip: { trigger: "axis", formatter: (ps) => {
      const i = ps[0].dataIndex, w = h.weights[i];
      const sat = Object.entries(w).filter(([t]) => !["SPY", "GLD", "SPAXX"].includes(t)).sort((a, b) => b[1] - a[1]).map(([t, v]) => `${t} ${pct(v, 1)}`).join("，");
      return `${h.dates[i]}${firstReal && h.dates[i] < firstReal ? "（回测模拟）" : ""}<br>${ps.map((p) => `${p.marker}${p.seriesName} ${pct(p.value, 1)}`).join("<br>")}<br><span style="opacity:.7">卫星：${sat || "–"}</span>`;
    } },
    legend: { top: 0, type: "scroll" }, grid: { left: 50, right: 20, top: 40, bottom: 30 },
    xAxis: { type: "category", data: h.dates, boundaryGap: false }, yAxis: { type: "value", max: 1, axisLabel: { formatter: (v) => pct(v, 0) } }, series });
}


const OVERVIEW_HOWTO = [
  "这一页回答“本周建议怎么配置、为什么”。顶部的[[regime|市场状态]]是模型对大环境的判断，它决定[[core|核心]]、[[satellite|卫星]]、[[hedge|对冲]]、[[cash|现金]]四层各占多少。",
  "“总资产配置”是模型给出的建议（不是你的实际持仓）；“[[lookthrough|穿透暴露]]”把 SPY 里间接持有的股票也算进来，看是否过度集中在某只股票或某个主题。",
  "“策略净值”和配置历史中标注为回测的部分属于[[simulated|模拟]]：假设过去按模型操作的结果，不是真实收益。",
];
function lastSeries(p) { return p && p.values.length ? p.values[p.values.length - 1] : null; }
function overviewInsights(o) {
  const out = [];
  const reg = o.regimes;
  if (reg && reg.regime.length) {
    const cur = reg.regime[reg.regime.length - 1];
    let n = 1;
    for (let i = reg.regime.length - 2; i >= 0 && reg.regime[i] === cur; i--) n++;
    const prev = reg.regime[reg.regime.length - 1 - n];
    out.push(n <= 4 && prev
      ? { level: "high", kind: "model", target: "c-regime", text: `[[regime|市场状态]]在 ${n} 周前由「${REGIME_ZH[prev]}」切换为「${REGIME_ZH[cur]}」，配置比例随之调整。` }
      : { level: "info", kind: "model", target: "c-regime", text: `[[regime|市场状态]]为「${REGIME_ZH[cur]}」，已连续 ${n} 周未变。` });
  }
  for (const w of (o.lookthrough?.warnings || []).slice(0, 2)) out.push({ level: "high", kind: "derived", target: "c-lt", text: `[[lookthrough|穿透暴露]]提示：${w}` });
  const ch = (o.changes || []).filter((c) => c.action !== "持平" && c.action !== "新进");
  if (ch.length) {
    const big = [...ch].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    out.push({ level: "medium", kind: "model", target: "c-changes", text: `本周调仓变化最大：${big.ticker} ${big.action} ${pct(Math.abs(big.delta), 1)}（${pct(big.prev, 1)} → ${pct(big.new, 1)}）。` });
  }
  const dd = o.drawdown?.Strategy;
  if (dd) {
    const cur = lastSeries(dd), worst = Math.min(...dd.values.filter(isNum));
    if (isNum(cur) && cur <= -0.08) out.push({ level: "high", kind: "simulated", target: "c-nav", text: `模拟策略当前处于[[drawdown|回撤]] ${pct(cur, 1)}（历史最大 ${pct(worst, 1)}）。` });
  }
  const m1y = (o.metrics || []).filter((m) => m.period === "近 1 年");
  const st = m1y.find((m) => m.strategy === "Strategy"), spy = m1y.find((m) => m.strategy === "SPY");
  if (st && spy && isNum(st.TotalReturn) && isNum(spy.TotalReturn)) {
    const gap = st.TotalReturn - spy.TotalReturn;
    out.push({ level: gap >= 0 ? "good" : "medium", kind: "simulated", target: "c-nav",
      text: `近 1 年模拟策略收益 ${pct(st.TotalReturn, 1, true)}，SPY ${pct(spy.TotalReturn, 1, true)}（${gap >= 0 ? "领先" : "落后"} ${pp(Math.abs(gap)).replace("+", "")}）；[[sharpe|夏普比率]] ${num(st.Sharpe, 2)} vs ${num(spy.Sharpe, 2)}。` });
  }
  if (o.allocation_history && !(o.real_signal_dates || []).length) {
    out.push({ level: "info", kind: "simulated", text: "尚无正式周报：配置历史全部是[[backtest|回测]]模拟，首份周报（周六）生成后开始显示真实建议。" });
  }
  return out;
}

function regimeChart(el, r) {
  // 把连续相同 regime 的区间画成背景色带
  const areas = [];
  let start = 0;
  for (let i = 1; i <= r.dates.length; i++) {
    if (i === r.dates.length || r.regime[i] !== r.regime[i - 1]) {
      areas.push([{ xAxis: r.dates[start], itemStyle: { color: REGIME_COLOR[r.regime[start]], opacity: 0.12 } }, { xAxis: r.dates[i - 1] }]);
      start = i;
    }
  }
  mkChart(el, {
    tooltip: { trigger: "axis", formatter: (ps) => {
      const i = ps[0].dataIndex;
      return `${r.dates[i]}<br>状态：${REGIME_ZH[r.regime[i]] || r.regime[i]}<br>总分：${r.score[i]}<br>SPY vs MA200：${pct(r.spy_vs_ma200[i], 1, true)}<br>VIX：${num(r.vix[i], 1)}<br>利差：${num(r.curve[i], 2, true)}`;
    } },
    legend: { show: false }, grid: { left: 40, right: 20, top: 16, bottom: 30 },
    xAxis: { type: "category", data: r.dates, boundaryGap: false },
    yAxis: { type: "value", min: -3, max: 3, interval: 1 },
    series: [{ name: "总分", type: "line", step: "end", showSymbol: false, color: palette()[0], data: r.score, markArea: { silent: true, data: areas },
      markPoint: { symbol: "roundRect", symbolSize: [86, 20], symbolOffset: [-40, -16], itemStyle: { color: REGIME_COLOR[r.regime[r.regime.length - 1]] },
        label: { color: "#fff", fontSize: 11, formatter: () => `当前：${(REGIME_ZH[r.regime[r.regime.length - 1]] || "").split("（")[0]}` },
        data: [{ coord: [r.dates[r.dates.length - 1], r.score[r.score.length - 1]] }] } }],
  });
}

function navChart(el, nav, log = true) {
  const names = Object.keys(nav);
  const series = names.map((n, i) => lineSeries(n === "Strategy" ? "策略" : n === "live" ? "实盘" : n === "backtest" ? "回测" : n, nav[n],
    n === "Strategy" || n === "live" ? { color: palette()[0] } : n === "backtest" ? { color: palette()[1] } : { color: BENCH_GRAY(), width: 1.4, dash: i % 2 ? "dotted" : "dashed" }));
  series.forEach((sr) => { sr.labelLayout = { moveOverlap: "shiftY" }; sr.endLabel = { show: true, formatter: (p) => `${p.seriesName} ${num(p.value[1], 2)}`, color: css("--ink-2"), fontSize: 11 }; });
  mkChart(el, {
    tooltip: { trigger: "axis", valueFormatter: (v) => num(v, 3) },
    grid: { left: 56, right: 90, top: 36, bottom: 40 },
    xAxis: { type: "time" },
    // 对数坐标以 2 为底：刻度落在 1、2、4、8…，比以 10 为底更易读
    yAxis: log ? { type: "log", logBase: 2, axisLabel: { formatter: (v) => num(v, v < 1 ? 2 : 0) } }
      : { type: "value", scale: true, axisLabel: { formatter: (v) => num(v, 2) } },
    dataZoom: [{ type: "inside" }], series,
  });
}

function trackingTable(t) {
  if (!t || !t.periods?.length) return empty("暂无已执行的建议：下周开始显示上期建议的实际表现。");
  const s = t.summary;
  const rows = [...t.periods].reverse().slice(0, 12).map((p) => `<tr><td>${esc(p.signal_date)}</td><td>${esc(p.start)} → ${esc(p.end)}</td>
    <td>${p.status === "completed" ? "已结束" : "进行中"}</td><td class="num"><b>${pct(p.live, 2, true)}</b></td><td class="num">${pct(p.SPY, 2, true)}</td>
    <td class="num">${pct(p.QQQ, 2, true)}</td><td class="num">${pct(p.backtest, 2, true)}</td><td class="num ${cls(p.excess_spy)}">${pct(p.excess_spy, 2, true)}</td></tr>`).join("");
  return `<div class="kpis"><div class="kpi"><span class="muted">跟踪周数</span><b>${s.weeks}</b></div>
    <div class="kpi"><span class="muted">累计（自 ${esc(s.since)}）</span><b>${pct(s.cum_live, 1, true)}</b></div>
    <div class="kpi"><span class="muted">同期 SPY</span><b>${pct(s.cum_SPY, 1, true)}</b></div>
    <div class="kpi"><span class="muted">跑赢 SPY 周数占比</span><b>${pct(s.win_rate_vs_spy, 0)}</b></div></div>
    <div class="table-wrap"><table><thead><tr><th>建议</th><th>持有区间</th><th>状态</th><th class="num">组合</th><th class="num">SPY</th><th class="num">QQQ</th><th class="num">回测</th><th class="num">vs SPY</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---------------- 2. 评分矩阵 ----------------
PAGES.matrix = async (r) => {
  const [m, h] = await Promise.all([load("matrix.json"), load("matrix_history.json").catch(() => null)]);
  const dims = m.dimensions;
  const sortKey = r.query.sort || "composite";
  const theme = r.query.theme || "";
  const date = r.query.date || m.asof;
  const hist = date !== m.asof && h ? h : null;
  let rows = m.rows;
  if (hist) {
    const di = hist.dates.indexOf(date);
    rows = di < 0 ? [] : hist.tickers.map((t, ti) => ({ ticker: t, theme: themeOf(t), weight: 0, raw: null,
      scores: Object.fromEntries(hist.dimensions.map((k, ki) => [k, hist.values[di][ti][ki]])) }));
  }
  rows = rows.filter((x) => !theme || x.theme === theme);
  rows.sort((a, b) => (b.scores[sortKey] ?? -1) - (a.scores[sortKey] ?? -1));
  const q = (o) => { const p = new URLSearchParams({ sort: sortKey, ...(theme ? { theme } : {}), ...(date !== m.asof ? { date } : {}), ...o }); for (const [k, v] of [...p]) if (!v) p.delete(k); return `#/matrix?${p}`; };
  const opts = dims.map((d) => `<option value="${d.key}" ${d.key === sortKey ? "selected" : ""}>${esc(d.name)}</option>`).join("");
  const themeOpts = `<option value="">全部主题</option>` + META.themes.map((t) => `<option value="${t.key}" ${t.key === theme ? "selected" : ""}>${esc(t.name)}</option>`).join("");
  const dates = h ? [...h.dates].reverse().filter((d) => d !== m.asof) : [];
  const dateOpts = `<option value="">${esc(m.asof)}（最新周报）</option>` + dates.map((d) => `<option value="${d}" ${d === date ? "selected" : ""}>${d}</option>`).join("");
  app().innerHTML = `
    <h2>评分矩阵 <span class="muted">信号日 ${esc(date)} · 分位 0–100，越高越好 · ● 持仓 ★ 关注列表${hist ? " · 历史周：综合信号为 A/B/C ensemble 分位，估值 / 情绪仅在有存档时显示" : ""}</span></h2>
    ${howto(MATRIX_HOWTO)}${insightBox(matrixInsights(m, h, rows, date))}
    <section class="card"><h3>评分矩阵 ${badge("model")}${badge("derived")}</h3>
      <p class="muted">“${term("composite", "综合信号")}”列是模型判断；其余各列由行情数据按固定公式计算的${term("percentile", "分位")}，“新闻情绪”列为 AI 打分。</p>
      <div class="row">
      <label>日期 <select id="m-date">${dateOpts}</select></label>
      <label>排序 <select id="m-sort">${opts}</select></label>
      <label>主题 <select id="m-theme">${themeOpts}</select></label>
      <span class="muted">点击单元格查看个股详情</span></div>
      ${rows.length ? `<div id="c-matrix" class="chart" style="height:${Math.max(360, rows.length * 30 + 90)}px"></div>` : empty("该日期无数据")}
    </section>
    ${card("口径说明", `<ul class="muted">${Object.entries(m.notes).map(([k, v]) => `<li><b>${esc(dims.find((d) => d.key === k)?.name || k)}</b>：${esc(v)}</li>`).join("")}
      <li>其余维度为对应因子在选股池内的截面分位均值：动量（12-1、26 周、12 周）、趋势（相对 MA200、MA50/MA200、MA200 斜率）、相对强弱（相对主题基准与 SPY）、低波动（60 日波动与下行波动取反）</li></ul>`)}`;
  byId("m-date").onchange = (e) => { location.hash = q({ date: e.target.value }); };
  byId("m-sort").onchange = (e) => { location.hash = q({ sort: e.target.value }); };
  byId("m-theme").onchange = (e) => { location.hash = q({ theme: e.target.value }); };
  if (!rows.length) return;
  const data = [];
  rows.forEach((row, yi) => dims.forEach((d, xi) => data.push([xi, yi, isNum(row.scores[d.key]) ? Math.round(row.scores[d.key]) : "-"])));
  const c = mkChart(byId("c-matrix"), {
    tooltip: { trigger: "item", formatter: (p) => {
      const row = rows[p.value[1]], raw = row.raw, d = dims[p.value[0]];
      const head = `<b>${esc(row.ticker)}</b>（${esc(themeName(row.theme))}）${row.weight ? ` · 权重 ${pct(row.weight, 1)}` : ""}<br>${esc(d.name)}：<b>${p.value[2]}</b>`;
      if (!raw) return head;
      return `${head}<br><span style="opacity:.75">信号分 ${num(raw.score, 3)} · 12-1 动量 ${pct(raw.mom_12_1, 1)} · 相对 MA200 ${pct(raw.px_ma200, 1, true)}<br>
        12 周相对 SPY ${pct(raw.rs_spy_12w, 1, true)} · 60 日波动 ${pct(raw.vol_60d, 0)} · Forward PE ${num(raw.forward_pe, 1)}<br>
        7 日新闻情绪 ${num(raw.news_sentiment, 2, true)}（${raw.news_count} 条）· 距财报 ${raw.days_to_earnings ?? "–"} 个交易日</span>`;
    } },
    legend: { show: false }, grid: { left: 90, right: 20, top: 40, bottom: 60 },
    xAxis: { type: "category", data: dims.map((d) => d.name), position: "top", splitArea: { show: false }, axisLabel: { color: css("--ink-2"), interval: 0 } },
    yAxis: { type: "category", data: rows.map((x) => tickerLabel(x.ticker)), inverse: true,
      axisLabel: { color: (v, i) => themeColor(rows[i]?.theme), fontWeight: 600 } },
    visualMap: { min: 0, max: 100, calculable: false, orient: "horizontal", left: "center", bottom: 4, itemWidth: 12, itemHeight: 160,
      text: ["100 强", "0 弱"], textStyle: { color: css("--muted") }, inRange: { color: divergingColors() } },
    series: [{ type: "heatmap", data, label: { show: true, color: css("--ink"), fontSize: 11 },
      itemStyle: { borderColor: css("--surface"), borderWidth: 2, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: css("--ink") } } }],
  });
  c?.on("click", (p) => { location.hash = `#/stock/${rows[p.value[1]].ticker}`; });
};


const MATRIX_HOWTO = [
  "每一行是一只候选股票，每一列是一个维度；格子里的数字是该股票在 21 只股票中的[[percentile|分位]]：100 = 最强，50 = 中间，0 = 最弱。蓝色越深越强，红色越深越弱。",
  "“[[composite|综合信号]]”是模型把各维度合成后的看法，决定卫星仓买哪些股票；其余列（[[momentum|动量]]、[[trend|趋势]]、[[relative_strength|相对强弱]]、[[volatility|低波动]]、[[valuation|估值]]、[[earnings|事件风险]]）是由行情按公式算出的客观描述，[[sentiment|新闻情绪]]是 AI 打分。",
  "用“日期”可以回看过去 26 周；● 表示当前建议持有，★ 表示你的关注列表。",
];
function matrixInsights(m, h, rows, date) {
  const out = [];
  const held = new Set(heldTickers());
  const dimName = Object.fromEntries(m.dimensions.map((d) => [d.key, d.name]));
  for (const r of rows.filter((x) => held.has(x.ticker))) {
    const weak = Object.entries(r.scores).filter(([k, v]) => k !== "composite" && isNum(v) && v < 20).map(([k]) => dimName[k]);
    if (weak.length) out.push({ level: "medium", kind: "derived", target: "c-matrix", text: `持仓 ${r.ticker} 在「${weak.join("、")}」上处于最弱的 1/5，是它的短板。` });
    if (isNum(r.scores.composite) && r.scores.composite < 35) out.push({ level: "high", kind: "model", target: "c-matrix", text: `持仓 ${r.ticker} 的[[composite|综合信号]]分位已降到 ${Math.round(r.scores.composite)}，若继续走弱可能在下次调仓中被移出。` });
  }
  const allStrong = rows.filter((r) => Object.entries(r.scores).filter(([k, v]) => k !== "composite" && isNum(v) && v >= 70).length >= 4);
  if (allStrong.length) out.push({ level: "good", kind: "derived", target: "c-matrix", text: `多个维度同时靠前（≥4 个维度分位 ≥70）：${allStrong.map((r) => r.ticker).join("、")}。` });
  if (h && h.dates.length >= 5 && date === m.asof) {
    const i1 = h.dates.length - 1, i0 = i1 - 4;
    const ci = h.dimensions.indexOf("composite");
    const moves = h.tickers.map((t, ti) => ({ t, d: (h.values[i1][ti][ci] ?? NaN) - (h.values[i0][ti][ci] ?? NaN) })).filter((x) => isNum(x.d));
    moves.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    const big = moves.filter((x) => Math.abs(x.d) >= 30).slice(0, 3);
    if (big.length) out.push({ level: "medium", kind: "model", target: "c-matrix", text: `近 4 周[[composite|综合信号]]变化最大：${big.map((x) => `${x.t} ${x.d > 0 ? "+" : ""}${Math.round(x.d)}`).join("，")}（分位点）。` });
  }
  return out;
}

// ---------------- 3. 新闻与产业链 ----------------
PAGES.news = async (r) => {
  const idx = await load("news/index.json");
  const days = idx.days;
  const weeks = idx.weeks || [];
  if (!days.length && !weeks.length) { app().innerHTML = card("新闻与产业链", empty("尚无新闻存档。")) + graphCard(); await drawGraph(idx.graph, null); return; }
  const latest = days.length ? days[days.length - 1].date : weeks[weeks.length - 1].week_end;
  const weekOf = (d) => { const x = new Date(`${d}T12:00:00Z`); const wd = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - wd); return x.toISOString().slice(0, 10); };
  const plusDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const curWeek = weekOf(latest);
  // 选择：date=具体某天；week=某一周（默认本周）
  const week = r.query.date ? null : (r.query.week || curWeek);
  const pickDays = week ? days.filter((d) => d.date >= week && d.date <= plusDays(week, 6)) : days.filter((d) => d.date === r.query.date);
  const [recs, digest] = await Promise.all([
    Promise.all(pickDays.map((d) => load(`news/${d.date}.json`))),
    week && weeks.some((w) => w.week_start === week) ? load(`news/weeks/${week}.json`) : Promise.resolve(null),
  ]);
  const ticker = r.query.ticker || "";
  let events = [...(digest?.events || []).map((e) => ({ ...e, date: (e.sources?.[0]?.date) || week })),
    ...recs.flatMap((rec) => (rec.events || []).map((e) => ({ ...e, date: rec.date })))];
  let briefs = recs.flatMap((rec) => (rec.briefs || []).map((b) => ({ ...b, date: rec.date })));
  let articles = recs.flatMap((rec) => rec.articles || []);
  if (ticker) {
    const hit = (e) => (e.tickers || []).includes(ticker) || (e.propagation || []).some((p) => p.node === ticker) || (e.direct_impacts || []).some((p) => p.node === ticker);
    events = events.filter(hit); briefs = briefs.filter((b) => (b.tickers || []).includes(ticker)); articles = articles.filter((a) => (a.tickers || []).includes(ticker));
  }
  events.sort((a, b) => (b.date.localeCompare(a.date)) || ((b.importance || 0) - (a.importance || 0)));
  briefs.sort((a, b) => b.date.localeCompare(a.date));
  const allWeeks = [...new Set([curWeek, ...weeks.map((w) => w.week_start), ...days.map((d) => weekOf(d.date))])].sort().reverse();
  const weekOpts = allWeeks.map((w) => `<option value="w:${w}" ${week === w ? "selected" : ""}>${w === curWeek ? "本周" : "周"} ${w} – ${plusDays(w, 6).slice(5)}${weeks.some((x) => x.week_start === w) ? " · 有周摘要" : ""}</option>`).join("");
  const dayOpts = [...days].reverse().slice(0, 21).map((d) => `<option value="d:${d.date}" ${r.query.date === d.date ? "selected" : ""}>${d.date}${d.mode === "weekend" ? "（周末汇总）" : d.mode === "backfill" ? "（回补）" : ""}</option>`).join("");
  const tickOpts = `<option value="">全部股票</option>` + META.universe.map((u) => `<option ${u.ticker === ticker ? "selected" : ""}>${u.ticker}</option>`).join("");
  const digestHtml = digest?.digest ? card(`本周摘要（${digest.week_start} – ${digest.week_end}${digest.holdings_source === "backtest_simulated" ? "；组合含义基于回测模拟配置" : ""}）`,
    `<p>${esc(digest.digest.summary)}</p><ul>${digest.digest.highlights.map((h) => `<li>${esc(h.text)} <span class="src">${srcLinks(h.sources, 2)}</span></li>`).join("")}</ul>`) : "";
  app().innerHTML = `
    <h2>新闻与产业链</h2>
    <section class="card"><div class="row">
      <label>范围 <select id="n-range"><optgroup label="按周">${weekOpts}</optgroup><optgroup label="按天（最近 21 天）">${dayOpts}</optgroup></select></label>
      <label>股票 <select id="n-ticker">${tickOpts}</select></label>
      <span class="muted">深度事件 ${events.length} · 其他要闻 ${briefs.length} · 相关报道 ${articles.length}</span></div>
      <p class="muted">历史回补的新闻：情绪由 FinBERT 判断；每周仅对最重要的 2–3 个事件做 LLM 深度分析。</p></section>
    ${howto(NEWS_HOWTO)}${insightBox(newsInsights(events))}
    ${digestHtml}
    <div class="grid" style="grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); align-items: start;">
      <section class="card"><h3>深度分析（点击事件，在右侧产业链图中查看传导）${badge("fact")}${badge("model")}</h3>
      <p class="muted">每个事件中“关键事实”来自新闻原文（附链接）；“直接影响”“产业链传导”“对组合的含义”是 AI 推断。</p>${events.map(eventCard).join("") || empty("该范围内没有深度分析事件")}</section>
      <div>${graphCard()}${card("其他要闻", briefs.slice(0, 40).map((b) => `<p>• <span class="chip">${esc(b.date.slice(5))}</span>${esc((b.tickers || []).join("/") || "行业")}：${esc(b.text)} <span class="src">${srcLinks(b.sources, 1)}</span></p>`).join("") || empty("无"))}
      ${card(`相关报道（${Math.min(articles.length, 80)} / ${articles.length}）`, `<div class="table-wrap"><table><tbody>${articles.slice(0, 80).map((a) => `<tr><td class="num ${cls(a.sentiment)}">${num(a.sentiment, 2, true)}</td><td class="wrap"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a> <span class="muted">${esc(a.publisher || "")} · ${esc((a.published || "").slice(5, 16).replace("T", " "))}</span></td></tr>`).join("")}</tbody></table></div>`)}</div>
    </div>`;
  byId("n-range").onchange = (e) => { const [k, v] = e.target.value.split(":"); location.hash = `#/news?${k === "w" ? "week" : "date"}=${v}${ticker ? `&ticker=${ticker}` : ""}`; };
  byId("n-ticker").onchange = (e) => { location.hash = `#/news?${week ? `week=${week}` : `date=${r.query.date}`}${e.target.value ? `&ticker=${e.target.value}` : ""}`; };
  const selected = events.find((e) => e.event_id === r.query.event) || events[0] || null;
  const chart = await drawGraph(idx.graph, selected);
  document.querySelectorAll(".event").forEach((el) => {
    if (selected && el.dataset.id === selected.event_id) el.classList.add("selected");
    el.addEventListener("click", () => {
      document.querySelectorAll(".event").forEach((x) => x.classList.remove("selected"));
      el.classList.add("selected");
      const ev = events.find((e) => e.event_id === el.dataset.id);
      if (chart) chart.showEvent(ev);
    });
  });
  if (r.query.event) document.querySelector(`.event[data-id="${CSS.escape(r.query.event)}"]`)?.scrollIntoView({ block: "center" });
};


const NEWS_HOWTO = [
  "上方选择查看的周或某一天。左侧是 AI 挑出的重要事件：先看“关键事实”（每条都附新闻原文链接，是[[fact|事实]]），再看 AI 的推断——“直接影响”“[[supply_chain|产业链传导]]”“对组合的含义”（[[model|模型 / AI]]，注意[[confidence|置信度]]）。",
  "右侧产业链图：点一个事件，受影响的公司会变色（绿 = 利好，红 = 利空，黄 = 影响不一），灰色是未受影响的公司。",
  "历史回补的周只有新闻标题，情绪由 [[finbert|FinBERT]] 判断、每周仅分析 2–3 个最重要的事件，准确度低于每日推送。",
];
function newsInsights(events) {
  const out = [];
  const held = new Set(heldTickers());
  const neg = events.filter((e) => (e.direct_impacts || []).some((d) => held.has(d.node) && d.direction === "negative"));
  for (const e of neg.slice(0, 2)) out.push({ level: "high", kind: "model", text: `利空持仓：${(e.direct_impacts || []).filter((d) => held.has(d.node) && d.direction === "negative").map((d) => d.node).join("、")} —— ${e.headline}（${e.date}）` });
  const spill = events.filter((e) => !(e.tickers || []).some((t) => held.has(t)) && (e.propagation || []).some((p) => held.has(p.node) && p.confidence !== "low"));
  for (const e of spill.slice(0, 2)) {
    const hit = (e.propagation || []).filter((p) => held.has(p.node) && p.confidence !== "low");
    out.push({ level: "medium", kind: "model", text: `非持仓事件经[[supply_chain|产业链]]影响到持仓 ${hit.map((p) => `${p.node}（${DIR_ZH[p.direction]}）`).join("、")}：${e.headline}` });
  }
  const pos = events.filter((e) => (e.direct_impacts || []).some((d) => d.direction === "positive")).length;
  const negAll = events.filter((e) => (e.direct_impacts || []).some((d) => d.direction === "negative")).length;
  if (events.length) out.push({ level: "info", kind: "model", text: `该范围共 ${events.length} 个深度分析事件：偏利好 ${pos} 个，偏利空 ${negAll} 个。` });
  return out;
}

function overallDirection(e) {
  const ds = [...new Set((e.direct_impacts || []).map((d) => d.direction))];
  return ds.length === 1 ? ds[0] : ds.length ? "mixed" : "neutral";
}
function eventCard(e) {
  const facts = (e.facts || []).map((f) => `<li>${esc(f.text)} <span class="src">${srcLinks(f.sources, 2)}</span></li>`).join("");
  const direct = (e.direct_impacts || []).map((d) => `<li><b>${esc(d.node)}</b> <span class="${d.direction === "positive" ? "pos" : d.direction === "negative" ? "neg" : ""}">${DIR_ZH[d.direction]}</span> · 程度${LEVEL_ZH[d.magnitude]} · ${HORIZON_ZH[d.horizon]}：${esc(d.rationale)}</li>`).join("");
  const prop = (e.propagation || []).map((p) => `<li>${esc(REL_ZH[p.relation] || p.relation)} <b>${esc(p.node)}</b> <span class="${p.direction === "positive" ? "pos" : p.direction === "negative" ? "neg" : ""}">${DIR_ZH[p.direction]}</span>（置信度${LEVEL_ZH[p.confidence]}）：${esc(p.rationale)}</li>`).join("");
  return `<article class="event ${overallDirection(e)}" data-id="${esc(e.event_id)}">
    <div><span class="chip">${esc(e.date)}</span><span class="chip ${e.priority === "holding" ? "holding" : ""}">${esc(PRIORITY_ZH[e.priority] || "")}</span>
      <span class="chip">${esc((e.tickers || []).join("/") || "行业")}</span><span class="chip">${esc(EVENT_ZH[e.event_type] || e.event_type)}</span>
      <span class="chip">${esc(TIER_ZH[e.tier] || e.tier)}</span></div>
    <h4>${esc(e.headline)}</h4><p>${esc(e.summary)}</p>
    ${facts ? `<b>关键事实</b><ul>${facts}</ul>` : ""}
    ${direct ? `<b>直接影响</b><ul>${direct}</ul>` : ""}
    ${prop ? `<b>产业链传导（推断）</b><ul>${prop}</ul>` : ""}
    <p><b>对组合的含义：</b>${esc(e.portfolio_implication)}</p>
    <p><b>需跟踪的信号：</b>${(e.watch_items || []).map(esc).join("；")}</p>
    <p><b>与量化信号：</b>${esc(e.signal_consistency)}</p>
    <p class="src">来源：${srcLinks(e.sources, 5)}</p></article>`;
}
function graphCard() {
  return card("产业链图谱（选中事件的影响：绿 = 利好，红 = 利空，黄 = 不一）",
    `<p class="muted">实线箭头 = 供应（上游 → 下游），虚线 = 竞争，绿线 = 合作；点击公司查看个股页（含业务构成与业务关联图）。</p>${chartDiv("c-graph", "tall")}`);
}
function eventImpact(ev) {
  const impact = {};
  if (ev) {
    for (const d of ev.direct_impacts || []) impact[d.node] = d.direction;
    for (const p of ev.propagation || []) if (!(p.node in impact)) impact[p.node] = p.direction;
  }
  return impact;
}
const EDGE_ZH = { supplier: "供应", competitor: "竞争", partner: "合作", investor: "持股" };
const edgeColors = () => ({ supplier: palette()[0], competitor: palette()[7], partner: palette()[2], investor: palette()[6] });
function graphOption(g, ev) {
  const impact = eventImpact(ev);
  const dirColor = { positive: "#0ca30c", negative: "#d03b3b", mixed: "#fab219", neutral: "#898781" };
  const hasEv = !!ev;
  const nodes = g.nodes.map((n) => {
    const touched = n.id in impact;
    return { id: n.id, name: n.id, value: n.name,
      symbolSize: n.in_universe ? 26 : 18, symbol: n.kind === "segment" ? "roundRect" : "circle",
      itemStyle: { color: touched ? dirColor[impact[n.id]] : n.theme ? themeColor(n.theme) : BENCH_GRAY(),
        opacity: hasEv && !touched ? 0.35 : 1, borderColor: css("--surface"), borderWidth: 2 },
      label: { show: true, color: css("--ink-2"), fontSize: 11, opacity: hasEv && !touched ? 0.5 : 1 } };
  });
  const ec = edgeColors();
  const links = g.edges.map((e) => {
    const on = hasEv && e.source in impact && e.target in impact;
    return { source: e.source, target: e.target, value: e.note, relation: e.type,
      symbol: e.type === "supplier" || e.type === "investor" ? ["none", "arrow"] : ["none", "none"], symbolSize: 6,
      lineStyle: { color: ec[e.type], width: on ? 2.2 : 1, opacity: hasEv ? (on ? 0.9 : 0.12) : 0.45, curveness: 0.1,
        type: e.type === "competitor" ? "dashed" : "solid" } };
  });
  return baseOption({
    tooltip: { trigger: "item", formatter: (p) => p.dataType === "edge"
      ? `${esc(p.data.source)} → ${esc(p.data.target)}<br>${EDGE_ZH[p.data.relation]}：${esc(p.data.value)}`
      : `<b>${esc(p.data.name)}</b> ${esc(p.data.value)}${impact[p.data.id] ? `<br>本事件：${DIR_ZH[impact[p.data.id]]}` : ""}` },
    legend: { show: false },
    series: [{ type: "graph", layout: "force", roam: true, draggable: true, data: nodes, links,
      force: { repulsion: 220, edgeLength: [50, 120], gravity: 0.08 }, emphasis: { focus: "adjacency" } }],
  });
}
async function drawGraph(g, ev) {
  const el = byId("c-graph");
  if (!el || !window.echarts) return null;
  const c = echarts.init(el);
  charts.push(c);
  c.setOption(graphOption(g, ev));
  c.on("click", (p) => { if (p.dataType === "node" && META.universe.some((u) => u.ticker === p.data.id)) location.hash = `#/stock/${p.data.id}`; });
  c.showEvent = (e) => c.setOption(graphOption(g, e), true);
  return c;
}

// ---------------- 4. 信号 × 新闻 ----------------

const SN_HOWTO = [
  "横轴是模型对股票的看法（[[composite|量化信号]][[percentile|分位]]），纵轴是最近 7 天新闻的平均情绪（AI 打分后的分位）。两者都是[[model|模型 / AI]]判断。",
  "右上角 = 模型看好且新闻正面（一致）；左下角 = 两者都偏负面；左上和右下 = 两者意见相反（冲突），值得多看一眼新闻原文。",
  "点击某只股票可跳到它的相关新闻。",
];
function snInsights(points) {
  const out = [];
  const held = new Set(heldTickers());
  const conf = points.filter((p) => p.label === "冲突");
  const heldConf = conf.filter((p) => held.has(p.ticker));
  for (const p of heldConf.slice(0, 3)) out.push({ level: "high", kind: "model", target: "c-sn",
    text: `持仓 ${p.ticker} 信号与新闻冲突：量化分位 ${Math.round(p.quant_pct)}，新闻情绪分位 ${Math.round(p.sent_pct)}（7 日情绪 ${num(p.sentiment, 2, true)}，${p.news_count} 篇）。` });
  if (conf.length) out.push({ level: "info", kind: "model", target: "c-sn", text: `共有 ${conf.length} 只股票信号与新闻方向相反：${conf.map((p) => p.ticker).join("、")}。` });
  const both = points.filter((p) => p.label === "一致" && p.quant_pct >= 70 && p.sent_pct >= 70);
  if (both.length) out.push({ level: "good", kind: "model", target: "c-sn", text: `模型和新闻同时明显看好：${both.map((p) => p.ticker).join("、")}。` });
  const ss = points.filter((p) => isNum(p.sentiment) && p.news_count >= 5).sort((a, b) => a.sentiment - b.sentiment);
  if (ss.length >= 2) {
    const lo = ss[0], hi = ss[ss.length - 1];
    out.push({ level: held.has(lo.ticker) && lo.sentiment < 0 ? "medium" : "info", kind: "model",
      text: `近 7 天[[sentiment|新闻情绪]]最正面：${hi.ticker}（${num(hi.sentiment, 2, true)}，${hi.news_count} 篇）；最负面：${lo.ticker}（${num(lo.sentiment, 2, true)}，${lo.news_count} 篇）。` });
  }
  if (!points.some((p) => isNum(p.quant_pct))) out.push({ level: "info", kind: "model", text: "该周尚无量化分位（首份正式周报生成后显示），散点图暂不可用，仅显示新闻情绪。" });
  return out;
}

PAGES["signal-news"] = async (r) => {
  const s = await load("signal_news.json");
  const snaps = s.snapshots || [];
  const wk = r.query.week || "";
  const snap = snaps.find((x) => x.date === wk);
  const points = snap ? snap.points : s.points;
  const pts = points.filter((p) => isNum(p.quant_pct) && isNum(p.sent_pct));
  const weekOpts = `<option value="">${esc(s.signal_date || "最新")}（最新周报）</option>` + [...snaps].reverse().map((x) => `<option value="${x.date}" ${x.date === wk ? "selected" : ""}>${x.date}</option>`).join("");
  app().innerHTML = `
    <h2>信号 × 新闻 <span class="muted">量化信号为该周 A/B/C ensemble 分位；新闻情绪为该周信号日前 7 天</span></h2>
    ${howto(SN_HOWTO)}${insightBox(snInsights(points))}
    <section class="card"><label>周 <select id="sn-week">${weekOpts}</select></label> <span class="muted">历史周的量化信号来自回测（首份正式周报之前为模拟）</span></section>
    ${card("量化分位 vs 新闻情绪分位（气泡大小 = 新闻数；点击查看相关新闻）", pts.length ? `<p class="muted">右上 = 一致看多 · 左下 = 一致看空 · 左上 = 新闻正面但信号弱（冲突）· 右下 = 信号强但新闻负面（冲突）</p>${chartDiv("c-sn", "tall")}` : empty("数据不足：需要周报存档与每日新闻"))}
    ${card("明细", `<div class="table-wrap"><table><thead><tr><th>股票</th><th>主题</th><th class="num">量化分位</th><th class="num">情绪分位</th><th class="num">7 日情绪</th><th class="num">新闻数</th><th class="num">权重</th><th>判断</th></tr></thead><tbody>${
      [...points].sort((a, b) => (b.quant_pct ?? -1) - (a.quant_pct ?? -1)).map((p) => `<tr><td><a href="#/news?ticker=${p.ticker}">${esc(tickerLabel(p.ticker))}</a></td><td>${esc(themeName(p.theme))}</td>
      <td class="num">${num(p.quant_pct, 0)}</td><td class="num">${num(p.sent_pct, 0)}</td><td class="num ${cls(p.sentiment)}">${num(p.sentiment, 2, true)}</td><td class="num">${p.news_count}</td><td class="num">${p.weight ? pct(p.weight, 1) : ""}</td>
      <td>${p.label === "冲突" ? '<b class="neg">冲突</b>' : p.label === "一致" ? '<b class="pos">一致</b>' : esc(p.label)}</td></tr>`).join("")}</tbody></table></div>`)}`;
  byId("sn-week").onchange = (e) => { location.hash = `#/signal-news${e.target.value ? `?week=${e.target.value}` : ""}`; };
  if (!pts.length) return;
  const byTheme = {};
  for (const p of pts) (byTheme[p.theme] ||= []).push(p);
  const c = mkChart(byId("c-sn"), {
    tooltip: { trigger: "item", formatter: (p) => { const d = p.data.raw; return `<b>${esc(d.ticker)}</b>（${esc(themeName(d.theme))}）<br>量化分位 ${num(d.quant_pct, 0)} · 情绪分位 ${num(d.sent_pct, 0)}<br>7 日情绪 ${num(d.sentiment, 2, true)}（${d.news_count} 条）<br>判断：${esc(d.label)}`; } },
    grid: { left: 56, right: 56, top: 40, bottom: 50 },
    xAxis: { type: "value", min: -4, max: 104, interval: 20, name: "量化信号分位", nameLocation: "middle", nameGap: 28,
      axisLabel: { formatter: (v) => (v >= 0 && v <= 100 ? v : "") } },
    yAxis: { type: "value", min: -4, max: 104, interval: 20, name: "新闻情绪分位", nameLocation: "middle", nameGap: 36,
      axisLabel: { formatter: (v) => (v >= 0 && v <= 100 ? v : "") } },
    series: Object.entries(byTheme).map(([th, arr]) => ({ name: themeName(th), type: "scatter", color: themeColor(th),
      symbolSize: (v, p) => 10 + Math.sqrt(p.data.raw.news_count) * 4,
      itemStyle: { borderColor: css("--surface"), borderWidth: 2 },
      label: { show: true, formatter: (p) => p.data.raw.ticker, position: "right", color: css("--ink-2"), fontSize: 11 },
      data: arr.map((p) => ({ value: [p.quant_pct, p.sent_pct], raw: p })),
      markLine: th === Object.keys(byTheme)[0] ? { silent: true, symbol: "none", lineStyle: { color: css("--axis"), type: "dashed" }, label: { show: false }, data: [{ xAxis: 50 }, { yAxis: 50 }] } : undefined,
    })),
  });
  c?.on("click", (p) => { location.hash = `#/news?ticker=${p.data.raw.ticker}`; });
};

// ---------------- 5. 个股 ----------------

const STOCK_HOWTO = [
  "K 线：每根柱子是一天的开盘到收盘，绿色 = 当天上涨，红色 = 下跌；蓝线和橙线是 50 日与 200 日[[ma|均线]]，价格在橙线之上通常表示长期向上。",
  "📍 标记是 AI 分析过的新闻事件；◆ ▲ ○ 是系统识别的[[turning_point|转折点]]：◆ 公司自身事件驱动（附 AI 归因，属推断），▲ 主要由大盘或板块带动（按 [[beta|β]] 计算），○ 证据不足、不做解释。点击任一标记查看详情。",
  "“业务关联”以本公司各业务为中心，画出直接相关的上游供应商、下游客户、竞争对手（细化到对方的具体业务），用来判断一条新闻会通过哪块业务影响这家公司。",
  "“收入结构”来自公司财报：[[segment_revenue|分业务收入]]看公司靠什么赚钱，[[geo_revenue|分地区收入]]看钱从哪里来；可切换“占比 / 金额”，下表给出最新一期的[[yoy|同比]]和[[share_change|占比变化]]。",
  "下方小图分别是每日新闻[[sentiment|情绪]]（AI 打分）、[[composite|综合信号]]分位历史（模型）、各模型对当前分数的贡献。",
];
function stockInsights(s, t) {
  const out = [];
  const n = s.dates.length;
  const close = s.ohlc[n - 1]?.[1], ma200 = s.ma200[n - 1];
  if (isNum(close) && isNum(ma200)) {
    const gap = close / ma200 - 1;
    out.push({ level: gap < 0 ? "medium" : "info", kind: "derived", target: "c-k", text: `当前价格${gap >= 0 ? "高于" : "低于"} 200 日[[ma|均线]] ${pct(Math.abs(gap), 1)}，${gap >= 0 ? "长期趋势向上" : "长期趋势偏弱"}。` });
  }
  const next = (s.earnings || []).filter((d) => d > s.dates[n - 1]).sort()[0];
  if (next) {
    const days = Math.round((new Date(next) - new Date(s.dates[n - 1])) / 86400000);
    if (days <= 14) out.push({ level: "high", kind: "fact", text: `${t} 将在 ${next}（约 ${days} 天后）发布[[earnings|财报]]，前后股价可能大幅波动。` });
  }
  const tp = (s.turning || []).slice(-1)[0];
  if (tp) out.push({ level: tp.category === "company" ? "medium" : "info", kind: tp.category === "company" ? "model" : "derived", target: "c-k",
    text: `最近的[[turning_point|转折点]]：${tp.date} ${TP_KIND_ZH[tp.kind]}，区间 ${pct(tp.move, 1, true)}，判断为「${tp.category_zh}」${tp.explanation ? `：${tp.explanation}` : ""}` });
  const comp = (s.turning || []).filter((x) => x.category === "company").length;
  if (comp) out.push({ level: "info", kind: "model", text: `近半年有 ${comp} 个转折点可由公司自身事件解释（见下方转折点详情）。` });
  const hv = (s.score_history?.values || []).filter(isNum);
  if (hv.length >= 5) {
    const d = hv[hv.length - 1] - hv[hv.length - 5];
    if (Math.abs(d) >= 25) out.push({ level: "medium", kind: "model", target: "c-hist", text: `[[composite|综合信号]]分位近 4 周${d > 0 ? "上升" : "下降"} ${Math.round(Math.abs(d))}（${Math.round(hv[hv.length - 5])} → ${Math.round(hv[hv.length - 1])}）。` });
  }
  const sd = Object.keys(s.sentiment || {}).sort();
  if (sd.length >= 6) {
    const recent = sd.slice(-3).map((d) => s.sentiment[d].mean), before = sd.slice(-6, -3).map((d) => s.sentiment[d].mean);
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    if (recent.every((v) => v < 0)) out.push({ level: "medium", kind: "model", target: "c-sent", text: `最近 3 个有新闻的日子[[sentiment|新闻情绪]]均为负（此前均值 ${num(avg(before), 2, true)}）。` });
  }
  return out;
}


// ---------------- 业务 / 地区收入（SEC 财报） ----------------
const REGION_COLOR = { us: "#2a78d6", americas: "#5b9be6", americas_other: "#9cc3f0", china: "#e34948", taiwan: "#eb6834",
  japan: "#1baf7a", korea: "#0e8a5f", singapore: "#6fd0a8", asia_pacific: "#eda100", asia_other: "#f3c75a",
  europe: "#4a3aa7", non_us: "#a9a7a0", other: "#c9c7c0" };
const CUR_ZH = { USD: "十亿美元", TWD: "十亿新台币", EUR: "十亿欧元" };
const OTHER_GRAY = () => (isDark() ? "#55544f" : "#d3d1ca");
const periodLabel = (p, freq) => (freq === "annual" ? `${p.slice(0, 4)} 财年` : p.slice(0, 7));
const ppText = (v) => (isNum(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}` : "–");
function segChart(el, g, kind, mode, currency) {
  const colors = g.meta.map((m, i) => (kind === "geography" ? REGION_COLOR[m.key] : palette()[i % 8]) || BENCH_GRAY());
  const val = (v, i) => (v == null ? null : mode === "share" ? (g.total[i] ? (v / g.total[i]) * 100 : null) : v / 1e9);
  const series = g.meta.map((m, i) => ({ name: m.name, type: "bar", stack: "s", barMaxWidth: 30, color: colors[i],
    itemStyle: { borderColor: css("--surface"), borderWidth: 1 }, data: g.items[m.key].map(val) }));
  if (g.other.some((v) => v != null)) series.push({ name: "其他 / 未归类", type: "bar", stack: "s", barMaxWidth: 30, color: OTHER_GRAY(),
    itemStyle: { borderColor: css("--surface"), borderWidth: 1 }, data: g.other.map(val) });
  return mkChart(el, {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => (v == null ? "–" : mode === "share" ? `${v.toFixed(1)}%` : v.toFixed(2)) },
    legend: { type: "scroll", top: 0 }, grid: { left: 52, right: 16, top: 44, bottom: 30 },
    xAxis: { type: "category", data: g.periods.map((p) => periodLabel(p, g.frequency)) },
    yAxis: { type: "value", max: mode === "share" ? 100 : null, name: mode === "share" ? "" : CUR_ZH[currency] || currency,
      axisLabel: { formatter: (v) => (mode === "share" ? `${v}%` : v) } },
    series });
}
function segTable(c) {
  const block = (g, label) => g ? g.latest.map((r, i) => `<tr><td>${i === 0 ? label : ""}</td><td>${esc(r.name)}</td>
    <td class="num">${isNum(r.value) ? num(r.value / 1e9, 2) : "–"}</td><td class="num">${pct(r.share, 1)}</td>
    <td class="num ${cls(r.yoy)}">${pct(r.yoy, 0, true)}</td><td class="num ${cls(r.share_chg)}">${ppText(r.share_chg)}</td></tr>`).join("") : "";
  const b = c.business, g = c.geography;
  const head = [b && `业务：${periodLabel(b.periods.at(-1), b.frequency)}${b.year_ago ? ` 对比 ${periodLabel(b.year_ago, b.frequency)}` : ""}`,
    g && `地区：${periodLabel(g.periods.at(-1), g.frequency)}${g.year_ago ? ` 对比 ${periodLabel(g.year_ago, g.frequency)}` : ""}`].filter(Boolean).join("；");
  return `<p class="muted">${esc(head)}。收入单位：${esc(CUR_ZH[c.currency] || c.currency)}；占比变化单位：个百分点。</p>
    <div class="table-wrap"><table><thead><tr><th></th><th>项目</th><th class="num">收入</th><th class="num">占比</th><th class="num">${term("yoy", "同比")}</th><th class="num">${term("share_change", "占比变化")}</th></tr></thead>
    <tbody>${block(b, "业务")}${block(g, "地区")}</tbody></table></div>`;
}
function segSection(c, t) {
  if (!c) return card("收入结构（公司财报）", empty(`${t} 暂无分业务 / 分地区收入数据`), "", ["fact"]);
  const notes = [c.note, c.business?.note && `业务：${c.business.note}`, c.geography?.note && `地区：${c.geography.note}`].filter(Boolean);
  const freqNote = [c.business, c.geography].some((g) => g?.frequency === "annual") ? "标注“财年”的为年度数据（该公司季报未披露此拆分）。" : "";
  return `<section class="card" id="seg-card"><h3>收入结构（公司财报） ${badge("fact")}${badge("derived")}</h3>
    <p class="muted">收入金额来自公司向 SEC 提交的季报 / 年报（${term("fact", "事实")}）；占比、同比为${term("derived", "计算")}；业务名称已映射为统一分类。横轴为各期截止日期（${term("fiscal_quarter", "财季")}）。${freqNote}</p>
    ${notes.length ? `<p class="muted">${notes.map(esc).join("<br>")}</p>` : ""}
    <div class="seg" id="seg-mode"><button type="button" data-m="share" class="on">占比</button><button type="button" data-m="amount">金额</button></div>
    <div class="grid two">
      <div><h4>${term("segment_revenue", "分业务收入")}</h4>${c.business ? chartDiv("c-segb") : empty("未披露或暂无数据")}</div>
      <div><h4>${term("geo_revenue", "分地区收入")}</h4>${c.geography ? chartDiv("c-segg") : empty("未披露或暂无数据")}</div>
    </div>${segTable(c)}</section>`;
}
function drawSeg(c, mode) {
  for (const [id, kind] of [["c-segb", "business"], ["c-segg", "geography"]]) {
    const el = byId(id);
    if (!el || !c[kind]) continue;
    const old = window.echarts?.getInstanceByDom(el);
    if (old) { charts = charts.filter((x) => x !== old); old.dispose(); }
    segChart(el, c[kind], kind, mode, c.currency);
  }
  document.querySelectorAll("#seg-mode button").forEach((b) => b.classList.toggle("on", b.dataset.m === mode));
}
function segInsights(c, t) {
  const out = [];
  if (!c) return out;
  const b = c.business?.latest.filter((r) => r.key !== "_rest") || [];
  const top = [...b].sort((x, y) => (y.share ?? 0) - (x.share ?? 0))[0];
  if (top && top.share >= 0.6 && b.length > 1) out.push({ level: "info", kind: "fact", target: "seg-card",
    text: `收入高度集中：「${top.name}」占 ${pct(top.share, 0)}${isNum(top.yoy) ? `，[[yoy|同比]] ${pct(top.yoy, 0, true)}` : ""}，相关新闻对 ${t} 影响最大。` });
  const mover = b.filter((r) => isNum(r.share_chg)).sort((x, y) => Math.abs(y.share_chg) - Math.abs(x.share_chg))[0];
  if (mover && Math.abs(mover.share_chg) >= 0.03) out.push({ level: "medium", kind: "derived", target: "seg-card",
    text: `业务结构在变化：「${mover.name}」占比一年内${mover.share_chg > 0 ? "上升" : "下降"} ${Math.abs(mover.share_chg * 100).toFixed(1)} 个百分点（[[share_change|占比变化]]）${isNum(mover.yoy) ? `，同比 ${pct(mover.yoy, 0, true)}` : ""}。` });
  const fall = b.filter((r) => isNum(r.yoy) && r.yoy <= -0.1 && r.share >= 0.1);
  for (const r of fall.slice(0, 1)) out.push({ level: "medium", kind: "fact", target: "seg-card", text: `「${r.name}」收入同比下降 ${pct(-r.yoy, 0)}，且占总收入 ${pct(r.share, 0)}。` });
  const cn = c.geography?.latest.find((r) => r.key === "china");
  if (cn && cn.share >= 0.15) out.push({ level: cn.share >= 0.25 ? "high" : "medium", kind: "fact", target: "seg-card",
    text: `中国收入占 ${pct(cn.share, 0)}（${periodLabel(c.geography.periods.at(-1), c.geography.frequency)}），对出口管制、关税等新闻较敏感（[[geo_revenue|分地区收入]]）。` });
  return out;
}
function exposureChart(el, seg) {
  const rows = [...seg.exposure].sort((a, b) => (b.shares.china ?? -1) - (a.shares.china ?? -1) || a.ticker.localeCompare(b.ticker));
  const regions = Object.keys(seg.regions).filter((r) => rows.some((x) => x.shares[r] != null));
  const series = regions.map((r) => ({ name: seg.regions[r], type: "bar", stack: "s", barMaxWidth: 16, color: REGION_COLOR[r] || BENCH_GRAY(),
    itemStyle: { borderColor: css("--surface"), borderWidth: 1 }, data: rows.map((x) => (x.shares[r] != null ? x.shares[r] * 100 : null)) }));
  series.push({ name: "其他 / 未归类", type: "bar", stack: "s", barMaxWidth: 16, color: OTHER_GRAY(),
    itemStyle: { borderColor: css("--surface"), borderWidth: 1 },
    data: rows.map((x) => (x.shares._rest != null ? x.shares._rest * 100 : null)) });
  mkChart(el, {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => (v == null ? "–" : `${v.toFixed(1)}%`),
      formatter: (ps) => { const x = rows[ps[0].dataIndex]; return `<b>${x.ticker}</b>（${periodLabel(x.period, x.frequency)}）${x.shares.china == null ? "<br>中国收入未单独披露" : ""}<br>` +
        ps.filter((p) => p.value != null).map((p) => `${p.marker}${p.seriesName} ${p.value.toFixed(1)}%`).join("<br>") + (x.note ? `<br><span style="opacity:.7">${esc(x.note)}</span>` : ""); } },
    legend: { type: "scroll", top: 0 }, grid: { left: 110, right: 24, top: 44, bottom: 30 },
    xAxis: { type: "value", max: 100, axisLabel: { formatter: "{value}%" } },
    yAxis: { type: "category", inverse: true, data: rows.map((x) => `${tickerLabel(x.ticker)}${x.shares.china == null ? " ·" : ""}`) },
    series });
}


// 以一家公司为中心的业务关联图：本公司各业务（大小 = 收入占比）+ 一跳上下游 / 竞争 / 合作（细化到对方业务）
function segGraphCard(t, g) {
  if (!g?.segments?.nodes?.[t]) return "";
  return `<section class="card" id="sg-card"><h3>业务关联（产业链） ${badge("model")}${badge("derived")}</h3>
    <p class="muted">中间是 ${esc(t)} 的各块业务（圆越大 = 占收入越多，标注占比与${term("yoy", "同比")}；颜色与上方“分业务收入”一致）；外圈是与这些业务直接相关的公司或其具体业务：
    实线箭头 = 供应（上游 → 下游），虚线 = 竞争，绿线 = 合作。关系为人工整理并经审核的${term("supply_chain", "产业链关系")}，不是财报数据；点击外圈公司可跳到其个股页。</p>
    ${chartDiv("c-sg", "tall")}</section>`;
}
function drawSegGraph(el, t, g, sc) {
  const own = g.segments.nodes[t];
  const colorOf = Object.fromEntries((sc?.business?.meta || []).map((m, i) => [m.key, palette()[i % 8]]));
  const yoyOf = Object.fromEntries((sc?.business?.latest || []).map((r) => [r.key, r.yoy]));
  const nodeInfo = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  const segName = (c, k) => (g.segments.nodes[c] || []).find((x) => x.key === k);
  const nodes = [{ id: t, name: t, kind: "hub", symbol: "diamond", symbolSize: 18, value: nodeInfo[t]?.name,
    itemStyle: { color: themeColor(nodeInfo[t]?.theme) }, label: { show: true, fontWeight: "bold", color: css("--ink") } }];
  const links = [];
  for (const sg of own) {
    const id = `${t}:${sg.key}`;
    nodes.push({ id, name: sg.name.split("（")[0], kind: "own", value: sg.name, share: sg.share, period: sg.period, yoy: yoyOf[sg.key],
      symbolSize: 16 + 44 * Math.sqrt(Math.max(sg.share || 0, 0)), itemStyle: { color: colorOf[sg.key] || palette()[0], borderColor: css("--surface"), borderWidth: 2 },
      label: { show: true, color: css("--ink"), fontSize: 11, formatter: `${sg.name.split("（")[0]}\n${pct(sg.share, 0)}${isNum(yoyOf[sg.key]) ? ` · 同比 ${pct(yoyOf[sg.key], 0, true)}` : ""}` } });
    links.push({ source: t, target: id, relation: "belong", lineStyle: { color: BENCH_GRAY(), type: "dotted", width: 1, opacity: 0.6 }, symbol: ["none", "none"] });
  }
  const ec = edgeColors();
  const seen = new Set(nodes.map((n) => n.id));
  const addOther = (ep) => {
    if (seen.has(ep)) return;
    seen.add(ep);
    const [c, k] = ep.split(":");
    const sgm = k ? segName(c, k) : null;
    const info = nodeInfo[c];
    nodes.push({ id: ep, name: sgm ? `${c} ${sgm.name.split("（")[0]}` : c, kind: "other", ticker: c, value: sgm ? `${info?.name || c}：${sgm.name}` : info?.name || c,
      share: sgm?.share, symbolSize: sgm ? 10 + 18 * Math.sqrt(Math.max(sgm.share || 0, 0)) : info?.in_universe ? 16 : 12,
      symbol: info?.kind === "segment" ? "roundRect" : "circle",
      itemStyle: { color: info?.theme ? themeColor(info.theme) : BENCH_GRAY(), opacity: 0.75 },
      label: { show: true, color: css("--ink-2"), fontSize: 10, formatter: sgm ? `${c} ${sgm.name.split("（")[0]} ${pct(sgm.share, 0)}` : c } });
  };
  const refinedPairs = new Set();
  for (const lk of g.segments.links) {
    const a = lk.source.split(":")[0], b = lk.target.split(":")[0];
    if (a !== t && b !== t) continue;
    refinedPairs.add(`${lk.type}|${a}|${b}`);
    const src = a === t && !lk.source.includes(":") ? t : lk.source, tgt = b === t && !lk.target.includes(":") ? t : lk.target;
    for (const ep of [src, tgt]) if (!ep.startsWith(`${t}:`) && ep !== t) addOther(ep);
    const w = Math.max(...[src, tgt].filter((x) => x.startsWith(`${t}:`)).map((x) => own.find((o) => `${t}:${o.key}` === x)?.share || 0), 0);
    links.push({ source: src, target: tgt, value: lk.note, relation: lk.type,
      symbol: lk.type === "supplier" || lk.type === "investor" ? ["none", "arrow"] : ["none", "none"], symbolSize: 7,
      lineStyle: { color: ec[lk.type], width: 1.2 + 3 * w, opacity: 0.8, curveness: 0.08, type: lk.type === "competitor" ? "dashed" : "solid" } });
  }
  // 未细化到业务的公司级关系：连在中心公司上
  for (const e of g.edges) {
    if (e.source !== t && e.target !== t) continue;
    const und = e.type === "competitor" || e.type === "partner";
    if (refinedPairs.has(`${e.type}|${e.source}|${e.target}`) || (und && refinedPairs.has(`${e.type}|${e.target}|${e.source}`))) continue;
    const other = e.source === t ? e.target : e.source;
    addOther(other);
    links.push({ source: e.source, target: e.target, value: e.note, relation: e.type,
      symbol: e.type === "supplier" || e.type === "investor" ? ["none", "arrow"] : ["none", "none"], symbolSize: 7,
      lineStyle: { color: ec[e.type], width: 1, opacity: 0.55, curveness: 0.08, type: e.type === "competitor" ? "dashed" : "solid" } });
  }
  // 分栏布局：左 = 上游供应商，中 = 本公司业务（按占比从大到小），右 = 下游客户，底部 = 竞争 / 合作
  const ownNodes = nodes.filter((n) => n.kind === "own").sort((x, y) => (y.share || 0) - (x.share || 0));
  const GAP_OWN = 90, GAP_COL = 44;
  ownNodes.forEach((n, i) => { n.x = 500; n.y = i * GAP_OWN; n.label.position = "right"; n.label.fontWeight = "bold";
    Object.assign(n.label, { backgroundColor: css("--surface"), padding: [2, 4], borderRadius: 3 }); });
  const hub = nodes[0];
  const ownY = Object.fromEntries(ownNodes.map((n) => [n.id, n.y]));
  const role = {}, anchor = {};
  for (const l of links) {
    if (l.relation === "belong") continue;
    const other = l.source.startsWith(`${t}:`) || l.source === t ? l.target : l.source;
    const mine = other === l.source ? l.target : l.source;
    const r = l.relation === "supplier" || l.relation === "investor" ? (other === l.source ? "up" : "down") : "side";
    if (!role[other] || role[other] === "side") role[other] = r;
    (anchor[other] ||= []).push(ownY[mine] ?? -GAP_OWN);
  }
  const others = nodes.filter((n) => n.kind === "other");
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const H = Math.max((ownNodes.length - 1) * GAP_OWN, 0);
  for (const [r, x, pos] of [["up", 80, "left"], ["down", 920, "right"]]) {
    const col = others.filter((n) => role[n.id] === r).sort((p, q) => avg(anchor[p.id]) - avg(anchor[q.id]));
    const span = Math.max(H, (col.length - 1) * GAP_COL);
    col.forEach((n, i) => { n.x = x; n.y = H / 2 - span / 2 + (col.length > 1 ? (i * span) / (col.length - 1) : span / 2); n.label.position = pos; });
  }
  const side = others.filter((n) => role[n.id] === "side").sort((p, q) => avg(anchor[p.id]) - avg(anchor[q.id]));
  const perRow = 6;
  side.forEach((n, i) => { const row = Math.floor(i / perRow), k = i % perRow, cnt = Math.min(perRow, side.length - row * perRow);
    n.x = 500 + (k - (cnt - 1) / 2) * 150; n.y = H + 110 + row * 70; n.label.position = "bottom"; });
  hub.x = 500; hub.y = -GAP_OWN * 0.9; hub.label.position = "top";
  for (const l of links) l.lineStyle.curveness = l.relation === "competitor" || l.relation === "partner" ? 0.15 : 0;
  const rows = Math.max(ownNodes.length * 2, others.filter((n) => role[n.id] !== "side").length, 4);
  el.style.height = `${Math.min(900, 220 + rows * 26 + Math.ceil(side.length / perRow) * 70)}px`;
  const label = (id) => nodes.find((n) => n.id === id)?.value || id;
  const c = mkChart(el, {
    graphic: [["上游供应商", "6%"], ["本公司业务", "44%"], ["下游客户", "84%"]].map(([text, left]) => ({ type: "text", left, top: 6,
      style: { text, fill: css("--muted"), fontSize: 12, fontWeight: "bold" } })),
    tooltip: { trigger: "item", formatter: (p) => {
      if (p.dataType === "edge") return p.data.relation === "belong" ? "" : `${esc(label(p.data.source))} → ${esc(label(p.data.target))}<br>${EDGE_ZH[p.data.relation]}：${esc(p.data.value)}`;
      if (p.data.kind === "own") return `<b>${esc(p.data.value)}</b><br>占 ${esc(t)} 收入 ${pct(p.data.share, 1)}${isNum(p.data.yoy) ? `，同比 ${pct(p.data.yoy, 0, true)}` : ""}<br><span style="opacity:.7">${esc(p.data.period)}，公司财报</span>`;
      if (p.data.kind === "other") return `<b>${esc(p.data.value)}</b>${isNum(p.data.share) ? `<br>占 ${esc(p.data.ticker)} 收入 ${pct(p.data.share, 1)}` : ""}`;
      return `<b>${esc(t)}</b> ${esc(p.data.value || "")}`;
    } },
    legend: { show: false },
    series: [{ type: "graph", layout: "none", roam: true, nodeScaleRatio: 0, data: nodes, links, top: 50, bottom: 50, left: 150, right: 170,
      emphasis: { focus: "adjacency" } }],
  });
  c?.on("click", (p) => { if (p.dataType === "node" && p.data.kind === "other" && META.universe.some((u) => u.ticker === p.data.ticker)) location.hash = `#/stock/${p.data.ticker}`; });
}

PAGES.stock = async (r) => {
  const t = r.arg || META.universe.find((u) => u.held)?.ticker || META.universe[0].ticker;
  const s = await load(`stocks/${t}.json`);
  const seg = await load("segments.json").catch(() => null);
  const sc = seg?.available ? seg.companies[t] : null;
  const graphData = (await load("news/index.json").catch(() => null))?.graph;
  const opts = META.universe.map((u) => `<option ${u.ticker === t ? "selected" : ""}>${u.ticker}</option>`).join("");
  const m = s.matrix;
  const dimChips = m ? Object.entries(m.scores).map(([k, v]) => `<span class="chip">${esc({ composite: "综合", momentum: "动量", trend: "趋势", relative: "相对强弱", low_vol: "低波动", valuation: "估值", sentiment: "情绪", event_risk: "事件风险低" }[k] || k)} ${num(v, 0)}</span>`).join("") : "";
  app().innerHTML = `
    <h2>个股 <select id="s-pick">${opts}</select> <span class="muted">${esc(themeName(s.theme))} · 主题基准 ${esc(s.benchmark)}${m?.weight ? ` · 当前权重 ${pct(m.weight, 1)}` : ""}</span></h2>
    ${howto(STOCK_HOWTO)}${insightBox([...stockInsights(s, t), ...segInsights(sc, t)])}
    <section class="card"><h3>价格走势与标注 ${badge("fact")}${badge("derived")}${badge("model")}</h3><div>${dimChips}</div><p class="muted">K 线与均线为${term("fact", "事实")}数据（复权价格）；转折点位置与涨跌拆分为${term("derived", "计算")}；新闻事件判断与转折点归因为 ${term("model", "AI 推断")}。标记：📍 新闻深度分析事件；◆ 转折点·公司事件驱动（有归因）；▲ 转折点·市场/板块驱动；○ 转折点·证据不足；竖线：财报日。点击标记查看详情。归因为推断，非因果证明。</p>${chartDiv("c-k", "tall")}</section>
    <section class="card" id="tp-card"><h3>${term("turning_point", "转折点")}详情 ${badge("derived")}${badge("model")}</h3><div id="tp-detail">${turningSummary(s.turning || [])}</div></section>
    ${segSection(sc, t)}
    ${segGraphCard(t, graphData)}
    <div class="grid">
      ${card("每日新闻情绪（均值，−1 ~ 1）", Object.keys(s.sentiment).length ? chartDiv("c-sent", "short") : empty("近期无相关新闻"))}
      ${card("综合信号分位历史（周）", s.score_history.values?.length ? chartDiv("c-hist", "short") : empty("暂无"))}
      ${card("最新一期各模型贡献（截面排名 × 权重）", s.contributions ? chartDiv("c-contrib", "short") : empty("暂无"))}
      ${card("相关事件", s.events.length ? `<ul>${[...s.events].reverse().map((e) => `<li><span class="chip">${esc(e.date)}</span><a href="#/news?date=${e.date}&event=${e.id}">${esc(e.headline)}</a> <span class="${e.direction === "positive" ? "pos" : e.direction === "negative" ? "neg" : "muted"}">${esc(DIR_ZH[e.direction] || "")}</span></li>`).join("")}</ul>` : empty("近期没有深度分析事件"))}
    </div>`;
  byId("s-pick").onchange = (e) => { location.hash = `#/stock/${e.target.value}`; };
  if (byId("c-sg")) drawSegGraph(byId("c-sg"), t, graphData, sc);
  if (sc) {
    drawSeg(sc, "share");
    document.querySelectorAll("#seg-mode button").forEach((b) => (b.onclick = () => drawSeg(sc, b.dataset.m)));
  }
  const dirColor = { positive: "#0ca30c", negative: "#d03b3b" };
  const closeOn = Object.fromEntries(s.dates.map((d, i) => [d, s.ohlc[i][1]]));
  const nearest = (d) => s.dates.find((x) => x >= d) || s.dates[s.dates.length - 1];
  const k = mkChart(byId("c-k"), {
    tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
    grid: { left: 56, right: 20, top: 36, bottom: 60 },
    xAxis: { type: "category", data: s.dates, boundaryGap: true }, yAxis: { type: "value", scale: true },
    dataZoom: [{ type: "inside", start: 40, end: 100 }, { type: "slider", start: 40, end: 100, height: 18, bottom: 10 }],
    series: [
      { name: t, type: "candlestick", data: s.ohlc, itemStyle: { color: css("--good"), color0: css("--bad"), borderColor: css("--good"), borderColor0: css("--bad") },
        markPoint: { label: { show: false },
          data: [
            ...s.events.map((e) => ({ symbol: "pin", symbolSize: 24, name: e.headline, coord: [nearest(e.date), closeOn[nearest(e.date)]], id: e.id, date: e.date,
              kind: "event", week: e.week, itemStyle: { color: dirColor[e.direction] || "#898781" } })),
            ...(s.turning || []).filter((tp) => tp.date >= s.dates[0]).map((tp, i) => ({ kind: "turning", idx: i, name: tp.category_zh, date: tp.date,
              coord: [nearest(tp.date), closeOn[nearest(tp.date)]],
              symbol: tp.category === "company" ? "diamond" : tp.category === "market" ? "triangle" : "emptyCircle",
              symbolSize: tp.category === "company" ? 16 : tp.category === "market" ? 12 : 9,
              symbolOffset: [0, tp.kind === "peak" || tp.kind === "gap_down" ? -14 : 14],
              itemStyle: { color: tp.category === "unclear" ? "#898781" : tp.move >= 0 ? dirColor.positive : dirColor.negative, borderColor: css("--surface"), borderWidth: 1 } })),
          ],
          tooltip: { formatter: (p) => p.data.kind === "event" ? `${esc(p.data.date)}<br>${esc(p.data.name)}`
            : (() => { const tp = s.turning[p.data.idx]; return `${esc(tp.date)} ${esc({ trough: "波段低点", peak: "波段高点", gap_up: "大幅跳涨", gap_down: "大幅跳跌" }[tp.kind])}<br>区间 ${pct(tp.move, 1, true)} · ${esc(tp.category_zh)}`; })() } },
        markLine: { symbol: "none", silent: true, label: { formatter: "财报", color: css("--muted") }, lineStyle: { color: css("--axis"), type: "dashed" },
          data: s.earnings.filter((d) => d >= s.dates[0] && d <= s.dates[s.dates.length - 1]).map((d) => ({ xAxis: nearest(d) })) } },
      { name: "MA50", type: "line", showSymbol: false, data: s.ma50, color: palette()[0], lineStyle: { width: 1.4 } },
      { name: "MA200", type: "line", showSymbol: false, data: s.ma200, color: palette()[1], lineStyle: { width: 1.4 } },
    ],
  });
  k?.on("click", (p) => {
    if (p.componentType !== "markPoint") return;
    if (p.data.kind === "turning") { byId("tp-detail").innerHTML = turningDetail(s.turning[p.data.idx], s.benchmark); byId("tp-card").scrollIntoView({ behavior: "smooth", block: "nearest" }); return; }
    location.hash = p.data.week ? `#/news?week=${p.data.week}&event=${p.data.id}` : `#/news?date=${p.data.date}&event=${p.data.id}`;
  });
  if (Object.keys(s.sentiment).length) {
    const ds = Object.keys(s.sentiment).sort();
    mkChart(byId("c-sent"), { legend: { show: false }, tooltip: { trigger: "axis", formatter: (ps) => `${ps[0].axisValue}<br>情绪 ${num(ps[0].value, 2, true)}（${s.sentiment[ps[0].axisValue].count} 条）` },
      grid: { left: 44, right: 16, top: 16, bottom: 30 }, xAxis: { type: "category", data: ds }, yAxis: { type: "value", min: -1, max: 1 },
      series: [{ type: "bar", barMaxWidth: 14, data: ds.map((d) => ({ value: s.sentiment[d].mean, itemStyle: { color: s.sentiment[d].mean >= 0 ? css("--pos") : css("--neg"), borderRadius: 3 } })) }] });
  }
  if (s.score_history.values?.length) {
    mkChart(byId("c-hist"), { legend: { show: false }, grid: { left: 40, right: 28, top: 16, bottom: 30 },
      xAxis: { type: "category", data: s.score_history.dates }, yAxis: { type: "value", min: 0, max: 100 },
      series: [{ type: "line", showSymbol: false, color: palette()[0], data: s.score_history.values,
        markLine: { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" }, label: { formatter: "中位 50", position: "insideEndTop", color: css("--muted") }, data: [{ yAxis: 50 }] } }] });
  }
  if (s.contributions) {
    const ks = Object.keys(s.contributions);
    mkChart(byId("c-contrib"), { legend: { show: false }, tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => num(v, 3, true) },
      grid: { left: 100, right: 30, top: 10, bottom: 30 }, xAxis: { type: "value" }, yAxis: { type: "category", data: ks },
      series: [{ type: "bar", barMaxWidth: 14, data: ks.map((x) => ({ value: s.contributions[x], itemStyle: { color: s.contributions[x] >= 0 ? css("--pos") : css("--neg"), borderRadius: 3 } })) }] });
  }
};

const TP_KIND_ZH = { trough: "波段低点", peak: "波段高点", gap_up: "大幅跳涨", gap_down: "大幅跳跌" };
function turningSummary(list) {
  if (!list.length) return empty("近半年没有识别出转折点");
  const cnt = (c) => list.filter((x) => x.category === c).length;
  const rows = [...list].reverse().map((tp) => `<tr><td>${esc(tp.date)}</td><td>${esc(TP_KIND_ZH[tp.kind])}</td><td class="num ${cls(tp.move)}">${pct(tp.move, 1, true)}</td>
    <td class="num">${pct(tp.market_part, 1, true)}</td><td class="num">${pct(tp.sector_part, 1, true)}</td><td class="num ${cls(tp.idio)}">${pct(tp.idio, 1, true)}</td>
    <td>${esc(tp.category_zh)}${tp.confidence && tp.category === "company" ? `（置信度${LEVEL_ZH[tp.confidence]}）` : ""}</td><td class="wrap muted">${esc(tp.explanation || tp.reason || "")}</td></tr>`).join("");
  return `<p class="muted">近半年共 ${list.length} 个：公司事件驱动 ${cnt("company")} · 市场/板块驱动 ${cnt("market")} · 证据不足 ${cnt("unclear")}。点击 K 线上的标记查看新闻与归因。</p>
    <div class="table-wrap"><table><thead><tr><th>日期</th><th>类型</th><th class="num">区间涨跌</th><th class="num">大盘</th><th class="num">板块</th><th class="num">个股特有</th><th>判断</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function turningDetail(tp, bench) {
  const news = (tp.news || []).map((n) => `<li><span class="chip">${esc(n.date)}</span><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="muted">${esc(n.publisher || "")}</span> <span class="${cls(n.sentiment)}">${num(n.sentiment, 2, true)}</span></li>`).join("");
  const drivers = (tp.drivers || []).map((d) => `<li>${esc(d.text)} <span class="src">${srcLinks(d.sources, 2)}</span></li>`).join("");
  return `<h4 style="margin:4px 0">${esc(tp.date)} ${esc(TP_KIND_ZH[tp.kind])} · 区间 ${esc(tp.window[0])} → ${esc(tp.window[1])} · ${pct(tp.move, 1, true)}</h4>
    <p>拆分：大盘（SPY）${pct(tp.market_part, 1, true)} · 板块（${esc(bench)}）${pct(tp.sector_part, 1, true)} · 个股特有 <b>${pct(tp.idio, 1, true)}</b>（占比 ${pct(tp.idio_share, 0)}）</p>
    <p><b>判断：${esc(tp.category_zh)}</b>${tp.category === "company" ? `（置信度${LEVEL_ZH[tp.confidence] || "–"}，${esc(TIER_ZH[tp.tier] || tp.tier || "")}；推断，非因果证明）` : ""}</p>
    ${tp.explanation ? `<p>${esc(tp.explanation)}</p>` : ""}${tp.reason ? `<p class="muted">未给出归因的原因：${esc(tp.reason)}</p>` : ""}
    ${drivers ? `<b>归因依据</b><ul>${drivers}</ul>` : ""}
    <p class="muted">新闻证据：直接相关报道 ${tp.evidence?.n_direct ?? 0} 篇 · 高影响事件 ${tp.evidence?.high_impact ? "有" : "无"} · 情绪方向与涨跌${tp.evidence?.agreement ? "一致" : "不一致或不明"} · 窗口内财报 ${tp.evidence?.earnings_in_window ? "有" : "无"} · 可解释度 ${num(tp.score, 2)}</p>
    ${news ? `<b>窗口内相关新闻</b><ul>${news}</ul>` : '<p class="muted">窗口内没有相关新闻</p>'}
    <p><a href="#" onclick="document.getElementById('tp-detail').innerHTML='';return false;">收起</a></p>`;
}

// ---------------- 6. 相对表现 ----------------

const PERF_HOWTO = [
  "这一页全是由真实价格算出的[[derived|计算]]结果，不含模型判断。选择区间（1 周 … 1 年）后，所有股票都从 100 开始画（[[index100|相对收益指数]]），线越高 = 区间内涨得越多。",
  "上方条形图：每只股票的涨幅减去 SPY 的涨幅（[[excess_return|超额收益]]），正数 = 跑赢大盘。下方按[[theme|主题]]分组，虚线是该主题的基准，点线是 SPY。",
];
function perfInsights(ranking, per, meta) {
  const out = [];
  if (!ranking.length) return out;
  const held = new Set(heldTickers());
  const top = ranking[0], bot = ranking[ranking.length - 1];
  out.push({ level: "info", kind: "derived", target: "c-rank", text: `${per} 区间跑赢 SPY 最多：${top.t}（${pp(top.ex)}）；跑输最多：${bot.t}（${pp(bot.ex)}）。` });
  const lag = ranking.filter((x) => held.has(x.t) && x.ex < -0.05);
  if (lag.length) out.push({ level: "medium", kind: "derived", target: "c-rank", text: `持仓中明显跑输大盘（超过 5 个百分点）：${lag.map((x) => `${x.t} ${pp(x.ex)}`).join("，")}。` });
  const byTheme = {};
  for (const x of ranking) (byTheme[x.theme] ||= []).push(x.ex);
  const disp = Object.entries(byTheme).map(([k, v]) => ({ k, d: Math.max(...v) - Math.min(...v) })).sort((a, b) => b.d - a.d)[0];
  if (disp && disp.d > 0.2) out.push({ level: "info", kind: "derived", text: `「${themeName(disp.k)}」主题内部分化最大：最强与最弱相差 ${(disp.d * 100).toFixed(0)} 个百分点，选股差异影响大。` });
  return out;
}

const PERIODS = { "1W": 5, "1M": 21, "3M": 63, YTD: "ytd", "1Y": 252 };
PAGES.performance = async (r) => {
  const p = await load("performance.json");
  const per = r.query.period in PERIODS ? r.query.period : "3M";
  const n = p.dates.length;
  let start = PERIODS[per] === "ytd" ? p.dates.findIndex((d) => d.slice(0, 4) === p.dates[n - 1].slice(0, 4)) : Math.max(0, n - 1 - PERIODS[per]);
  const idx = (t) => { const s = p.series[t]; if (!s) return null; const b = s.slice(start).find(isNum); return s.slice(start).map((v) => (isNum(v) && b ? (v / b) * 100 : null)); };
  const dates = p.dates.slice(start);
  const last = (arr) => arr ? [...arr].reverse().find(isNum) : null;
  const spy = idx("SPY");
  const ranking = META.universe.map((u) => ({ t: u.ticker, theme: u.theme, ex: (last(idx(u.ticker)) - last(spy)) / 100 })).filter((x) => isNum(x.ex)).sort((a, b) => b.ex - a.ex);
  app().innerHTML = `
    <h2>相对表现 <span class="muted">区间起点 = 100 · 截至 ${esc(p.dates[n - 1])}</span></h2>
    ${howto(PERF_HOWTO)}${insightBox(perfInsights(ranking, per, META))}
    <section class="card"><div class="seg" id="p-seg">${Object.keys(PERIODS).map((k) => `<button type="button" data-p="${k}" class="${k === per ? "on" : ""}">${k}</button>`).join("")}</div></section>
    ${card(`区间超额收益排名（相对 SPY，${per}）`, chartDiv("c-rank", "tall"))}
    <p class="muted">主题小图：● 持仓为粗线，★ 关注列表为实线，其余股票为细淡线；悬停图例可单独高亮</p>
    <div class="grid two">${META.themes.map((th) => card(`${th.name}（基准 ${p.benchmarks[th.key]}，虚线；SPY 点线）`, chartDiv(`c-th-${th.key}`))).join("")}</div>`;
  document.querySelectorAll("#p-seg button").forEach((b) => (b.onclick = () => { location.hash = `#/performance?period=${b.dataset.p}`; }));
  mkChart(byId("c-rank"), { legend: { show: false }, tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => pct(v, 1, true) },
    grid: { left: 80, right: 50, top: 10, bottom: 30 }, xAxis: { type: "value", axisLabel: { formatter: (v) => pct(v, 0) } },
    yAxis: { type: "category", data: ranking.map((x) => tickerLabel(x.t)), inverse: true, axisLabel: { color: (v, i) => themeColor(ranking[i]?.theme) } },
    series: [{ type: "bar", barMaxWidth: 14, data: ranking.map((x) => ({ value: x.ex, itemStyle: { color: themeColor(x.theme), borderRadius: 3 } })),
      label: { show: true, position: "right", formatter: (q) => pct(q.value, 1, true), color: css("--ink-2"), fontSize: 11 } }] });
  for (const th of META.themes) {
    const members = META.universe.filter((u) => u.theme === th.key);
    const series = members.map((u, i) => {
      const focus = u.held || u.watchlist;
      return { name: tickerLabel(u.ticker), type: "line", showSymbol: false, color: palette()[i % 8],
        lineStyle: { width: u.held ? 2.6 : focus ? 1.8 : 1.1, opacity: focus ? 1 : 0.45 }, emphasis: { focus: "series" }, data: idx(u.ticker) };
    });
    series.push({ name: p.benchmarks[th.key], type: "line", showSymbol: false, color: BENCH_GRAY(), lineStyle: { width: 1.4, type: "dashed" }, data: idx(p.benchmarks[th.key]) });
    if (p.benchmarks[th.key] !== "SPY") series.push({ name: "SPY", type: "line", showSymbol: false, color: BENCH_GRAY(), lineStyle: { width: 1.2, type: "dotted" }, data: spy });
    mkChart(byId(`c-th-${th.key}`), { tooltip: { trigger: "axis", valueFormatter: (v) => num(v, 1) }, legend: { top: 0, type: "scroll" }, grid: { left: 44, right: 24, top: 40, bottom: 30 },
      xAxis: { type: "category", data: dates, boundaryGap: false }, yAxis: { type: "value", scale: true }, series });
  }
};

// ---------------- 7. 风险与集中度 ----------------

const RISK_HOWTO = [
  "这一页是由真实价格算出的[[derived|计算]]结果，用来看“风险在哪里”。散点图：越靠右越颠簸（[[volatility|波动率]]高），越靠上近 3 个月跑赢大盘越多；气泡越大 = 建议仓位越重。",
  "[[correlation|相关性]]热力图：两只股票涨跌越同步，格子越蓝。持仓之间如果都很蓝，说明分散效果差，可能一起跌。",
  "滚动走势图：看波动和平均相关性最近是在上升还是下降。",
  "地区收入暴露：每只股票的收入来自哪些地区（公司财报），用来判断地缘政治、关税等新闻会同时波及哪些股票。",
];
function riskInsights(k) {
  const out = [];
  const held = new Set(heldTickers());
  const hp = k.points.filter((p) => held.has(p.ticker) && isNum(p.vol_60d)).sort((a, b) => b.vol_60d - a.vol_60d);
  if (hp.length) out.push({ level: hp[0].vol_60d > 0.5 ? "medium" : "info", kind: "derived", target: "c-rr", text: `持仓中波动最大：${hp[0].ticker}（年化 ${pct(hp[0].vol_60d, 0)}，权重 ${pct(hp[0].weight, 1)}）。` });
  const T = k.corr.tickers, hi = [];
  for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) {
    if (held.has(T[i]) && held.has(T[j]) && k.corr.values[i][j] >= 0.75) hi.push(`${T[i]}–${T[j]} ${num(k.corr.values[i][j], 2)}`);
  }
  if (hi.length) out.push({ level: "high", kind: "derived", target: "c-corr", text: `持仓之间高度同涨同跌（[[correlation|相关性]] ≥ 0.75）：${hi.slice(0, 4).join("，")}，分散效果有限。` });
  const top = k.points.filter((p) => isNum(p.vol_60d)).sort((a, b) => b.vol_60d - a.vol_60d)[0];
  if (top && !held.has(top.ticker)) out.push({ level: "info", kind: "derived", target: "c-rr", text: `选股池中波动最大：${top.ticker}（年化 ${pct(top.vol_60d, 0)}，即一年内价格上下波动幅度的典型值）。` });
  let best = null;
  for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) if (!best || k.corr.values[i][j] > best.v) best = { a: T[i], b: T[j], v: k.corr.values[i][j] };
  if (best) out.push({ level: "info", kind: "derived", target: "c-corr", text: `走势最同步的一对：${best.a} 与 ${best.b}（[[correlation|相关性]] ${num(best.v, 2)}），同时持有两者的分散效果有限。` });
  const ac = (k.history?.avg_corr || []).filter(isNum);
  if (ac.length >= 8) {
    const cur = ac[ac.length - 1], med = [...ac].sort((a, b) => a - b)[Math.floor(ac.length / 2)];
    if (cur - med >= 0.08) out.push({ level: "medium", kind: "derived", target: "c-rcorr", text: `选股池平均相关性升至 ${num(cur, 2)}（半年中位数 ${num(med, 2)}）：股票走势越来越同步，分散效果在变差。` });
    else if (med - cur >= 0.03) out.push({ level: "good", kind: "derived", target: "c-rcorr", text: `选股池平均相关性降至 ${num(cur, 2)}（半年中位数 ${num(med, 2)}）：个股走势分化，分散效果较好。` });
  }
  return out;
}


function exposureInsights(seg) {
  const out = [];
  if (!seg?.available) return out;
  const held = new Set(heldTickers());
  const cn = seg.exposure.filter((x) => x.shares.china != null).sort((a, b) => b.shares.china - a.shares.china);
  const heldCn = cn.filter((x) => held.has(x.ticker) && x.shares.china >= 0.15);
  if (heldCn.length) out.push({ level: "high", kind: "fact", target: "c-geo", text: `持仓中中国收入占比较高：${heldCn.map((x) => `${x.ticker} ${pct(x.shares.china, 0)}`).join("，")}；出口管制 / 关税新闻可能同时影响这些持仓（[[geo_revenue|分地区收入]]）。` });
  if (cn.length) out.push({ level: "info", kind: "fact", target: "c-geo", text: `选股池中中国收入占比最高：${cn.slice(0, 3).map((x) => `${x.ticker} ${pct(x.shares.china, 0)}`).join("，")}。` });
  return out;
}

PAGES.risk = async () => {
  const k = await load("risk.json");
  const seg = await load("segments.json").catch(() => null);
  app().innerHTML = `
    <h2>风险与集中度 <span class="muted">截至 ${esc(k.asof)} · 同期 SPY 3 个月收益 ${pct(k.spy_3m, 1, true)}</span></h2>
    ${howto(RISK_HOWTO)}${insightBox([...riskInsights(k), ...exposureInsights(seg)])}
    ${card("风险 vs 收益：60 日年化波动（横）× 3 个月超额收益（纵）；气泡大小 = 当前权重", chartDiv("c-rr", "tall"))}
    <div class="grid two">${card("滚动 60 日年化波动（周；● 持仓为粗线）", k.history ? chartDiv("c-rvol") : empty("暂无"))}
      ${card("选股池平均两两相关性（滚动 60 日；越高越同涨同跌，分散效果越差）", k.history ? chartDiv("c-rcorr") : empty("暂无"))}</div>
    ${seg?.available ? card("地区收入暴露（最新披露期；按中国收入占比从高到低，“·”= 中国未单独披露）",
      `<p class="muted">来自公司财报的${term("geo_revenue", "分地区收入")}。各公司统计口径不同（按客户账单地址 / 交付地 / 用户所在地），悬停查看期间与口径说明；中国收入未单独披露的公司可能含在“亚太”“其他”中。</p>${chartDiv("c-geo", "tall")}`, "", ["fact", "derived"]) : ""}
    ${card("60 日日收益相关性（越蓝越正相关，持仓过度同质时整体偏蓝）", `<div id="c-corr" class="chart" style="height:${Math.max(420, k.corr.tickers.length * 24 + 100)}px"></div>`)}`;
  if (seg?.available && byId("c-geo")) exposureChart(byId("c-geo"), seg);
  if (k.history) {
    const hd = k.history.dates;
    mkChart(byId("c-rvol"), { tooltip: { trigger: "axis", valueFormatter: (v) => pct(v, 0) }, legend: { type: "scroll", top: 0 }, grid: { left: 48, right: 16, top: 40, bottom: 30 },
      xAxis: { type: "category", data: hd, boundaryGap: false }, yAxis: { type: "value", axisLabel: { formatter: (v) => pct(v, 0) } },
      series: META.universe.map((u) => ({ name: tickerLabel(u.ticker), type: "line", showSymbol: false, color: themeColor(u.theme),
        lineStyle: { width: u.held ? 2.4 : 1, opacity: u.held ? 1 : 0.35 }, emphasis: { focus: "series" }, data: k.history.vol[u.ticker] })) });
    mkChart(byId("c-rcorr"), { legend: { show: false }, tooltip: { trigger: "axis", valueFormatter: (v) => num(v, 2) }, grid: { left: 48, right: 16, top: 16, bottom: 30 },
      xAxis: { type: "category", data: hd, boundaryGap: false }, yAxis: { type: "value", scale: true },
      series: [{ type: "line", showSymbol: false, color: palette()[0], data: k.history.avg_corr, areaStyle: { opacity: 0.12 },
        markLine: { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" }, label: { formatter: "中位数", position: "insideEndTop", color: css("--muted") },
          data: [{ yAxis: [...k.history.avg_corr.filter(isNum)].sort((a, b) => a - b)[Math.floor(k.history.avg_corr.filter(isNum).length / 2)] }] },
        markPoint: { symbolSize: 34, data: [{ coord: [hd.length - 1, k.history.avg_corr[hd.length - 1]], value: num(k.history.avg_corr[hd.length - 1], 2) }], label: { fontSize: 10 } } }] });
  }
  const byTheme = {};
  for (const p of k.points) if (isNum(p.vol_60d) && isNum(p.excess_3m)) (byTheme[p.theme] ||= []).push(p);
  const c = mkChart(byId("c-rr"), {
    tooltip: { trigger: "item", formatter: (p) => { const d = p.data.raw; return `<b>${esc(d.ticker)}</b>（${esc(themeName(d.theme))}）<br>60 日波动 ${pct(d.vol_60d, 0)}<br>3 个月收益 ${pct(d.ret_3m, 1, true)}（超额 ${pct(d.excess_3m, 1, true)}）${d.weight ? `<br>权重 ${pct(d.weight, 1)}` : ""}`; } },
    grid: { left: 60, right: 30, top: 40, bottom: 50 },
    xAxis: { type: "value", name: "60 日年化波动", nameLocation: "middle", nameGap: 28, axisLabel: { formatter: (v) => pct(v, 0) }, scale: true },
    yAxis: { type: "value", name: "3 个月超额收益（vs SPY）", nameLocation: "middle", nameGap: 44, axisLabel: { formatter: (v) => pct(v, 0) } },
    series: Object.entries(byTheme).map(([th, arr], i) => ({ name: themeName(th), type: "scatter", color: themeColor(th),
      symbolSize: (v, p) => 9 + Math.sqrt(p.data.raw.weight) * 60, itemStyle: { borderColor: css("--surface"), borderWidth: 2 },
      label: { show: true, formatter: (p) => p.data.raw.ticker, position: "right", color: css("--ink-2"), fontSize: 11 },
      labelLayout: { hideOverlap: true, moveOverlap: "shiftY" },
      data: arr.map((p) => ({ value: [p.vol_60d, p.excess_3m], raw: p })),
      markLine: i === 0 ? { silent: true, symbol: "none", lineStyle: { color: css("--axis"), type: "dashed" }, label: { formatter: "跑平 SPY", color: css("--muted") }, data: [{ yAxis: 0 }] } : undefined })),
  });
  c?.on("click", (p) => { location.hash = `#/stock/${p.data.raw.ticker}`; });
  const T = k.corr.tickers;
  const data = [];
  k.corr.values.forEach((row, i) => row.forEach((v, j) => data.push([j, i, isNum(v) ? Math.round(v * 100) / 100 : "-"])));
  mkChart(byId("c-corr"), {
    tooltip: { trigger: "item", formatter: (p) => `${T[p.value[1]]} × ${T[p.value[0]]}：${p.value[2]}` }, legend: { show: false },
    grid: { left: 70, right: 20, top: 20, bottom: 90 },
    xAxis: { type: "category", data: T.map(tickerLabel), axisLabel: { rotate: 60, color: (v, i) => themeColor(themeOf(T[i])) } },
    yAxis: { type: "category", data: T.map(tickerLabel), inverse: true, axisLabel: { color: (v, i) => themeColor(themeOf(T[i])) } },
    visualMap: { min: -1, max: 1, orient: "horizontal", left: "center", bottom: 0, itemWidth: 12, itemHeight: 160, text: ["+1", "−1"], textStyle: { color: css("--muted") }, inRange: { color: divergingColors() } },
    series: [{ type: "heatmap", data, label: { show: T.length <= 22, fontSize: 9, color: css("--ink"), formatter: (p) => (p.value[0] === p.value[1] ? "" : num(p.value[2], 1)) },
      itemStyle: { borderColor: css("--surface"), borderWidth: 1 } }],
  });
};

// ---------------- 8. 回测与实盘 ----------------

const BT_HOWTO = [
  "这一页几乎全是[[simulated|模拟]]结果：[[backtest|回测]]假设 2016 年起每周都按模型建议调仓（每次买卖扣除 0.1% 成本），得出“如果当时这么做会怎样”。它不是任何人真实赚到的钱。",
  "看回测时优先看[[oos|样本外]]（2019 年至今）的[[sharpe|夏普比率]]和[[drawdown|最大回撤]]，而不是最高收益；并记住选股池存在[[survivorship|幸存者偏差]]，结果偏乐观。",
  "“[[tracking|实盘跟踪]]”用每周真实推送的建议和真实价格计算，比回测更接近现实，积累几个月后可与回测对比。",
];
function btInsights(b) {
  const out = [];
  const oos = (b.metrics || []).filter((m) => m.period === "OOS");
  const st = oos.find((m) => m.strategy === "Strategy"), spy = oos.find((m) => m.strategy === "SPY");
  if (st && spy) out.push({ level: st.Sharpe > spy.Sharpe ? "good" : "medium", kind: "simulated", target: "c-bnav",
    text: `[[oos|样本外]]：模拟策略年化 ${pct(st.CAGR, 1)}、[[sharpe|夏普]] ${num(st.Sharpe, 2)}、[[drawdown|最大回撤]] ${pct(st.MaxDrawdown, 1)}；SPY 分别为 ${pct(spy.CAGR, 1)}、${num(spy.Sharpe, 2)}、${pct(spy.MaxDrawdown, 1)}。` });
  const dd = b.drawdown?.Strategy;
  if (dd) {
    let wi = 0;
    dd.values.forEach((v, i) => { if (isNum(v) && v < dd.values[wi]) wi = i; });
    out.push({ level: "info", kind: "simulated", target: "c-bdd", text: `模拟策略最深的一次回撤出现在 ${dd.dates[wi]} 附近（${pct(dd.values[wi], 1)}）。` });
    const cur = lastSeries(dd);
    if (isNum(cur) && cur <= -0.08) out.push({ level: "high", kind: "simulated", target: "c-bdd", text: `模拟策略当前仍在回撤中：${pct(cur, 1)}。` });
  }
  const m3 = (b.metrics || []).filter((m) => m.period === "近 3 个月");
  const s3 = m3.find((m) => m.strategy === "Strategy"), p3 = m3.find((m) => m.strategy === "SPY");
  if (s3 && p3 && s3.TotalReturn - p3.TotalReturn < -0.03) out.push({ level: "medium", kind: "simulated", text: `近 3 个月模拟策略落后 SPY ${pp(p3.TotalReturn - s3.TotalReturn).replace("+", "")}（${pct(s3.TotalReturn, 1, true)} vs ${pct(p3.TotalReturn, 1, true)}）。` });
  const t = b.tracking?.summary;
  if (t && t.weeks) out.push({ level: "info", kind: "simulated", text: `[[tracking|实盘跟踪]] ${t.weeks} 周：累计 ${pct(t.cum_live, 1, true)}，同期 SPY ${pct(t.cum_SPY, 1, true)}。` });
  else out.push({ level: "info", kind: "simulated", text: "[[tracking|实盘跟踪]]尚无数据：首份周报之后的下一周开始显示。" });
  return out;
}

PAGES.backtest = async () => {
  const b = await load("backtest.json");
  if (!b.nav) { app().innerHTML = card("回测与实盘", empty("尚无周报网页数据：首份周报生成后显示。")); return; }
  const metrics = (b.metrics || []).map((m) => `<tr><td>${esc(m.period)}</td><td>${esc(m.strategy === "Strategy" ? "策略" : m.strategy)}</td><td class="num">${pct(m.CAGR, 1)}</td><td class="num">${pct(m.Volatility, 1)}</td>
    <td class="num">${num(m.Sharpe, 2)}</td><td class="num">${pct(m.MaxDrawdown, 1)}</td><td class="num">${num(m.Calmar, 2)}</td><td class="num">${pct(m.TotalReturn, 1)}</td></tr>`).join("");
  const sens = b.summary?.sensitivity;
  app().innerHTML = `
    <h2>回测与实盘</h2>
    ${howto(BT_HOWTO)}${insightBox(btInsights(b))}
    <div class="grid">${card("净值（对数坐标）", chartDiv("c-bnav"))}${card("回撤", chartDiv("c-bdd"))}</div>
    ${card("指标", `<div class="table-wrap"><table><thead><tr><th>区间</th><th>组合</th><th class="num">CAGR（年化）</th><th class="num">波动</th><th class="num">Sharpe</th><th class="num">最大回撤</th><th class="num">Calmar</th><th class="num">总收益</th></tr></thead><tbody>${metrics}</tbody></table></div>`)}
    ${card("策略月度收益（样本外）", b.monthly ? `<div id="c-month" class="chart" style="height:${b.monthly.years.length * 30 + 80}px"></div>` : empty("暂无"))}
    ${card("Regime 时间线", b.regimes ? chartDiv("c-breg", "short") : empty("暂无"))}
    ${card("实盘跟踪", trackingTable(b.tracking) + (b.tracking?.nav ? chartDiv("c-track") : ""))}
    ${card("参数敏感性（样本外，来自最近一次完整回测）", sens ? `<div class="table-wrap"><table><thead><tr><th>参数</th><th>取值</th><th class="num">CAGR</th><th class="num">Sharpe</th><th class="num">最大回撤</th></tr></thead><tbody>${sens.map((x) => `<tr><td>${esc(x.parameter)}</td><td>${esc(x.value)}</td><td class="num">${pct(x.CAGR, 1)}</td><td class="num">${num(x.Sharpe, 2)}</td><td class="num">${pct(x.MaxDrawdown, 1)}</td></tr>`).join("")}</tbody></table></div>` : empty("尚无：完整回测每月 1 日运行后发布"))}`;
  navChart(byId("c-bnav"), b.nav, true);
  const dd = b.drawdown;
  mkChart(byId("c-bdd"), { tooltip: { trigger: "axis", valueFormatter: (v) => pct(v, 1) }, xAxis: { type: "time" }, yAxis: { type: "value", axisLabel: { formatter: (v) => pct(v, 0) } },
    series: Object.keys(dd).map((k, i) => lineSeries(k === "Strategy" ? "策略" : k, dd[k], k === "Strategy"
      ? { color: palette()[0], width: 1.6, extra: { markPoint: { symbol: "pin", symbolSize: 36, data: [{ type: "min", name: "最大回撤" }],
          label: { formatter: (p) => pct(p.value, 0), fontSize: 10 } } } }
      : { color: BENCH_GRAY(), width: 1.2, dash: i % 2 ? "dotted" : "dashed" })) });
  if (b.monthly) {
    const months = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
    const data = [];
    b.monthly.values.forEach((row, yi) => row.forEach((v, mi) => data.push([mi, yi, isNum(v) ? Math.round(v * 1000) / 10 : "-"])));
    const lim = Math.max(5, ...data.map((d) => (isNum(d[2]) ? Math.abs(d[2]) : 0)));
    mkChart(byId("c-month"), { tooltip: { trigger: "item", formatter: (p) => `${b.monthly.years[p.value[1]]} 年 ${months[p.value[0]]}：${p.value[2]}%` }, legend: { show: false },
      grid: { left: 50, right: 20, top: 10, bottom: 50 }, xAxis: { type: "category", data: months }, yAxis: { type: "category", data: b.monthly.years, inverse: true },
      visualMap: { min: -lim, max: lim, orient: "horizontal", left: "center", bottom: 0, itemWidth: 12, itemHeight: 140, textStyle: { color: css("--muted") }, inRange: { color: divergingColors() } },
      series: [{ type: "heatmap", data, label: { show: true, fontSize: 10, color: css("--ink") }, itemStyle: { borderColor: css("--surface"), borderWidth: 2, borderRadius: 3 } }] });
  }
  if (b.regimes) regimeChart(byId("c-breg"), b.regimes);
  if (b.tracking?.nav) navChart(byId("c-track"), b.tracking.nav, false);
};


// ---------------- 术语与说明 ----------------
PAGES.glossary = async (r) => {
  const q = (r.query.q || "").trim();
  const target = r.query.t || "";
  const list = (window.GLOSSARY || []).filter((g) => !q || `${g.name}${g.short}${g.body}`.toLowerCase().includes(q.toLowerCase()));
  const sections = window.GLOSSARY_CATEGORIES.map((cat) => {
    const items = list.filter((g) => g.cat === cat);
    if (!items.length) return "";
    return card(cat, items.map((g) => `<div class="gloss-item ${g.id === target ? "target" : ""}" id="g-${g.id}">
      <h4>${esc(g.name)}${KINDS[g.id] ? badge(g.id) : ""}</h4><p class="short">${esc(g.short)}</p>
      ${g.body ? `<p>${esc(g.body)}</p>` : ""}${g.how ? `<p class="muted">怎么看：${esc(g.how)}</p>` : ""}</div>`).join(""), "", []);
  }).join("");
  app().innerHTML = `
    <h2>术语与说明</h2>
    <section class="card"><h3>本看板的信息分四类</h3>
      <p>${badge("fact")} <b>事实</b>：真实发生的数据或新闻原文。 ${badge("derived")} <b>计算</b>：由事实按固定公式算出。
         ${badge("model")} <b>模型 / AI</b>：模型或 AI 的判断，可能出错。 ${badge("simulated")} <b>模拟</b>：假设过去按模型操作的结果，不是真实收益。</p>
      <p class="muted">阅读顺序建议：先看“事实”和“计算”了解发生了什么，再把“模型 / AI”当作参考意见，“模拟”只用来判断方法是否大致可靠。所有内容仅为量化研究信号，不构成投资建议。</p>
      <div class="row"><input id="g-q" type="search" placeholder="搜索术语，如 夏普 / 回撤 / 分位" value="${esc(q)}" style="min-width:260px"></div></section>
    ${sections || card("没有匹配的术语", empty("换个关键词试试"), "", [])}`;
  const input = byId("g-q");
  input.addEventListener("change", () => { location.hash = `#/glossary${input.value ? `?q=${encodeURIComponent(input.value)}` : ""}`; });
  if (target) setTimeout(() => byId(`g-${target}`)?.scrollIntoView({ block: "center" }), 50);
};

// ---------------- 启动 ----------------
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
async function init() {
  // 优先使用网址参数 ?theme=dark|light（便于分享），其次是本机记住的选择，否则跟随系统
  const urlTheme = new URLSearchParams(location.search).get("theme");
  let saved = null;
  try { saved = localStorage.getItem("theme"); } catch { /* 隐私模式下 localStorage 不可用 */ }
  applyTheme(urlTheme === "dark" || urlTheme === "light" ? urlTheme : saved);
  document.getElementById("theme-toggle").onclick = () => {
    const next = isDark() ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem("theme", next); } catch { /* 忽略 */ }
    route();
  };
  try {
    META = await load("meta.json");
    document.getElementById("meta-line").textContent = `信号日 ${META.signal_date || "—"} · 数据截至 ${META.data_end} · 更新于 ${META.generated_at.replace("T", " ").slice(0, 16)} UTC`;
    document.getElementById("footer").textContent = META.disclaimer;
  } catch (e) {
    app().innerHTML = card("加载失败", `<p class="warn">${esc(e.message)}</p>`);
    return;
  }
  window.addEventListener("hashchange", route);
  route();
}
document.addEventListener("DOMContentLoaded", init);
