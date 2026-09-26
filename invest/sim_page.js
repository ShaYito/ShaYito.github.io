"use strict";
/* 模拟经营页面：设置 → 浏览器端回测（sim.js）→ 收益报告。设置编码进网址（#/sim?c=...），可保存 / 分享。 */

const SIM_STRATEGIES = {
  fixed: { name: "固定比例", tip: "按你设定的比例持有；配合下方“调仓”规则定期调回目标比例。",
    why: "定期再平衡会自动“高卖低买”，把组合风险维持在你设定的水平；这是最被广泛验证、最透明的做法。", risk: "不判断市场，牛市中涨得多的资产会被卖出一部分，收益可能略低于放任不管。" },
  invvol: { name: "逆波动率加权", tip: "只用你选的标的，比例改为“波动越小给得越多”（过去 60 日波动）；你填写的比例合计作为总仓位，其余为现金。",
    why: "让每个标的对组合波动的贡献更接近，避免一只高波动股票主导组合。", risk: "低波动资产未必收益高；波动突然放大时调整有滞后。" },
  momentum: { name: "动量轮动", tip: "在你选的标的中，每次调仓持有过去 N 个月（跳过最近 1 个月）涨幅最高的几只，等权；若连现金都跑不赢，该份额留在现金（绝对动量）。",
    why: "“强者恒强”的动量效应是金融学里被研究最多、跨市场都存在的现象之一；绝对动量过滤能在长期下跌中退到现金。", risk: "换手高；市场急转弯（如 2020 年 3 月后的反弹）时会追高杀跌。" },
  system: { name: "本系统策略（原版）", tip: "完全复现本系统回测：每周按市场状态分配核心 / 卫星 / 对冲 / 现金，卫星层由模型选 6 只股票。不能修改参数，结果与“回测与实盘”页一致。",
    why: "按市场状态调整仓位在回测中降低了回撤。", risk: "模型选股在样本外没有稳定的预测力；收益受幸存者偏差影响较大。" },
  system_custom: { name: "本系统策略（可调）", tip: "沿用本系统每周的市场状态和模型排名，但你可以修改各状态下四层的比例和选股只数。组合构建为简化版（逆波动率 + 单只上限），与原版略有差异。",
    why: "用来检验“更保守 / 更激进的配置”在历史上会怎样。", risk: "同原版。" },
};
const SIM_OVERLAYS = {
  trend: { name: "趋势过滤（200 日均线）", tip: "调仓时，价格低于 200 日均线的标的不持有（换成现金）；买入持有时每月检查一次。",
    why: "有长期研究支持（如 Faber 2007）：能避开大部分长期熊市。", risk: "震荡市中会反复卖出又买回，产生交易成本和踏空。" },
  volTarget: { name: "波动率目标", tip: "按目标权重估算组合过去 60 日的年化波动，高于目标时整体按比例降仓（不加杠杆）。",
    why: "机构常用的风险控制：市场越动荡仓位越低，明显降低回撤。", risk: "波动回落后才恢复仓位，反弹初期会少赚。" },
  stop: { name: "移动止损", tip: "持仓从持有期间的最高收盘价回落超过设定比例就卖出，直到下一次定期调仓才重新买入。",
    why: "直观、便于执行纪律。", risk: "研究支持弱：单只股票的正常波动也常触发止损，容易卖在低点。仅供对比。" },
};
const SIM_TEMPLATES = {
  system_now: { name: "本系统最新配置" },
  spy: { name: "SPY 100%", weights: { SPY: 1 } },
  qqq: { name: "QQQ 100%", weights: { QQQ: 1 } },
  classic: { name: "SPY 60% + GLD 20% + 现金 20%", weights: { SPY: 0.6, GLD: 0.2 } },
  pool_ew: { name: "选股池等权（全部股票）" },
  semis: { name: "半导体等权" },
  ai_infra: { name: "AI 基础设施等权" },
};
const SIM_DEFAULT = { mode: "fixed", weights: { SPY: 0.35, QQQ: 0.25, GLD: 0.1, NVDA: 0.1, MSFT: 0.1 }, rebalance: "Q", band: 0.05,
  topN: 3, momentumLookback: 12, overlays: { trend: false, trendMA: 200, volTarget: 0, stop: 0 }, initial: 100000, monthly: 0,
  start: "2019-01-01", end: "", costBps: 10, bench: ["SPY", "QQQ", "bh"], layers: null };
