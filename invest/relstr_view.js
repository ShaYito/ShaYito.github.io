"use strict";
/* 个股页“相对大盘走势”：相对大盘（个股 − 基准）与剔除 beta 后（个股 − β × 基准）两条累计曲线。
   计算见 relstr.js；数据为 sim/prices.json 的日频复权收盘价（含分红）。
   横轴与价格走势（K 线）完全一致：同一组日期、同样的左右边距；缩放 / 拖动任一张图，另一张同步，
   相对曲线从当前显示区间的起点开始累计（起点 = 0）。基准选择记在本机。 */

// K 线区间按钮（交易日数；5 年 = 全部数据）
const K_PERIODS = [["6M", 126, "6 月"], ["1Y", 252, "1 年"], ["3Y", 756, "3 年"], ["5Y", Infinity, "5 年"]];
const K_PERIOD_KEY = "invest.kline.period";
function kPeriod() { try { const v = localStorage.getItem(K_PERIOD_KEY); return K_PERIODS.some(([k]) => k === v) ? v : "1Y"; } catch { return "1Y"; } }
function kPeriodStart(n, key) { const p = K_PERIODS.find(([k]) => k === key) || K_PERIODS[1]; return Math.max(0, n - 1 - p[1]); }
function kPeriodSeg() {
  const cur = kPeriod();
  return `<div class="seg" id="k-per" style="margin:6px 0">${K_PERIODS.map(([k, , n]) => `<button type="button" data-v="${k}" class="${k === cur ? "on" : ""}">${n}</button>`).join("")}</div>`;
}
// 价格走势与相对走势共用的横轴边距（两张图日期上下对齐）
const K_GRID_X = { left: 56, right: 20 };

// 当前缩放范围（类别轴下标）
function zoomRange(chart, n) {
  const dz = chart?.getOption()?.dataZoom?.[0];
  if (!dz) return [0, n - 1];
  const a = Number.isFinite(dz.startValue) ? dz.startValue : Math.round(((dz.start ?? 0) / 100) * (n - 1));
  const b = Number.isFinite(dz.endValue) ? dz.endValue : Math.round(((dz.end ?? 100) / 100) * (n - 1));
  return [Math.max(0, a), Math.min(n - 1, b)];
}

/* 绑定区间按钮：点按钮缩放 K 线（其余图表经联动同步）；手动拖动后按钮高亮与当前范围一致的那个（都不一致时不高亮） */
function bindKPeriod(k, n) {
  const seg = byId("k-per");
  if (!seg || !k) return;
  const mark = () => {
    const [a, b] = zoomRange(k, n);
    const hit = b === n - 1 ? K_PERIODS.find(([key]) => kPeriodStart(n, key) === a)?.[0] : null;
    seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.v === hit));
  };
  seg.querySelectorAll("button").forEach((x) => (x.onclick = () => {
    try { localStorage.setItem(K_PERIOD_KEY, x.dataset.v); } catch { /* 忽略 */ }
    k.dispatchAction({ type: "dataZoom", startValue: kPeriodStart(n, x.dataset.v), endValue: n - 1 });
  }));
  k.on("datazoom", mark);
}

const REL_KEY = "invest.relstr.v1";
function relPrefs() { try { return JSON.parse(localStorage.getItem(REL_KEY) || "{}") || {}; } catch { return {}; } }
function saveRelPrefs(p) { try { localStorage.setItem(REL_KEY, JSON.stringify({ ...relPrefs(), ...p })); } catch { /* 忽略 */ } }

const REL_HOWTO = [
  "相对大盘：每天把这只股票的涨跌减去基准（SPY 或所属主题的行业 ETF）的涨跌，从当前显示区间的起点累计（起点 = 0）。线往上 = 这段时间比基准涨得多（或跌得少），往下 = 跑输。回答“买它比买基准强还是弱”。",
  "剔除 [[beta|β]] 后：先估计这只股票对基准有多敏感（β，用此前一年的日收益估计，不用未来数据），每天减去 β × 基准涨跌，剩下的是公司自身因素带来的涨跌。高 β 股票（如半导体）在牛市里“相对大盘”看起来会偏强、熊市里偏弱，这条线把这部分放大效应去掉，更适合判断公司自身的趋势。",
  "横轴与上方价格走势一致：在任一张图上缩放、拖动或点区间按钮，两张图同步，曲线从新的区间起点重新累计。基准选 SPY 看相对整个市场；选主题基准（如 SMH）看在同行里强不强：相对 SPY 走强但相对 SMH 走平，说明主要是整个板块在涨。",
  "局限：相对强弱有一定延续性（动量效应），但不是预测，强势也可能突然反转；β 是估计值，会随时间变化，财报等重大事件前后不稳定；曲线按日复利累计，和“个股收益 − 基准收益”的简单相减在长区间上会有差别。",
];

function relCard() {
  return `<section class="card" id="rel-card" data-nav="相对大盘走势"><h3>相对大盘走势 ${badge("derived")}</h3>
    <div class="row"><span class="muted">基准</span><div class="seg" id="rel-b"></div></div>
    <div id="rel-sum" class="muted"></div>${chartDiv("c-rel")}
    <details class="howto"><summary>如何阅读这张图</summary>${REL_HOWTO.map((l) => `<p>${rich(l)}</p>`).join("")}</details></section>`;
}

