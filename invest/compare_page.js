"use strict";
/* 多股对比（#/compare?t=NVDA,AMD,SMH&p=1Y&w=252）：最多 8 只股票 / ETF。
   走势对比（起点 = 100 / 相对基准 / 剔除 β，可选 SPY 或主题基准、对数坐标）、相关性矩阵、选中一对的滚动相关性、汇总表。
   数据：sim/prices.json 的日频复权收盘价（2015 年起，覆盖选股池与 ETF）。 */

const CMP_MAX = 8;
const CMP_PERIODS = [["1M", 21, "1 月"], ["3M", 63, "3 月"], ["6M", 126, "6 月"], ["YTD", "ytd", "今年"], ["1Y", 252, "1 年"], ["3Y", 756, "3 年"], ["5Y", 1260, "5 年"]];
const CMP_WINDOWS = [[60, "60 天"], [252, "1 年"], [756, "3 年"]];
const CMP_ROLL = 60;
const CMP_HOWTO = [
  "在左侧勾选最多 8 只股票或 ETF（也可以用上方的快捷按钮一键选中一组），选择会记在网址里，可以收藏或分享。",
  "走势对比：每只从区间起点归一为 100（[[index100|指数化]]），直接比涨幅；打开“相对 SPY”后，线高于 100 表示区间内跑赢大盘；区间较长时可打开“对数坐标”：每往上一条横线代表翻一倍，相同斜率 = 相同的涨幅速度，不会被涨得最多的那只把其他线压扁。价格为复权价（含分红）。",
  "相关性矩阵：两两之间日收益率的[[correlation|相关系数]]（−1 ~ 1）。越接近 1 越同涨同跌，接近 0 表示关系不大，负值表示常常反向。几只持仓两两相关都很高，意味着它们其实押在同一件事上，分散效果有限。点矩阵中任意一格，下方显示这两只的滚动 60 天相关性变化。",
  "走势切换：“相对大盘”= 每天涨跌减去基准涨跌后累计（线在 0 以上 = 跑赢）；“剔除 β”= 减去 [[beta|β]] × 基准涨跌后累计，去掉大盘 / 板块带动的部分，只看公司自身因素（β 用此前一年日收益估计，不用未来数据）。基准可选 SPY 或各自的主题基准（行业 ETF）。",
  "汇总表：区间收益、年化[[volatility|波动]]、区间最大[[drawdown|回撤]]、相对 SPY 的 [[beta|Beta]]（大盘涨跌 1% 时它平均涨跌多少）和与 SPY 的相关系数，都按所选区间计算；“相对基准”“剔除 β 后”按上方所选基准计算区间累计。",
];

function cmpParse(r) {
  const valid = new Set([...(META.etfs || []).map((e) => e.ticker), ...META.universe.map((u) => u.ticker)]);
  const t = (r.query.t || "").split(",").map((x) => x.trim().toUpperCase()).filter((x) => valid.has(x));
  return {
    t: [...new Set(t)].slice(0, CMP_MAX),
    p: CMP_PERIODS.some(([k]) => k === r.query.p) ? r.query.p : "1Y",
    w: CMP_WINDOWS.some(([k]) => String(k) === r.query.w) ? +r.query.w : 252,
    m: ["raw", "rel", "resid"].includes(r.query.m) ? r.query.m : r.query.rel === "1" ? "rel" : "raw", // 原始 / 相对基准 / 剔除 β
    b: r.query.b === "theme" ? "theme" : "spy", log: r.query.log === "1",
    pair: (r.query.pair || "").split(",").filter(Boolean),
  };
}
function cmpHash(s) {
  const q = new URLSearchParams();
  if (s.t.length) q.set("t", s.t.join(","));
  q.set("p", s.p); q.set("w", String(s.w));
  if (s.m !== "raw") q.set("m", s.m);
  if (s.b === "theme") q.set("b", "theme");
  if (s.log) q.set("log", "1");
  if (s.pair.length === 2) q.set("pair", s.pair.join(","));
  return `#/compare?${q.toString().replace(/%2C/g, ",")}`;
}
function cmpGo(s) { const y = window.scrollY; location.hash = cmpHash(s); setTimeout(() => window.scrollTo(0, y), 0); }