const SIM_HOWTO = [
  "这一页让你用真实历史价格做“如果当时这样操作会怎样”的[[simulated|模拟]]：设定标的和比例，选择一种分配方式和调仓规则，可选叠加风控，然后选择历史区间运行。",
  "可选的分配方式与风控：固定比例 + [[rebalance|再平衡]]、[[inverse_vol|逆波动率加权]]、[[momentum_rotation|动量轮动]]、本系统策略；叠加[[trend_filter|趋势过滤]]、[[vol_target|波动率目标]]、[[trailing_stop|移动止损]]。展开下方“逻辑、可靠性说明”查看每种方法为什么可能有效、何时会失效。",
  "报告中的“净值”是[[twr|时间加权收益]]（不受[[dca|定投]]时点影响）；“期末资产 / 盈亏”是按你的初始资金与定投计算的金额。",
  "规则与本系统回测完全一致：收盘产生信号、下一交易日开盘成交、每笔买卖扣除成本（默认 0.1%），现金按短期国债利率计息；不计税和分红预扣税，价格为复权价（分红再投资）。",
  "候选股票是今天挑出来的公司（[[survivorship|幸存者偏差]]），越早的起点、越集中于个股，结果越偏乐观。",
];

let SIM_DATA = null;
async function simData() {
  if (SIM_DATA) return SIM_DATA;
  const [raw, sys] = await Promise.all([load("sim/prices.json"), load("sim/system.json").catch(() => null)]);
  SIM_DATA = { P: Sim.prepare(raw), sys: sys && sys.dates?.length ? sys : null, raw };
  return SIM_DATA;
}
function simEncode(c) { return btoa(unescape(encodeURIComponent(JSON.stringify(c)))).replace(/=+$/, ""); }
function simDecode(s) { try { return JSON.parse(decodeURIComponent(escape(atob(s)))); } catch { return null; } }

