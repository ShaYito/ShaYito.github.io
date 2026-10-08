"use strict";
/* 多股对比（#/compare?t=NVDA,AMD,SMH&p=1Y&w=252）：股票 / ETF 数量不限。
   走势对比（起点 = 100 / 相对基准 / 剔除 β，可选 SPY 或主题基准、对数坐标）、相关性矩阵、选中一对的滚动相关性、汇总表。
   数据：sim/prices.json 的日频复权收盘价（2015 年起，覆盖选股池与 ETF）。 */

const CMP_MAX = Infinity; // 不限制选择数量（超过 8 只时颜色自动扩展）
// 第 i 只的颜色：前 8 只用主题调色板，之后按色相均匀取色
function cmpColor(i) { return i < 8 ? palette()[i] : `hsl(${Math.round((i * 137.5) % 360)} 62% ${isDark() ? 62 : 44}%)`; }
// 区块标题上的“参考价值”标签（排序依据）
function valueChip(v) { return `<span class="chip" title="对判断与决策的参考价值；本页各区块按此从高到低排列">参考价值 ${esc(v)}</span> `; }
const CMP_PERIODS = [["1M", 21, "1 月"], ["3M", 63, "3 月"], ["6M", 126, "6 月"], ["YTD", "ytd", "今年"], ["1Y", 252, "1 年"], ["3Y", 756, "3 年"], ["5Y", 1260, "5 年"]];
const CMP_WINDOWS = [[60, "60 天"], [252, "1 年"], [756, "3 年"]];
const CMP_ROLL = 60;
const CMP_HOWTO = [
  "在左侧勾选股票或 ETF（数量不限，也可以用上方的快捷按钮一键选中一组），选择会记在网址里，可以收藏或分享。本页各区块按对判断的参考价值从高到低排列（标题上标有“参考价值”）：全部股票指标对比、周期性不需要选择即可查看；收益与风险、相关性、走势对比需要选择至少 2 只。",
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
  const color = Object.fromEntries(sel.map((t, i) => [t, cmpColor(i)]));
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
  const parts = sel.length < 2 ? null : cmpBody(st, raw, sel, i0, end, color, myW);
  const need2 = `<section class="card">${empty("在左侧勾选至少 2 只（数量不限），或点上方的快捷按钮，下方显示收益与风险、相关性与走势对比。")}</section>`;
  app().innerHTML = `
    <div class="stock-layout" data-no-secnav>${compareSidebar(sel)}<div class="stock-main">
    <h2>多股对比 <span class="muted">已选 ${sel.length} 只 · 价格截至 ${esc(dates[end])}</span></h2>
    <section class="card"><div class="row"><span class="muted">快捷选择</span>${presets.map(([n, ts], i) => `<button type="button" class="ghost cmp-preset" data-i="${i}" title="${esc(ts.join("、"))}">${esc(n)}${ts.length > CMP_MAX ? `（前 ${CMP_MAX}）` : ""}</button>`).join("")}
      ${sel.length ? `<button type="button" class="ghost" id="cmp-clear">清空</button>` : ""}</div>
      ${sel.length ? `<p>${sel.map((t) => `<span class="chip" style="border-color:${color[t]}"><span class="dot" style="background:${color[t]}"></span>${esc(t)} ${esc(META.names_zh?.[t] || "")} <a href="#" class="cmp-x" data-t="${t}" title="移除">×</a></span>`).join("")}</p>` : ""}</section>
    ${howto(CMP_HOWTO)}
    ${parts ? parts.ins : ""}
    <section class="card" id="cmp-all"><h3>全部股票指标对比 ${valueChip("中–高")}${badge("fact")}${badge("derived")}</h3><div id="cmp-all-body">${empty("加载中…")}</div></section>
    <section class="card" id="cmp-cyc"><h3>周期性 ${valueChip("中–高")}${badge("fact")}${badge("derived")}</h3><div id="cmp-cyc-body">${empty("加载中…")}</div></section>
    ${sel.length >= 2 ? `<section class="card"><div class="row"><span class="muted">区间</span>${seg("cmp-p", CMP_PERIODS.map(([k, , n]) => [k, n]), st.p)}
      <span class="muted">走势</span>${seg("cmp-m", [["raw", "原始"], ["rel", "相对大盘"], ["resid", "剔除 β"]], st.m)}
      ${st.m !== "raw" ? `<span class="muted">基准</span>${seg("cmp-b", [["spy", "SPY"], ["theme", "各自主题基准"]], st.b)}` : `<label><input type="checkbox" id="cmp-log" ${st.log ? "checked" : ""}> 对数坐标</label>`}</div></section>` : ""}
    ${parts ? parts.summary + parts.corr + parts.trend : need2}
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
  cmpCycle(sel, color).catch((e) => console.error(e)); // 不依赖选择：默认显示全部股票
};

// ---------------- 全部股票指标对比（compare_metrics.json；ETF / 黄金等不适用的不列）----------------
const FCF_STAGE_ZH = ["非上升期", "上升早期", "上升中段", "接近高点", "见顶回落"];
const FCF_KIND_ZH = { 1: "A 基本面领先", 2: "B 价格驱动", 3: "C 双降" };
const FCF_PHASE_VALUE = ["低–中", "尚未回测验证；先观察，之后用约 2,300 家公司的数据回测再定"];
const CMP_EXTRA_DEFS = {
  fcf_stage_code: { name: "上升期阶段", fmt: "fcfstage", def: "FCF 收益率在自身历史中的阶段：非上升期 / 上升早期 / 上升中段 / 接近高点 / 见顶回落（只和自己比，不看绝对水平）。",
    read: "“接近高点”= 已在自身高位、上升减速、离近半年最高点很近；“见顶回落”= 刚从上升期的高点回落 ≥ 10%。只能事后确认，这里是按当时数据的估计。",
    use: "收益率高点 ≈ 股价相对现金流最便宜的时候；结合类型（A / B / C）看是基本面改善还是股价下跌造成的。", value: FCF_PHASE_VALUE },
  fcf_kind_code: { name: "上升类型", fmt: "fcfkind", def: "近 26 周收益率上升的来源：A = 每股 FCF 增长 ≥ 5%（基本面领先）；B = 每股 FCF 基本不变、股价下跌（价格驱动）；C = 每股 FCF 下降、股价跌得更多（双降）。",
    read: "A 最理想；B 需要看业务是否在恶化（价值陷阱）；C 应警惕。只要近 26 周收益率净上升就会给出来源（不一定达到“上升期”的强度）；净下降时为空。", use: "排序时 A < B < C。", value: FCF_PHASE_VALUE },
  fcf_z: { name: "上升强度", fmt: "num1", better: "high", def: "近 26 周收益率的对数变化 ÷ 这只股票历史上 26 周变化的标准差。",
    read: "≥ 0.5 才算上升期；同样上升 20%，对平稳的股票是更强的信号。", use: "只和自己比的强弱。", value: FCF_PHASE_VALUE },
  fcf_y_chg: { name: "收益率 26 周变化", fmt: "pp", better: null, def: "FCF 收益率近 26 周的变化（相对变化）。", read: "≈（1 + 每股 FCF 变化）÷（1 + 股价变化）− 1。", use: "看后两列拆分来源。", value: FCF_PHASE_VALUE },
  fcf_ps_chg: { name: "每股 FCF 变化", fmt: "pp", better: null, def: "近 26 周每股 FCF（近 4 季合计）的变化；只在交 10-Q / 10-K 后更新。", read: "正 = 现金流在改善。", use: "收益率上升的基本面部分。", value: FCF_PHASE_VALUE },
  fcf_px_chg: { name: "股价变化", fmt: "pp", better: null, def: "近 26 周股价变化。", read: "收益率 = 每股 FCF ÷ 股价，股价下跌会抬高收益率。", use: "收益率上升的价格部分。", value: FCF_PHASE_VALUE },
  fcf_y_pct: { name: "自身历史分位", fmt: "pct0", better: null, def: "当前 FCF 收益率在自身近 5 年中的百分位。", read: "越高 = 相对自己的历史越便宜。", use: "≥ 70% 视为高位（判断“接近高点”的条件之一）。", value: FCF_PHASE_VALUE },
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
  ["traits", "经营特征", ["op_leverage", "share_change", "cash_conversion", "capex_intensity"]],
  ["fcf_phase", "FCF 收益率上升期", ["fcf_stage_code", "fcf_kind_code", "fcf_z", "fcf_y_chg", "fcf_ps_chg", "fcf_px_chg", "fcf_y_pct"]],
  ["growth", "增长与盈利", ["revenue_growth", "earnings_growth", "eps_fwd_growth", "gross_margin", "op_margin", "net_margin", "roe", "roa"]],
  ["health", "财务健康", ["net_cash_pct", "debt_to_equity", "current_ratio", "payout"]],
  ["price", "价格与风险", ["price", "ret_1m", "ret_ytd", "ret_1y", "pos_52w", "from_high", "vs_ma200", "vol_1y", "max_dd_1y", "beta"]],
  ["expect", "市场预期", ["median_target", "median_upside", "moves_up", "moves_down", "weighted_target", "weighted_upside", "analysts", "rec_mean", "short_pct_float", "short_change", "days_to_cover", "insiders_pct", "institutions_pct", "next_earnings"]],
];
const CMP_ALL = { group: null, sort: null, dir: 1, theme: "" };
function cmpDef(k) { return CMP_EXTRA_DEFS[k] || METRIC_DEFS[k] || { name: k, fmt: "num2" }; }
// 参考价值评级 → 分数（取评级文字开头，如“中–高”“高（风险）”“低（科技）/ 中（银行）”取“低”）
const VALUE_SCORE = { "高": 5, "中–高": 4, "中": 3, "低–中": 2, "低": 1 };
function valueScore(k) {
  const v = (cmpDef(k).value || [""])[0].split(/[（(/ ]/)[0].trim();
  return VALUE_SCORE[v] ?? 0;
}
/* 按参考价值排序：组内指标按评级从高到低；组按组内最高三项的平均评级从高到低（同分按全组平均） */
let CMP_SORTED = null;
function cmpGroups() {
  if (CMP_SORTED) return CMP_SORTED;
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const groups = CMP_GROUPS.map(([g, n, ks]) => {
    const keys = [...ks].sort((a, b) => valueScore(b) - valueScore(a));
    const sc = keys.map(valueScore);
    return [g, n, keys, avg(sc.slice(0, 3)), avg(sc)];
  }).sort((a, b) => b[3] - a[3] || b[4] - a[4]);
  CMP_SORTED = groups.map(([g, n, ks]) => [g, n, ks]);
  if (!CMP_ALL.group) { CMP_ALL.group = CMP_SORTED[0][0]; CMP_ALL.sort = CMP_SORTED[0][2][0]; CMP_ALL.dir = cmpDef(CMP_ALL.sort).better === "high" ? -1 : 1; }
  return CMP_SORTED;
}
function cmpFmt(v, f) {
  if (f === "cap") return isNum(v) ? (v >= 1e12 ? `${(v / 1e12).toFixed(2)}T` : `${(v / 1e9).toFixed(0)}B`) : "–";
  if (f === "int") return isNum(v) ? String(v) : "–";
  if (f === "date") return v ? esc(v.slice(5)) : "–";
  if (f === "fcfstage") return isNum(v) ? FCF_STAGE_ZH[v] : "–";
  if (f === "fcfkind") return isNum(v) ? FCF_KIND_ZH[v] : "–";
  return fmtMetric(v, f);
}
async function cmpAllTable(sel) {
  const host = byId("cmp-all-body");
  if (!host) return;
  const data = await load("compare_metrics.json").catch(() => null);
  if (!data) { host.innerHTML = empty("暂无数据"); return; }
  const draw = () => {
    const keys = cmpGroups().find(([g]) => g === CMP_ALL.group)[2];
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
    host.innerHTML = `<div class="row"><div class="seg" id="ca-g">${cmpGroups().map(([g, n]) => `<button type="button" data-g="${g}" class="${g === CMP_ALL.group ? "on" : ""}">${n}</button>`).join("")}</div>
      <select id="ca-theme"><option value="">全部主题</option>${META.themes.map((t) => `<option value="${t.key}" ${t.key === CMP_ALL.theme ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
      <span class="muted">点表头排序；悬停表头看指标说明；已选股票（${sel.length}）高亮并排在最前</span></div>
      <div class="table-wrap"><table class="cmp-all"><thead><tr><th>股票</th>${keys.map(th).join("")}</tr></thead><tbody>
      ${rows.map((r) => `<tr class="${sel.includes(r.ticker) ? "sel" : ""}"><td class="nowrap"><a href="#/stock/${esc(r.ticker)}"><b>${esc(r.ticker)}</b></a>${r.cyc_tier === "strong" ? ' <span class="chip warnchip" title="强周期：P/E 高低主要反映处于周期的哪个阶段">强周期</span>' : r.cyc_tier === "medium" ? ' <span class="chip" title="中等周期性">中周期</span>' : ""}${r.fin_currency && r.fin_currency !== "USD" ? `<sup title="财报以 ${esc(r.fin_currency)} 计">†</sup>` : ""} <span class="muted">${esc(META.names_zh?.[r.ticker] || "")}</span></td>
        ${keys.map((key) => { const d = cmpDef(key); return `<td class="num ${d.fmt === "pp" ? cls(r[key]) : ""}">${cmpFmt(r[key], d.fmt)}</td>`; }).join("")}</tr>`).join("")}
      <tr class="total"><td><b>中位数</b></td>${keys.map((key) => `<td class="num">${key === "next_earnings" ? "" : cmpFmt(med(key), cmpDef(key).fmt)}</td>`).join("")}</tr></tbody></table></div>
      <details class="howto" open><summary>本组指标的含义、用法与参考价值</summary>${metricDocTable(keys, cmpDef)}<p class="muted">${esc(METRIC_VALUE_NOTE)}</p></details>
      <p class="muted">公司数据来自 yfinance（${esc(data.asof)}），价格类按最新收盘计算；“–”表示该公司不适用或暂无数据（如银行没有毛利率、EV/EBITDA）。ETF 与黄金没有这些公司指标，不列入。† = 财报以外币计（如台积电 TWD、ASML EUR）：总额类比率已按汇率换算，P/B 与 EV/EBITDA 不显示，P/E 可能有约一成的汇率口径偏差。每个指标的含义与用法见个股页“关键指标”。</p>`;
    host.querySelectorAll("#ca-g button").forEach((b) => (b.onclick = () => { CMP_ALL.group = b.dataset.g; const ks = cmpGroups().find(([g]) => g === CMP_ALL.group)[2]; if (!ks.includes(CMP_ALL.sort)) { CMP_ALL.sort = ks[1] || ks[0]; CMP_ALL.dir = 1; } draw(); }));
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
  return { ins: insightBox(ins, 6), trend: `
    <section class="card"><h3>走势对比（${st.m === "raw" ? "起点 = 100" : `${st.m === "rel" ? "相对" : "剔除 β 后，相对"}${st.b === "theme" ? "各自主题基准" : " SPY"}，区间累计`}）${valueChip("低–中")}${badge("fact")}${badge("derived")}</h3>${chartDiv("c-cmp", "tall")}
      ${st.m !== "raw" ? `<p class="muted">${st.m === "rel" ? "每天的涨跌减去基准涨跌后从区间起点累计：线在 0 以上 = 区间内跑赢基准。" : "每天的涨跌减去 β × 基准涨跌（β 用此前一年日收益估计，不用未来数据）后累计，去掉大盘 / 板块带动的部分，剩下公司自身因素：高 β 股票在牛市里“相对大盘”会显得偏强，这里不会。"}${st.b === "theme" ? "主题基准：每只股票用所属主题的行业 ETF（ETF 用 SPY）。" : ""}读法与局限见个股页“相对大盘走势”。</p>` : ""}
      ${late.length ? `<p class="muted">${late.map((t) => `${t} 从 ${raw.dates[stats[t].late]} 才有数据，从该日起归一。`).join("")}</p>` : ""}</section>
`, corr: `
    <div class="grid two"><section class="card"><h3>相关性矩阵 ${valueChip("中")}${badge("derived")}</h3>
        <div class="row"><span class="muted">计算窗口</span><div class="seg" id="cmp-w">${CMP_WINDOWS.map(([k, n]) => `<button type="button" data-v="${k}" class="${st.w === k ? "on" : ""}">${n}</button>`).join("")}</div></div>
        ${chartDiv("c-cmp-corr")}<p class="muted">点任意一格查看这两只的滚动相关性。</p></section>
      <section class="card"><h3>滚动 ${CMP_ROLL} 天相关性：${esc(pair[0])} × ${esc(pair[1])} ${badge("derived")}</h3>${chartDiv("c-cmp-roll")}
        <p class="muted">近 3 年，每周取一个点。线往上 = 两者走得越来越像；往下 = 开始分化。</p></section></div>
`, summary: `
    <section class="card"><h3>汇总：收益与风险（${esc(CMP_PERIODS.find(([k]) => k === st.p)[2])}）${valueChip("中")}${badge("derived")}</h3><div class="table-wrap"><table>
      <thead><tr><th>标的</th><th class="num">区间收益</th><th class="num">年化波动</th><th class="num">最大回撤</th><th class="num">Beta（vs SPY）</th><th class="num">与 SPY 相关</th><th class="num">相对基准</th><th class="num">剔除 β 后</th>${myW ? `<th class="num">占你账户</th>` : ""}</tr></thead>
      <tbody>${sel.map((t) => { const s = stats[t]; return `<tr><td><span class="dot" style="background:${color[t]}"></span><a href="#/stock/${t}"><b>${esc(t)}</b></a> <span class="muted">${esc(META.names_zh?.[t] || (META.etfs || []).find((e) => e.ticker === t)?.name_zh || "")}</span></td>
        ${s ? `<td class="num ${cls(s.ret)}">${pct(s.ret, 1, true)}</td><td class="num">${pct(s.vol, 0)}</td><td class="num neg">${pct(s.mdd, 1)}</td><td class="num">${num(s.beta, 2)}</td><td class="num">${num(s.corr, 2)}</td>
          <td class="num ${cls(relS[t].rel)}" title="相对 ${esc(relS[t].bench)}">${pct(relS[t].rel, 1, true)}${relS[t].bench !== "SPY" ? ` <span class="muted">vs ${esc(relS[t].bench)}</span>` : ""}</td><td class="num ${cls(relS[t].resid)}">${pct(relS[t].resid, 1, true)}</td>` : `<td colspan="7" class="muted">区间内无数据</td>`}
        ${myW ? `<td class="num">${myW[t] ? pct(myW[t], 1) : "–"}</td>` : ""}</tr>`; }).join("")}</tbody></table></div></section>` };
}

// ---------------- 周期性（cyclicality.json：财报数据分档 + 人工修正）----------------
const CYC_ZH = { strong: "强周期", medium: "中等", weak: "弱" };
async function cmpCycle(sel, color) {
  const host = byId("cmp-cyc-body");
  const cy = await load("cyclicality.json").catch(() => null);
  if (!host) return;
  if (!cy?.rows) { host.innerHTML = empty("暂无周期性数据"); return; }
  const R = cy.rows, f0 = (x) => (isNum(x) ? `${(x * 100).toFixed(0)}%` : "–"), pp = (x) => (isNum(x) ? `${(x * 100).toFixed(0)} 个百分点` : "–");
  const r2 = (x) => (isNum(x) ? `${x > 0 ? "+" : ""}${num(x, 2)}` : "–");
  const tierColor = { strong: css("--neg"), medium: palette()[1], weak: palette()[2] };
  const rank = { strong: 0, medium: 1, weak: 2 };
  // 全部股票：已选的在前，其余按 强 → 中 → 弱、波动幅度从大到小
  const order = Object.keys(R).sort((a, b) => (sel.includes(b) - sel.includes(a)) || rank[R[a].tier] - rank[R[b].tier] || (R[b].amplitude ?? 0) - (R[a].amplitude ?? 0));
  // 能画在地图上的（周期敏感度与波动幅度都有）/ 不能画的
  const pts = Object.entries(R).filter(([, r]) => isNum(r.sensitivity) && isNum(r.amplitude));
  const off = Object.entries(R).filter(([, r]) => !(isNum(r.sensitivity) && isNum(r.amplitude))).map(([t]) => t);
  const S = cy.strong, M = cy.medium;
  host.innerHTML = `<p class="muted">${rich("周期股 = 盈利随一个共同的行业周期大起大落。这里从两个维度衡量（只描述 2015 年以来的历史，不预测未来）：横轴“周期敏感度”回答“是不是跟着行业周期走”，纵轴“波动幅度”回答“起落有多猛”。周期性越强，P/E 越容易误导：盈利高峰时 P/E 最低、低谷时最高，这类股票更适合用 P/S 与自由现金流收益率估值。")}</p>
    <div class="grid two">${chartDiv("c-cyc-map")}${chartDiv("c-cyc-yoy")}</div>
    ${off.length ? `<p class="muted">未在地图上（缺少周期敏感度或波动幅度，原因见下表“依据 / 说明”）：${off.map(esc).join("、")}；分档按其余可用指标判断。</p>` : ""}
    <p class="muted">左图：横轴 = 公司近 4 季收入同比增速与“行业周期”同比增速的相关系数（半导体 / AI 基础设施用选股池同行、排除自身的收入同比中位数；其他公司用美国工业生产指数）；纵轴 = 波动幅度（收入从高点最大跌幅、利润率 P90−P10 波动、EPS 最大跌幅三项的平均）；点越大 = 2015 年以来收入同比转负的次数越多（反复下行 = 周期，一次 = 可能是一次性事件）。颜色：红 = 强周期、橙 = 中等、绿 = 弱；已选的放大并用对比颜色。虚线框 = 强周期区。
    右图：收入同比增速大起大落、反复穿过 0 的，就是典型的周期。</p>
    <div class="table-wrap"><table><thead><tr><th>股票</th><th>分档</th><th class="num" title="与行业周期的相关系数（参照见说明）">周期敏感度</th><th class="num" title="三项平均：收入跌幅、利润率波动、EPS 跌幅（截断在 100%）">波动幅度</th><th class="num" title="2015 年以来收入同比转负的次数">下行次数</th>
      <th class="num" title="近 4 季收入从高点的最大跌幅（SEC 季度数据）">收入最大跌幅</th><th class="num" title="近 4 季 EPS 之和从高点的最大跌幅；转为亏损时可超过 −100%">EPS 最大跌幅</th><th class="num" title="近 5 年季度营业利润率的 P90 − P10">利润率波动</th><th>依据 / 说明</th></tr></thead><tbody>
      ${order.map((t) => { const r = R[t]; return `<tr class="${sel.includes(t) ? "sel" : ""}"><td class="nowrap"><span class="dot" style="background:${color[t] || tierColor[r.tier]}"></span><a href="#/stock/${esc(t)}"><b>${esc(t)}</b></a> <span class="muted">${esc(META.names_zh?.[t] || "")}</span></td>
        <td class="nowrap"><span class="chip ${r.tier === "strong" ? "warnchip" : ""}">${CYC_ZH[r.tier]}</span>${r.tier_data && r.tier_data !== r.tier ? ` <span class="muted">（数据：${CYC_ZH[r.tier_data]}）</span>` : ""}</td>
        <td class="num" title="${esc(r.ref ? `参照：${r.ref}；${r.sens_n} 个季度` : "")}">${r2(r.sensitivity)}</td><td class="num">${f0(r.amplitude)}</td><td class="num">${r.downturns ?? "–"}</td>
        <td class="num">${isNum(r.revenue_dd) ? f0(r.revenue_dd) : '<span class="muted" title="见右侧说明">数据不足</span>'}</td><td class="num">${f0(r.eps_dd)}</td>
        <td class="num">${pp(r.margin_range)}${isNum(r.margin_range) && r.margin_basis === "净利率" ? '<sup title="用净利率替代营业利润率">*</sup>' : ""}</td>
        <td class="wrap muted">${esc([r.override || (r.reasons || []).join("；") || "波动幅度低于“中等”门槛", ...(r.notes || [])].join("。"))}</td></tr>`; }).join("") || `<tr><td colspan="9" class="muted">暂无数据</td></tr>`}</tbody></table></div>
    <p class="muted">分档规则：强周期 = 波动幅度 ≥ ${f0(S.amplitude)} 且与行业周期相关 ≥ ${num(S.sensitivity, 1)}（算不出相关性时要求利润率波动本身 ≥ ${f0(S.amplitude)}）；中等 = 波动幅度 ≥ ${f0(M.amplitude)}，或波动幅度 ≥ ${f0(M.amplitude_if_sensitive)} 且相关 ≥ ${num(M.sensitivity, 1)}；其余为弱。波动大但与行业周期相关性低的（如英特尔份额流失）只算中等——更可能是自身原因而非周期。收入最大跌幅为 0% 表示 2015 年以来近 4 季收入从未下降；收入历史不足 5 年或数据中断的记为“数据不足”。一次性事件、会计口径（如 AMZN 2022 年投资亏损）人工注明。利润率波动带 * 的用净利率替代。外国公司没有美元口径的 SEC 季度收入，只按 EPS 判断幅度。</p>`;
  mkChart(byId("c-cyc-map"), { title: { text: "周期性地图（右上 = 周期性强）", left: 0, top: 0, textStyle: { fontSize: 12, fontWeight: 500, color: css("--ink-2") } },
    tooltip: { formatter: (p) => { const r = R[p.data.t]; return `<b>${esc(p.data.t)}</b> · ${CYC_ZH[r.tier]}<br>周期敏感度 ${r2(r.sensitivity)}（${esc(r.ref)}）<br>波动幅度 ${f0(r.amplitude)} · 下行 ${r.downturns ?? "–"} 次<br>收入最大跌幅 ${f0(r.revenue_dd)} · EPS 最大跌幅 ${f0(r.eps_dd)}<br>利润率波动 ${pp(r.margin_range)}`; } },
    grid: { left: 48, right: 20, top: 34, bottom: 40 },
    xAxis: { type: "value", name: "周期敏感度（与行业周期的相关系数）", nameLocation: "middle", nameGap: 26, min: -0.5, max: 1 },
    yAxis: { type: "value", name: "波动幅度", nameLocation: "middle", nameGap: 34, min: 0, axisLabel: { formatter: (x) => `${x}%` } },
    series: [{ type: "scatter", data: pts.map(([t, r]) => { const on = sel.includes(t);
      return { t, value: [r.sensitivity, Math.round(r.amplitude * 100)], symbolSize: (on ? 10 : 7) + 3 * (r.downturns || 0),
        itemStyle: { color: on ? color[t] : tierColor[r.tier], opacity: on ? 1 : 0.55, borderColor: on ? css("--ink") : "transparent" },
        label: { show: true, formatter: t, position: "right", fontSize: on ? 12 : 10, color: on ? css("--ink") : css("--muted"), fontWeight: on ? 600 : 400 } }; }),
      labelLayout: { hideOverlap: true },
      markArea: { silent: true, itemStyle: { color: "transparent", borderColor: css("--neg"), borderType: "dashed", borderWidth: 1 },
        data: [[{ xAxis: S.sensitivity, yAxis: S.amplitude * 100 }, { xAxis: 1, yAxis: "max" }]] } }] });
  // 收入同比增速（近 4 季合计）：周期股呈大幅起伏的波浪
  const yoy = (rows) => rows.map(([d, v], i) => { const j = rows.findIndex(([d0]) => Math.abs((Date.parse(d) - Date.parse(d0)) / 864e5 - 365) <= 20); return j >= 0 && j < i && rows[j][1] > 0 ? [d, +((v / rows[j][1] - 1) * 100).toFixed(1)] : null; }).filter(Boolean);
  // 没有选择时默认显示强周期股，便于对照
  const pick = sel.filter((t) => R[t]?.rev_ttm?.length >= 8);
  const shown = pick.length ? pick : order.filter((t) => R[t].tier === "strong" && R[t].rev_ttm?.length >= 8);
  const ser = shown.map((t, i) => ({ name: t, type: "line", showSymbol: false, color: color[t] || cmpColor(i), lineStyle: { width: 2 }, data: yoy(R[t].rev_ttm) }));
  if (!ser.length) { byId("c-cyc-yoy").outerHTML = empty("所选股票没有可用的季度收入（外国公司只有年报）"); return; }
  mkChart(byId("c-cyc-yoy"), { title: { text: `收入同比增速（近 4 季合计）${pick.length ? "" : " · 未选股票时显示强周期股"}`, left: 0, top: 0, textStyle: { fontSize: 12, fontWeight: 500, color: css("--ink-2") } },
    tooltip: { trigger: "axis", valueFormatter: (x) => (isNum(x) ? `${x > 0 ? "+" : ""}${num(x, 0)}%` : "–") }, legend: { type: "scroll", top: 20, left: 0, right: 0 }, grid: { left: 48, right: 20, top: 52, bottom: 30 },
    xAxis: { type: "time" }, yAxis: { type: "value", axisLabel: { formatter: (x) => `${x}%` } },
    series: ser.map((x, i) => (i ? x : { ...x, markLine: { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" }, label: { show: false }, data: [{ yAxis: 0 }] } })) });
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
