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
  "全部股票指标对比：指标按描述角度分四大类——价格与风险（短期得分、价格位置、风险水平、风险来源）、估值（倍数、全市场估值比较、FCF 收益率上升期）、基本面（增长与盈利、质量、重资产与资本投入、经营与资本配置、财务健康）、资金与预期（分析师预期、持仓结构与拥挤度）；组内从概览到细项排列，与个股页对应卡片同一口径。每组下方的说明表列出含义、用法与参考价值。",
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
    <span class="nm"><span class="dot" style="background:${color}"></span>${isHeld(t) ? "● " : isPlanned(t) ? "◇ " : ""}<b>${esc(t)}</b>${esc(name || "")}</span><span class="tgs">${tagChips(t)}</span></label>`;
  const etfs = (META.etfs || []).map((x) => item(x.ticker, x.name_zh, BENCH_GRAY())).join("");
  const groups = sideThemeGroups(() => true, (u, th) => item(u.ticker, u.name_zh, themeColor(th.key))); // 与个股页同样的分类与子分类
  const at = sideEtfAt();
  return `<aside class="stock-side" aria-label="选择对比的股票"><a href="#/stock">← 返回个股</a>${groups.slice(0, at).join("")}<h4>ETF / 大类资产</h4>${etfs}${groups.slice(at).join("")}</aside>`;
}

PAGES.compare = async (r) => {
  await bnData().catch(() => null); // 侧边栏紫色标出有瓶颈信号的股票
  const st = cmpParse(r);
  const raw = await load("sim/prices.json");
  CMP_EARN = await load("earn_days.json").catch(() => null); // 剔除 β 表的财报标记；缺失时不标
  const dates = raw.dates, end = dates.length - 1;
  const perN = CMP_PERIODS.find(([k]) => k === st.p)[1];
  const i0 = perN === "ytd" ? Math.max(0, dates.findIndex((d) => d >= `${dates[end].slice(0, 4)}-01-01`) - 1) : Math.max(0, end - perN);
  const sel = st.t.filter((t) => raw.close[t]);
  const color = Object.fromEntries(sel.map((t, i) => [t, cmpColor(i)]));
  const myW = cmpMyWeights(raw);
  // 快捷选择
  const held = [...new Set([...(META.etfs || []).map((e) => e.ticker), ...META.universe.map((u) => u.ticker)])].filter((t) => holdingsMode() === "mine" && isHeld(t));
  const presets = [
    ...(held.length ? [["你的持仓", held]] : []),
    ...(plannedSet().size ? [["计划持仓", [...new Set([...held, ...plannedSet()])].filter((t) => raw.close[t])]] : []),
    ["SPY / QQQ / GLD", ["SPY", "QQQ", "GLD"]],
    ...META.themes.map((th) => [th.name, META.universe.filter((u) => u.theme === th.key).map((u) => u.ticker)]),
  ];
  const seg = (id, items, cur) => `<div class="seg" id="${id}">${items.map(([k, n]) => `<button type="button" data-v="${k}" class="${String(cur) === String(k) ? "on" : ""}">${n}</button>`).join("")}</div>`;
  const parts = sel.length < 2 ? null : cmpBody(st, raw, sel, i0, end, color, myW);
  const need2 = `<section class="card">${empty("在左侧勾选至少 2 只（数量不限），或点上方的快捷按钮，下方显示收益与风险、相关性与走势对比。")}</section>`;
  app().innerHTML = `
    <div class="stock-layout" data-no-secnav>${compareSidebar(sel)}<div class="stock-main">
    <h2>多股对比 <span class="muted">已选 ${sel.length} 只 · 价格截至 ${esc(dates[end])}</span></h2>
    <section class="card cmp-quick" id="cmp-quick"><div class="row"><span class="muted">快捷选择</span>${presets.map(([n, ts], i) => `<button type="button" class="ghost cmp-preset" data-i="${i}" title="${esc(ts.join("、"))}">${esc(n)}${ts.length > CMP_MAX ? `（前 ${CMP_MAX}）` : ""}</button>`).join("")}
      ${sel.length ? `<button type="button" class="ghost" id="cmp-clear">清空</button>` : ""}</div>
      <div class="row"><span class="muted">按业务</span>${usedTags().map((k) => { const d = META.tags[k], ts = META.universe.filter((u) => (u.tags || []).includes(k)).map((u) => u.ticker);
        return `<button type="button" class="ghost cmp-tagp" data-k="${k}" title="${esc(`${d.name}：${ts.join("、")}`)}"><span class="tg" style="background:${d.color}">${esc(d.short)}</span> ${esc(d.name.replace(/（.*）/, ""))}</button>`; }).join("")}</div>
      ${sel.length ? `<p>${sel.map((t) => `<span class="chip" style="border-color:${color[t]}"><span class="dot" style="background:${color[t]}"></span>${esc(t)} ${esc(META.names_zh?.[t] || "")} <a href="#" class="cmp-x" data-t="${t}" title="移除">×</a></span>`).join("")} <a href="#" id="cmp-go-sw" class="cmp-jump">↓ 上涨 / 下跌折线图</a></p>` : ""}</section>
    ${howto(CMP_HOWTO)}
    ${parts ? parts.ins : ""}
    ${sel.length ? `<section class="card" id="cmp-rw">${cmpResidWin(st, raw, sel, color)}</section>` : ""}
    <section class="card" id="cmp-all"><h3>全部股票指标对比 ${valueChip("中–高")}${badge("fact")}${badge("derived")}</h3><div id="cmp-all-body">${empty("加载中…")}</div></section>
    <section class="card" id="cmp-cyc"><h3>周期性 ${valueChip("中–高")}${badge("fact")}${badge("derived")}</h3><div id="cmp-cyc-body">${empty("加载中…")}</div></section>
    ${sel.length >= 2 ? `<section class="card"><div class="row"><span class="muted">区间</span>${seg("cmp-p", CMP_PERIODS.map(([k, , n]) => [k, n]), st.p)}
      <span class="muted">走势</span>${seg("cmp-m", [["raw", "原始"], ["rel", "相对大盘"], ["resid", "剔除 β"]], st.m)}
      ${st.m !== "raw" ? `<span class="muted">基准</span>${seg("cmp-b", [["spy", "SPY"], ["theme", "各自主题基准"]], st.b)}` : `<label><input type="checkbox" id="cmp-log" ${st.log ? "checked" : ""}> 对数坐标</label>`}</div></section>` : ""}
    ${parts ? parts.summary + parts.corr + parts.trend : need2}
    ${sel.length ? `<section class="card" id="cmp-sw">${empty("加载中…")}</section>` : ""}
    </div></div>`;
  // 交互
  const apply = (patch) => cmpGo({ ...st, t: sel, ...patch });
  document.querySelectorAll(".cmp-item input").forEach((el) => (el.onchange = () => {
    const t = el.dataset.t;
    apply({ t: el.checked ? [...sel, t].slice(0, CMP_MAX) : sel.filter((x) => x !== t), pair: [] });
  }));
  document.querySelectorAll(".cmp-preset").forEach((b) => (b.onclick = () => apply({ t: presets[+b.dataset.i][1].filter((t) => raw.close[t]).slice(0, CMP_MAX), pair: [] })));
  document.querySelectorAll(".cmp-tagp").forEach((b) => (b.onclick = () => {
    CMP_ALL.tag = b.dataset.k; // 下方“全部股票指标”同步筛选到该业务
    apply({ t: META.universe.filter((u) => (u.tags || []).includes(b.dataset.k)).map((u) => u.ticker).filter((t) => raw.close[t]).slice(0, CMP_MAX), pair: [] });
  }));
  document.querySelectorAll(".cmp-x").forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); apply({ t: sel.filter((x) => x !== a.dataset.t), pair: [] }); }));
  byId("cmp-clear")?.addEventListener("click", () => apply({ t: [], pair: [] }));
  // 快捷选择栏吸顶：紧贴顶部导航栏下方（导航栏换行时高度会变）；跳到折线图时让出两个吸顶栏的高度（直接跳转，不用动画）
  const qk = byId("cmp-quick"), tb = document.querySelector(".topbar");
  if (qk && tb) qk.style.top = `${tb.offsetHeight}px`;
  byId("cmp-go-sw")?.addEventListener("click", (e) => {
    e.preventDefault();
    const el = byId("cmp-sw");
    const d = byId("cmp-sw-d");
    if (d && !d.open) d.open = true;
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (tb?.offsetHeight || 0) - (qk?.offsetHeight || 0) - 10);
  });
  document.querySelectorAll("#cmp-p button").forEach((b) => (b.onclick = () => apply({ p: b.dataset.v })));
  document.querySelectorAll("#cmp-w button").forEach((b) => (b.onclick = () => apply({ w: +b.dataset.v })));
  document.querySelectorAll("#cmp-m button").forEach((b) => (b.onclick = () => apply({ m: b.dataset.v })));
  document.querySelectorAll("#cmp-b button").forEach((b) => (b.onclick = () => apply({ b: b.dataset.v })));
  byId("cmp-log")?.addEventListener("change", (e) => apply({ log: e.target.checked }));
  cmpResidWinBind(st, raw, sel, color, apply);
  if (sel.length >= 2) cmpDraw(st, raw, sel, i0, end, color, apply);
  cmpAllTable(sel);
  cmpFillFcf().catch((e) => console.error(e));
  cmpCycle(sel, color).catch((e) => console.error(e)); // 不依赖选择：默认显示全部股票
  cmpSwings(sel, color).catch((e) => console.error(e));
};

// ---------------- 全部股票指标对比（compare_metrics.json；ETF / 黄金等不适用的不列）----------------
const FCF_STAGE_ZH = ["非上升期", "上升早期", "上升中段", "接近高点", "见顶回落"];
const FCF_KIND_ZH = { 1: "A 基本面领先", 2: "B 价格驱动", 3: "C 双降" };
// 参考价值按回测（2012–2026，选股池及同行业，窗口 13 / 4 周；2026-10-14 按修正后的 SEC 口径重跑）；具体数字见个股页“FCF 收益率上升期”卡片
const FCF_PHASE_VALUE = ["低", "回测中对之后 1 周–3 个月的超额收益没有稳定预测力，只作描述"];
const FCF_KIND_VALUE = ["低–中", "回测中上升期内 A 类之后 3 个月平均比 B 类高约 1.5%（t 2.0），但只在后半段时间成立、前半段不显著；对 1 周无效"];
const FCF_PS_VALUE = ["低", "回测中每股 FCF 变化与之后 1–3 个月超额收益略正相关，但很弱、不显著（t 约 1.6–1.9）"];
const CMP_EXTRA_DEFS = {
  fcf_stage_code: { name: "上升期阶段", fmt: "fcfstage", def: "FCF 收益率在自身历史中的阶段：非上升期 / 上升早期 / 上升中段 / 接近高点 / 见顶回落（只和自己比，不看绝对水平）。",
    read: "“接近高点”= 已在自身高位、上升减速、离近 13 周最高点很近；“见顶回落”= 刚从上升期的高点回落 ≥ 10%。只能事后确认，这里是按当时数据的估计。",
    use: "收益率高点 ≈ 股价相对现金流最便宜的时候；结合类型（A / B / C）看是基本面改善还是股价下跌造成的。", value: FCF_PHASE_VALUE },
  fcf_kind_code: { name: "上升类型", fmt: "fcfkind", def: "近 13 周（判定窗口）收益率上升的来源：A = 每股 FCF 增长 ≥ 5%（基本面领先）；B = 每股 FCF 基本不变、股价下跌（价格驱动）；C = 每股 FCF 下降、股价跌得更多（双降）。",
    read: "A 最理想；B 需要看业务是否在恶化（价值陷阱）；C 应警惕。只要近 13 周收益率净上升就会给出来源（不一定达到“上升期”的强度）；净下降时为空。", use: "排序时 A < B < C。", value: FCF_KIND_VALUE },
  fcf_z: { name: "上升强度", fmt: "num1", better: "high", def: "近 13 周收益率的对数变化 ÷ 这只股票截至当时 13 周变化的标准差。",
    read: "≥ 0.5 才算上升期；同样上升 20%，对平稳的股票是更强的信号。", use: "只和自己比的强弱。", value: FCF_PHASE_VALUE },
  fcf_y_chg: { name: "收益率 13 周变化", fmt: "pp", better: null, def: "FCF 收益率近 13 周的变化（相对变化）。", read: "≈（1 + 每股 FCF 变化）÷（1 + 股价变化）− 1。", use: "看后两列拆分来源。", value: FCF_PHASE_VALUE },
  fcf_ps_chg: { name: "每股 FCF 变化", fmt: "pp", better: null, def: "近 13 周每股 FCF（近 4 季合计）的变化；只在交 10-Q / 10-K 后更新。", read: "正 = 现金流在改善。", use: "收益率上升的基本面部分。", value: FCF_PS_VALUE },
  fcf_px_chg: { name: "股价变化", fmt: "pp", better: null, def: "近 13 周股价变化。", read: "收益率 = 每股 FCF ÷ 股价，股价下跌会抬高收益率。", use: "收益率上升的价格部分。", value: FCF_PHASE_VALUE },
  fcf_y_pct: { name: "自身历史分位", fmt: "pct0", better: null, def: "当前 FCF 收益率在自身近 5 年中的百分位。", read: "越高 = 相对自己的历史越便宜。", use: "≥ 70% 视为高位（判断“接近高点”的条件之一）。", value: FCF_PHASE_VALUE },
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
// M88 短期综合得分（short_evidence.json，与个股页“短期证据”同一份数据；只有选股池股票）
const SCORE_VALUE = ["中", "1 周：全市场与大盘股（≥ $10B）2019 年起样本外均通过（大盘股 IC 0.022，t 2.5）；单只股票的实际结果离散度远大于得分，只是倾向"];
const SCORE_VALUE_4W = ["低–中", "4 周：全市场样本外通过（t 2.45），但大盘股（≥ $10B）中未通过（IC 0.019，t 1.5）：对选股池这类大盘股证据较弱"];
const SCORE_DEFS = {
  score_4w: { name: "综合得分 4 周 ⚠", fmt: "pct2s", better: "high", def: "之后 4 周预期相对全市场平均的表现 = 已验证价格信号（扣除重叠的权重）+ 文献支持项（假定权重）。",
    read: "选股池大多在 ±1% 以内；历史上全市场得分最高与最低五分之一 4 周相差约 0.7%，而单只股票 4 周实际表现的标准差约 ±11%。", use: "作为倾向参考，与财报日程、基本面一起看；详见个股页“短期证据”。", value: SCORE_VALUE_4W },
  score_1w: { name: "综合得分 1 周", fmt: "pct2s", better: "high", def: "之后 1 周预期相对全市场平均的表现（只用 1 周有效的信号与权重）。",
    read: "短期回吐（近 1 周 / 1 月涨跌）占比更大；单只股票 1 周实际表现的标准差约 ±5%。", use: "更短的持有期参考。", value: SCORE_VALUE },
  score_4w_mom: { name: "4 周 · 中期动量", fmt: "pct2s", better: "high", def: "4 周得分中来自 12-1、6-1 月动量的部分。", read: "过去 6–12 个月强的之后倾向略强。", use: "看得分来自哪里。", value: SCORE_VALUE },
  score_4w_rev: { name: "4 周 · 短期回吐", fmt: "pct2s", better: "high", def: "4 周得分中来自近 1 周 / 1 月涨跌的部分（涨多为负、跌多为正）。", read: "近期涨得多的之后倾向小幅回吐。", use: "看得分来自哪里。", value: SCORE_VALUE },
  score_4w_lit: { name: "4 周 · 文献部分", fmt: "pct2s", better: "high", def: "4 周得分中来自 EPS 预期修正、空头、内部人买入的部分（权重为假定，本系统未检验）。", read: "EPS 预期上调为正、空头很高为负。", use: "看得分来自哪里。",
    value: ["低–中", "文献支持，本系统尚未检验（已进入证据前瞻账本）"] },
};
Object.assign(CMP_EXTRA_DEFS, SCORE_DEFS, {
  risk_pct: { name: "价格风险分位", fmt: "num0", better: "low", def: "近 1 年波动、近 3 个月波动、近 1 年最大回撤、下行 β 四项在当前市值 ≥ $10B 美股中的综合分位（0 = 最稳，100 = 波动最大；2026-10-20 起加入近 3 个月波动）。",
    read: "检验：与之后 3 个月实际波动的排序相关约 0.77、与之后半年最大回撤约 0.52（2012 年起，前后稳定）。", use: "决定仓位大小与能承受的波动；不预测涨跌。",
    value: ["高（风险）", "预测之后的波动与回撤很可靠（波动有很强的持续性）；不预测方向"] },
  risk_vol3m: { name: "近 3 个月波动", fmt: "pct0", better: "low", def: "近 63 个交易日日收益的标准差（年化）；价格风险的一项。", read: "比近 1 年波动反应更快：近期波动更能反映接下来的风险。",
    use: "与近 1 年波动对照：明显更高说明最近波动在放大。", value: ["高（风险）", "价格风险的组成部分，加入后对之后波动的预测提高（M97 检验通过）"] },
  risk_dbeta: { name: "下行 β", fmt: "num2", better: "low", def: "只用大盘下跌的日子估计的 β（近 1 年）：大盘跌 1% 时它平均跌多少。", read: "> 1 表示大盘下跌时跌得更多（Ang, Chen & Xing 2006）。",
    use: "评估回调时的损失；价格风险的一项。", value: ["中–高（风险）", "价格风险的组成部分"] },
  crowd_pct: { name: "拥挤度分位", fmt: "num0", better: "low", def: "MAX（近 1 月最大 5 日涨幅）、特质波动、近 1 月换手率等按显著度加权，在当前市值 ≥ $10B 美股中的分位（金融股只有四项价格类、等权）。",
    read: "最拥挤的 20% 之后半年大跌的概率约为同等价格风险股票的 1.35 倍（2019 年起样本外），未达事先 1.5 倍标准；对涨跌没有预测力。", use: "了解是否像“彩票股”一样被追捧、资金是否涌入；只作参考。",
    value: ["低–中", "回撤提示显著但未达事先标准，只作参考"] },
  crowd_ivol: { name: "特质波动（日）", fmt: "pct", better: "low", def: "近 63 日剔除大盘后的日收益波动（Ang et al. 2006）；拥挤度权重最大的两项之一。",
    read: "有相当一部分只是近期波动更大与板块共同波动（M97）；单项回撤提示较强但为事后挑出，只报告。", use: "与近 3 个月波动一起看。", value: ["低–中", "单项数值达标但为事后挑选，不作判定"] },
  crowd_turn: { name: "近 1 月日均换手率", fmt: "pct", better: "low", def: "近 21 日日均成交额 ÷ 市值（Datar, Naik & Radcliffe 1998）；拥挤度的一项。", read: "换手越高，资金进出越频繁。",
    use: "了解交易是否异常活跃。", value: ["低", "单项未通过检验"] },
  inst_io: { name: "机构持股（13F）", fmt: "pct0", better: "", def: "13F 申报机构（管理资产 ≥ $100M）合计持股市值 ÷ 季末市值（截断在 100%）。", read: "大盘股多在 60–90%。季末后约 45 天才公开。",
    use: "了解机构持有程度；对之后涨跌与大跌都没有预测力（M99）。", value: ["低", "检验未通过，只作描述"] },
  inst_sto: { name: "短线资金持股（13F）", fmt: "pct", better: "low", def: "近 4 个季度换手率最高三分之一的机构（含对冲基金与高换手的主动基金）合计持股 ÷ 季末市值。",
    read: "最高 20% 的股票在价格风险与拥挤度之外，之后半年大跌的概率约为 1.13 倍，未达 1.5 倍标准（M99）。", use: "了解是否被短线资金集中持有；只作描述。", value: ["低", "检验未通过，只作描述"] },
  inst_dsto: { name: "短线资金持股季度变化", fmt: "pp", better: "", def: "短线资金持股比例较上一季度的变化（个百分点）。", read: "正值 = 短线资金在流入。", use: "只作描述。", value: ["低", "检验未通过，只作描述"] },
  inst_dholders: { name: "机构家数季度变化", fmt: "pp", better: "high", def: "持有它的 13F 机构家数较上一季度的变化（Chen, Hong & Stein 2002 的持股广度）。", read: "家数增加 = 关注的机构变多。",
    use: "只作描述；大盘股中对之后涨跌没有预测力。", value: ["低", "检验未通过，只作描述"] },
  buyback_pct: { name: "回购程度分位", fmt: "num0", better: "high", def: "近 1 年股本变化在同板块大盘股中的位置（100 = 回购最多，0 = 增发最多；SEC 季报股本）。",
    read: "检验：股本减少多的之后 6–12 个月相对表现更好（大盘股中 26 / 52 周均通过事先标准）。", use: "与个股页“股本变化”卡片一起看。", value: ["中", "已验证（6–12 个月）"] },
  q_gpa: { name: "毛利 ÷ 总资产（同板块分位）", fmt: "num0", better: "high", def: "近一个财年毛利 ÷ 总资产在同板块大盘股中的分位（Novy-Marx 2013）。", read: "大盘股中 12 个月 t 2.1 刚过事先标准，但 ≥ $2B 中不成立、分组不单调。",
    use: "了解盈利能力；只作描述。", value: ["低–中", "刚过线但不稳定，只作描述"] },
  q_opa: { name: "营业利润 ÷ 总资产（同板块分位）", fmt: "num0", better: "high", def: "近 4 季营业利润 ÷ 总资产在同板块大盘股中的分位。", read: "检验未通过。", use: "只作描述。", value: ["低", "检验未通过，只作描述"] },
  q_mstd: { name: "利润率波动（同板块分位）", fmt: "num0", better: "low", def: "近 12 季营业利润率的标准差在同板块大盘股中的分位（越低越稳定；与个股页“质量画像”同一口径）。",
    read: "低波动的之后略好：大盘股中 12 个月 t 3.3 过事先标准，但 ≥ $2B 与科技股中不成立。", use: "了解经营稳定性；只作描述。", value: ["低–中", "刚过线但不稳定，只作描述"] },
  q_accr: { name: "应计（同板块分位）", fmt: "num0", better: "low", def: "（净利润 − 经营现金流）÷ 总资产在同板块中的分位（越高说明利润中没变成现金的部分越多；Sloan 1996）。", read: "检验无效。", use: "只作描述。", value: ["低", "检验未通过，只作描述"] },
  q_lev: { name: "负债率（同板块分位）", fmt: "num0", better: "low", def: "总负债 ÷ 总资产在同板块中的分位。", read: "方向与预期相反（负债高的之后反而更好，可能与回购推高负债率有关）。", use: "只作描述。", value: ["低", "检验方向相反，只作描述"] },
});
// ---- 个股页新增卡片的读数（M102 全市场估值比较、M103 重资产程度、M104 风险面板；compare_metrics.json，与个股页同一份数据）----
const XS_VALUE = ["中（预示利润率）", "回测：隐含与实际利润率之差预示之后 12 个月利润率变化（秩相关 +0.17，t 8.1）；对股价涨跌本身没有预测力"];
const XS_DEV_VALUE = ["低", "对之后 13–52 周涨跌没有预测力（IC ≈ 0）；最贵 20% 之后大跌的发生率是其他股票的 1.27 倍，未达 1.5 倍标准"];
const AI_VALUE = ["低", "描述性画像，未检验预测力；帮助理解商业模式（多少钱压在厂房设备上）"];
const RP_VALUE = ["低", "描述性：近 1 年波动来自哪一层；未检验对涨跌的预测力"];
Object.assign(CMP_EXTRA_DEFS, {
  rp_dd30: { name: "半年内跌超 30% 频率", fmt: "pct0", better: "low", def: "按价格风险分位所在的十分组，同组大盘股 2022 年以来半年内最大跌幅超过 30% 的实际频率（与个股页“风险面板”同一口径）。",
    read: "是同组股票的历史频率，不是对这只股票的单独预测；十组从低到高严格递增（已验证），水平随市场环境变化。", use: "把价格风险分位翻译成直观的“大跌有多常见”，用来决定仓位大小。", value: ["高（风险）", "排序已验证（十组严格递增）；水平随环境变化"] },
  earn_move: { name: "财报日波动（中位数）", fmt: "pct", better: "low", def: "近 8 次财报后一个交易日相对大盘的绝对涨跌幅中位数。",
    read: "财报波动有持续性：过去波动大的，下次通常也大。", use: "估计下次财报可能带来的单日波动，财报前决定是否减仓。", value: ["中", "已验证：过去的财报波动对下次财报波动的秩相关 0.32"] },
  rp_mkt: { name: "大盘层占比", fmt: "pct0", better: null, def: "近 1 年总波动（方差）中由大盘涨跌带来的比例（四层合计 100%）。", read: "高 = 主要跟着大盘走。", use: "了解这只股票的风险从哪里来。", value: RP_VALUE },
  rp_ai: { name: "AI 主题层占比", fmt: "pct0", better: null, def: "近 1 年总波动中由 AI 股相对大盘的强弱带来的比例。", read: "高 = AI 板块一起涨跌是主要驱动（持有多只这类股票时风险会叠加）。", use: "判断与 AI 主题的绑定程度。", value: RP_VALUE },
  rp_ind: { name: "行业层占比", fmt: "pct0", better: null, def: "近 1 年总波动中由所在行业（同行等权）相对大盘与 AI 主题的强弱带来的比例。", read: "高 = 行业景气是主要驱动。", use: "了解行业因素的影响。", value: RP_VALUE },
  rp_idio: { name: "个股层占比", fmt: "pct0", better: null, def: "近 1 年总波动中公司自身因素（扣除大盘、AI 主题、行业后剩下的部分）的比例。", read: "高 = 走势主要由公司自己的消息决定，分散作用更好，但也更难预判。", use: "高时更要关注公司自身事件（财报、产品、管理层）。", value: RP_VALUE },
  rp_earn: { name: "个股层中财报日占比", fmt: "pct0", better: null, def: "个股层波动中发生在财报后一个交易日的比例。", read: "高 = 公司自身的风险集中在财报日。", use: "高时财报前后的仓位管理最重要。", value: RP_VALUE },
  rp_beta_mkt: { name: "大盘 β（四层模型）", fmt: "num2", better: null, def: "四层拆分回归中对大盘的 β（近 1 年周收益）。", read: "与“Beta”列口径不同（这里同时控制了 AI 主题与行业）。", use: "了解剔除主题与行业后对大盘的敏感度。", value: RP_VALUE },
  rp_beta_ai: { name: "AI 主题 β", fmt: "num2", better: null, def: "对 AI 股相对大盘强弱的 β（近 1 年周收益）。", read: "> 0 = 随 AI 股相对强弱同向；< 0 = 反向。", use: "判断 AI 板块回调时它会怎样。", value: RP_VALUE },
  xs_implied_om: { name: "现价隐含营业利润率", fmt: "impom", better: null, def: "按全市场 ≥ $2B 公司的横截面回归（增速、毛利率、营业利润率、FCF 利润率、行业），营业利润率取多少时“应有 P/S”恰好等于现价（与个股页“全市场估值比较”同一口径）。",
    read: "低于实际 = 市场预期利润率回落（周期高点常见）；高于实际 = 价格已含利润率提升的预期；“> 50%”= 贵在利润率以外的因素；“< 0%”= 按亏损或谷底盈利定价。", use: "和之后几个季度的实际利润率对照。", value: XS_VALUE },
  xs_om: { name: "实际营业利润率（近 4 季）", fmt: "pct0", better: null, def: "SEC 季报近 4 季营业利润 ÷ 收入（没有营业利润科目时用净利润率）。", read: "和隐含值对照。", use: "—", value: XS_VALUE },
  xs_gap: { name: "隐含 − 实际", fmt: "pp", better: null, def: "现价隐含营业利润率减实际营业利润率（百分点）；超出可解范围时为空。", read: "正 = 市场预期利润率还会提高；负 = 预期回落。", use: "按此排序找“市场预期利润率大幅回落”的股票（多为周期高点）。", value: XS_VALUE },
  xs_fair_ps: { name: "应有 P/S", fmt: "x", better: null, def: "基本面相似公司（全市场回归）通常给的 P/S；本股不参与估计自己的值。", read: "与“市销率 P/S”列对照。", use: "—", value: XS_DEV_VALUE },
  xs_dev: { name: "相对相似公司的 P/S", fmt: "pp", better: "low", def: "实际 P/S 比应有 P/S 高（正）或低（负）多少。", read: "模型只解释全市场 P/S 差异的约 70%，±80% 以内都很常见，不代表错误定价。", use: "偏离极端时先找原因。", value: XS_DEV_VALUE },
  xs_dev_pct: { name: "偏离的全市场分位", fmt: "num0", better: "low", def: "偏离在全市场 ≥ $2B 公司中的分位（100 = 最贵）。", read: "同上。", use: "—", value: XS_DEV_VALUE },
  ai_score: { name: "重资产得分", fmt: "num0", better: null, def: "资本开支 / 收入（近 3 年）、折旧 / 收入、（固定资产 + 经营租赁资产）/ 收入、固定资产 / 总资产四项在全市场 ≥ $2B 公司中的分位平均（0–100，越高越重；与个股页“重资产程度”同一口径）。",
    read: "≥ 80 重资产（公用事业、能源、云厂商），< 20 轻资产（软件、芯片设计）。重资产本身不是好坏，要和 ROIC 一起看。", use: "了解商业模式：增长要不要先花大钱、周期性强不强。", value: AI_VALUE },
  ai_capex_rev: { name: "资本开支 / 收入（近 3 年）", fmt: "pct", better: null, def: "近 3 年资本开支合计 ÷ 同期收入合计（流量：每年投多少）。", read: "与“资本密集度”（近 4 季）口径相近，3 年平均更稳。", use: "—", value: AI_VALUE },
  ai_dep_rev: { name: "折旧 / 收入", fmt: "pct", better: null, def: "近 4 季折旧（不含并购无形资产摊销）÷ 收入。", read: "过去投下的固定资产每年消耗多少。", use: "—", value: AI_VALUE },
  ai_fixed_rev: { name: "固定资产 / 收入", fmt: "num2", better: null, def: "（固定资产 + 经营租赁资产）÷ 近 4 季收入：每 $1 收入占用多少实物资产（存量）。", read: "含租来的门店 / 机房。", use: "—", value: AI_VALUE },
  ai_ppe_assets: { name: "固定资产 / 总资产", fmt: "pct0", better: null, def: "固定资产净值 ÷ 总资产。", read: "资产里有多少是厂房、设备、数据中心。", use: "—", value: AI_VALUE },
  ai_flow_gap: { name: "投入 − 存量（分位差）", fmt: "num0", better: null, def: "资本开支 / 收入的全市场分位减去两项存量指标的平均分位。",
    read: "≥ +20 = 投入远高于存量（正在变重或资本开支含非实物）；≤ −20 = 存量高于投入（收获期，或收入规模大）。全市场标准差约 18。", use: "结合“资本开支 / 折旧”判断是不是在扩张。", value: AI_VALUE },
  ai_capex_dep: { name: "资本开支 / 折旧", fmt: "x", better: null, def: "近 4 季资本开支 ÷ 折旧。", read: "> 1.5 扩张；≈ 1 维持；< 1 收缩或投资不足。扩张期之后几年折旧会上升、压低利润率。", use: "—", value: AI_VALUE },
  ai_asset_turn: { name: "资产周转率", fmt: "num2", better: null, def: "近 4 季收入 ÷ 总资产。", read: "越低越重；看趋势判断新资产有没有带来收入。", use: "—", value: AI_VALUE },
  ai_rnd_rev: { name: "研发 / 收入", fmt: "pct", better: null, def: "近 4 季研发费用 ÷ 收入。", read: "轻资产公司的投入常在研发（费用化，不进固定资产）。", use: "和资本开支一起看总投入。", value: AI_VALUE },
  ai_inv_days: { name: "存货周转天数", fmt: "days", better: null, def: "最新存货 ÷ 近 4 季销售成本 × 365。", read: "硬件 / 制造业的库存周期风险；上升过快常是需求放缓的早期迹象。", use: "—", value: AI_VALUE },
});
// 分组：先按描述角度分大类，组内列按逻辑顺序（概览 → 细项）；大类与组的顺序即按钮顺序（2026-10-22 重排）
const CMP_CATS = [["risk", "价格与风险"], ["value", "估值"], ["fund", "基本面"], ["flow", "资金与预期"]];
const CMP_GROUPS = [
  ["score", "短期综合得分", ["score_1w", "score_4w", "score_4w_mom", "score_4w_rev", "score_4w_lit"], "risk"],
  ["price", "价格位置与涨跌", ["price", "ret_1m", "ret_ytd", "ret_1y", "pos_52w", "from_high", "vs_ma200"], "risk"],
  ["risk", "风险水平", ["risk_pct", "rp_dd30", "vol_1y", "risk_vol3m", "max_dd_1y", "beta", "risk_dbeta", "earn_move", "next_earnings"], "risk"],
  ["risksrc", "风险来源（四层拆分）", ["rp_mkt", "rp_ai", "rp_ind", "rp_idio", "rp_earn", "rp_beta_mkt", "rp_beta_ai"], "risk"],
  ["valuation", "估值倍数", ["market_cap", "pe_ttm", "pe_fwd", "peg", "ps", "ev_ebitda", "pb", "fcf_yield", "dividend_yield"], "value"],
  ["xsval", "全市场估值比较", ["xs_implied_om", "xs_om", "xs_gap", "ps", "xs_fair_ps", "xs_dev", "xs_dev_pct"], "value"],
  ["fcf_phase", "FCF 收益率上升期", ["fcf_stage_code", "fcf_kind_code", "fcf_z", "fcf_y_chg", "fcf_ps_chg", "fcf_px_chg", "fcf_y_pct"], "value"],
  ["growth", "增长与盈利", ["revenue_growth", "earnings_growth", "eps_fwd_growth", "gross_margin", "op_margin", "net_margin", "roic", "roe", "roa"], "fund"],
  ["quality", "质量画像（同板块）", ["q_gpa", "q_opa", "q_mstd", "q_accr", "q_lev"], "fund"],
  ["asset", "重资产与资本投入", ["ai_score", "ai_capex_rev", "capex_intensity", "ai_dep_rev", "ai_fixed_rev", "ai_ppe_assets", "ai_flow_gap", "ai_capex_dep", "ai_asset_turn"], "fund"],
  ["ops", "经营特征与资本配置", ["op_leverage", "cash_conversion", "ai_rnd_rev", "ai_inv_days", "share_change", "buyback_pct"], "fund"],
  ["health", "财务健康", ["net_cash_pct", "debt_to_equity", "current_ratio", "payout"], "fund"],
  ["expect", "分析师与市场预期", ["rec_mean", "analysts", "median_target", "median_upside", "weighted_target", "weighted_upside", "moves_up", "moves_down"], "flow"],
  ["holders", "持仓结构与拥挤度", ["crowd_pct", "crowd_ivol", "crowd_turn", "short_pct_float", "short_change", "days_to_cover", "inst_io", "inst_sto", "inst_dsto", "inst_dholders", "insiders_pct", "institutions_pct"], "flow"],
];
/* 本页表格共用的表头排序：s = { sort, dir }（dir 1 = 从低到高 / A→Z，−1 = 从高到低）；只有当前排序列显示 ▲ / ▼；
   点新列按 firstDir(key) 定方向，再点同一列反向。“ticker”列按代码字母排序；缺数据的行始终排在最后。 */
function cmpSortTh(s, key, label, { tip = "", num = true } = {}) {
  const on = s.sort === key;
  return `<th class="${num ? "num " : ""}sortable ${on ? "on" : ""}" data-k="${esc(key)}"${tip ? ` title="${esc(tip)}"` : ""}>${label}${on ? (s.dir > 0 ? " ▲" : " ▼") : ""}</th>`;
}
function cmpSortCmp(x, y, dir) {
  const has = (v) => (typeof v === "string" ? v !== "" : isNum(v));
  if (!has(x) && !has(y)) return 0;
  if (!has(x)) return 1;
  if (!has(y)) return -1;
  return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
}
function cmpSortBind(host, s, firstDir, redraw) {
  host.querySelectorAll("th.sortable").forEach((h) => (h.onclick = () => {
    const k = h.dataset.k;
    if (s.sort === k) s.dir *= -1; else { s.sort = k; s.dir = firstDir(k); }
    redraw();
  }));
}
const CMP_ALL = { group: null, sort: null, dir: 1, theme: "", tag: "" };
// 同组里有相近指标时，本页改用更明确的列名（说明文字不变）
const CMP_NAME = { institutions_pct: "机构持股（Yahoo）", capex_intensity: "资本开支 / 收入（近 4 季）" };
function cmpDef(k) {
  const d = CMP_EXTRA_DEFS[k] || METRIC_DEFS[k] || { name: k, fmt: "num2" };
  return CMP_NAME[k] ? { ...d, name: CMP_NAME[k] } : d;
}
/* 2026-10-22 起按描述角度固定顺序（CMP_GROUPS），不再按参考价值自动排序；参考价值评级仍显示在每组的说明表里 */
let CMP_SORTED = null;
function cmpGroups() {
  if (CMP_SORTED) return CMP_SORTED;
  CMP_SORTED = CMP_GROUPS.map(([g, n, ks, cat]) => [g, n, ks, cat]);
  if (!CMP_ALL.group) { CMP_ALL.group = CMP_SORTED[0][0]; CMP_ALL.sort = CMP_SORTED[0][2][0]; CMP_ALL.dir = cmpDef(CMP_ALL.sort).better === "high" ? -1 : 1; }
  return CMP_SORTED;
}
function cmpFmt(v, f) {
  if (f === "cap") return isNum(v) ? (v >= 1e12 ? `${(v / 1e12).toFixed(2)}T` : `${(v / 1e9).toFixed(0)}B`) : "–";
  if (f === "int") return isNum(v) ? String(v) : "–";
  if (f === "date") return v ? esc(v.slice(5)) : "–";
  if (f === "fcfstage") return isNum(v) ? FCF_STAGE_ZH[v] : "–";
  if (f === "fcfkind") return isNum(v) ? FCF_KIND_ZH[v] : "–";
  if (f === "pct2s") return isNum(v) ? pct(v, 2, true) : "–";
  if (f === "impom") return !isNum(v) ? "–" : v <= -1 ? "< 0%" : v >= 9 ? "> 50%" : pct(v, 0); // −1 / 9 = 超出可解范围（build.py 编码）
  if (f === "days") return isNum(v) ? `${num(v, 0)} 天` : "–";
  return fmtMetric(v, f);
}
// 汇总表的“FCF 收益率上升期”一栏（compare_metrics.json；与个股页卡片同一份数据）
function fcfPhaseText(r) {
  if (!r || !isNum(r.fcf_stage_code)) return `<span class="muted" title="缺少 FCF 收益率历史（ETF、银行保险不适用；外国公司只有年报）">–</span>`;
  const st = r.fcf_stage_code, kind = isNum(r.fcf_kind_code) ? FCF_KIND_ZH[r.fcf_kind_code] : "";
  const tip = `上升强度 ${isNum(r.fcf_z) ? num(r.fcf_z, 2) : "–"}（≥ 0.5 算上升期）；收益率近 13 周 ${isNum(r.fcf_y_chg) ? pct(r.fcf_y_chg, 1, true) : "–"}；自身近 5 年分位 ${isNum(r.fcf_y_pct) ? pct(r.fcf_y_pct, 0) : "–"}`;
  const body = st === 0 ? "否" : st === 4 ? `否 · 见顶回落${kind ? ` <span class="muted">（此前 ${esc(kind)}）</span>` : ""}`
    : `<b>是</b> · ${FCF_STAGE_ZH[st]}${kind ? ` <span class="muted">（${esc(kind)}）</span>` : ""}`;
  return `<span title="${esc(tip)}">${body}</span>`;
}
async function cmpFillFcf() {
  const cells = document.querySelectorAll(".cmp-fcf");
  if (!cells.length) return;
  const data = await load("compare_metrics.json").catch(() => null);
  const by = Object.fromEntries((data?.rows || []).map((r) => [r.ticker, r]));
  cells.forEach((c) => (c.innerHTML = fcfPhaseText(by[c.dataset.t])));
}
async function cmpAllTable(sel) {
  const host = byId("cmp-all-body");
  if (!host) return;
  const data = await load("compare_metrics.json").catch(() => null);
  if (!data) { host.innerHTML = empty("暂无数据"); return; }
  const se = await load("short_evidence.json").catch(() => null); // M88：并入短期综合得分
  const rk = await load("risk_scores.json").catch(() => null); // M91：价格风险分位（M92 / M98 拥挤度在同一文件）
  const [qp, iss, inst] = await Promise.all(["quality_profile.json", "issuance.json", "inst13f.json"].map((f) => load(f).catch(() => null)));
  for (const r of data.rows) {
    const sc = se?.scores?.[r.ticker] || {};
    const w4 = sc["4"], w1 = sc["1"];
    const rs = rk?.stocks?.[r.ticker] || {}, cw = rs.crowd || {};
    const q = qp?.stocks?.[r.ticker]?.items || {}, ins = inst?.stocks?.[r.ticker] || {};
    Object.assign(r, { score_4w: w4?.total, score_1w: w1?.total, score_4w_mom: w4?.momentum, score_4w_rev: w4?.reversal,
      score_4w_lit: w4 ? w4.total - w4.price : null, risk_pct: rs.score_pct, risk_vol3m: rs.raw?.vol3m, risk_dbeta: rs.raw?.dbeta,
      crowd_pct: isNum(cw.scorew_pct) ? cw.scorew_pct : cw.score_pct, crowd_ivol: cw.raw?.ivol,
      crowd_turn: isNum(cw.raw?.turn) ? Math.exp(cw.raw.turn) : null,
      inst_io: ins.io, inst_sto: ins.sto, inst_dsto: ins.d_sto, inst_dholders: isNum(ins.d_holders) ? Math.exp(ins.d_holders) - 1 : null,
      buyback_pct: iss?.stocks?.[r.ticker]?.buyback_pct,
      q_gpa: q.gpa?.pct, q_opa: q.opa?.pct, q_mstd: q.mstd?.pct, q_accr: q.accr?.pct, q_lev: q.lev?.pct, // 质量各项分位为原始方向（与个股页一致）
      rp_dd30: isNum(rs.score_pct) ? (rk?.calibration?.recent || []).find((x) => x.bin === Math.min(10, Math.max(1, Math.ceil(rs.score_pct / 10))))?.dd30 : null }); // M104 风险面板同口径
  }
  const draw = () => {
    const keys = cmpGroups().find(([g]) => g === CMP_ALL.group)[2];
    const rows = data.rows.filter((r) => (!CMP_ALL.theme || r.theme === CMP_ALL.theme) && (!CMP_ALL.tag || tagsOf(r.ticker).includes(CMP_ALL.tag)));
    const k = CMP_ALL.sort;
    const val = (r) => (k === "ticker" ? r.ticker : k === "next_earnings" ? (r[k] ? Date.parse(r[k]) : null) : r[k]);
    rows.sort((a, b) => {
      const sa = sel.includes(a.ticker), sb = sel.includes(b.ticker);
      if (sa !== sb) return sa ? -1 : 1; // 已选的排在最前
      return cmpSortCmp(val(a), val(b), CMP_ALL.dir);
    });
    const med = (key) => { const xs = rows.map((r) => r[key]).filter(isNum).sort((a, b) => a - b); return xs.length ? xs[Math.floor((xs.length - 1) / 2)] : null; };
    const th = (key) => { const d = cmpDef(key); return cmpSortTh(CMP_ALL, key, esc(d.name), { tip: `${d.name}：${d.def || ""}${d.read ? ` 如何理解：${d.read}` : ""}` }); };
    const btn = ([g, n]) => `<button type="button" data-g="${g}" class="${g === CMP_ALL.group ? "on" : ""}">${n}</button>`;
    host.innerHTML = `<div class="cmp-cats">${CMP_CATS.map(([c, cn]) => `<div class="row"><span class="muted cmp-cat">${cn}</span><div class="seg">${cmpGroups().filter((x) => x[3] === c).map(btn).join("")}</div></div>`).join("")}</div>
      <div class="row">
      <select id="ca-theme"><option value="">全部主题</option>${META.themes.map((t) => `<option value="${t.key}" ${t.key === CMP_ALL.theme ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
      <select id="ca-tag"><option value="">全部业务</option>${usedTags().map((k) => `<option value="${k}" ${k === CMP_ALL.tag ? "selected" : ""}>${esc(META.tags[k].short)} ${esc(META.tags[k].name)}</option>`).join("")}</select>
      <span class="muted">点表头排序；悬停表头看指标说明；已选股票（${sel.length}）高亮并排在最前</span></div>
      <div class="table-wrap"><table class="cmp-all"><thead><tr>${cmpSortTh(CMP_ALL, "ticker", "股票", { tip: "按股票代码字母排序", num: false })}${keys.map(th).join("")}</tr></thead><tbody>
      ${rows.map((r) => `<tr class="${sel.includes(r.ticker) ? "sel" : ""}"><td class="nowrap"><a href="#/stock/${esc(r.ticker)}"><b>${esc(r.ticker)}</b></a>${r.cyc_tier === "strong" ? ' <span class="chip warnchip" title="强周期：P/E 高低主要反映处于周期的哪个阶段">强周期</span>' : r.cyc_tier === "medium" ? ' <span class="chip" title="中等周期性">中周期</span>' : ""}${r.fin_currency && r.fin_currency !== "USD" ? `<sup title="财报以 ${esc(r.fin_currency)} 计">†</sup>` : ""} <span class="muted">${esc(META.names_zh?.[r.ticker] || "")}</span></td>
        ${keys.map((key) => { const d = cmpDef(key); return `<td class="num ${d.fmt === "pp" || d.fmt === "pct2s" ? cls(r[key]) : ""}">${cmpFmt(r[key], d.fmt)}</td>`; }).join("")}</tr>`).join("")}
      <tr class="total"><td><b>中位数</b></td>${keys.map((key) => `<td class="num">${key === "next_earnings" ? "" : cmpFmt(med(key), cmpDef(key).fmt)}</td>`).join("")}</tr></tbody></table></div>
      <details class="howto" open><summary>本组指标的含义、用法与参考价值</summary>${metricDocTable(keys, cmpDef)}<p class="muted">${esc(METRIC_VALUE_NOTE)}</p></details>
      <p class="muted">公司数据来自 yfinance（${esc(data.asof)}），价格类按最新收盘计算；“–”表示该公司不适用或暂无数据（如银行没有毛利率、EV/EBITDA）。ETF 与黄金没有这些公司指标，不列入。† = 财报以外币计（如台积电 TWD、ASML EUR）：总额类比率已按汇率换算，P/B 与 EV/EBITDA 不显示，P/E 可能有约一成的汇率口径偏差。每个指标的含义与用法见个股页“关键指标”。</p>`;
    host.querySelectorAll(".cmp-cats button").forEach((b) => (b.onclick = () => { CMP_ALL.group = b.dataset.g; const ks = cmpGroups().find(([g]) => g === CMP_ALL.group)[2]; if (CMP_ALL.sort !== "ticker" && !ks.includes(CMP_ALL.sort)) { CMP_ALL.sort = ks[1] || ks[0]; CMP_ALL.dir = 1; } draw(); }));
    byId("ca-theme").onchange = (e) => { CMP_ALL.theme = e.target.value; draw(); };
    byId("ca-tag").onchange = (e) => { CMP_ALL.tag = e.target.value; draw(); };
    cmpSortBind(host, CMP_ALL, (key) => (key === "ticker" ? 1 : cmpDef(key).better === "high" ? -1 : 1), draw);
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
    <section class="card"><h3>走势对比（${st.m === "raw" ? "起点 = 100" : `${st.m === "rel" ? "相对" : "剔除 β 后，相对"}${st.b === "theme" ? "各自主题基准" : " SPY"}，区间累计`}）${valueChip("低–中")}${badge("fact")}${badge("derived")}</h3>
      <div class="row"><span class="muted">时间</span><div class="seg" id="cmp-tz">${CMP_TZ.map(([k, , n]) => `<button type="button" data-v="${k}">${n}</button>`).join("")}</div><span class="muted" id="cmp-tz-range"></span></div>
      ${chartDiv("c-cmp", "tall")}<p class="muted">拖动图下方的时间轴（或在图上滚轮缩放）调节区间，各线从区间起点重新归一；上方“区间”同时决定汇总表与本图的初始区间。</p>
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
      <thead><tr><th>标的</th><th class="num">区间收益</th><th class="num">年化波动</th><th class="num">最大回撤</th><th class="num">Beta（vs SPY）</th><th class="num">与 SPY 相关</th><th class="num">相对基准</th><th class="num">剔除 β 后</th><th title="FCF 收益率是否处于上升期、在哪个阶段（只和自身历史比；详见个股页“FCF 收益率上升期”卡片）。括号内为上升来源：A 基本面领先 / B 价格驱动 / C 双降">FCF 收益率上升期</th>${myW ? `<th class="num">占你账户</th>` : ""}</tr></thead>
      <tbody>${sel.map((t) => { const s = stats[t]; return `<tr><td><span class="dot" style="background:${color[t]}"></span><a href="#/stock/${t}"><b>${esc(t)}</b></a> <span class="muted">${esc(META.names_zh?.[t] || (META.etfs || []).find((e) => e.ticker === t)?.name_zh || "")}</span></td>
        ${s ? `<td class="num ${cls(s.ret)}">${pct(s.ret, 1, true)}</td><td class="num">${pct(s.vol, 0)}</td><td class="num neg">${pct(s.mdd, 1)}</td><td class="num">${num(s.beta, 2)}</td><td class="num">${num(s.corr, 2)}</td>
          <td class="num ${cls(relS[t].rel)}" title="相对 ${esc(relS[t].bench)}">${pct(relS[t].rel, 1, true)}${relS[t].bench !== "SPY" ? ` <span class="muted">vs ${esc(relS[t].bench)}</span>` : ""}</td><td class="num ${cls(relS[t].resid)}">${pct(relS[t].resid, 1, true)}</td>` : `<td colspan="7" class="muted">区间内无数据</td>`}
        <td class="nowrap cmp-fcf" data-t="${esc(t)}"><span class="muted">…</span></td>
        ${myW ? `<td class="num">${myW[t] ? pct(myW[t], 1) : "–"}</td>` : ""}</tr>`; }).join("")}</tbody></table></div></section>` };
}

// ---------------- 剔除 β 后相对大盘：多个时间窗（近 1 周 – 1 年）----------------
const CMP_RW = [[5, "1 周"], [10, "2 周"], [15, "3 周"], [21, "1 个月"], [42, "2 个月"], [63, "3 个月"], [126, "6 个月"], [189, "9 个月"], [252, "1 年"]];
const CMP_RW_SORT = { sort: null, dir: -1 }; // 排序列（"ticker" / "beta" / 交易日数字符串；null = 按选择顺序），切换表格时保留
// β 估计窗口：[交易日数, 最少有效日数, 名称]；1 年与个股页“相对大盘走势”一致
const CMP_RW_BETA = [[252, 120, "近 1 年"], [126, 60, "近半年"], [21, 15, "近 1 个月"]];
let CMP_RW_BW = 252; // 当前显示哪张表（β 估计窗口）
let CMP_EARN = null; // earn_days.json：各股近 2 年财报反应日
const CMP_RW_SIG = [1, 2]; // 相对正常波动的倍数：< 1 视为噪声（灰），≥ 2 视为明显（加粗）
let CMP_RW_EXE = false; // 勾选“剔除财报”：表中直接显示不计财报反应日的值
/* 一格的统计：v = 显示的累计（exclude 时不计窗口内财报反应日）、raw = 含财报的累计、exE = 不计财报的累计；
   z = v ÷ 正常波动（窗口开始前一年剔除 β 后日波动 × √天数；exclude 时日波动与天数都不计财报反应日） */
function cmpRwCell(resid, end, n, earnIdx, exclude) {
  const raw = RelStr.trailing(resid, end, n);
  if (!isNum(raw)) return { v: raw };
  const a = end - n + 1, ev = earnIdx.filter((i) => i >= a && i <= end);
  let exE = null;
  if (ev.length) { let lvl = 1; for (let i = a; i <= end; i++) if (isNum(resid[i]) && !ev.includes(i)) lvl *= 1 + resid[i]; exE = lvl - 1; }
  const ex = exclude && ev.length;
  const past = [];
  for (let i = Math.max(1, a - 252); i < a; i++) if (isNum(resid[i]) && !(exclude && earnIdx.includes(i))) past.push(resid[i]);
  let sd = null;
  if (past.length >= 60) { const m = past.reduce((x, y) => x + y, 0) / past.length; sd = Math.sqrt(past.reduce((x, y) => x + (y - m) ** 2, 0) / (past.length - 1)); }
  const v = ex ? exE : raw, band = sd ? sd * Math.sqrt(n - (ex ? ev.length : 0)) : null;
  return { v, raw, exE, z: band ? v / band : null, band, ev: ev.map((i) => ({ i, r: resid[i] })) };
}
function cmpResidWin(st, raw, sel, color) {
  const end = raw.dates.length - 1;
  const bench = Object.fromEntries(sel.map((t) => [t, cmpBench(t, st.b, raw)]));
  const skip = sel.filter((t) => bench[t] === t);
  const mean = (xs) => (xs = xs.filter(isNum)).length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const cell = (v) => `<td class="num ${cls(v)}">${isNum(v) ? pct(v, 1, true) : "–"}</td>`;
  const di = Object.fromEntries(raw.dates.map((x, i) => [x, i]));
  const earn = Object.fromEntries(sel.map((t) => [t, (CMP_EARN?.days?.[t] || []).filter((e) => di[e.d] != null).map((e) => ({ ...e, i: di[e.d] }))]));
  const sigCell = (t, c) => {
    if (!isNum(c.v)) return `<td class="num">–</td>`;
    const z = c.z, a = isNum(z) ? Math.abs(z) : null;
    const tone = a == null ? cls(c.v) : a < CMP_RW_SIG[0] ? "rw-weak" : `${cls(c.v)}${a >= CMP_RW_SIG[1] ? " rw-strong" : ""}`;
    const evs = c.ev.map((e) => { const x = earn[t].find((y) => y.i === e.i); return `${x.a} ${x.timing}公布（反应日 ${x.d}）：当天剔除 β 后 ${pct(e.r, 1, true)}`; });
    const tip = [isNum(z) ? `约 ${num(z, 1)} 倍正常波动（正常范围约 ±${pct(c.band, 1)}，按此前一年自身每日波动估计）${a < CMP_RW_SIG[0] ? "：在正常波动之内，基本是噪声" : a >= CMP_RW_SIG[1] ? "：明显超出正常波动" : ""}` : "此前历史太短，无法判断是否超出正常波动",
      ...(evs.length ? ["窗口内有财报：", ...evs, `含财报：${pct(c.raw, 1, true)}；不计财报反应日：${pct(c.exE, 1, true)}${CMP_RW_EXE ? "（表中显示的是不计财报的值）" : ""}`] : [])].join("\n");
    return `<td class="num ${tone}" title="${esc(tip)}">${pct(c.v, 1, true)}${evs.length ? `<sup class="rw-earn">财</sup>` : ""}</td>`;
  };
  const table = ([win, minObs, nm]) => {
    const ok = sel.filter((t) => bench[t] !== t).map((t) => {
      const d = RelStr.daily(raw.close[t], raw.close[bench[t]], { win, minObs });
      const c = Object.fromEntries(CMP_RW.map(([n]) => [n, cmpRwCell(d.resid, end, n, earn[t].map((e) => e.i), CMP_RW_EXE)]));
      return { t, bt: bench[t], beta: d.beta[end], c, v: Object.fromEntries(CMP_RW.map(([n]) => [n, c[n].v])) };
    });
    const k = CMP_RW_SORT.sort, val = (r) => (k === "ticker" ? r.t : k === "beta" ? r.beta : r.v[k]);
    if (k) ok.sort((a, b) => cmpSortCmp(val(a), val(b), CMP_RW_SORT.dir));
    const th = (key, label, tip) => cmpSortTh(CMP_RW_SORT, key, label, { tip, num: key !== "ticker" });
    return `<div class="table-wrap"><table><thead><tr>${th("ticker", "标的", "按股票代码字母排序")}${th("beta", "β", `当前 β（${nm}日收益估计）`)}${CMP_RW.map(([n, nm2]) => th(String(n), `近 ${nm2}`, `最近 ${n} 个交易日`)).join("")}</tr></thead><tbody>
      ${ok.map((r) => `<tr><td class="nowrap"><span class="dot" style="background:${color[r.t]}"></span><a href="#/stock/${esc(r.t)}"><b>${esc(r.t)}</b></a>${r.bt !== "SPY" ? ` <span class="muted">vs ${esc(r.bt)}</span>` : ""}</td><td class="num">${isNum(r.beta) ? num(r.beta, 2) : "–"}</td>${CMP_RW.map(([n]) => sigCell(r.t, r.c[n])).join("")}</tr>`).join("")}
      ${ok.length >= 2 ? `<tr class="total"><td><b>平均</b> <span class="muted">（${ok.length} 只等权）</span></td><td class="num">${num(mean(ok.map((r) => r.beta)), 2)}</td>${CMP_RW.map(([n]) => cell(mean(ok.map((r) => r.v[n])))).join("")}</tr>` : ""}
    </tbody></table></div>`;
  };
  return `<h3>剔除 β 后相对大盘：近 1 周 – 1 年（${st.b === "theme" ? "相对各自主题基准" : "相对 SPY"}）${valueChip("中")}${badge("derived")}</h3>
    <div class="row"><span class="muted">基准</span><div class="seg" id="cmp-rb">${[["spy", "SPY"], ["theme", "各自主题基准"]].map(([k, n]) => `<button type="button" data-v="${k}" class="${st.b === k ? "on" : ""}">${n}</button>`).join("")}</div>
      <span class="muted">β 估计用</span><div class="seg" id="cmp-rbw">${CMP_RW_BETA.map(([w, , nm]) => `<button type="button" data-v="${w}" class="${CMP_RW_BW === w ? "on" : ""}" title="滚动 ${w} 个交易日">${nm}</button>`).join("")}</div>
      <label title="勾选后，窗口内有财报的格子直接显示不计财报反应日的累计（排序、平均、倍数都按此计算）"><input type="checkbox" id="cmp-rexe" ${CMP_RW_EXE ? "checked" : ""}> 剔除财报日</label>
      <span class="muted">点表头排序</span></div>
    <p class="muted small">颜色深浅按“超出正常波动多少”：<b class="pos">加粗</b> = 超过 ${CMP_RW_SIG[1]} 倍正常波动（明显）；正常颜色 = ${CMP_RW_SIG[0]}–${CMP_RW_SIG[1]} 倍；<span class="rw-weak">灰色</span> = 不到 ${CMP_RW_SIG[0]} 倍（基本是噪声）。<sup class="rw-earn">财</sup> = 窗口内有财报${CMP_RW_EXE ? "（已剔除财报反应日，显示的是不计这些日子的值）" : ""}。鼠标悬停看倍数、财报当天涨跌和含 / 不含财报的值。</p>
    ${table(CMP_RW_BETA.find(([w]) => w === CMP_RW_BW))}
    <p class="muted">${rich("每格 = 最近 N 个交易日内，每天的涨跌减去 [[beta|β]] × 基准涨跌后按日复利累计：正数 = 去掉大盘 / 板块带动的部分后，公司自身因素让它跑赢。β 每天滚动重估，只用当天之前的日收益（不用未来数据）；上方按钮切换估计 β 用多长的历史：1 年最稳定，半年更贴近近期，1 个月反应最快但噪声大（只有约 21 个数据点，一两天的大涨大跌就会明显改变 β）。正常波动 = 这只股票此前一年（窗口开始之前）剔除 β 后的每日波动 × √N，代表“没有特别事件时，N 天里随机波动的典型幅度”；倍数只说明是否异常；本系统检验（2,568 只美股，2012 年起）：近 1 周剔除 β 的倍数越高，之后 1–4 周相对表现倾向越弱（明显上涨倾向部分回吐、明显下跌倾向部分回补），13 周后不再有差别；近 3 个月剔除 β 累计对之后没有预测力。效果很小，只是倾向（见个股页“短期证据”）。财报反应日：盘后公布算下一个交易日；勾选“剔除财报日”时，累计跳过窗口内的财报反应日，正常波动也用不含财报日的日波动、按剩余天数计算。“平均”一行是所选股票的等权平均（不做倍数判断）。数据不足（上市时间短、缺失超过两成、β 估计不出）显示“–”。截至 ")}${esc(raw.dates[end])}。${skip.length ? `${skip.map(esc).join("、")} 本身就是基准，不列出。` : ""}</p>`;
}
function cmpResidWinBind(st, raw, sel, color, apply) {
  const host = byId("cmp-rw");
  if (!host) return;
  host.querySelectorAll("#cmp-rb button").forEach((b) => (b.onclick = () => apply({ b: b.dataset.v })));
  const redraw = () => { host.innerHTML = cmpResidWin(st, raw, sel, color); cmpResidWinBind(st, raw, sel, color, apply); };
  host.querySelectorAll("#cmp-rbw button").forEach((b) => (b.onclick = () => { CMP_RW_BW = +b.dataset.v; redraw(); }));
  byId("cmp-rexe")?.addEventListener("change", (e) => { CMP_RW_EXE = e.target.checked; redraw(); });
  cmpSortBind(host, CMP_RW_SORT, (key) => (key === "ticker" ? 1 : -1), redraw);
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

// 走势对比自带的区间按钮（时间轴可在此基础上拖动微调）
const CMP_TZ = [["6M", 126, "半年"], ["1Y", 252, "1 年"], ["3Y", 756, "3 年"], ["5Y", 1260, "5 年"], ["ALL", Infinity, "全部"]];

function cmpDraw(st, raw, sel, i0, end, color, apply) {
  const relMode = st.m !== "raw";
  const N = raw.dates.length;
  const daily = Object.fromEntries(sel.filter(() => relMode).map((t) => {
    const d = RelStr.daily(raw.close[t], raw.close[cmpBench(t, st.b, raw)]);
    return [t, st.m === "rel" ? d.rel : d.resid];
  }));
  // 区间 [a, b]：从 a 起重新归一（原始 = 100；相对 = 0%），区间外不画（x 轴始终是全部日期，供时间轴拖动）
  const build = (a, b) => sel.map((t) => {
    const c = raw.close[t];
    const data = new Array(N).fill(null);
    if (relMode) {
      RelStr.cum(daily[t], c, a, b).forEach((v, k) => { data[a + k] = v == null ? null : +(v * 100).toFixed(2); });
      return { name: t, type: "line", showSymbol: false, color: color[t], lineStyle: { width: 2 }, data,
        endLabel: { show: true, formatter: (p) => `${t} ${p.value > 0 ? "+" : ""}${num(p.value, 0)}%`, color: css("--ink-2"), fontSize: 11 }, labelLayout: { moveOverlap: "shiftY" } };
    }
    let s0 = a; while (s0 <= b && c[s0] == null) s0++;
    for (let i = s0; i <= b; i++) if (c[i] != null) data[i] = +((c[i] / c[s0]) * 100).toFixed(2);
    return { name: t, type: "line", showSymbol: false, color: color[t], lineStyle: { width: t === "SPY" ? 1.4 : 2, type: t === "SPY" ? "dashed" : "solid" },
      data, endLabel: { show: true, formatter: (p) => `${t} ${num(p.value, 0)}`, color: css("--ink-2"), fontSize: 11 }, labelLayout: { moveOverlap: "shiftY" } };
  });
  const withMark = (series) => series.map((x, i) => (i ? x : { ...x, markLine: { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" }, label: { show: false }, data: [{ yAxis: relMode ? 0 : 100 }] } }));
  const tz = byId("cmp-tz");
  const mark = (a, b) => tz?.querySelectorAll("button").forEach((x) => {
    const n = CMP_TZ.find(([k]) => k === x.dataset.v)[1];
    x.classList.toggle("on", b === N - 1 && a === Math.max(0, N - 1 - n));
  });
  const ch = mkChart(byId("c-cmp"), { tooltip: { trigger: "axis", valueFormatter: (v) => (!isNum(v) ? "–" : relMode ? `${v > 0 ? "+" : ""}${num(v, 1)}%` : `${num(v, 1)}（${pct(v / 100 - 1, 1, true)}）`) },
    legend: { top: 0 }, grid: { left: 56, right: 90, top: 36, bottom: 72 },
    xAxis: { type: "category", data: raw.dates, boundaryGap: false },
    yAxis: relMode ? { type: "value", scale: true, axisLabel: { formatter: (v) => `${v}%` } } : st.log
      ? { type: "log", logBase: 2, min: (v) => v.min * 0.95, max: (v) => v.max * 1.05, axisLabel: { formatter: (v) => num(v, 0), showMinLabel: false, showMaxLabel: false },
          minorTick: { show: true }, minorSplitLine: { show: true, lineStyle: { color: css("--grid"), opacity: 0.5 } } }
      : { type: "value", scale: true },
    dataZoom: [{ type: "slider", startValue: i0, endValue: end, bottom: 8, height: 22, showDataShadow: false, brushSelect: false },
      { type: "inside", startValue: i0, endValue: end }],
    series: withMark(build(i0, end)) });
  mark(i0, end);
  // 拖动时间轴 / 区间按钮：按新的起点重新归一
  let tmr = 0;
  const redraw = () => {
    if (!ch) return;
    const z = ch.getOption().dataZoom[0];
    const a = Math.max(0, Math.round(z.startValue)), b = Math.min(N - 1, Math.round(z.endValue));
    ch.setOption({ series: withMark(build(a, b)) });
    mark(a, b);
    const lab = byId("cmp-tz-range");
    if (lab) lab.textContent = `${raw.dates[a]} ~ ${raw.dates[b]}`;
  };
  ch?.on("datazoom", () => { clearTimeout(tmr); tmr = setTimeout(redraw, 60); });
  tz?.querySelectorAll("button").forEach((x) => (x.onclick = () => {
    const n = CMP_TZ.find(([k]) => k === x.dataset.v)[1];
    ch.dispatchAction({ type: "dataZoom", startValue: Math.max(0, N - 1 - n), endValue: N - 1 });
  }));
  redraw();
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

// ---------------- 上涨 / 下跌相对大盘（最近 N 轮，M83；各股按自己的走势切波段，散点用相对大盘） ----------------
async function cmpSwings(sel, color) {
  const box = byId("cmp-sw");
  if (!box) return;
  const w = await load("swings.json").catch(() => null);
  if (!w?.available) { box.innerHTML = `<h3>上涨 / 下跌相对大盘</h3>${empty("暂无数据")}`; return; }
  const ok = sel.filter((t) => w.stocks[t]), skip = sel.filter((t) => !w.stocks[t]);
  const d5 = (d) => d.slice(2);  // 26-10-05
  const per = ok.map((t) => { const x = w.stocks[t];
    return `<li><span class="dot" style="background:${color[t]}"></span><b>${esc(t)}</b>（阈值 ${pct(x.th, 0)}）：${x.periods.map((r, i) => `${i + 1} ↑${d5(r.rise[0])}→${d5(r.rise[1])} ↓→${d5(r.decline[1])}${r.ongoing ? "（进行中）" : ""}`).join("；")}${x.rising_since ? `；自 ${d5(x.rising_since)} 起的上涨未结束，未计入` : ""}</li>`; }).join("");
  // M87：走势特征描述、未经检验，默认折叠（展开后重算图表宽度）
  box.innerHTML = `<details id="cmp-sw-d"><summary><h3 style="display:inline">上涨 / 下跌相对大盘（最近 ${w.n} 轮）${valueChip("低–中")}${badge("derived")} <span class="chip basis-chip" title="按本股走势切分的最近几轮，样本少，未经检验">描述（未检验）</span></h3> <span class="muted small">点击展开</span></summary>
    <p class="muted">每只股票按<b>自己的股价走势</b>切出最近 ${w.n} 轮“上涨段 + 随后的下跌段”（各股时段不同），每轮一个点：横轴 = 上涨段涨跌 − ${esc(w.bench)} 同期涨跌，纵轴 = 下跌段涨跌 − ${esc(w.bench)} 同期涨跌（单位：百分点）。
    因为下跌段是按各股自己的跌势切出来的，纵轴通常为负：<b>越靠右 = 涨时比大盘涨得越多；越靠上 = 跌时比大盘跌得越少</b>，往右上方移动 = “涨得多、跌得少”在改善。
    点按时间顺序标 1–${w.n} 并连线，最后一点最大。股票用左侧勾选或上方快捷按钮选择。</p>
    ${ok.length ? chartDiv("c-cmp-sw", "tall") : empty("所选标的都没有这项数据（只计算选股池股票）")}
    ${skip.length ? `<p class="muted small">${skip.map(esc).join("、")} 不在选股池（ETF 等），不计算。</p>` : ""}
    ${ok.length ? `<p class="muted small"><b>各折线使用的 ${w.n} 个时段</b>（↑ 上涨段起止，↓ 下跌段终点；阈值 = 股价从高 / 低点反向变动多少才算拐点，取 ${w.vol_mult} × 该股近 3 年年化波动，限制在 ${pct(w.th_min, 0)}–${pct(w.th_max, 0)}）：</p>
    <ul class="small" style="margin-top:0;list-style:none;padding-left:0">${per}</ul>` : ""}
    <p class="muted small">各股、各轮时长不同，横轴的数值范围也因此不同；连线只表示时间顺序，不代表中间的路径。单只股票的明细见个股页“最近 5 轮涨跌”。只反映过去的走势特征，不代表之后会重复。</p></details>`;
  byId("cmp-sw-d")?.addEventListener("toggle", () => window.dispatchEvent(new Event("resize")));
  if (!ok.length) return;
  const series = ok.map((t) => { const x = w.stocks[t]; return {
    name: t, type: "line", color: color[t], lineStyle: { width: 1.5 }, connectNulls: true,
    data: x.periods.map((r, i) => (r.rel ? { value: [r.rel[0] * 100, r.rel[1] * 100], i, last: i === x.periods.length - 1 } : { value: [null, null], i })),
    symbolSize: (_, p) => 5 + p.data.i * 2.2, emphasis: { focus: "series" },
    label: { show: true, fontSize: 9, position: "top", formatter: (p) => `${p.data.i + 1}` },
    endLabel: { show: true, formatter: t, fontSize: 11, fontWeight: 600 },
  }; });
  mkChart(byId("c-cmp-sw"), {
    grid: { left: 56, right: 60, top: 36, bottom: 44 },
    legend: { top: 0, type: "scroll" },
    tooltip: { trigger: "item", formatter: (p) => { const r = w.stocks[p.seriesName].periods[p.data.i]; return `<b>${esc(p.seriesName)}</b> 第 ${p.data.i + 1} 轮<br>上涨 ${r.rise[0]} → ${r.rise[1]}：${pct(r.ret[0], 1, true)}，相对 ${w.bench} ${num(p.value[0], 1, true)} 个百分点<br>下跌 ${r.decline[0]} → ${r.decline[1]}${r.ongoing ? "（进行中）" : ""}：${pct(r.ret[1], 1, true)}，相对 ${w.bench} ${num(p.value[1], 1, true)} 个百分点`; } },
    xAxis: { type: "value", name: `上涨段相对 ${w.bench}（百分点）`, nameLocation: "middle", nameGap: 28, axisLabel: { formatter: (v) => `${v > 0 ? "+" : ""}${v}` } },
    yAxis: { type: "value", name: `下跌段相对 ${w.bench}（百分点）`, nameLocation: "middle", nameGap: 40, axisLabel: { formatter: (v) => `${v > 0 ? "+" : ""}${v}` } },
    series: [...series, { type: "line", data: [], silent: true,
      markLine: { symbol: "none", silent: true, label: { show: false }, lineStyle: { type: "dashed", color: css("--ink-2") }, data: [{ xAxis: 0 }, { yAxis: 0 }] } }],
  });
}