PAGES.sim = async (r) => {
  const { P, sys } = await simData();
  const cfg = { ...structuredClone(SIM_DEFAULT), ...(r.query.c ? simDecode(r.query.c) || {} : {}) };
  cfg.overlays = { ...SIM_DEFAULT.overlays, ...(cfg.overlays || {}) };
  if (!cfg.end) cfg.end = P.dates[P.n - 1];
  const first = P.dates[Math.max(P.backtestStart, 1)];
  const assetOpts = P.assets.map((a) => `<option value="${a.ticker}">${esc(tickerLabel(a.ticker) || a.ticker)}${a.kind === "etf" ? "（ETF）" : ""}</option>`).join("");
  const layerRows = sys ? ["risk_on", "neutral", "risk_off"].map((rg) => {
    const lw = (cfg.layers && cfg.layers[rg]) || sys.regime_weights[rg];
    return `<tr><td>${esc(REGIME_ZH[rg])}</td>${["core", "satellite", "hedge", "cash"].map((k) => `<td><input type="number" class="sim-layer" data-rg="${rg}" data-k="${k}" min="0" max="100" step="1" value="${Math.round(lw[k] * 100)}" style="width:64px">%</td>`).join("")}</tr>`;
  }).join("") : "";
  app().innerHTML = `
    <h2>模拟经营 <span class="muted">用真实历史价格检验你的仓位与策略 · 数据 ${esc(first)} ~ ${esc(P.dates[P.n - 1])}</span></h2>
    ${howto(SIM_HOWTO)}
    <section class="card" id="sim-form"><h3>设置 ${badge("simulated")}</h3>
      <div class="row"><label>模板 <select id="sim-tpl"><option value="">— 载入模板 —</option>${Object.entries(SIM_TEMPLATES).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join("")}</select></label>
        <label>分配方式 <select id="sim-mode">${Object.entries(SIM_STRATEGIES).filter(([k]) => sys || !k.startsWith("system")).map(([k, s]) => `<option value="${k}" ${k === cfg.mode ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label></div>
      <p class="muted" id="sim-mode-tip"></p>
      <div id="sim-assets-box"><h4>标的与目标比例 <span class="muted" id="sim-sum"></span></h4>
        <div class="table-wrap"><table><tbody id="sim-assets"></tbody></table></div>
        <div class="row"><select id="sim-add">${assetOpts}</select><button type="button" class="ghost" id="sim-add-btn">添加标的</button>
          <button type="button" class="ghost" id="sim-eq-btn">等权</button><button type="button" class="ghost" id="sim-clear-btn">清空</button></div></div>
      <div class="row" id="sim-mom-box"><label>持有前 <input type="number" id="sim-topn" min="1" max="20" value="${cfg.topN}" style="width:60px"> 只</label>
        <label>回看 <input type="number" id="sim-lookback" min="3" max="12" value="${cfg.momentumLookback}" style="width:60px"> 个月（跳过最近 1 个月）</label></div>
      <div id="sim-sys-box">${sys ? `<h4>各市场状态下的四层比例（可调版）</h4><div class="table-wrap"><table><thead><tr><th>市场状态</th><th>核心 SPY</th><th>卫星（模型选股）</th><th>对冲 GLD</th><th>现金</th></tr></thead><tbody>${layerRows}</tbody></table></div>
        <div class="row"><label>卫星选股只数 <input type="number" id="sim-sys-topn" min="1" max="15" value="${cfg.sysTopN || sys.top_n}" style="width:60px"></label></div>` : ""}</div>
      <div class="row" id="sim-reb-box"><label>调仓 <select id="sim-reb">${[["none", "不调仓（买入持有）"], ["M", "每月"], ["Q", "每季"], ["Y", "每年"], ["band", "偏离超过阈值时（每周检查）"]].map(([k, n]) => `<option value="${k}" ${k === cfg.rebalance ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label id="sim-band-l">阈值 <input type="number" id="sim-band" min="1" max="30" value="${Math.round(cfg.band * 100)}" style="width:60px"> 个百分点</label></div>
      <h4>风控叠加（可多选）</h4>
      <div class="row"><label><input type="checkbox" id="sim-trend" ${cfg.overlays.trend ? "checked" : ""}> ${SIM_OVERLAYS.trend.name}</label>
        <label><input type="checkbox" id="sim-vt-on" ${cfg.overlays.volTarget > 0 ? "checked" : ""}> ${SIM_OVERLAYS.volTarget.name} <input type="number" id="sim-vt" min="3" max="40" value="${Math.round((cfg.overlays.volTarget || 0.12) * 100)}" style="width:56px">%</label>
        <label><input type="checkbox" id="sim-stop-on" ${cfg.overlays.stop > 0 ? "checked" : ""}> ${SIM_OVERLAYS.stop.name} <input type="number" id="sim-stop" min="3" max="50" value="${Math.round((cfg.overlays.stop || 0.15) * 100)}" style="width:56px">%</label></div>
      <details class="howto"><summary>各策略与风控的逻辑、可靠性说明</summary>${[...Object.values(SIM_STRATEGIES), ...Object.values(SIM_OVERLAYS)].map((s) => `<p><b>${esc(s.name)}</b>：${esc(s.tip)}<br><span class="pos">为什么可能有效：</span>${esc(s.why)}<br><span class="neg">局限：</span>${esc(s.risk)}</p>`).join("")}</details>
      <h4>资金与区间</h4>
      <div class="row"><label>初始资金 <input type="number" id="sim-initial" min="100" step="1000" value="${cfg.initial}" style="width:110px"></label>
        <label>每月定投 <input type="number" id="sim-monthly" min="0" step="100" value="${cfg.monthly}" style="width:90px"></label>
        <label>成本 <input type="number" id="sim-cost" min="0" max="100" step="1" value="${cfg.costBps}" style="width:56px"> bps（单边）</label></div>
      <div class="row"><label>开始 <input type="date" id="sim-start" min="${first}" max="${P.dates[P.n - 1]}" value="${esc(cfg.start)}"></label>
        <label>结束 <input type="date" id="sim-end" min="${first}" max="${P.dates[P.n - 1]}" value="${esc(cfg.end)}"></label>
        <div class="seg" id="sim-quick">${[["2016-01-01", "2016 起"], ["2019-01-01", "2019 起（样本外）"], ["3y", "近 3 年"], ["1y", "近 1 年"], ["2022", "2022 熊市"], ["2020", "2020 疫情"]].map(([k, n]) => `<button type="button" data-q="${k}">${n}</button>`).join("")}</div></div>
      <div class="row">对比：${[["SPY", "SPY"], ["QQQ", "QQQ"], ["bh", "同比例买入持有"]].map(([k, n]) => `<label><input type="checkbox" class="sim-bench" value="${k}" ${cfg.bench.includes(k) ? "checked" : ""}> ${n}</label>`).join("")}
        <button type="button" id="sim-run" class="primary">运行模拟</button><span class="muted" id="sim-status"></span></div>
    </section>
    <div id="sim-report"></div>`;

  // ---------- 表单状态 ----------
  let weights = { ...cfg.weights };
  const drawAssets = () => {
    const rows = Object.entries(weights).map(([t, w]) => `<tr><td>${esc(tickerLabel(t) || t)}</td><td><input type="number" class="sim-w" data-t="${t}" min="0" max="100" step="1" value="${+(w * 100).toFixed(1)}" style="width:72px"> %</td>
      <td><button type="button" class="ghost sim-del" data-t="${t}">移除</button></td></tr>`).join("");
    byId("sim-assets").innerHTML = rows || `<tr><td class="muted">尚未添加标的（全部为现金）</td></tr>`;
    const s = Object.values(weights).reduce((a, b) => a + b, 0);
    byId("sim-sum").innerHTML = `合计 ${pct(s, 0)}，现金 ${pct(Math.max(0, 1 - s), 0)}${s > 1.0001 ? ' <span class="neg">（超过 100%，运行时按比例缩放）</span>' : ""}`;
    document.querySelectorAll(".sim-w").forEach((el) => (el.onchange = () => { weights[el.dataset.t] = Math.max(0, +el.value || 0) / 100; drawAssets(); }));
    document.querySelectorAll(".sim-del").forEach((el) => (el.onclick = () => { delete weights[el.dataset.t]; drawAssets(); }));
  };
  const syncMode = () => {
    const m = byId("sim-mode").value;
    const s = SIM_STRATEGIES[m];
    byId("sim-mode-tip").textContent = s.tip;
    byId("sim-assets-box").style.display = m.startsWith("system") ? "none" : "";
    byId("sim-mom-box").style.display = m === "momentum" ? "" : "none";
    byId("sim-sys-box").style.display = m === "system_custom" ? "" : "none";
    byId("sim-reb-box").style.display = m.startsWith("system") ? "none" : "";
    byId("sim-band-l").style.display = byId("sim-reb").value === "band" ? "" : "none";
  };
  byId("sim-mode").onchange = syncMode;
  byId("sim-reb").onchange = syncMode;
  byId("sim-add-btn").onclick = () => { const t = byId("sim-add").value; if (!(t in weights)) weights[t] = 0.1; drawAssets(); };
  byId("sim-eq-btn").onclick = () => { const k = Object.keys(weights); k.forEach((t) => (weights[t] = 1 / k.length)); drawAssets(); };
  byId("sim-clear-btn").onclick = () => { weights = {}; drawAssets(); };
  byId("sim-tpl").onchange = (e) => {
    const k = e.target.value;
    if (k === "system_now" && sys) weights = { ...sys.targets[sys.targets.length - 1] };
    else if (k === "pool_ew") { const u = META.universe.map((x) => x.ticker); weights = Object.fromEntries(u.map((t) => [t, 1 / u.length])); }
    else if (k === "ai_infra") { const u = META.universe.filter((x) => x.theme === "ai_infrastructure").map((x) => x.ticker); weights = Object.fromEntries(u.map((t) => [t, 1 / u.length])); }
    else if (k === "semis") { const u = META.universe.filter((x) => x.theme === "semis" || x.theme === "semiconductors").map((x) => x.ticker); weights = Object.fromEntries(u.map((t) => [t, 1 / u.length])); }
    else if (SIM_TEMPLATES[k]?.weights) weights = { ...SIM_TEMPLATES[k].weights };
    if (k && byId("sim-mode").value.startsWith("system")) byId("sim-mode").value = "fixed";
    syncMode(); drawAssets();
  };
  document.querySelectorAll("#sim-quick button").forEach((b) => (b.onclick = () => {
    const last = P.dates[P.n - 1], q = b.dataset.q;
    const back = (y) => { const d = new Date(last); d.setFullYear(d.getFullYear() - y); return d.toISOString().slice(0, 10); };
    const [s, e] = q === "3y" ? [back(3), last] : q === "1y" ? [back(1), last] : q === "2022" ? ["2022-01-01", "2022-12-31"] : q === "2020" ? ["2020-01-01", "2020-12-31"] : [q, last];
    byId("sim-start").value = s < first ? first : s; byId("sim-end").value = e;
  }));
  drawAssets(); syncMode();

  const readCfg = () => {
    const c = {
      mode: byId("sim-mode").value, weights: { ...weights }, rebalance: byId("sim-reb").value, band: (+byId("sim-band").value || 5) / 100,
      topN: +byId("sim-topn").value || 3, momentumLookback: +byId("sim-lookback").value || 12,
      overlays: { trend: byId("sim-trend").checked, trendMA: 200, volTarget: byId("sim-vt-on").checked ? (+byId("sim-vt").value || 12) / 100 : 0,
        stop: byId("sim-stop-on").checked ? (+byId("sim-stop").value || 15) / 100 : 0 },
      initial: Math.max(100, +byId("sim-initial").value || 100000), monthly: Math.max(0, +byId("sim-monthly").value || 0),
      start: byId("sim-start").value || first, end: byId("sim-end").value || P.dates[P.n - 1], costBps: Math.max(0, +byId("sim-cost").value || 0),
      bench: [...document.querySelectorAll(".sim-bench:checked")].map((x) => x.value), layers: null,
    };
    const s = Object.values(c.weights).reduce((a, b) => a + b, 0);
    if (s > 1) c.weights = Object.fromEntries(Object.entries(c.weights).map(([t, w]) => [t, w / s]));
    if (c.mode === "system_custom" && sys) {
      c.layers = {};
      document.querySelectorAll(".sim-layer").forEach((el) => { (c.layers[el.dataset.rg] ||= {})[el.dataset.k] = Math.max(0, +el.value || 0) / 100; });
      for (const rg of Object.keys(c.layers)) { const t = Object.values(c.layers[rg]).reduce((a, b) => a + b, 0); if (t > 0) for (const k in c.layers[rg]) c.layers[rg][k] /= t; }
      c.sysTopN = +byId("sim-sys-topn").value || sys.top_n;
    }
    return c;
  };
  const go = () => {
    const c = readCfg();
    history.replaceState(null, "", `#/sim?c=${simEncode(c)}`);
    byId("sim-status").textContent = "计算中…";
    setTimeout(() => {
      try { renderSimReport(P, sys, c); byId("sim-status").textContent = ""; }
      catch (e) { console.error(e); byId("sim-status").innerHTML = `<span class="neg">运行失败：${esc(e.message)}</span>`; }
    }, 10);
  };
  byId("sim-run").onclick = go;
  if (r.query.c) go();
};

// ---------------- 运行与报告 ----------------
function simRun(P, sys, c, override = {}) {
  const cc = { ...c, ...override };
  const strat = Sim.makeStrategy(P, { ...cc, topN: cc.mode === "system_custom" ? cc.sysTopN : cc.topN }, sys);
  const start = Math.max(Sim.indexOnOrAfter(P, cc.start), P.backtestStart, 1);
  const end = Sim.indexOnOrBefore(P, cc.end);
  if (end - start < 5) throw new Error("区间太短（至少一周）");
  const res = Sim.run(P, strat, { start, end, costBps: cc.costBps, initial: cc.initial, monthly: cc.monthly });
  return { res, m: Sim.metrics(P, res) };
}
function renderSimReport(P, sys, c) {
  const main = simRun(P, sys, c);
  const runs = [{ key: "main", name: "你的策略", ...main }];
  const benchFixed = (w) => ({ mode: "fixed", weights: w, rebalance: "none", overlays: {} });
  if (c.bench.includes("SPY")) runs.push({ key: "SPY", name: "SPY 买入持有", ...simRun(P, sys, c, benchFixed({ SPY: 1 })) });
  if (c.bench.includes("QQQ")) runs.push({ key: "QQQ", name: "QQQ 买入持有", ...simRun(P, sys, c, benchFixed({ QQQ: 1 })) });
  if (c.bench.includes("bh") && !c.mode.startsWith("system") && Object.keys(c.weights).length)
    runs.push({ key: "bh", name: "同比例买入持有", ...simRun(P, sys, c, benchFixed(c.weights)) });
  const anyOverlay = c.overlays.trend || c.overlays.volTarget > 0 || c.overlays.stop > 0;
  const noOv = anyOverlay ? simRun(P, sys, c, { overlays: {} }) : null;
  const { res, m } = main;
  const spy = runs.find((x) => x.key === "SPY");
  const money = (v) => `${v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
  const pnlTotal = res.final - res.invested;

  // 本页重点
  const ins = [];
  if (spy) {
    const d = m.CAGR - spy.m.CAGR, dd = m.MaxDrawdown - spy.m.MaxDrawdown;
    ins.push({ level: d >= 0 ? "good" : "medium", kind: "simulated", target: "c-sim-nav",
      text: `年化 ${pct(m.CAGR, 1)}，SPY ${pct(spy.m.CAGR, 1)}（${d >= 0 ? "高" : "低"} ${Math.abs(d * 100).toFixed(1)} 个百分点）；[[drawdown|最大回撤]] ${pct(m.MaxDrawdown, 1)} vs ${pct(spy.m.MaxDrawdown, 1)}（${dd >= 0 ? "少跌" : "多跌"} ${Math.abs(dd * 100).toFixed(1)} 个百分点）；[[sharpe|夏普]] ${num(m.Sharpe, 2)} vs ${num(spy.m.Sharpe, 2)}。` });
  }
  const contrib = Object.entries(res.pnl).filter(([, v]) => Math.abs(v) > 1).sort((a, b) => b[1] - a[1]);
  if (contrib.length && pnlTotal > 0) {
    const [t, v] = contrib[0];
    ins.push({ level: v / pnlTotal > 0.5 ? "medium" : "info", kind: "simulated", target: "c-sim-contrib",
      text: `盈亏贡献最大：${t}（${money(v)}，占总盈亏 ${pct(v / pnlTotal, 0)}）${v / pnlTotal > 0.5 ? "——结果高度依赖单一标的" : ""}。` });
  }
  if (m.ddPeak) ins.push({ level: "info", kind: "simulated", target: "c-sim-dd",
    text: `最深回撤从 ${m.ddPeak} 开始、${m.ddTrough} 见底（${pct(m.MaxDrawdown, 1)}），${m.ddRecover ? `${m.ddRecover} 收复` : "区间结束时尚未收复"}。` });
  if (noOv) {
    const d = m.CAGR - noOv.m.CAGR, dd = m.MaxDrawdown - noOv.m.MaxDrawdown;
    ins.push({ level: dd > 0 ? "good" : "medium", kind: "simulated",
      text: `风控叠加的效果：与不叠加相比，年化 ${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)} 个百分点，最大回撤 ${dd >= 0 ? "减少" : "增加"} ${Math.abs(dd * 100).toFixed(1)} 个百分点。` });
  }
  if (res.costSum / res.invested > 0.01) ins.push({ level: "medium", kind: "simulated", text: `交易成本累计 ${money(res.costSum)}（占投入 ${pct(res.costSum / res.invested, 1)}），年化[[turnover|换手]] ${num(m.Turnover, 1)} 倍。` });
  const stocks = Object.keys(c.mode.startsWith("system") ? res.pnl : c.weights).filter((t) => P.assets.find((a) => a.ticker === t)?.kind === "stock");
  if (stocks.length) ins.push({ level: "info", kind: "simulated", text: `包含个股：候选股票是今天挑出的公司（[[survivorship|幸存者偏差]]），${c.start < "2019-01-01" ? "且起点较早，" : ""}结果偏乐观。` });

  const kpi = (label, val, sub = "") => `<div class="kpi"><span class="muted">${label}</span><b>${val}</b>${sub ? `<span class="muted">${sub}</span>` : ""}</div>`;
  const metricRow = (x) => `<tr><td>${esc(x.name)}</td><td class="num">${pct(x.m.TotalReturn, 1, true)}</td><td class="num">${pct(x.m.CAGR, 1)}</td><td class="num">${pct(x.m.Volatility, 1)}</td>
    <td class="num">${num(x.m.Sharpe, 2)}</td><td class="num">${num(x.m.Sortino, 2)}</td><td class="num neg">${pct(x.m.MaxDrawdown, 1)}</td><td class="num">${num(x.m.Calmar, 2)}</td>
    <td class="num">${pct(x.m.WinRate, 0)}</td><td class="num">${isNum(x.m.Turnover) ? num(x.m.Turnover, 1) : "–"}</td><td class="num">${money(x.res.final)}</td></tr>`;
  byId("sim-report").innerHTML = `
    ${insightBox(ins)}
    <section class="card"><h3>结果概览（${esc(res.dates[0])} ~ ${esc(res.dates[res.dates.length - 1])}，${num(m.Years, 1)} 年）${badge("simulated")}</h3><div class="kpis">
      ${kpi("期末资产", money(res.final), `投入 ${money(res.invested)}`)}${kpi("盈亏", `<span class="${cls(pnlTotal)}">${money(pnlTotal)}</span>`)}
      ${kpi("总收益（时间加权）", pct(m.TotalReturn, 1, true))}${kpi(term("cagr", "年化收益"), pct(m.CAGR, 1))}
      ${kpi(term("drawdown", "最大回撤"), `<span class="neg">${pct(m.MaxDrawdown, 1)}</span>`)}${kpi(term("sharpe", "夏普比率"), num(m.Sharpe, 2))}
      ${kpi("利息 / 成本", `${money(res.interest)} / ${money(res.costSum)}`)}</div></section>
    ${card("净值（起点 = 1；对数坐标）", chartDiv("c-sim-nav"), "", ["simulated"])}
    <div class="grid two">${card("回撤", chartDiv("c-sim-dd", "short"), "", ["simulated"])}${card("各标的盈亏贡献（金额）", chartDiv("c-sim-contrib", "short"), "", ["simulated"])}</div>
    ${card("指标对比", `<div class="table-wrap"><table><thead><tr><th></th><th class="num">总收益</th><th class="num">年化</th><th class="num">波动</th><th class="num">夏普</th><th class="num">Sortino</th><th class="num">最大回撤</th><th class="num">Calmar</th><th class="num">周胜率</th><th class="num">换手</th><th class="num">期末资产</th></tr></thead><tbody>${runs.map(metricRow).join("")}${noOv ? metricRow({ name: "你的策略（不叠加风控）", ...noOv }) : ""}</tbody></table></div>`, "", ["simulated"])}
    ${card("持仓比例变化（每次调仓后）", chartDiv("c-sim-w"), "", ["simulated"])}
    ${card("月度收益（%）", chartDiv("c-sim-month", "short"), "", ["simulated"])}
    ${card(`交易明细（共 ${res.trades.length} 次调仓）`, `<div class="row"><button type="button" class="ghost" id="sim-csv">下载 CSV</button><span class="muted">金额为正 = 买入，负 = 卖出；按开盘价成交</span></div>
      <div class="table-wrap" style="max-height:360px;overflow:auto"><table><thead><tr><th>日期</th><th>标的</th><th class="num">金额</th><th class="num">开盘价</th></tr></thead><tbody>${[...res.trades].reverse().slice(0, 150).flatMap((tr) => tr.items.map((x) => `<tr><td>${tr.date}</td><td>${esc(x.ticker)}</td><td class="num ${cls(x.amount)}">${money(x.amount)}</td><td class="num">${num(x.price, 2)}</td></tr>`)).join("")}</tbody></table></div>`, "", ["simulated"])}`;
  bindGoto();

  // 净值
  const colors = { main: palette()[0], SPY: BENCH_GRAY(), QQQ: BENCH_GRAY(), bh: palette()[3] };
  const dash = { SPY: "dashed", QQQ: "dotted", bh: "solid" };
  mkChart(byId("c-sim-nav"), {
    tooltip: { trigger: "axis", valueFormatter: (v) => num(v, 3) }, legend: { top: 0 }, grid: { left: 56, right: 100, top: 36, bottom: 40 },
    xAxis: { type: "time" }, yAxis: { type: "log", logBase: 2, scale: true, axisLabel: { formatter: (v) => num(v, 2) } },
    series: [...runs, ...(noOv ? [{ key: "noov", name: "不叠加风控", ...noOv }] : [])].map((x) => ({ name: x.name, type: "line", showSymbol: false,
      data: x.res.dates.map((d, k) => [d, x.res.nav[k]]), color: x.key === "noov" ? palette()[2] : colors[x.key],
      lineStyle: { width: x.key === "main" ? 2 : 1.2, type: x.key === "noov" ? "dotted" : dash[x.key] || "solid" },
      endLabel: { show: true, formatter: (p) => `${p.seriesName.slice(0, 6)} ${num(p.value[1], 2)}`, color: css("--ink-2"), fontSize: 11 },
      labelLayout: { moveOverlap: "shiftY" } })),
  });
  // 回撤
  const dd = Sim.drawdown(res.nav);
  mkChart(byId("c-sim-dd"), {
    tooltip: { trigger: "axis", valueFormatter: (v) => pct(v, 1) }, legend: { show: false }, grid: { left: 52, right: 16, top: 16, bottom: 30 },
    xAxis: { type: "time" }, yAxis: { type: "value", axisLabel: { formatter: (v) => pct(v, 0) } },
    series: [{ type: "line", showSymbol: false, color: css("--neg"), areaStyle: { opacity: 0.15 }, data: res.dates.map((d, k) => [d, dd[k]]),
      markPoint: { symbol: "pin", symbolSize: 34, data: [{ type: "min", name: "最大回撤" }], label: { formatter: (p) => pct(p.value, 0), fontSize: 10 } } },
      ...(spy ? [{ type: "line", showSymbol: false, color: BENCH_GRAY(), lineStyle: { type: "dashed", width: 1 }, name: "SPY", data: spy.res.dates.map((d, k) => [d, Sim.drawdown(spy.res.nav)[k]]) }] : [])],
  });
  // 贡献
  const items = [...contrib, ["利息", res.interest], ["交易成本", -res.costSum]].filter(([, v]) => Math.abs(v) > 0.5);
  byId("c-sim-contrib").style.height = `${Math.max(220, items.length * 22 + 40)}px`;
  mkChart(byId("c-sim-contrib"), {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => money(v) }, legend: { show: false }, grid: { left: 80, right: 60, top: 10, bottom: 20 },
    xAxis: { type: "value", axisLabel: { formatter: (v) => money(v) } }, yAxis: { type: "category", inverse: true, data: items.map(([t]) => t) },
    series: [{ type: "bar", barMaxWidth: 14, data: items.map(([, v]) => ({ value: v, itemStyle: { color: v >= 0 ? css("--pos") : css("--neg"), borderRadius: 3 } })),
      label: { show: true, position: "right", formatter: (p) => money(p.value), fontSize: 10, color: css("--ink-2") } }],
  });
  // 持仓比例
  const allT = [...new Set(res.weightsHist.flatMap((h) => Object.keys(h.weights)))];
  mkChart(byId("c-sim-w"), {
    tooltip: { trigger: "axis", valueFormatter: (v) => pct(v, 1) }, legend: { type: "scroll", top: 0 }, grid: { left: 48, right: 16, top: 40, bottom: 30 },
    xAxis: { type: "time" }, yAxis: { type: "value", max: 1, axisLabel: { formatter: (v) => pct(v, 0) } },
    series: [...allT.map((t, k) => ({ name: t, type: "line", step: "end", stack: "w", showSymbol: false, areaStyle: { opacity: 0.85 }, lineStyle: { width: 0 },
      color: palette()[k % 8], data: res.weightsHist.map((h) => [h.date, h.weights[t] || 0]) })),
    { name: "现金", type: "line", step: "end", stack: "w", showSymbol: false, areaStyle: { opacity: 0.6 }, lineStyle: { width: 0 }, color: OTHER_GRAY(),
      data: res.weightsHist.map((h) => [h.date, Math.max(0, 1 - Object.values(h.weights).reduce((a, b) => a + b, 0))]) }],
  });
  // 月度热力图
  const mon = Sim.monthly(res);
  const years = [...new Set(Object.keys(mon).map((k) => k.slice(0, 4)))];
  const cells = Object.entries(mon).map(([k, v]) => [+k.slice(5, 7) - 1, years.indexOf(k.slice(0, 4)), +(v * 100).toFixed(1)]);
  byId("c-sim-month").style.height = `${Math.max(180, years.length * 26 + 70)}px`;
  const mx = Math.max(5, ...cells.map((x) => Math.abs(x[2])));
  mkChart(byId("c-sim-month"), {
    tooltip: { formatter: (p) => `${years[p.value[1]]} 年 ${p.value[0] + 1} 月：${p.value[2]}%` }, grid: { left: 50, right: 16, top: 10, bottom: 40 },
    xAxis: { type: "category", data: Array.from({ length: 12 }, (_, i) => `${i + 1}月`) }, yAxis: { type: "category", data: years, inverse: true },
    visualMap: { min: -mx, max: mx, calculable: false, orient: "horizontal", left: "center", bottom: 0, itemHeight: 120, inRange: { color: [css("--neg"), css("--surface"), palette()[0]] }, show: false },
    series: [{ type: "heatmap", data: cells, label: { show: true, fontSize: 10, color: css("--ink") }, itemStyle: { borderColor: css("--surface"), borderWidth: 2 } }],
  });
  byId("sim-csv").onclick = () => {
    const lines = ["date,ticker,amount,open_price", ...res.trades.flatMap((tr) => tr.items.map((x) => `${tr.date},${x.ticker},${x.amount.toFixed(2)},${x.price}`))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `sim_trades_${res.dates[0]}_${res.dates[res.dates.length - 1]}.csv`;
    a.click();
  };
}