// 相对走势的基准：SPY，或所属主题的行业 ETF（ETF / 无主题的用 SPY）
function cmpBench(t, b, raw) {
  if (b !== "theme") return "SPY";
  const th = META.universe.find((u) => u.ticker === t)?.theme;
  const bt = META.themes.find((x) => x.key === th)?.benchmark;
  return bt && raw.close[bt] ? bt : "SPY";
}
// 日收益（两只都有数据的日子）→ 相关系数 / Beta
function cmpReturns(c, i0, i1) {
  const out = [];
  for (let i = Math.max(i0, 1); i <= i1; i++) out.push(c[i] != null && c[i - 1] != null ? c[i] / c[i - 1] - 1 : null);
  return out;
}
function cmpCorr(a, b) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] == null || b[i] == null) continue;
    n++; sa += a[i]; sb += b[i]; saa += a[i] * a[i]; sbb += b[i] * b[i]; sab += a[i] * b[i];
  }
  if (n < 20) return null;
  const cov = sab / n - (sa / n) * (sb / n), va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : null;
}
function cmpBeta(a, m) {
  let n = 0, sa = 0, sm = 0, smm = 0, sam = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] == null || m[i] == null) continue;
    n++; sa += a[i]; sm += m[i]; smm += m[i] * m[i]; sam += a[i] * m[i];
  }
  if (n < 20) return null;
  const vm = smm / n - (sm / n) ** 2;
  return vm > 0 ? (sam / n - (sa / n) * (sm / n)) / vm : null;
}
function cmpStats(c, i0, i1, spyR) {
  let first = i0;
  while (first <= i1 && c[first] == null) first++;
  if (first >= i1) return null;
  const r = cmpReturns(c, first, i1);
  const valid = r.filter((x) => x != null);
  const mean = valid.reduce((x, y) => x + y, 0) / valid.length;
  const vol = Math.sqrt(valid.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, valid.length - 1)) * Math.sqrt(252);
  let peak = -Infinity, mdd = 0;
  for (let i = first; i <= i1; i++) { if (c[i] == null) continue; peak = Math.max(peak, c[i]); mdd = Math.min(mdd, c[i] / peak - 1); }
  const spy = spyR.slice(first - i0);
  return { ret: c[i1] / c[first] - 1, vol, mdd, beta: cmpBeta(r, spy), corr: cmpCorr(r, spy), late: first > i0 ? first : null };
}
// 你的账户比例（本机账本 / 个人版）：股数 × 最新收盘价
function cmpMyWeights(raw) {
  if (holdingsMode() !== "mine") return null;
  const h = loadHoldings();
  if (!h) return null;
  const last = (t) => { const c = raw.close[t]; if (!c) return h.prices?.[t] || h.cost?.[t] || 0; for (let i = c.length - 1; i >= 0; i--) if (c[i] != null) return c[i]; return 0; };
  const val = Object.fromEntries(Object.entries(h.positions).map(([t, n]) => [t, n * last(t)]));
  const total = Object.values(val).reduce((a, b) => a + b, 0) + (h.cash || 0);
  return total > 0 ? Object.fromEntries(Object.entries(val).map(([t, v]) => [t, v / total])) : null;
}

function compareSidebar(sel) {
  const on = new Set(sel);
  const item = (t, name, color) => `<label class="cmp-item ${on.has(t) ? "on" : ""}"><input type="checkbox" data-t="${t}" ${on.has(t) ? "checked" : ""} ${!on.has(t) && sel.length >= CMP_MAX ? "disabled" : ""}>
    <span class="dot" style="background:${color}"></span>${isHeld(t) ? "● " : isPlanned(t) ? "◇ " : ""}<b>${esc(t)}</b>${esc(name || "")}</label>`;
  const etfs = (META.etfs || []).map((x) => item(x.ticker, x.name_zh, BENCH_GRAY())).join("");
  const groups = META.themes.map((th) => `<h4>${esc(th.name)}</h4>${sidebarOrder(META.universe.filter((u) => u.theme === th.key)).map((u) => item(u.ticker, u.name_zh, themeColor(th.key))).join("")}`).join("");
  return `<aside class="stock-side" aria-label="选择对比的股票"><a href="#/stock">← 返回个股</a><h4>ETF / 大类资产</h4>${etfs}${groups}</aside>`;
}