/* k：价格走势（K 线）图表实例，用于对齐与联动缩放 */
async function drawRelStr(t, s, k) {
  const raw = await load("sim/prices.json").catch(() => null);
  const el = byId("c-rel");
  if (!el || (k && k.isDisposed())) return;
  if (!raw?.close?.[t]) { byId("rel-card").querySelector(".row").outerHTML = empty("没有这只股票的日频价格数据"); el.remove(); return; }
  const benches = [...new Set(["SPY", s.benchmark])].filter((b) => raw.close[b]);
  const pr = relPrefs();
  const want = pr.b === "theme" ? s.benchmark : "SPY";
  const bench = benches.includes(want) ? want : benches[0];
  byId("rel-b").innerHTML = benches.map((b) => [b === "SPY" ? "spy" : "theme", b === "SPY" ? "SPY（大盘）" : `${b}（主题基准）`])
    .map(([key, n]) => `<button type="button" data-v="${key}" class="${(bench === "SPY" ? "spy" : "theme") === key ? "on" : ""}">${esc(n)}</button>`).join("");
  byId("rel-b").querySelectorAll("button").forEach((b) => (b.onclick = () => {
    saveRelPrefs({ b: b.dataset.v });
    echarts.getInstanceByDom(el)?.dispose(); charts = charts.filter((c) => !c.isDisposed());
    drawRelStr(t, s, k);
  }));

  const sc = raw.close[t], bc = raw.close[bench];
  const end = raw.dates.length - 1;
  const d = RelStr.daily(sc, bc);
  const beta = d.beta[end];
  const fmt = (v) => (isNum(v) ? `<span class="${cls(v)}">${pct(v, 1, true)}</span>` : "–");
  byId("rel-sum").innerHTML = `当前 β ${isNum(beta) ? num(beta, 2) : "–"}（相对 ${esc(bench)}，过去一年日收益估计）· 近 12 周：相对大盘 ${fmt(RelStr.trailing(d.rel, end, 60))}、剔除 β 后 ${fmt(RelStr.trailing(d.resid, end, 60))} · 近 26 周：相对大盘 ${fmt(RelStr.trailing(d.rel, end, 130))}、剔除 β 后 ${fmt(RelStr.trailing(d.resid, end, 130))}`;

  // 横轴 = 价格走势的日期（s.dates）；从显示区间起点 a 开始累计
  const n = s.dates.length;
  const rawIdx = Object.fromEntries(raw.dates.map((x, i) => [x, i]));
  const ix = s.dates.map((x) => rawIdx[x]);
  const series = (a) => {
    const rel = new Array(n).fill(null), res = new Array(n).fill(null);
    let j0 = a; while (j0 < n && ix[j0] == null) j0++;
    if (j0 < n) {
      const i0 = ix[j0], i1 = ix[n - 1] ?? end;
      const cr = RelStr.cum(d.rel, sc, i0, i1), cs = RelStr.cum(d.resid, sc, i0, i1);
      for (let j = j0; j < n; j++) if (ix[j] != null) {
        const v1 = cr[ix[j] - i0], v2 = cs[ix[j] - i0];
        rel[j] = v1 == null ? null : +(v1 * 100).toFixed(2);
        res[j] = v2 == null ? null : +(v2 * 100).toFixed(2);
      }
    }
    return [rel, res];
  };
  const [a0, b0] = k ? zoomRange(k, n) : [kPeriodStart(n, kPeriod()), n - 1];
  const [rel0, res0] = series(a0);
  const c = mkChart(el, {
    tooltip: { trigger: "axis", valueFormatter: (v) => (isNum(v) ? `${v > 0 ? "+" : ""}${num(v, 1)}%` : "–") },
    legend: { top: 0 }, grid: { ...K_GRID_X, top: 34, bottom: 30 },
    xAxis: { type: "category", data: s.dates, boundaryGap: true },
    yAxis: { type: "value", scale: true, axisLabel: { formatter: (v) => `${v}%` } },
    dataZoom: [{ type: "inside", startValue: a0, endValue: b0 }],
    series: [
      { name: `相对 ${bench}`, type: "line", showSymbol: false, data: rel0, color: css("--accent"), lineStyle: { width: 2 },
        markLine: { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" }, label: { show: false }, data: [{ yAxis: 0 }] } },
      { name: "剔除 β 后（公司自身）", type: "line", showSymbol: false, data: res0, color: palette()[3], lineStyle: { width: 2 } },
    ],
  });
  if (!c || !k) return;
  // 双向联动：缩放任一张图，另一张同步；相对曲线从新的起点重新累计
  let base = a0, lock = false;
  const rebase = (a) => { if (a === base) return; base = a; const [r1, r2] = series(a); c.setOption({ series: [{ data: r1 }, { data: r2 }] }); };
  const follow = (from, to) => from.on("datazoom", () => {
    if (lock) return;
    const [a, b] = zoomRange(from, n);
    lock = true;
    try { to.dispatchAction({ type: "dataZoom", startValue: a, endValue: b }); } finally { lock = false; }
    rebase(a);
  });
  follow(k, c);
  follow(c, k);
}
