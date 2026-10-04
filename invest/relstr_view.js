"use strict";
/* 个股页“相对大盘走势”：相对大盘（个股 − 基准）与剔除 beta 后（个股 − β × 基准）两条累计曲线。
   计算见 relstr.js；数据为 sim/prices.json 的日频复权收盘价（含分红）。基准与区间的选择记在本机。 */

const REL_PERIODS = [["6M", 126, "6 月"], ["1Y", 252, "1 年"], ["3Y", 756, "3 年"], ["5Y", 1260, "5 年"]];
const REL_KEY = "invest.relstr.v1";
function relPrefs() { try { return JSON.parse(localStorage.getItem(REL_KEY) || "{}") || {}; } catch { return {}; } }
function saveRelPrefs(p) { try { localStorage.setItem(REL_KEY, JSON.stringify({ ...relPrefs(), ...p })); } catch { /* 忽略 */ } }

const REL_HOWTO = [
  "相对大盘：每天把这只股票的涨跌减去基准（SPY 或所属主题的行业 ETF）的涨跌，再从区间起点累计。线往上 = 这段时间比基准涨得多（或跌得少），往下 = 跑输。回答“买它比买基准强还是弱”。",
  "剔除 [[beta|β]] 后：先估计这只股票对基准有多敏感（β，用此前一年的日收益估计，不用未来数据），每天减去 β × 基准涨跌，剩下的是公司自身因素带来的涨跌。高 β 股票（如半导体）在牛市里“相对大盘”看起来会偏强、熊市里偏弱，这条线把这部分放大效应去掉，更适合判断公司自身的趋势。",
  "基准选 SPY 看相对整个市场；选主题基准（如 SMH）看在同行里强不强：相对 SPY 走强但相对 SMH 走平，说明主要是整个板块在涨。",
  "局限：相对强弱有一定延续性（动量效应），但不是预测，强势也可能突然反转；β 是估计值，会随时间变化，财报等重大事件前后不稳定；曲线按日复利累计，和“个股收益 − 基准收益”的简单相减在长区间上会有差别。",
];

function relCard(t, s) {
  return `<section class="card" id="rel-card" data-nav="相对大盘走势"><h3>相对大盘走势 ${badge("derived")}</h3>
    <div class="row"><span class="muted">基准</span><div class="seg" id="rel-b"></div><span class="muted">区间</span><div class="seg" id="rel-p"></div></div>
    <div id="rel-sum" class="muted"></div>${chartDiv("c-rel")}
    <details class="howto"><summary>如何阅读这张图</summary>${REL_HOWTO.map((l) => `<p>${rich(l)}</p>`).join("")}</details></section>`;
}

async function drawRelStr(t, s) {
  const raw = await load("sim/prices.json").catch(() => null);
  const el = byId("c-rel");
  if (!el) return;
  if (!raw?.close?.[t]) { byId("rel-card").querySelector(".row").outerHTML = empty("没有这只股票的日频价格数据"); el.remove(); return; }
  const benches = [...new Set(["SPY", s.benchmark])].filter((b) => raw.close[b]);
  const pr = relPrefs();
  const bench = benches.includes(pr.b === "theme" ? s.benchmark : "SPY") ? (pr.b === "theme" ? s.benchmark : "SPY") : benches[0];
  const per = REL_PERIODS.find(([k]) => k === pr.p) || REL_PERIODS[1];
  const segHtml = (items, cur) => items.map(([k, n]) => `<button type="button" data-v="${k}" class="${k === cur ? "on" : ""}">${esc(n)}</button>`).join("");
  byId("rel-b").innerHTML = segHtml(benches.map((b) => [b === "SPY" ? "spy" : "theme", b === "SPY" ? "SPY（大盘）" : `${b}（主题基准）`]), bench === "SPY" ? "spy" : "theme");
  byId("rel-p").innerHTML = segHtml(REL_PERIODS.map(([k, , n]) => [k, n]), per[0]);
  const redraw = () => { echarts.getInstanceByDom(el)?.dispose(); charts = charts.filter((c) => !c.isDisposed()); drawRelStr(t, s); };
  byId("rel-b").querySelectorAll("button").forEach((b) => (b.onclick = () => { saveRelPrefs({ b: b.dataset.v }); redraw(); }));
  byId("rel-p").querySelectorAll("button").forEach((b) => (b.onclick = () => { saveRelPrefs({ p: b.dataset.v }); redraw(); }));

  const sc = raw.close[t], bc = raw.close[bench];
  const end = raw.dates.length - 1;
  const i0 = Math.max(1, end - per[1]);
  const d = RelStr.daily(sc, bc);
  const rel = RelStr.cum(d.rel, sc, i0, end), res = RelStr.cum(d.resid, sc, i0, end);
  const beta = d.beta[end];
  const fmt = (v) => (isNum(v) ? `<span class="${cls(v)}">${pct(v, 1, true)}</span>` : "–");
  byId("rel-sum").innerHTML = `当前 β ${isNum(beta) ? num(beta, 2) : "–"}（相对 ${esc(bench)}，过去一年日收益估计）· 近 12 周：相对大盘 ${fmt(RelStr.trailing(d.rel, end, 60))}、剔除 β 后 ${fmt(RelStr.trailing(d.resid, end, 60))} · 近 26 周：相对大盘 ${fmt(RelStr.trailing(d.rel, end, 130))}、剔除 β 后 ${fmt(RelStr.trailing(d.resid, end, 130))}`;
  const dates = raw.dates.slice(i0, end + 1);
  const r4 = (a) => a.map((v) => (v == null ? null : +(v * 100).toFixed(2)));
  mkChart(el, {
    tooltip: { trigger: "axis", valueFormatter: (v) => (isNum(v) ? `${v > 0 ? "+" : ""}${num(v, 1)}%` : "–") },
    legend: { top: 0 }, grid: { left: 52, right: 20, top: 34, bottom: 30 },
    xAxis: { type: "category", data: dates, boundaryGap: false },
    yAxis: { type: "value", scale: true, axisLabel: { formatter: (v) => `${v}%` } },
    series: [
      { name: `相对 ${bench}`, type: "line", showSymbol: false, data: r4(rel), color: css("--accent"), lineStyle: { width: 2 },
        markLine: { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" }, label: { show: false }, data: [{ yAxis: 0 }] } },
      { name: "剔除 β 后（公司自身）", type: "line", showSymbol: false, data: r4(res), color: palette()[3], lineStyle: { width: 2 } },
    ],
  });
}