PAGES.compare = async (r) => {
  const st = cmpParse(r);
  const raw = await load("sim/prices.json");
  const dates = raw.dates, end = dates.length - 1;
  const perN = CMP_PERIODS.find(([k]) => k === st.p)[1];
  const i0 = perN === "ytd" ? Math.max(0, dates.findIndex((d) => d >= `${dates[end].slice(0, 4)}-01-01`) - 1) : Math.max(0, end - perN);
  const sel = st.t.filter((t) => raw.close[t]);
  const color = Object.fromEntries(sel.map((t, i) => [t, palette()[i % 8]]));
  const myW = cmpMyWeights(raw);
  // 快捷选择
  const alloc = (await load("overview.json").catch(() => null))?.allocation || [];
  const held = [...new Set([...(META.etfs || []).map((e) => e.ticker), ...META.universe.map((u) => u.ticker)])].filter((t) => holdingsMode() === "mine" && isHeld(t));
  const presets = [
    ...(held.length ? [["你的持仓", held]] : []),
    ...(plannedSet().size ? [["计划持仓", [...new Set([...held, ...plannedSet()])].filter((t) => raw.close[t])]] : []),
    ["系统建议持仓", alloc.map((a) => a.ticker).filter((t) => raw.close[t])],
    ["SPY / QQQ / GLD", ["SPY", "QQQ", "GLD"]],
    ...META.themes.map((th) => [th.name, META.universe.filter((u) => u.theme === th.key).map((u) => u.ticker)]),
  ];
  const seg = (id, items, cur) => `<div class="seg" id="${id}">${items.map(([k, n]) => `<button type="button" data-v="${k}" class="${String(cur) === String(k) ? "on" : ""}">${n}</button>`).join("")}</div>`;
  const body = sel.length < 2
    ? `<section class="card">${empty("在左侧勾选至少 2 只（最多 8 只），或点上方的快捷按钮。")}</section>`
    : cmpBody(st, raw, sel, i0, end, color, myW);
  app().innerHTML = `
    <div class="stock-layout" data-no-secnav>${compareSidebar(sel)}<div class="stock-main">
    <h2>多股对比 <span class="muted">已选 ${sel.length} / ${CMP_MAX} · 价格截至 ${esc(dates[end])}</span></h2>
    <section class="card"><div class="row"><span class="muted">快捷选择</span>${presets.map(([n, ts], i) => `<button type="button" class="ghost cmp-preset" data-i="${i}" title="${esc(ts.join("、"))}">${esc(n)}${ts.length > CMP_MAX ? `（前 ${CMP_MAX}）` : ""}</button>`).join("")}
      ${sel.length ? `<button type="button" class="ghost" id="cmp-clear">清空</button>` : ""}</div>
      ${sel.length ? `<p>${sel.map((t) => `<span class="chip" style="border-color:${color[t]}"><span class="dot" style="background:${color[t]}"></span>${esc(t)} ${esc(META.names_zh?.[t] || "")} <a href="#" class="cmp-x" data-t="${t}" title="移除">×</a></span>`).join("")}</p>` : ""}</section>
    ${howto(CMP_HOWTO)}
    ${sel.length >= 2 ? `<section class="card"><div class="row"><span class="muted">区间</span>${seg("cmp-p", CMP_PERIODS.map(([k, , n]) => [k, n]), st.p)}
      <span class="muted">走势</span>${seg("cmp-m", [["raw", "原始"], ["rel", "相对大盘"], ["resid", "剔除 β"]], st.m)}
      ${st.m !== "raw" ? `<span class="muted">基准</span>${seg("cmp-b", [["spy", "SPY"], ["theme", "各自主题基准"]], st.b)}` : `<label><input type="checkbox" id="cmp-log" ${st.log ? "checked" : ""}> 对数坐标</label>`}</div></section>` : ""}
    ${body}
    <section class="card" id="cmp-all"><h3>全部股票指标对比 ${badge("fact")}${badge("derived")}</h3><div id="cmp-all-body">${empty("加载中…")}</div></section>
    </div></div>`;
  // 交互
  const apply = (patch) => cmpGo({ ...st, t: sel, ...patch });
  document.querySelectorAll(".cmp-item input").forEach((el) => (el.onchange = () => {
    const t = el.dataset.t;
    apply({ t: el.checked ? [...sel, t].slice(0, CMP_MAX) : sel.filter((x) => x !== t), pair: [] });
  }));
  document.querySelectorAll(".cmp-preset").forEach((b) => (b.onclick = () => apply({ t: presets[+b.dataset.i][1].filter((t) => raw.close[t]).slice(0, CMP_MAX), pair: [] })));
  document.querySelectorAll(".cmp-x").forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); apply({ t: sel.filter((x) => x !== a.dataset.t), pair: [] }); }));
  byId("cmp-clear")?.addEventListener("click", () => apply({ t: [], pair: [] }));
  document.querySelectorAll("#cmp-p button").forEach((b) => (b.onclick = () => apply({ p: b.dataset.v })));
  document.querySelectorAll("#cmp-w button").forEach((b) => (b.onclick = () => apply({ w: +b.dataset.v })));
  document.querySelectorAll("#cmp-m button").forEach((b) => (b.onclick = () => apply({ m: b.dataset.v })));
  document.querySelectorAll("#cmp-b button").forEach((b) => (b.onclick = () => apply({ b: b.dataset.v })));
  byId("cmp-log")?.addEventListener("change", (e) => apply({ log: e.target.checked }));
  if (sel.length >= 2) cmpDraw(st, raw, sel, i0, end, color, apply);
  cmpAllTable(sel);
};

// ---------------- 全部股票指标对比（compare_metrics.json；ETF / 黄金等不适用的不列）----------------
const CMP_EXTRA_DEFS = {
  market_cap: { name: "市值", fmt: "cap", def: "总市值（美元）= 股价 × 总股数。", read: "衡量公司规模；超大市值公司流动性好、波动通常较小。",
    use: "同样的新闻，对小公司的股价影响往往更大；比较估值时注意规模差异。", value: ["低", "规模本身对收益的预测力在大盘股中很弱，主要用于理解波动与流动性。"] },
  price: { name: "现价", fmt: "num2", def: "最新收盘价（拆股调整）。", read: "单独看没有意义，需与目标价、成本价、历史区间比较。", use: "与加权目标价、你的平均成本对照。", value: ["—", "描述性数据。"] },
  median_target: { name: "目标价中位数", fmt: "num2", def: "各机构近 12 个月最新目标价的中位数（相同目标价的重申只算一次）。",
    read: "代表机构共识；比平均值更不受极端目标价影响。", use: "与现价比较得到共识空间；更有用的是它随时间的变化方向（见“本周上调 / 下调”）。",
    value: ["低", "目标价整体偏乐观、针对 12 个月，对短期涨跌预测力很弱。"] },
  median_upside: { name: "中位数空间", fmt: "pp", better: null, def: "目标价中位数 ÷ 现价 − 1。", read: "所有股票的平均空间常年为正，看相对高低而不是绝对值。",
    use: "空间已很小（甚至为负）说明乐观预期大多已反映在价格中，可作为加仓前的提醒。", value: ["低", "同“目标价中位数”。"] },
  weighted_target: { name: "加权目标价", fmt: "num2", def: "各机构最新目标价按“相对共识”的历史准确度加权（连续评分、12 个月期限、波动率标准化、经验贝叶斯收缩；样本不足的机构取中性权重），偏离中位数超过 50% 的不计入。",
    read: "与中位数差别通常很小。", use: "仅作对照。",
    caveat: "实测机构间准确度差异大多是样本噪音与覆盖范围的运气，且没有持续性（详见个股页“分析师目标价 → 局限”），按准确度加权并不比中位数更可靠。",
    value: ["低", "同“目标价中位数”，且加权缺乏实证支持。"] },
  weighted_upside: { name: "加权目标空间", fmt: "pp", better: null, def: "加权目标价 ÷ 现价 − 1。", read: "同“中位数空间”。",
    use: "仅作对照。", value: ["低", "同“加权目标价”。"] },
  moves_up: { name: "本周上调", fmt: "int", def: "近 7 天上调目标价的机构数。", read: "多家机构集中上调，通常跟随财报或重要新闻。",
    use: "与每周操作节奏最相关的分析师信息；结合新闻判断原因。", value: ["低–中", "预期修正方向在研究中对之后几周到几个月有一定参考价值；本系统回测结果见个股页。"] },
  moves_down: { name: "本周下调", fmt: "int", def: "近 7 天下调目标价的机构数。", read: "集中下调常是基本面转弱或估值过高的提示。",
    use: "持仓出现集中下调时复核持有理由。", value: ["低–中", "同“本周上调”。"] },
  analysts: { name: "机构数", fmt: "int", def: "近 12 个月给出目标价的机构数。", read: "覆盖越多，市场关注度越高、信息越充分。",
    use: "覆盖很少的公司，目标价与预期的代表性较弱。", value: ["低", "描述关注度，本身不预测涨跌。"] },
  next_earnings: { name: "下次财报", fmt: "date", def: "yfinance 的下次财报日期（公司正式公布前可能是预估）。", read: "财报前后是个股波动最大的时候。",
    use: "持仓临近财报时评估仓位，避免意外的大幅波动超出承受能力。", value: ["高（风险）", "财报日是确定的事件风险，对安排仓位和交易时点很有用。"] },
};
const CMP_GROUPS = [
  ["valuation", "估值", ["market_cap", "pe_ttm", "pe_fwd", "peg", "ps", "ev_ebitda", "pb", "fcf_yield", "dividend_yield"]],
  ["growth", "增长与盈利", ["revenue_growth", "earnings_growth", "eps_fwd_growth", "gross_margin", "op_margin", "net_margin", "roe", "roa"]],
  ["health", "财务健康", ["net_cash_pct", "debt_to_equity", "current_ratio", "payout"]],
  ["price", "价格与风险", ["price", "ret_1m", "ret_ytd", "ret_1y", "pos_52w", "from_high", "vs_ma200", "vol_1y", "max_dd_1y", "beta"]],
  ["expect", "市场预期", ["median_target", "median_upside", "moves_up", "moves_down", "weighted_target", "weighted_upside", "analysts", "rec_mean", "short_pct_float", "short_change", "days_to_cover", "insiders_pct", "institutions_pct", "next_earnings"]],
];
const CMP_ALL = { group: "valuation", sort: "pe_fwd", dir: 1, theme: "" };
function cmpDef(k) { return CMP_EXTRA_DEFS[k] || METRIC_DEFS[k] || { name: k, fmt: "num2" }; }
function cmpFmt(v, f) {
  if (f === "cap") return isNum(v) ? (v >= 1e12 ? `${(v / 1e12).toFixed(2)}T` : `${(v / 1e9).toFixed(0)}B`) : "–";
  if (f === "int") return isNum(v) ? String(v) : "–";
  if (f === "date") return v ? esc(v.slice(5)) : "–";
  return fmtMetric(v, f);
}
async function cmpAllTable(sel) {
  const host = byId("cmp-all-body");
  if (!host) return;
  const data = await load("compare_metrics.json").catch(() => null);
  if (!data) { host.innerHTML = empty("暂无数据"); return; }
  const draw = () => {
    const keys = CMP_GROUPS.find(([g]) => g === CMP_ALL.group)[2];
    const rows = data.rows.filter((r) => !CMP_ALL.theme || r.theme === CMP_ALL.theme);
    const k = CMP_ALL.sort;
    const val = (r) => (k === "next_earnings" ? (r[k] ? Date.parse(r[k]) : null) : r[k]);
    rows.sort((a, b) => {
      const sa = sel.includes(a.ticker), sb = sel.includes(b.ticker);
      if (sa !== sb) return sa ? -1 : 1; // 已选的排在最前
      const x = val(a), y = val(b);
      if (!isNum(x) && !isNum(y)) return 0;
      if (!isNum(x)) return 1;
      if (!isNum(y)) return -1;
      return (x - y) * CMP_ALL.dir;
    });
    const med = (key) => { const xs = rows.map((r) => r[key]).filter(isNum).sort((a, b) => a - b); return xs.length ? xs[Math.floor((xs.length - 1) / 2)] : null; };
    const th = (key) => { const d = cmpDef(key); return `<th class="num sortable ${key === k ? "on" : ""}" data-k="${key}" title="${esc(`${d.name}：${d.def || ""}${d.read ? ` 如何理解：${d.read}` : ""}`)}">${esc(d.name)}${key === k ? (CMP_ALL.dir > 0 ? " ▲" : " ▼") : ""}</th>`; };
    host.innerHTML = `<div class="row"><div class="seg" id="ca-g">${CMP_GROUPS.map(([g, n]) => `<button type="button" data-g="${g}" class="${g === CMP_ALL.group ? "on" : ""}">${n}</button>`).join("")}</div>
      <select id="ca-theme"><option value="">全部主题</option>${META.themes.map((t) => `<option value="${t.key}" ${t.key === CMP_ALL.theme ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
      <span class="muted">点表头排序；悬停表头看指标说明；已选股票（${sel.length}）高亮并排在最前</span></div>
      <div class="table-wrap"><table class="cmp-all"><thead><tr><th>股票</th>${keys.map(th).join("")}</tr></thead><tbody>
      ${rows.map((r) => `<tr class="${sel.includes(r.ticker) ? "sel" : ""}"><td class="nowrap"><a href="#/stock/${esc(r.ticker)}"><b>${esc(r.ticker)}</b></a>${r.fin_currency && r.fin_currency !== "USD" ? `<sup title="财报以 ${esc(r.fin_currency)} 计">†</sup>` : ""} <span class="muted">${esc(META.names_zh?.[r.ticker] || "")}</span></td>
        ${keys.map((key) => { const d = cmpDef(key); return `<td class="num ${d.fmt === "pp" ? cls(r[key]) : ""}">${cmpFmt(r[key], d.fmt)}</td>`; }).join("")}</tr>`).join("")}
      <tr class="total"><td><b>中位数</b></td>${keys.map((key) => `<td class="num">${key === "next_earnings" ? "" : cmpFmt(med(key), cmpDef(key).fmt)}</td>`).join("")}</tr></tbody></table></div>
      <details class="howto" open><summary>本组指标的含义、用法与参考价值</summary>${metricDocTable(keys, cmpDef)}<p class="muted">${esc(METRIC_VALUE_NOTE)}</p></details>
      <p class="muted">公司数据来自 yfinance（${esc(data.asof)}），价格类按最新收盘计算；“–”表示该公司不适用或暂无数据（如银行没有毛利率、EV/EBITDA）。ETF 与黄金没有这些公司指标，不列入。† = 财报以外币计（如台积电 TWD、ASML EUR）：总额类比率已按汇率换算，P/B 与 EV/EBITDA 不显示，P/E 可能有约一成的汇率口径偏差。每个指标的含义与用法见个股页“关键指标”。</p>`;
    host.querySelectorAll("#ca-g button").forEach((b) => (b.onclick = () => { CMP_ALL.group = b.dataset.g; const ks = CMP_GROUPS.find(([g]) => g === CMP_ALL.group)[2]; if (!ks.includes(CMP_ALL.sort)) { CMP_ALL.sort = ks[1] || ks[0]; CMP_ALL.dir = 1; } draw(); }));
    byId("ca-theme").onchange = (e) => { CMP_ALL.theme = e.target.value; draw(); };
    host.querySelectorAll("th.sortable").forEach((h) => (h.onclick = () => { if (CMP_ALL.sort === h.dataset.k) CMP_ALL.dir *= -1; else { CMP_ALL.sort = h.dataset.k; CMP_ALL.dir = cmpDef(h.dataset.k).better === "high" ? -1 : 1; } draw(); }));
  };
  draw();
}

function cmpBody(st, raw, sel, i0, end, color, myW) {
  const spyR = cmpReturns(raw.close.SPY, i0, end);
  const stats = Object.fromEntries(sel.map((t) => [t, cmpStats(raw.close[t], i0, end, spyR)]));
  // 区间相对基准 / 剔除 β 后（按所选基准；“原始”模式下用 SPY）
  const relS = Object.fromEntries(sel.map((t) => {
    const bt = cmpBench(t, st.b, raw), d = RelStr.daily(raw.close[t], raw.close[bt]);
    const last = (a) => { const c = RelStr.cum(a, raw.close[t], i0, end); return c[c.length - 1]; };
    return [t, { bench: bt, rel: last(d.rel), resid: last(d.resid), beta: d.beta[end] }];
  }));
  const w0 = Math.max(1, end - st.w);
  const R = Object.fromEntries(sel.map((t) => [t, cmpReturns(raw.close[t], w0, end)]));
  const pairs = [];
  for (let a = 0; a < sel.length; a++) for (let b = a + 1; b < sel.length; b++) pairs.push([sel[a], sel[b], cmpCorr(R[sel[a]], R[sel[b]])]);
  const ok = pairs.filter((p) => isNum(p[2])).sort((x, y) => y[2] - x[2]);
  const ins = [];
  if (ok.length) {
    const [a, b, c] = ok[0];
    ins.push({ level: c > 0.7 ? "medium" : "info", kind: "derived", text: `相关性最高：${a} 与 ${b}（${num(c, 2)}，${CMP_WINDOWS.find(([k]) => k === st.w)[1]}）${c > 0.7 ? "：高度同涨同跌，一起持有的分散效果有限" : ""}。` });
    const [la, lb, lc] = ok[ok.length - 1];
    if (ok.length > 1) ins.push({ level: "info", kind: "derived", text: `相关性最低：${la} 与 ${lb}（${num(lc, 2)}）。` });
    const avg = ok.reduce((x, p) => x + p[2], 0) / ok.length;
    ins.push({ level: avg > 0.6 ? "medium" : "info", kind: "derived", text: `所选 ${sel.length} 只两两相关系数平均 ${num(avg, 2)}${avg > 0.6 ? "，整体走势很接近" : ""}。` });
  }
  const ranked = sel.filter((t) => stats[t]).sort((a, b) => stats[b].ret - stats[a].ret);
  if (ranked.length) ins.push({ level: "info", kind: "derived", text: `区间涨幅最大：${ranked[0]}（${pct(stats[ranked[0]].ret, 1, true)}）；最小：${ranked[ranked.length - 1]}（${pct(stats[ranked[ranked.length - 1]].ret, 1, true)}）。` });
  const spyVol = stats.SPY?.vol ?? cmpStats(raw.close.SPY, i0, end, spyR)?.vol;
  const hv = ranked.filter((t) => t !== "SPY").sort((a, b) => stats[b].vol - stats[a].vol)[0];
  if (hv && spyVol) ins.push({ level: "info", kind: "derived", text: `波动最大：${hv}，年化 ${pct(stats[hv].vol, 0)}，约为 SPY 的 ${num(stats[hv].vol / spyVol, 1)} 倍。` });
  const rr = sel.filter((t) => isNum(relS[t].resid) && relS[t].bench !== t).sort((a, b) => relS[b].resid - relS[a].resid);
  if (rr.length >= 2) ins.push({ level: "info", kind: "derived", text: `剔除 β 后（公司自身因素）区间最强：${rr[0]}（${pct(relS[rr[0]].resid, 1, true)}）；最弱：${rr[rr.length - 1]}（${pct(relS[rr[rr.length - 1]].resid, 1, true)}）${st.b === "theme" ? "，相对各自主题基准" : "，相对 SPY"}。` });
  const late = sel.filter((t) => stats[t]?.late);
  const pair = st.pair.length === 2 && sel.includes(st.pair[0]) && sel.includes(st.pair[1]) ? st.pair : ok.length ? ok[0].slice(0, 2) : sel.slice(0, 2);
  return `${insightBox(ins, 6)}
    <section class="card"><h3>走势对比（${st.m === "raw" ? "起点 = 100" : `${st.m === "rel" ? "相对" : "剔除 β 后，相对"}${st.b === "theme" ? "各自主题基准" : " SPY"}，区间累计`}）${badge("fact")}${badge("derived")}</h3>${chartDiv("c-cmp", "tall")}
      ${st.m !== "raw" ? `<p class="muted">${st.m === "rel" ? "每天的涨跌减去基准涨跌后从区间起点累计：线在 0 以上 = 区间内跑赢基准。" : "每天的涨跌减去 β × 基准涨跌（β 用此前一年日收益估计，不用未来数据）后累计，去掉大盘 / 板块带动的部分，剩下公司自身因素：高 β 股票在牛市里“相对大盘”会显得偏强，这里不会。"}${st.b === "theme" ? "主题基准：每只股票用所属主题的行业 ETF（ETF 用 SPY）。" : ""}读法与局限见个股页“相对大盘走势”。</p>` : ""}
      ${late.length ? `<p class="muted">${late.map((t) => `${t} 从 ${raw.dates[stats[t].late]} 才有数据，从该日起归一。`).join("")}</p>` : ""}</section>
    <div class="grid two"><section class="card"><h3>相关性矩阵 ${badge("derived")}</h3>
        <div class="row"><span class="muted">计算窗口</span><div class="seg" id="cmp-w">${CMP_WINDOWS.map(([k, n]) => `<button type="button" data-v="${k}" class="${st.w === k ? "on" : ""}">${n}</button>`).join("")}</div></div>
        ${chartDiv("c-cmp-corr")}<p class="muted">点任意一格查看这两只的滚动相关性。</p></section>
      <section class="card"><h3>滚动 ${CMP_ROLL} 天相关性：${esc(pair[0])} × ${esc(pair[1])} ${badge("derived")}</h3>${chartDiv("c-cmp-roll")}
        <p class="muted">近 3 年，每周取一个点。线往上 = 两者走得越来越像；往下 = 开始分化。</p></section></div>
    <section class="card"><h3>汇总（${esc(CMP_PERIODS.find(([k]) => k === st.p)[2])}）${badge("derived")}</h3><div class="table-wrap"><table>
      <thead><tr><th>标的</th><th class="num">区间收益</th><th class="num">年化波动</th><th class="num">最大回撤</th><th class="num">Beta（vs SPY）</th><th class="num">与 SPY 相关</th><th class="num">相对基准</th><th class="num">剔除 β 后</th>${myW ? `<th class="num">占你账户</th>` : ""}</tr></thead>
      <tbody>${sel.map((t) => { const s = stats[t]; return `<tr><td><span class="dot" style="background:${color[t]}"></span><a href="#/stock/${t}"><b>${esc(t)}</b></a> <span class="muted">${esc(META.names_zh?.[t] || (META.etfs || []).find((e) => e.ticker === t)?.name_zh || "")}</span></td>
        ${s ? `<td class="num ${cls(s.ret)}">${pct(s.ret, 1, true)}</td><td class="num">${pct(s.vol, 0)}</td><td class="num neg">${pct(s.mdd, 1)}</td><td class="num">${num(s.beta, 2)}</td><td class="num">${num(s.corr, 2)}</td>
          <td class="num ${cls(relS[t].rel)}" title="相对 ${esc(relS[t].bench)}">${pct(relS[t].rel, 1, true)}${relS[t].bench !== "SPY" ? ` <span class="muted">vs ${esc(relS[t].bench)}</span>` : ""}</td><td class="num ${cls(relS[t].resid)}">${pct(relS[t].resid, 1, true)}</td>` : `<td colspan="7" class="muted">区间内无数据</td>`}
        ${myW ? `<td class="num">${myW[t] ? pct(myW[t], 1) : "–"}</td>` : ""}</tr>`; }).join("")}</tbody></table></div></section>`;
}

function cmpDraw(st, raw, sel, i0, end, color, apply) {
  const dates = raw.dates.slice(i0, end + 1);
  const relMode = st.m !== "raw";
  const series = sel.map((t) => {
    const c = raw.close[t];
    if (relMode) {
      const bt = cmpBench(t, st.b, raw);
      const d = RelStr.daily(c, raw.close[bt]);
      const data = RelStr.cum(st.m === "rel" ? d.rel : d.resid, c, i0, end).map((v) => (v == null ? null : +(v * 100).toFixed(2)));
      return { name: t, type: "line", showSymbol: false, color: color[t], lineStyle: { width: 2 }, data,
        endLabel: { show: true, formatter: (p) => `${t} ${p.value > 0 ? "+" : ""}${num(p.value, 0)}%`, color: css("--ink-2"), fontSize: 11 }, labelLayout: { moveOverlap: "shiftY" } };
    }
    let b = i0; while (b <= end && c[b] == null) b++;
    const data = dates.map((_, k) => {
      const i = i0 + k;
      if (i < b || c[i] == null) return null;
      const v = (c[i] / c[b]) * 100;
      return +v.toFixed(2);
    });
    return { name: t, type: "line", showSymbol: false, color: color[t], lineStyle: { width: t === "SPY" ? 1.4 : 2, type: t === "SPY" ? "dashed" : "solid" },
      data, endLabel: { show: true, formatter: (p) => `${t} ${num(p.value, 0)}`, color: css("--ink-2"), fontSize: 11 }, labelLayout: { moveOverlap: "shiftY" } };
  });
  mkChart(byId("c-cmp"), { tooltip: { trigger: "axis", valueFormatter: (v) => (!isNum(v) ? "–" : relMode ? `${v > 0 ? "+" : ""}${num(v, 1)}%` : `${num(v, 1)}（${pct(v / 100 - 1, 1, true)}）`) },
    legend: { top: 0 }, grid: { left: 56, right: 90, top: 36, bottom: 30 },
    xAxis: { type: "category", data: dates, boundaryGap: false },
    yAxis: relMode ? { type: "value", scale: true, axisLabel: { formatter: (v) => `${v}%` } } : st.log
      ? { type: "log", logBase: 2, min: (v) => v.min * 0.95, max: (v) => v.max * 1.05, axisLabel: { formatter: (v) => num(v, 0), showMinLabel: false, showMaxLabel: false },
          minorTick: { show: true }, minorSplitLine: { show: true, lineStyle: { color: css("--grid"), opacity: 0.5 } } }
      : { type: "value", scale: true },
    series: series.map((x, i) => (i ? x : { ...x, markLine: { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" }, label: { show: false }, data: [{ yAxis: relMode ? 0 : 100 }] } })) });
  // 相关性矩阵
  const w0 = Math.max(1, end - st.w);
  const R = Object.fromEntries(sel.map((t) => [t, cmpReturns(raw.close[t], w0, end)]));
  const data = [];
  sel.forEach((a, i) => sel.forEach((b, j) => { const c = i === j ? 1 : cmpCorr(R[a], R[b]); data.push([j, i, isNum(c) ? Math.round(c * 100) / 100 : "-"]); }));
  const hm = mkChart(byId("c-cmp-corr"), {
    tooltip: { trigger: "item", formatter: (p) => `${sel[p.value[1]]} × ${sel[p.value[0]]}：${p.value[2]}` }, legend: { show: false },
    grid: { left: 56, right: 16, top: 10, bottom: 70 },
    xAxis: { type: "category", data: sel, axisLabel: { color: (v, i) => color[sel[i]] } }, yAxis: { type: "category", data: sel, inverse: true, axisLabel: { color: (v, i) => color[sel[i]] } },
    visualMap: { min: -1, max: 1, orient: "horizontal", left: "center", bottom: 0, itemWidth: 12, itemHeight: 160, text: ["+1", "−1"], textStyle: { color: css("--muted") }, inRange: { color: divergingColors() } },
    series: [{ type: "heatmap", data, label: { show: true, fontSize: 11, color: css("--ink"), formatter: (p) => (p.value[0] === p.value[1] ? "" : num(p.value[2], 2)) },
      itemStyle: { borderColor: css("--surface"), borderWidth: 2 } }],
  });
  hm?.on("click", (p) => { if (p.value[0] !== p.value[1]) apply({ pair: [sel[p.value[1]], sel[p.value[0]]] }); });
  // 滚动相关性
  let pair = st.pair.length === 2 && sel.includes(st.pair[0]) && sel.includes(st.pair[1]) ? st.pair : null;
  if (!pair) {
    let best = null;
    for (let a = 0; a < sel.length; a++) for (let b = a + 1; b < sel.length; b++) { const c = cmpCorr(R[sel[a]], R[sel[b]]); if (isNum(c) && (!best || c > best[2])) best = [sel[a], sel[b], c]; }
    pair = best ? best.slice(0, 2) : sel.slice(0, 2);
  }
  const r0 = Math.max(CMP_ROLL + 1, end - 756);
  const ra = cmpReturns(raw.close[pair[0]], 1, end), rb = cmpReturns(raw.close[pair[1]], 1, end); // 下标 k 对应日期 k+1
  const rd = [], rv = [];
  for (let i = r0; i <= end; i += 5) {
    rd.push(raw.dates[i]);
    const c = cmpCorr(ra.slice(i - CMP_ROLL, i), rb.slice(i - CMP_ROLL, i));
    rv.push(isNum(c) ? +c.toFixed(3) : null);
  }
  mkChart(byId("c-cmp-roll"), { tooltip: { trigger: "axis", valueFormatter: (v) => num(v, 2) }, legend: { show: false }, grid: { left: 44, right: 16, top: 12, bottom: 30 },
    xAxis: { type: "category", data: rd, boundaryGap: false }, yAxis: { type: "value", min: -1, max: 1 },
    series: [{ name: `${pair[0]} × ${pair[1]}`, type: "line", showSymbol: false, color: palette()[0], data: rv,
      markLine: { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" }, label: { show: false }, data: [{ yAxis: 0 }] } }] });
}
