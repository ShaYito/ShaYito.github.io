"use strict";
/* 模拟经营 · 策略回测：① 起始仓位 → ② 策略（之后怎么操作）→ ③ 区间与资金 → 收益报告。
   起始仓位视为“开始日已持有”（不计建仓成本），之后按所选策略的节奏调整。设置编码进网址（#/sim?c=...）。 */

const SIM_STRATEGIES = {
  hold: { name: "买入持有", tip: "持有起始仓位，之后不再调整（比例会随涨跌自然变化）。",
    why: "最简单、成本最低，作为其他策略的对照基准。", risk: "涨得多的标的占比越来越大，组合风险可能逐渐集中。" },
  rebalance: { name: "定期再平衡", tip: "定期把各标的调回起始比例（每月 / 每季 / 每年，或偏离超过阈值时）。",
    why: "自动“高卖低买”，把组合风险维持在你设定的水平；这是最被广泛验证、最透明的做法。", risk: "牛市中会卖出涨得多的标的，收益可能略低于买入持有。" },
  invvol: { name: "逆波动率", tip: "只在起始仓位的标的之间，定期按“波动越小给得越多”重新分配（过去 60 日波动）；总仓位与现金比例保持不变。",
    why: "让每个标的对组合波动的贡献更接近，避免一只高波动股票主导组合。", risk: "低波动资产未必收益高；波动突然放大时调整有滞后。" },
  momentum: { name: "动量轮动", tip: "只在起始仓位的标的中，定期持有过去 N 个月（跳过最近 1 个月）涨幅最高的几只，等权；跑输现金的份额留在现金（绝对动量）。",
    why: "“强者恒强”的动量效应是金融学里研究最多、跨市场都存在的现象之一；绝对动量能在长期下跌中退到现金。", risk: "换手高；市场急转弯时会追高杀跌。" },
  system: { name: "按系统每周建议调仓（原版）", tip: "从起始仓位出发，第一个周信号起完全按本系统每周的建议配置调仓（市场状态决定四层比例，卫星层由模型选股）。",
    why: "按市场状态调整仓位在回测中降低了回撤。", risk: "模型选股在样本外没有稳定的预测力；收益受幸存者偏差影响较大。" },
  system_custom: { name: "按系统建议调仓（可调比例）", tip: "沿用本系统每周的市场状态与模型排名，但你可以修改各状态下四层的比例与选股只数（组合构建为简化版）。",
    why: "检验“更保守 / 更激进的配置”在历史上会怎样。", risk: "同原版。" },
};
const SIM_OVERLAYS = {
  trend: { name: "趋势过滤（200 日均线）", tip: "调仓时，价格低于 200 日均线的标的不持有（换成现金）；买入持有时每月检查一次。",
    why: "有长期研究支持（如 Faber 2007）：能避开大部分长期熊市。", risk: "震荡市中会反复卖出又买回，产生交易成本和踏空。" },
  volTarget: { name: "波动率目标", tip: "按目标权重估算组合过去 60 日的年化波动，高于目标时整体按比例降仓（不加杠杆）；每次调仓时重新计算。",
    why: "机构常用的风险控制：市场越动荡仓位越低，明显降低回撤。", risk: "波动回落后才恢复仓位，反弹初期会少赚。" },
  stop: { name: "移动止损", tip: "持仓从持有期间的最高收盘价回落超过设定比例就卖出，直到下一次定期调仓才重新买入。",
    why: "直观、便于执行纪律。", risk: "研究支持弱：单只股票的正常波动也常触发止损，容易卖在低点。仅供对比。" },
};
const SIM_TEMPLATES = {
  mine: { name: "我的持仓（按当前市值比例）" },
  mine_shares: { name: "我的持仓（按股数）" },
  recon: { name: "对账起始持仓（按股数与日期）" },
  system_now: { name: "本系统最新建议配置" },
  spy: { name: "SPY 100%", weights: { SPY: 1 } },
  qqq: { name: "QQQ 100%", weights: { QQQ: 1 } },
  classic: { name: "SPY 60% + GLD 20% + 现金 20%", weights: { SPY: 0.6, GLD: 0.2 } },
  pool_ew: { name: "选股池等权（全部股票）" },
  semis: { name: "半导体等权" },
  ai_infra: { name: "AI 基础设施等权" },
};
const SIM_DEFAULT = { v: 2, posMode: "weight", weights: { SPY: 0.35, QQQ: 0.25, GLD: 0.1, NVDA: 0.1, MSFT: 0.1 }, shares: {}, cash: 0,
  initial: 100000, strategy: "rebalance", freq: "Q", band: 0.05, topN: 3, lookback: 12,
  overlays: { trend: false, trendMA: 200, volTarget: 0, stop: 0 }, monthly: 0, start: "2019-01-01", end: "", costBps: 10,
  bench: ["SPY", "QQQ", "bh"], layers: null, sysTopN: null };
const SIM_HOWTO = [
  "三步：① 设定起始仓位（直接填写比例或股数，或载入模板，例如你的持仓）；② 选择之后怎么操作（策略）；③ 选择历史区间与资金，点“运行模拟”。",
  "起始仓位视为“开始日已经持有”，不计建仓成本；之后按策略的节奏调整（例如每季末再平衡、每周按系统建议调仓），每次买卖按单边成本扣除。",
  "结果是用真实历史价格做的[[simulated|模拟]]：“净值”是[[twr|时间加权收益]]（不受[[dca|定投]]影响），“期末资产 / 盈亏”按你的资金计算。规则与本系统回测一致：收盘产生信号、下一交易日开盘成交，现金按短期国债利率计息，分红再投资，不计税。",
  "候选股票是今天挑出来的公司（[[survivorship|幸存者偏差]]），起点越早、越集中于个股，结果越偏乐观。",
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
function simUpgrade(c) {
  // 兼容旧网址参数（mode / rebalance）
  if (!c || c.v === 2) return c;
  const m = c.mode || "fixed";
  const strategy = m === "fixed" ? (c.rebalance === "none" ? "hold" : "rebalance") : m;
  return { ...c, v: 2, posMode: "weight", strategy, freq: c.rebalance && c.rebalance !== "none" ? c.rebalance : "Q", lookback: c.momentumLookback || 12 };
}
function lastRawClose(P, raw, t, i) {
  if (!P.C[t]) return NaN;
  const px = Recon.rawPrice(P, raw, t);
  for (let k = i; k >= 0; k--) { const v = px.close(k); if (Number.isFinite(v)) return v; }
  return NaN;
}
/* 实盘历史仓位：对账起始持仓 + 每个交易日调仓后的持仓（该日收盘后的状态）。
   现金用对账引擎推算（成交金额、费用、分红、现金利息）；超出价格数据的日期只按成交金额加减。 */
function reconSnapshots(P, raw) {
  const st = loadReconStart();
  if (!st) return [];
  const trades = loadTrades().filter((t) => t.date > st.date).sort((a, b) => a.date.localeCompare(b.date));
  const out = [{ label: `建仓 ${st.date}（对账起始持仓）`, date: st.date, positions: { ...st.positions }, cash: st.cash || 0 }];
  const days = [...new Set(trades.map((t) => t.date))];
  for (const d of days) {
    const upto = trades.filter((t) => t.date <= d);
    let positions, cash, note = "";
    try {
      const r = Recon.reconcile(P, raw, st, upto, { end: d });
      if (P.dates[P.n - 1] < d) throw new Error("beyond");
      positions = Object.fromEntries(Object.entries(r.final_positions).filter(([, v]) => v > 1e-9));
      // 对账只计有行情的标的：把无行情标的按成交记录补回
      const a = Recon.applyTrades(st.positions, st.cash || 0, upto);
      for (const [t, v] of Object.entries(a.positions)) if (!P.C[t] && v > 0) positions[t] = v;
      cash = r.final_cash;
    } catch {
      const a = Recon.applyTrades(st.positions, st.cash || 0, upto);
      positions = a.positions; cash = a.cash; note = "（现金未含分红与利息）";
    }
    const dayT = trades.filter((t) => t.date === d);
    const nFlow = dayT.filter((t) => t.side === "deposit" || t.side === "withdraw").length;
    const nTrade = dayT.length - nFlow;
    const what = [nTrade && `${nTrade} 笔交易`, nFlow && `${nFlow} 笔资金进出`].filter(Boolean).join("、");
    out.push({ label: `${d} ${nTrade ? "调仓后" : "资金变动后"}（${what}）${note}`, date: d, positions, cash: Math.max(0, cash) });
  }
  return out;
}
function nextSessionDate(P, d) {
  let k = -1;
  for (let i = 0; i < P.n && P.dates[i] <= d; i++) k = i;
  return P.dates[Math.min(k + 1, P.n - 1)] || d;
}

/* 起始仓位 → {weights, initial, s, notes}；s = 第一个交易日（持仓按 s-1 收盘估值） */
function simStartPosition(P, raw, c) {
  const s = Math.max(Sim.indexOnOrAfter(P, c.start), P.backtestStart, 1);
  const notes = [];
  if (c.posMode === "shares") {
    let total = c.cash || 0;
    const val = {};
    for (const [t, n] of Object.entries(c.shares || {})) {
      if (!(n > 0)) continue;
      const p = lastRawClose(P, raw, t, s - 1);
      if (!Number.isFinite(p) || !Number.isFinite(P.C[t]?.[s - 1])) { notes.push(`${t} 在 ${P.dates[s - 1]} 没有价格（未上市或不在数据范围），按 0 计`); continue; }
      val[t] = n * p; total += val[t];
    }
    if (total <= 0) throw new Error("起始仓位市值为 0");
    return { weights: Object.fromEntries(Object.entries(val).map(([t, v]) => [t, v / total])), initial: total, s, notes };
  }
  const w = Object.fromEntries(Object.entries(c.weights || {}).filter(([t, x]) => x > 0 && P.C[t]));
  for (const [t, x] of Object.entries(w)) if (!Number.isFinite(P.C[t][s - 1])) { notes.push(`${t} 在 ${P.dates[s - 1]} 还没有价格，其比例按现金计`); delete w[t]; }
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  const weights = sum > 1 ? Object.fromEntries(Object.entries(w).map(([t, x]) => [t, x / sum])) : w;
  return { weights, initial: Math.max(100, c.initial || 100000), s, notes };
}
function simEngineCfg(c, w) {
  const base = { overlays: c.overlays || {}, holdStart: true, initialWeights: w };
  switch (c.strategy) {
    case "hold": return { ...base, mode: "fixed", weights: w, rebalance: "none" };
    case "rebalance": return { ...base, mode: "fixed", weights: w, rebalance: c.freq, band: c.band };
    case "invvol": return { ...base, mode: "invvol", weights: w, rebalance: c.freq === "band" ? "M" : c.freq };
    case "momentum": return { ...base, mode: "momentum", weights: w, rebalance: c.freq === "band" ? "M" : c.freq, topN: c.topN, momentumLookback: c.lookback };
    case "system": return { ...base, mode: "system" };
    case "system_custom": return { ...base, mode: "system_custom", layers: c.layers, topN: c.sysTopN };
    default: return { ...base, mode: "fixed", weights: w, rebalance: "none" };
  }
}

PAGES.sim = async (r) => {
  if (r.query.tab === "recon") return renderRecon();
  const { P, raw, sys } = await simData();
  const cfg = { ...structuredClone(SIM_DEFAULT), ...(r.query.c ? simUpgrade(simDecode(r.query.c)) || {} : {}) };
  cfg.overlays = { ...SIM_DEFAULT.overlays, ...(cfg.overlays || {}) };
  if (!cfg.end) cfg.end = P.dates[P.n - 1];
  const first = P.dates[Math.max(P.backtestStart, 1)];
  const lastDate = P.dates[P.n - 1];
  const nameOf = (t) => `${t}${META.names_zh?.[t] ? ` ${META.names_zh[t]}` : ""}`;
  const assetOpts = P.assets.map((a) => `<option value="${a.ticker}">${esc(nameOf(a.ticker))}${a.kind === "etf" ? "（ETF）" : ""}</option>`).join("");
  const layerRows = sys ? ["risk_on", "neutral", "risk_off"].map((rg) => {
    const lw = (cfg.layers && cfg.layers[rg]) || sys.regime_weights[rg];
    return `<tr><td>${esc(REGIME_ZH[rg])}</td>${["core", "satellite", "hedge", "cash"].map((k) => `<td><input type="number" class="sim-layer" data-rg="${rg}" data-k="${k}" min="0" max="100" step="1" value="${Math.round(lw[k] * 100)}" style="width:64px">%</td>`).join("")}</tr>`;
  }).join("") : "";
  const histSnaps = reconSnapshots(P, raw);
  const stratRadios = Object.entries(SIM_STRATEGIES).filter(([k]) => sys || !k.startsWith("system")).map(([k, s]) =>
    `<label class="sim-strat"><input type="radio" name="sim-strat" value="${k}" ${k === cfg.strategy ? "checked" : ""}> <b>${esc(s.name)}</b><span class="muted">${esc(s.tip)}</span></label>`).join("");
  app().innerHTML = `
    <h2>模拟经营 <span class="muted">用真实历史价格检验“某个仓位 + 某种操作方式”的结果 · 数据 ${esc(first)} ~ ${esc(lastDate)}</span></h2>
    ${simTabs("bt")}${howto(SIM_HOWTO)}
    <section class="card" id="sim-form"><h3>① 起始仓位 ${badge("simulated")}</h3>
      <div class="row"><label>载入模板 <select id="sim-tpl"><option value="">— 选择 —</option>${Object.entries(SIM_TEMPLATES).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join("")}
        ${histSnaps.length ? `<optgroup label="实盘历史仓位（来自实盘对账）">${histSnaps.map((h, i) => `<option value="hist:${i}">${esc(h.label)}</option>`).join("")}</optgroup>` : ""}</select></label>
        <span class="muted" id="sim-tpl-msg"></span></div>
      <div class="row"><span class="muted">输入方式</span><div class="seg" id="sim-posmode"><button type="button" data-m="weight">按比例</button><button type="button" data-m="shares">按股数</button></div>
        <span class="muted" id="sim-posmode-tip"></span></div>
      <div class="table-wrap"><table><tbody id="sim-assets"></tbody></table></div>
      <div class="row"><select id="sim-add">${assetOpts}</select><button type="button" class="ghost" id="sim-add-btn">添加标的</button>
        <button type="button" class="ghost" id="sim-eq-btn">等权</button><button type="button" class="ghost" id="sim-clear-btn">清空</button></div>
      <div class="row" id="sim-money-row"></div>
      <h3 style="margin-top:18px">② 策略：之后怎么操作</h3>
      <div class="sim-strats">${stratRadios}</div>
      <div class="row" id="sim-freq-box"><label>调整频率 <select id="sim-freq">${[["W", "每周"], ["M", "每月"], ["Q", "每季"], ["Y", "每年"], ["band", "偏离超过阈值时（每周检查）"]].map(([k, n]) => `<option value="${k}" ${k === cfg.freq ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label id="sim-band-l">阈值 <input type="number" id="sim-band" min="1" max="30" value="${Math.round(cfg.band * 100)}" style="width:60px"> 个百分点</label></div>
      <p class="muted" id="sim-rhythm"></p>
      <div class="row" id="sim-mom-box"><label>持有前 <input type="number" id="sim-topn" min="1" max="20" value="${cfg.topN}" style="width:60px"> 只</label>
        <label>回看 <input type="number" id="sim-lookback" min="3" max="12" value="${cfg.lookback}" style="width:60px"> 个月（跳过最近 1 个月）</label></div>
      <div id="sim-sys-box">${sys ? `<div class="table-wrap"><table><thead><tr><th>市场状态</th><th>核心 SPY</th><th>卫星（模型选股）</th><th>对冲 GLD</th><th>现金</th></tr></thead><tbody>${layerRows}</tbody></table></div>
        <div class="row"><label>卫星选股只数 <input type="number" id="sim-sys-topn" min="1" max="15" value="${cfg.sysTopN || sys.top_n}" style="width:60px"></label></div>` : ""}</div>
      <details class="howto"><summary>可选：风控叠加（在任何策略之上再加一层风险控制）</summary>
        <div class="row"><label><input type="checkbox" id="sim-trend" ${cfg.overlays.trend ? "checked" : ""}> ${SIM_OVERLAYS.trend.name}</label>
          <label><input type="checkbox" id="sim-vt-on" ${cfg.overlays.volTarget > 0 ? "checked" : ""}> ${SIM_OVERLAYS.volTarget.name} <input type="number" id="sim-vt" min="3" max="40" value="${Math.round((cfg.overlays.volTarget || 0.12) * 100)}" style="width:56px">%</label>
          <label><input type="checkbox" id="sim-stop-on" ${cfg.overlays.stop > 0 ? "checked" : ""}> ${SIM_OVERLAYS.stop.name} <input type="number" id="sim-stop" min="3" max="50" value="${Math.round((cfg.overlays.stop || 0.15) * 100)}" style="width:56px">%</label></div></details>
      <details class="howto"><summary>各策略与风控的逻辑、可靠性说明</summary>${[...Object.values(SIM_STRATEGIES), ...Object.values(SIM_OVERLAYS)].map((s) => `<p><b>${esc(s.name)}</b>：${esc(s.tip)}<br><span class="pos">为什么可能有效：</span>${esc(s.why)}<br><span class="neg">局限：</span>${esc(s.risk)}</p>`).join("")}</details>
      <h3 style="margin-top:18px">③ 区间与资金</h3>
      <div class="row"><label>开始 <input type="date" id="sim-start" min="${first}" max="${lastDate}" value="${esc(cfg.start)}"></label>
        <label>结束 <input type="date" id="sim-end" min="${first}" max="${lastDate}" value="${esc(cfg.end)}"></label>
        <div class="seg" id="sim-quick">${[["2016-01-01", "2016 起"], ["2019-01-01", "2019 起（样本外）"], ["3y", "近 3 年"], ["1y", "近 1 年"], ["2022", "2022 熊市"], ["2020", "2020 疫情"]].map(([k, n]) => `<button type="button" data-q="${k}">${n}</button>`).join("")}</div></div>
      <div class="row"><label>每月定投 <input type="number" id="sim-monthly" min="0" step="100" value="${cfg.monthly}" style="width:90px"></label>
        <label>成本 <input type="number" id="sim-cost" min="0" max="100" step="1" value="${cfg.costBps}" style="width:56px"> bps（单边）</label>
        对比：${[["SPY", "SPY 买入持有"], ["QQQ", "QQQ 买入持有"], ["bh", "起始仓位买入持有"]].map(([k, n]) => `<label><input type="checkbox" class="sim-bench" value="${k}" ${cfg.bench.includes(k) ? "checked" : ""}> ${n}</label>`).join("")}</div>
      <div class="row"><button type="button" id="sim-run" class="primary">运行模拟</button><span class="muted" id="sim-status"></span></div>
    </section>
    <div id="sim-report"></div>`;

  // ---------- 表单状态 ----------
  let posMode = cfg.posMode === "shares" ? "shares" : "weight";
  let weights = { ...(cfg.weights || {}) };
  let shares = { ...(cfg.shares || {}) };
  let cash = cfg.cash || 0;
  const priceAtStart = (t) => {
    const s = Math.max(Sim.indexOnOrAfter(P, byId("sim-start").value || cfg.start), P.backtestStart, 1);
    return lastRawClose(P, raw, t, s - 1);
  };
  const drawAssets = () => {
    document.querySelectorAll("#sim-posmode button").forEach((b) => b.classList.toggle("on", b.dataset.m === posMode));
    byId("sim-posmode-tip").textContent = posMode === "weight" ? "填写各标的占总资产的比例，其余为现金" : "填写开始日持有的股数（按拆股调整后的口径）与现金，按开始日收盘价折算市值与比例";
    const list = posMode === "weight" ? weights : shares;
    const rows = Object.entries(list).map(([t, v]) => {
      const input = posMode === "weight"
        ? `<input type="number" class="sim-w" data-t="${t}" min="0" max="100" step="1" value="${+(v * 100).toFixed(1)}" style="width:72px"> %`
        : `<input type="number" class="sim-w" data-t="${t}" min="0" step="1" value="${v}" style="width:90px"> 股 <span class="muted">≈ ${(() => { const p = priceAtStart(t); return Number.isFinite(p) ? (v * p).toLocaleString("zh-CN", { maximumFractionDigits: 0 }) : "开始日无价格"; })()}</span>`;
      return `<tr><td>${esc(nameOf(t))}</td><td>${input}</td><td><button type="button" class="ghost sim-del" data-t="${t}">移除</button></td></tr>`;
    }).join("");
    byId("sim-assets").innerHTML = rows || `<tr><td class="muted">尚未添加标的（全部为现金）</td></tr>`;
    if (posMode === "weight") {
      const s = Object.values(weights).reduce((a, b) => a + b, 0);
      byId("sim-money-row").innerHTML = `<label>初始资金 <input type="number" id="sim-initial" min="100" step="1000" value="${cfg.initial}" style="width:120px"></label>
        <span class="muted">比例合计 ${pct(s, 0)}，现金 ${pct(Math.max(0, 1 - s), 0)}${s > 1.0001 ? '（超过 100%，运行时按比例缩放）' : ""}</span>`;
      byId("sim-initial").onchange = (e) => { cfg.initial = +e.target.value || 100000; };
    } else {
      const tot = Object.entries(shares).reduce((a, [t, n]) => { const p = priceAtStart(t); return a + (Number.isFinite(p) ? n * p : 0); }, 0) + cash;
      byId("sim-money-row").innerHTML = `<label>现金 <input type="number" id="sim-cash" min="0" step="100" value="${cash}" style="width:120px"></label>
        <span class="muted">按开始日（${esc(byId("sim-start").value || cfg.start)}）收盘价折算的起始市值 ≈ ${tot.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}</span>`;
      byId("sim-cash").onchange = (e) => { cash = Math.max(0, +e.target.value || 0); drawAssets(); };
    }
    document.querySelectorAll(".sim-w").forEach((el) => (el.onchange = () => {
      if (posMode === "weight") weights[el.dataset.t] = Math.max(0, +el.value || 0) / 100; else shares[el.dataset.t] = Math.max(0, +el.value || 0);
      drawAssets();
    }));
    document.querySelectorAll(".sim-del").forEach((el) => (el.onclick = () => { delete (posMode === "weight" ? weights : shares)[el.dataset.t]; drawAssets(); }));
  };
  const syncStrategy = () => {
    const k = document.querySelector('input[name="sim-strat"]:checked')?.value || "hold";
    byId("sim-freq-box").style.display = ["rebalance", "invvol", "momentum"].includes(k) ? "" : "none";
    byId("sim-band-l").style.display = k === "rebalance" && byId("sim-freq").value === "band" ? "" : "none";
    [...byId("sim-freq").options].forEach((o) => { o.disabled = o.value === "band" && k !== "rebalance"; });
    byId("sim-mom-box").style.display = k === "momentum" ? "" : "none";
    byId("sim-sys-box").style.display = k === "system_custom" ? "" : "none";
    const f = byId("sim-freq").value;
    const fz = { W: "每周最后一个交易日", M: "每月最后一个交易日", Q: "每季最后一个交易日", Y: "每年最后一个交易日" }[f];
    byId("sim-rhythm").textContent = {
      hold: "调仓节奏：不调仓（叠加趋势过滤时每月检查一次均线）。",
      system: "调仓节奏：固定每周——周五（或当周最后一个交易日）收盘产生系统信号，下一个交易日开盘成交；与本系统周报一致，频率不可调。",
      system_custom: "调仓节奏：固定每周——与系统周报相同，只是四层比例与选股只数按你的设定。",
    }[k] || (f === "band"
      ? "调仓节奏：每周检查一次，只有某个标的比例偏离目标超过阈值才调仓。"
      : `调仓节奏：${fz}收盘产生信号，下一个交易日开盘成交。通用策略常用每月或每季；频率越高换手与成本越高，效果不一定更好。`);
  };
  document.querySelectorAll('input[name="sim-strat"]').forEach((el) => (el.onchange = syncStrategy));
  byId("sim-freq").onchange = syncStrategy;
  document.querySelectorAll("#sim-posmode button").forEach((b) => (b.onclick = () => { posMode = b.dataset.m; drawAssets(); }));
  byId("sim-start").onchange = () => { if (posMode === "shares") drawAssets(); };
  byId("sim-add-btn").onclick = () => {
    const t = byId("sim-add").value;
    if (posMode === "weight") { if (!(t in weights)) weights[t] = 0.1; } else if (!(t in shares)) shares[t] = 10;
    drawAssets();
  };
  byId("sim-eq-btn").onclick = () => {
    if (posMode !== "weight") { byId("sim-tpl-msg").textContent = "等权仅用于按比例输入"; return; }
    const k = Object.keys(weights); k.forEach((t) => (weights[t] = 1 / k.length)); drawAssets();
  };
  byId("sim-clear-btn").onclick = () => { if (posMode === "weight") weights = {}; else { shares = {}; cash = 0; } drawAssets(); };
  byId("sim-tpl").onchange = (e) => {
    const k = e.target.value;
    const msg = byId("sim-tpl-msg");
    msg.textContent = "";
    const eq = (list) => Object.fromEntries(list.map((t) => [t, 1 / list.length]));
    if (k === "mine" || k === "mine_shares") {
      const hh = loadHoldings();
      if (!hh) { msg.textContent = "本机没有“我的持仓”：请先在“我的持仓”页填写并保存"; return; }
      if (k === "mine_shares") {
        posMode = "shares"; shares = { ...hh.positions }; cash = hh.cash || 0;
        msg.textContent = "已按股数载入：表示“开始日就持有这些股数”，市值按开始日价格计算";
      } else {
        const vals = Object.entries(hh.positions).map(([t, n]) => [t, n * lastRawClose(P, raw, t, P.n - 1)]).filter(([, v]) => v > 0);
        const skipped = Object.keys(hh.positions).filter((t) => !P.C[t]);
        const tot = vals.reduce((a, [, v]) => a + v, 0) + (hh.cash || 0);
        posMode = "weight"; weights = Object.fromEntries(vals.map(([t, v]) => [t, v / tot])); cfg.initial = Math.round(tot);
        msg.textContent = `已按当前市值比例载入（初始资金 = 当前总资产 ${Math.round(tot).toLocaleString("zh-CN")}）${skipped.length ? `；${skipped.join("、")} 无历史数据，按现金处理` : ""}`;
      }
    } else if (k.startsWith("hist:")) {
      const h = histSnaps[+k.slice(5)];
      posMode = "shares"; shares = { ...h.positions }; cash = Math.round(h.cash * 100) / 100;
      const sd = nextSessionDate(P, h.date);
      byId("sim-start").value = sd;
      msg.textContent = `已载入 ${h.label} 的仓位（该日收盘后），开始日期设为下一个交易日 ${sd}`;
    } else if (k === "recon") {
      const st = loadReconStart();
      if (!st) { msg.textContent = "还没有对账起始持仓：请先在“实盘对账”标签设置"; return; }
      posMode = "shares"; shares = { ...st.positions }; cash = st.cash || 0;
      const sd = nextSessionDate(P, st.date);
      byId("sim-start").value = sd;
      msg.textContent = `已载入 ${st.date} 收盘后的对账起始持仓，开始日期设为下一个交易日 ${sd}`;
    } else if (k === "system_now" && sys) { posMode = "weight"; weights = { ...sys.targets[sys.targets.length - 1] }; }
    else if (k === "pool_ew") { posMode = "weight"; weights = eq(META.universe.map((x) => x.ticker)); }
    else if (k === "semis") { posMode = "weight"; weights = eq(META.universe.filter((x) => x.theme === "semiconductors").map((x) => x.ticker)); }
    else if (k === "ai_infra") { posMode = "weight"; weights = eq(META.universe.filter((x) => x.theme === "ai_infrastructure").map((x) => x.ticker)); }
    else if (SIM_TEMPLATES[k]?.weights) { posMode = "weight"; weights = { ...SIM_TEMPLATES[k].weights }; }
    drawAssets();
  };
  document.querySelectorAll("#sim-quick button").forEach((b) => (b.onclick = () => {
    const q = b.dataset.q;
    const back = (y) => { const d = new Date(lastDate); d.setFullYear(d.getFullYear() - y); return d.toISOString().slice(0, 10); };
    const [s, e] = q === "3y" ? [back(3), lastDate] : q === "1y" ? [back(1), lastDate] : q === "2022" ? ["2022-01-01", "2022-12-31"] : q === "2020" ? ["2020-01-01", "2020-12-31"] : [q, lastDate];
    byId("sim-start").value = s < first ? first : s; byId("sim-end").value = e;
    if (posMode === "shares") drawAssets();
  }));
  drawAssets(); syncStrategy();

  const readCfg = () => {
    const c = {
      v: 2, posMode, weights: { ...weights }, shares: { ...shares }, cash,
      initial: Math.max(100, +(byId("sim-initial")?.value || cfg.initial) || 100000),
      strategy: document.querySelector('input[name="sim-strat"]:checked')?.value || "hold",
      freq: byId("sim-freq").value, band: (+byId("sim-band").value || 5) / 100,
      topN: +byId("sim-topn").value || 3, lookback: +byId("sim-lookback").value || 12,
      overlays: { trend: byId("sim-trend").checked, trendMA: 200, volTarget: byId("sim-vt-on").checked ? (+byId("sim-vt").value || 12) / 100 : 0,
        stop: byId("sim-stop-on").checked ? (+byId("sim-stop").value || 15) / 100 : 0 },
      monthly: Math.max(0, +byId("sim-monthly").value || 0),
      start: byId("sim-start").value || first, end: byId("sim-end").value || lastDate, costBps: Math.max(0, +byId("sim-cost").value || 0),
      bench: [...document.querySelectorAll(".sim-bench:checked")].map((x) => x.value), layers: null, sysTopN: null,
    };
    if (c.strategy === "system_custom" && sys) {
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
  const { raw } = SIM_DATA;
  const sp = cc.startPos || simStartPosition(P, raw, cc);
  const strat = Sim.makeStrategy(P, simEngineCfg(cc, sp.weights), sys);
  const end = Sim.indexOnOrBefore(P, cc.end);
  if (end - sp.s < 5) throw new Error("区间太短（至少一周）");
  const res = Sim.run(P, strat, { start: sp.s, end, costBps: cc.costBps, initial: sp.initial, monthly: cc.monthly, initialWeights: sp.weights });
  return { res, m: Sim.metrics(P, res), sp };
}
function simSummary(c, sp, res) {
  const strat = SIM_STRATEGIES[c.strategy]?.name || c.strategy;
  const freq = { M: "每月", Q: "每季", Y: "每年", band: `偏离超过 ${Math.round(c.band * 100)} 个百分点时` }[c.freq];
  const detail = c.strategy === "rebalance" ? `（${freq}调回起始比例）` : ["invvol", "momentum"].includes(c.strategy) ? `（${freq}调整${c.strategy === "momentum" ? `，持有前 ${c.topN} 只` : ""}）` : "";
  const top = Object.entries(sp.weights).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, w]) => `${t} ${pct(w, 0)}`).join("、");
  const cashW = 1 - Object.values(sp.weights).reduce((a, b) => a + b, 0);
  const ov = [c.overlays.trend && "趋势过滤", c.overlays.volTarget > 0 && `波动率目标 ${Math.round(c.overlays.volTarget * 100)}%`, c.overlays.stop > 0 && `移动止损 ${Math.round(c.overlays.stop * 100)}%`].filter(Boolean);
  return `从 ${res.dates[0]} 起持有 ${top || "现金"}${Object.keys(sp.weights).length > 5 ? " 等" : ""}${cashW > 0.005 ? `（现金 ${pct(cashW, 0)}）` : ""}，起始资金 ${Math.round(sp.initial).toLocaleString("zh-CN")}；按「${strat}」${detail}${ov.length ? `，叠加${ov.join("、")}` : ""}${c.monthly > 0 ? `，每月定投 ${c.monthly.toLocaleString("zh-CN")}` : ""}，到 ${res.dates[res.dates.length - 1]}：`;
}
function renderSimReport(P, sys, c) {
  const main = simRun(P, sys, c);
  const sp = main.sp;
  const runs = [{ key: "main", name: "你的策略", ...main }];
  // 对比基准：同一起始资金，开始日直接持有（与主策略口径一致，不计建仓成本）
  const bench = (w) => ({ strategy: "hold", overlays: {}, startPos: { ...sp, weights: w } });
  if (c.bench.includes("SPY")) runs.push({ key: "SPY", name: "SPY 买入持有", ...simRun(P, sys, c, bench({ SPY: 1 })) });
  if (c.bench.includes("QQQ")) runs.push({ key: "QQQ", name: "QQQ 买入持有", ...simRun(P, sys, c, bench({ QQQ: 1 })) });
  const anyOverlay = c.overlays.trend || c.overlays.volTarget > 0 || c.overlays.stop > 0;
  if (c.bench.includes("bh") && (c.strategy !== "hold" || anyOverlay) && Object.keys(sp.weights).length)
    runs.push({ key: "bh", name: "起始仓位买入持有", ...simRun(P, sys, c, bench(sp.weights)) });
  const noOv = anyOverlay ? simRun(P, sys, c, { overlays: {}, startPos: sp }) : null;
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
    const isStock = P.assets.find((x) => x.ticker === t)?.kind === "stock";
    const conc = v / pnlTotal > 0.5 && isStock;
    ins.push({ level: conc ? "medium" : "info", kind: "simulated", target: "c-sim-contrib",
      text: `盈亏贡献最大：${t}（${money(v)}，占总盈亏 ${pct(v / pnlTotal, 0)}）${conc ? "——结果高度依赖单一个股" : ""}。` });
  }
  if (m.ddPeak) ins.push({ level: "info", kind: "simulated", target: "c-sim-dd",
    text: `最深回撤从 ${m.ddPeak} 开始、${m.ddTrough} 见底（${pct(m.MaxDrawdown, 1)}），${m.ddRecover ? `${m.ddRecover} 收复` : "区间结束时尚未收复"}。` });
  if (noOv) {
    const d = m.CAGR - noOv.m.CAGR, dd = m.MaxDrawdown - noOv.m.MaxDrawdown;
    ins.push({ level: dd > 0 ? "good" : "medium", kind: "simulated",
      text: `风控叠加的效果：与不叠加相比，年化 ${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)} 个百分点，最大回撤 ${dd >= 0 ? "减少" : "增加"} ${Math.abs(dd * 100).toFixed(1)} 个百分点。` });
  }
  if (res.costSum / res.invested > 0.01) ins.push({ level: "medium", kind: "simulated", text: `交易成本累计 ${money(res.costSum)}（占投入 ${pct(res.costSum / res.invested, 1)}），年化[[turnover|换手]] ${num(m.Turnover, 1)} 倍。` });
  const stocks = Object.keys(res.pnl).filter((t) => Math.abs(res.pnl[t]) > 0 && P.assets.find((a) => a.ticker === t)?.kind === "stock");
  sp.notes.forEach((n) => ins.push({ level: "medium", kind: "simulated", text: n }));
  if (stocks.length) ins.push({ level: "info", kind: "simulated", text: `包含个股：候选股票是今天挑出的公司（[[survivorship|幸存者偏差]]），${c.start < "2019-01-01" ? "且起点较早，" : ""}结果偏乐观。` });

  const rebal = res.trades.filter((t) => !t.contribution);
  const contribN = res.trades.length - rebal.length;
  const gaps = rebal.slice(1).map((t, k) => (P.idx[t.date] - P.idx[rebal[k].date]));
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  const rhythmSummary = rebal.length
    ? `共 ${rebal.length} 次调仓${avgGap ? `，平均每 ${avgGap.toFixed(0)} 个交易日一次（约 ${(avgGap / 5).toFixed(1)} 周）` : ""}；年化换手 ${isNum(m.Turnover) ? num(m.Turnover, 1) : "–"} 倍；交易成本合计 ${money(res.costSum)}。换手 = 调仓时买卖金额合计的一半占总资产的比例。`
    : "区间内没有调仓（买入持有且未触发风控）。";
  const changeText = (t) => {
    if (t.contribution) return t.items.map((x) => `${x.ticker} +${money(x.amount)}`).join("、");
    const keys = [...new Set([...Object.keys(t.before || {}), ...Object.keys(t.after || {})])];
    return keys.map((k) => ({ k, a: (t.before || {})[k] || 0, b: (t.after || {})[k] || 0 })).filter((x) => Math.abs(x.b - x.a) >= 0.001)
      .sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a)).slice(0, 6)
      .map((x) => `${x.k} ${x.a < 0.0005 ? "新进 " : ""}${pct(x.a, 1)}→${pct(x.b, 1)}${x.b < 0.0005 ? "（清仓）" : ""}`).join("；") || "比例微调";
  };
  const kpi = (label, val, sub = "") => `<div class="kpi"><span class="muted">${label}</span><b>${val}</b>${sub ? `<span class="muted">${sub}</span>` : ""}</div>`;
  const metricRow = (x) => `<tr><td>${esc(x.name)}</td><td class="num">${pct(x.m.TotalReturn, 1, true)}</td><td class="num">${pct(x.m.CAGR, 1)}</td><td class="num">${pct(x.m.Volatility, 1)}</td>
    <td class="num">${num(x.m.Sharpe, 2)}</td><td class="num">${num(x.m.Sortino, 2)}</td><td class="num neg">${pct(x.m.MaxDrawdown, 1)}</td><td class="num">${num(x.m.Calmar, 2)}</td>
    <td class="num">${pct(x.m.WinRate, 0)}</td><td class="num">${isNum(x.m.Turnover) ? num(x.m.Turnover, 1) : "–"}</td><td class="num">${money(x.res.final)}</td></tr>`;
  byId("sim-report").innerHTML = `
    ${insightBox(ins)}
    <section class="card"><h3>结果概览（${esc(res.dates[0])} ~ ${esc(res.dates[res.dates.length - 1])}，${num(m.Years, 1)} 年）${badge("simulated")}</h3>
      <p>${esc(simSummary(c, sp, res))}期末资产 <b>${money(res.final)}</b>，${pnlTotal >= 0 ? "盈利" : "亏损"} <b class="${cls(pnlTotal)}">${money(Math.abs(pnlTotal))}</b>（年化 ${pct(m.CAGR, 1)}，最大回撤 ${pct(m.MaxDrawdown, 1)}）。</p><div class="kpis">
      ${kpi("期末资产", money(res.final), `投入 ${money(res.invested)}`)}${kpi("盈亏", `<span class="${cls(pnlTotal)}">${money(pnlTotal)}</span>`)}
      ${kpi("总收益（时间加权）", pct(m.TotalReturn, 1, true))}${kpi(term("cagr", "年化收益"), pct(m.CAGR, 1))}
      ${kpi(term("drawdown", "最大回撤"), `<span class="neg">${pct(m.MaxDrawdown, 1)}</span>`)}${kpi(term("sharpe", "夏普比率"), num(m.Sharpe, 2))}
      ${kpi("利息 / 成本", `${money(res.interest)} / ${money(res.costSum)}`)}</div></section>
    ${card("净值（起点 = 1；对数坐标）", chartDiv("c-sim-nav"), "", ["simulated"])}
    <div class="grid two">${card("回撤", chartDiv("c-sim-dd", "short"), "", ["simulated"])}${card("各标的盈亏贡献（金额）", chartDiv("c-sim-contrib", "short"), "", ["simulated"])}</div>
    ${card("指标对比", `<div class="table-wrap"><table><thead><tr><th></th><th class="num">总收益</th><th class="num">年化</th><th class="num">波动</th><th class="num">夏普</th><th class="num">Sortino</th><th class="num">最大回撤</th><th class="num">Calmar</th><th class="num">周胜率</th><th class="num">换手</th><th class="num">期末资产</th></tr></thead><tbody>${runs.map(metricRow).join("")}${noOv ? metricRow({ name: "你的策略（不叠加风控）", ...noOv }) : ""}</tbody></table></div>`, "", ["simulated"])}
    ${card("持仓比例变化（每次调仓后）", chartDiv("c-sim-w"), "", ["simulated"])}
    ${card("月度收益（%）", chartDiv("c-sim-month", "short"), "", ["simulated"])}
    ${card(`调仓日志（${rebal.length} 次调仓${contribN ? `，另有 ${contribN} 次定投买入` : ""}）`, `<p class="muted">${esc(rhythmSummary)}</p>
      <div class="row"><button type="button" class="ghost" id="sim-csv">下载全部明细 CSV</button>${contribN ? '<label><input type="checkbox" id="sim-log-contrib"> 显示定投</label>' : ""}
        <span class="muted">信号日收盘产生信号 → 成交日开盘成交；“主要变化”为调仓前后占总资产比例（按变化大小取前 6 项）</span></div>
      <div class="table-wrap" style="max-height:420px;overflow:auto"><table><thead><tr><th>成交日</th><th>信号日</th><th>原因</th><th>主要变化</th><th class="num">换手</th><th class="num">成本</th></tr></thead><tbody id="sim-log"></tbody></table></div>
      <details class="howto"><summary>每笔买卖金额</summary><div class="table-wrap" style="max-height:360px;overflow:auto"><table><thead><tr><th>日期</th><th>标的</th><th class="num">金额</th><th class="num">开盘价</th></tr></thead><tbody>${[...res.trades].reverse().slice(0, 200).flatMap((tr) => tr.items.map((x) => `<tr><td>${tr.date}</td><td>${esc(x.ticker)}</td><td class="num ${cls(x.amount)}">${money(x.amount)}</td><td class="num">${num(x.price, 2)}</td></tr>`)).join("")}</tbody></table></div></details>`, "", ["simulated"])}`;
  const drawLog = () => {
    const showC = byId("sim-log-contrib")?.checked;
    const list = [...res.trades].filter((t) => showC || !t.contribution).reverse();
    byId("sim-log").innerHTML = list.map((t) => `<tr><td>${esc(t.date)}</td><td>${esc(t.signal || "–")}</td><td class="wrap">${esc(t.reason || "")}</td>
      <td class="wrap">${esc(changeText(t))}</td><td class="num">${t.contribution ? "–" : pct(t.turnover / 2, 1)}</td><td class="num">${num(t.cost, 2)}</td></tr>`).join("")
      || '<tr><td colspan="6" class="muted">区间内没有调仓</td></tr>';
  };
  drawLog();
  byId("sim-log-contrib")?.addEventListener("change", drawLog);
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
      labelLayout: { moveOverlap: "shiftY" } })).concat(rebal.length && rebal.length <= 150 ? [{
        name: "调仓", type: "scatter", symbolSize: 6, color: palette()[0], z: 5,
        data: rebal.map((t) => ({ value: [t.date, res.nav[res.dates.indexOf(t.date)]], reason: t.reason })),
        tooltip: { trigger: "item", formatter: (p) => `${p.value[0]} 调仓<br>${esc(p.data.reason || "")}` } }] : []),
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
    const q = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
    const lines = ["exec_date,signal_date,reason,ticker,amount,open_price,weight_before,weight_after",
      ...res.trades.flatMap((tr) => tr.items.map((x) => [tr.date, tr.signal || "", q(tr.reason), x.ticker, x.amount.toFixed(2), x.price,
        ((tr.before || {})[x.ticker] || 0).toFixed(4), ((tr.after || {})[x.ticker] || 0).toFixed(4)].join(",")))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `sim_trades_${res.dates[0]}_${res.dates[res.dates.length - 1]}.csv`;
    a.click();
  };
}

// ---------------- 实盘对账 ----------------
const TRADES_KEY = "invest.trades.v1";
const RECON_START_KEY = "invest.recon.start.v1";
const RECON_HOWTO = [
  "用你的真实调仓来检验模拟运算：从一份“起始持仓”出发，录入之后每一笔实际交易（日期、买卖、股数、成交价、费用），系统同时计算两条资产曲线——",
  "① 实际：按原始股价估值，按你的成交价与费用成交，除息日收到现金分红；② 模拟：同一起始持仓、在同一天调到同样的比例，但按模拟经营的规则成交（当天开盘价、单边 0.1% 成本、分红再投资）。",
  "两条曲线的差额被拆成：成交价差（你的成交价 vs 当天开盘价）、费用差（实际费用 vs 模拟成本假设）、现金利息差、其他（差额在之后的复利、分红到账方式、整股等）。没有交易时两条曲线应完全一致；差额主要来自成交价和费用，说明模拟的规则是对的，只是成交假设和你的实际不同。",
  "期间有资金转入转出时，在交易记录里选“存入现金 / 取出现金”并填金额：它在当天开盘前同时计入实际与模拟两条曲线，不会被算成差额。",
  "数据只保存在本机浏览器。录完交易后可点“应用到我的持仓”更新股数与现金，再到“我的持仓”页同步到后台（现金请以券商显示为准）。",
];
function loadTrades() { try { return JSON.parse(localStorage.getItem(TRADES_KEY) || "[]"); } catch { return []; } }
function saveTrades(t) { try { localStorage.setItem(TRADES_KEY, JSON.stringify(t)); } catch { /* 忽略 */ } }
function loadReconStart() { try { return JSON.parse(localStorage.getItem(RECON_START_KEY) || "null"); } catch { return null; } }
function saveReconStart(s) { try { localStorage.setItem(RECON_START_KEY, JSON.stringify(s)); } catch { /* 忽略 */ } }
function simTabs(active) {
  return `<div class="seg" style="margin-bottom:12px"><button type="button" class="${active === "bt" ? "on" : ""}" onclick="location.hash='#/sim'">策略回测</button>
    <button type="button" class="${active === "recon" ? "on" : ""}" onclick="location.hash='#/sim?tab=recon'">实盘对账</button></div>`;
}

async function renderRecon() {
  const { P, raw } = await simData();
  let start = loadReconStart();
  const mine = loadHoldings();
  if (!start && mine) { start = { date: mine.date, positions: { ...mine.positions }, cash: mine.cash || 0 }; saveReconStart(start); }
  let trades = loadTrades();
  const money = (v) => (isNum(v) ? `${v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}` : "–");
  app().innerHTML = `
    <h2>模拟经营 <span class="muted">实盘对账 · 价格数据截至 ${esc(P.dates[P.n - 1])}</span></h2>
    ${simTabs("recon")}${howto(RECON_HOWTO)}
    <section class="card" id="rc-start"><h3>起始持仓（过去某日收盘后）${badge("fact")}</h3>
      <div class="row"><label>日期 <input type="date" id="rs-date" min="${esc(P.dates[Math.max(P.backtestStart, 1)])}" max="${esc(P.dates[P.n - 1])}" value="${esc(start?.date || "")}"></label>
        <label>现金 <input type="number" id="rs-cash" min="0" step="100" value="${start?.cash ?? 0}" style="width:120px"></label></div>
      <div class="table-wrap"><table><thead><tr><th>代码</th><th>名称</th><th class="num">股数</th><th></th></tr></thead><tbody id="rs-rows"></tbody></table></div>
      <div class="row"><input type="text" id="rs-new" placeholder="代码" style="width:100px"><input type="number" id="rs-new-n" placeholder="股数" min="0" step="1" style="width:90px">
        <button type="button" class="ghost" id="rs-add">添加</button>
        <details class="howto" style="flex:1 1 300px"><summary>粘贴导入（每行“代码 股数”，现金写“现金 金额”）</summary>
          <textarea id="rs-paste" rows="4" style="width:100%" placeholder="NVDA 40\nSPY 30\n现金 8000"></textarea>
          <div class="row"><button type="button" class="ghost" id="rs-paste-btn">解析并覆盖</button></div></details></div>
      <div class="row"><button type="button" class="primary" id="rs-save">保存起始持仓</button>
        <button type="button" class="ghost" id="rs-copy">从“我的持仓”复制</button>
        <button type="button" class="ghost" id="rs-reverse">由当前持仓倒推到该日期</button><span class="muted" id="rs-msg"></span></div>
      <p class="muted">起始持仓与“我的持仓”分开保存。倒推 = 用“我的持仓”（${mine ? `${esc(mine.date)} 的持仓` : "尚未填写"}）撤销该日期之后、${mine ? esc(mine.date) : "当前"}之前的交易记录，现金按成交价与费用反推；请先录入这段时间的全部交易。</p></section>
    <section class="card"><h3>交易记录 ${badge("fact")}</h3>
      <div class="table-wrap"><table><thead><tr><th>日期</th><th>方向</th><th>代码</th><th class="num">股数</th><th class="num">成交价</th><th class="num">费用</th><th></th></tr></thead><tbody id="rc-rows"></tbody></table></div>
      <div class="row"><input type="date" id="rc-d" value="${esc(P.dates[P.n - 1])}"><select id="rc-side"><option value="buy">买入</option><option value="sell">卖出</option><option value="deposit">存入现金</option><option value="withdraw">取出现金</option></select>
        <input type="text" id="rc-t" placeholder="代码" style="width:90px"><input type="number" id="rc-n" placeholder="股数" min="0" step="1" style="width:90px">
        <input type="number" id="rc-p" placeholder="成交价" min="0" step="0.01" style="width:100px"><input type="number" id="rc-f" placeholder="费用" min="0" step="0.01" style="width:80px">
        <button type="button" class="ghost" id="rc-add">添加</button></div>
      <details class="howto"><summary>粘贴导入（每行“日期 买/卖 代码 股数 成交价 费用”；资金写“日期 存入/取出 金额”）</summary>
        <textarea id="rc-paste" rows="5" style="width:100%" placeholder="2026-09-29 买 NVDA 10 180.50 1.00\n2026-09-29 卖 SPY 5 700.20 0.50\n2026-10-01 存入 5000\n2026-10-15 取出 2000"></textarea>
        <div class="row"><button type="button" class="ghost" id="rc-paste-btn">解析并追加</button><span class="muted" id="rc-paste-msg"></span></div></details>
      <div class="row"><label title="模拟那条曲线每笔买卖按成交额扣除的成本比例，不是某一笔交易的费用">模拟成本假设 <input type="number" id="rc-cost" min="0" max="100" value="10" style="width:56px"> bps</label>
        <label><input type="checkbox" id="rc-int" checked> 现金计息（放在 SPAXX 等货币基金中）</label>
        <button type="button" class="primary" id="rc-run">运行对账</button>
        <button type="button" class="ghost" id="rc-apply">应用到我的持仓</button><span class="muted" id="rc-msg"></span></div>
      <p class="muted"><b>模拟成本假设</b>：模拟曲线每笔买卖按成交额扣除的成本比例（1 bp = 0.01%，默认 10 bps = 0.1%，与策略回测相同），对所有交易统一生效；你每笔的实际费用填在交易记录的“费用”栏，两者之差即结果中的“费用差”。
        填 10 看默认假设与你的实际差多少；填 0 只验证计算逻辑；调到“费用差”接近 0 的值，可作为你在策略回测中设置成本的参考。</p>
      <p class="muted">成交价留空时按当天开盘价计；交易日期若不是交易日，按之后第一个交易日计。只计入起始持仓日期之后、价格数据截止日之前的交易。</p></section>
    <div id="rc-report"></div>`;
  const draw = () => {
    trades.sort((a, b) => a.date.localeCompare(b.date));
    const SIDE = { buy: ["买入", "pos"], sell: ["卖出", "neg"], deposit: ["存入现金", "pos"], withdraw: ["取出现金", "neg"] };
    const flowSide = (t) => t.side === "deposit" || t.side === "withdraw";
    byId("rc-rows").innerHTML = trades.map((t, i) => `<tr><td>${esc(t.date)}</td><td class="${SIDE[t.side]?.[1] || ""}">${SIDE[t.side]?.[0] || esc(t.side)}</td>
      <td><b>${flowSide(t) ? "现金" : esc(t.ticker)}</b></td><td class="num">${flowSide(t) ? `金额 ${money(t.shares)}` : t.shares}</td>
      <td class="num">${flowSide(t) ? "–" : t.price > 0 ? num(t.price, 2) : "开盘价"}</td><td class="num">${flowSide(t) ? "–" : num(t.fee || 0, 2)}</td>
      <td><button type="button" class="ghost rc-del" data-i="${i}">删除</button></td></tr>`).join("") || `<tr><td colspan="7" class="muted">还没有交易记录</td></tr>`;
    document.querySelectorAll(".rc-del").forEach((b) => (b.onclick = () => { trades.splice(+b.dataset.i, 1); saveTrades(trades); draw(); }));
  };
  const syncSide = () => {
    const f = ["deposit", "withdraw"].includes(byId("rc-side").value);
    byId("rc-t").disabled = f; byId("rc-p").disabled = f; byId("rc-f").disabled = f;
    byId("rc-t").placeholder = f ? "现金" : "代码"; byId("rc-n").placeholder = f ? "金额" : "股数";
  };
  byId("rc-side").onchange = syncSide;
  byId("rc-add").onclick = () => {
    const side = byId("rc-side").value;
    if (side === "deposit" || side === "withdraw") {
      const amt = +byId("rc-n").value;
      if (!(amt > 0)) { byId("rc-msg").textContent = "请填写金额"; return; }
      trades.push({ date: byId("rc-d").value, side, ticker: "CASH", shares: amt, price: null, fee: 0 });
      saveTrades(trades); draw(); byId("rc-msg").textContent = ""; byId("rc-n").value = "";
      return;
    }
    const t = byId("rc-t").value.trim().toUpperCase().replace(/\./g, "-"), n = +byId("rc-n").value;
    if (!/^[A-Z0-9^][A-Z0-9\-=^]{0,11}$/.test(t) || !(n > 0)) { byId("rc-msg").textContent = "请填写代码与股数"; return; }
    trades.push({ date: byId("rc-d").value, side: byId("rc-side").value, ticker: t, shares: n, price: +byId("rc-p").value || null, fee: +byId("rc-f").value || 0 });
    saveTrades(trades); draw(); byId("rc-msg").textContent = "";
  };
  byId("rc-paste-btn").onclick = () => {
    const p = Recon.parseTrades(byId("rc-paste").value);
    trades.push(...p.trades); saveTrades(trades); draw();
    byId("rc-paste-msg").textContent = `追加 ${p.trades.length} 笔${p.errors.length ? `；${p.errors.length} 行无法识别：${p.errors.slice(0, 2).join("；")}` : ""}`;
  };
  // ---------- 起始持仓编辑器 ----------
  let sp = start ? { ...start.positions } : {};
  const drawStart = () => {
    byId("rs-rows").innerHTML = Object.keys(sp).sort().map((t) => `<tr><td><b>${esc(t)}</b>${P.C[t] ? "" : ' <span class="chip">无行情，不参与对账</span>'}</td>
      <td>${esc(META.names_zh?.[t] || "")}</td><td class="num"><input type="number" class="rs-sh" data-t="${t}" min="0" step="1" value="${sp[t]}" style="width:100px"></td>
      <td><button type="button" class="ghost rs-del" data-t="${t}">移除</button></td></tr>`).join("") || `<tr><td colspan="4" class="muted">尚未填写</td></tr>`;
    document.querySelectorAll(".rs-sh").forEach((el) => (el.onchange = () => { sp[el.dataset.t] = Math.max(0, +el.value || 0); }));
    document.querySelectorAll(".rs-del").forEach((el) => (el.onclick = () => { delete sp[el.dataset.t]; drawStart(); }));
  };
  const commitStart = (msg) => {
    const d = byId("rs-date").value;
    if (!d) { byId("rs-msg").textContent = "请填写日期"; return false; }
    start = { date: d, positions: Object.fromEntries(Object.entries(sp).filter(([, v]) => v > 0)), cash: Math.max(0, +byId("rs-cash").value || 0) };
    saveReconStart(start);
    byId("rs-msg").textContent = msg || `已保存 ${d} 的起始持仓（${Object.keys(start.positions).length} 个标的）`;
    byId("rc-run").click();
    return true;
  };
  byId("rs-add").onclick = () => {
    const t = byId("rs-new").value.trim().toUpperCase().replace(/\./g, "-"), n = +byId("rs-new-n").value;
    if (!/^[A-Z0-9^][A-Z0-9\-=^]{0,11}$/.test(t) || !(n > 0)) { byId("rs-msg").textContent = "请填写代码与股数"; return; }
    sp[t] = n; byId("rs-new").value = ""; byId("rs-new-n").value = ""; drawStart();
  };
  byId("rs-paste-btn").onclick = () => {
    const p = HoldingsCalc.parsePasted(byId("rs-paste").value);
    sp = { ...p.positions }; if (p.cash != null) byId("rs-cash").value = p.cash;
    byId("rs-msg").textContent = `识别 ${Object.keys(sp).length} 个标的${p.errors.length ? `；${p.errors.length} 行无法识别` : ""}（记得点“保存起始持仓”）`;
    drawStart();
  };
  byId("rs-save").onclick = () => commitStart();
  byId("rs-copy").onclick = () => {
    const h = loadHoldings();
    if (!h) { byId("rs-msg").textContent = "本机没有“我的持仓”"; return; }
    sp = { ...h.positions }; byId("rs-cash").value = h.cash || 0; byId("rs-date").value = h.date; drawStart();
    commitStart(`已复制“我的持仓”（${h.date}）作为起始持仓`);
  };
  byId("rs-reverse").onclick = () => {
    const h = loadHoldings(), d = byId("rs-date").value;
    if (!h) { byId("rs-msg").textContent = "请先在“我的持仓”页填写当前持仓"; return; }
    if (!d || d >= h.date) { byId("rs-msg").textContent = `请先选择早于 ${h.date} 的日期`; return; }
    const r = Recon.reverseTrades(h.positions, h.cash || 0, trades, d, h.date);
    sp = { ...r.positions }; byId("rs-cash").value = Math.max(0, Math.round(r.cash * 100) / 100); drawStart();
    const notes = [`已由 ${h.date} 的持仓撤销 ${r.used} 笔交易，倒推出 ${d} 的持仓`];
    if (r.missingPrice.length) notes.push(`${r.missingPrice.length} 笔没有成交价，现金无法反推，请手动核对`);
    if (r.negative.length) notes.push(`${r.negative.join("、")} 倒推后为负，可能漏录了买入`);
    if (r.cash < 0) notes.push("倒推现金为负，可能漏录了卖出或期间有资金存入");
    commitStart(notes.join("；"));
  };
  drawStart();
  byId("rc-apply").onclick = () => {
    if (!start) return;
    const after = trades.filter((t) => t.date > start.date);
    if (!after.length) { byId("rc-msg").textContent = "没有起始日期之后的交易"; return; }
    const r = Recon.applyTrades(start.positions, start.cash, after);
    const h = loadHoldings() || { prices: {}, cost: {}, note: "" };
    saveHoldings({ ...h, date: after[after.length - 1].date, positions: r.positions, cash: Math.max(0, Math.round(r.cash * 100) / 100), note: "由交易记录更新" });
    byId("rc-msg").innerHTML = `已更新“我的持仓”（${esc(after[after.length - 1].date)}）${r.missingPrice.length ? `；${r.missingPrice.length} 笔没有成交价，现金未扣减，请手动核对` : ""}。现金未含分红与利息，请以券商显示为准后到 <a href="#/holdings">我的持仓</a> 同步。`;
  };
  byId("rc-run").onclick = () => {
    if (!start) { byId("rc-msg").textContent = "请先设置起始持仓"; return; }
    try {
      const out = Recon.reconcile(P, raw, start, trades, { costBps: +byId("rc-cost").value || 0, cashInterest: byId("rc-int").checked });
      renderReconReport(out, money);
    } catch (e) { console.error(e); byId("rc-msg").textContent = `对账失败：${e.message}`; }
  };
  draw(); syncSide();
  if (start) byId("rc-run").click();
}

function renderReconReport(out, money) {
  const d = out.decomposition;
  const last = out.actual.length - 1;
  const rel = d.total / out.sim[last];
  const ins = [];
  if (out.flows.length) ins.push({ level: "info", kind: "fact", text: `期间资金净${out.flow_total >= 0 ? "存入" : "取出"} ${money(Math.abs(out.flow_total))}（${out.flows.map((f) => `${f.date} ${f.amount >= 0 ? "+" : ""}${money(f.amount)}`).join("，")}），实际与模拟两条曲线同时计入。` });
  ins.push({ level: Math.abs(rel) < 0.002 ? "good" : "info", kind: "derived",
    text: `实际期末资产 ${money(out.actual[last])}，模拟 ${money(out.sim[last])}，相差 ${money(d.total)}（${(rel * 100).toFixed(2)}%）。` });
  if (out.rows.length) {
    const parts = [["成交价差", d.fill], ["费用差", d.fee], ["现金利息差", d.interest], ["其他", d.other]].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    ins.push({ level: "info", kind: "derived", text: `差额主要来自「${parts[0][0]}」${money(parts[0][1])}；成交价差为正表示你的成交价比当天开盘价更有利。` });
    const slip = out.rows.filter((r) => isNum(r.slip_bps) && r.price_given);
    if (slip.length) {
      const avg = slip.reduce((a, r) => a + r.slip_bps * r.shares * r.open, 0) / slip.reduce((a, r) => a + r.shares * r.open, 0);
      ins.push({ level: Math.abs(avg) > 20 ? "medium" : "info", kind: "derived", text: `按成交额加权，你的成交价平均比开盘价${avg > 0 ? "差" : "好"} ${Math.abs(avg).toFixed(1)} 个基点（${avg > 0 ? "买得更贵 / 卖得更便宜" : "买得更便宜 / 卖得更贵"}）。` });
    }
    ins.push({ level: "info", kind: "derived", text: `实际费用 ${num(out.fees, 2)}，按模拟成本假设计 ${num(out.model_cost, 2)}${out.fees < out.model_cost ? "：该成本假设比你的实际费用偏保守" : out.fees > out.model_cost ? "：该成本假设低于你的实际费用" : ""}。` });
  } else ins.push({ level: "info", kind: "derived", text: "还没有起始日期之后的交易：两条曲线应一致（差额来自分红到账方式等细节）。" });
  byId("rc-report").innerHTML = `${insightBox(ins)}
    ${out.warnings.length ? `<section class="card"><p class="warn">${out.warnings.map(esc).join("<br>")}</p></section>` : ""}
    <section class="card"><h3>对账结果 ${badge("derived")}${badge("simulated")}</h3><div class="kpis">
      <div class="kpi"><span class="muted">实际期末资产</span><b>${money(out.actual[last])}</b></div>
      <div class="kpi"><span class="muted">模拟期末资产</span><b>${money(out.sim[last])}</b></div>
      <div class="kpi"><span class="muted">差额（实际 − 模拟）</span><b class="${cls(d.total)}">${money(d.total)}</b><span class="muted">${(rel * 100).toFixed(2)}%</span></div>
      <div class="kpi"><span class="muted">期间分红 / 利息</span><b>${money(out.dividends)} / ${money(out.interest)}</b></div>
      ${out.flows.length ? `<div class="kpi"><span class="muted">资金净存入（${out.flows.length} 笔）</span><b class="${cls(out.flow_total)}">${money(out.flow_total)}</b><span class="muted">两条曲线同时计入，不影响差额</span></div>` : ""}</div>
      <div class="grid two"><div>${chartDiv("c-rc-nav")}</div><div>${chartDiv("c-rc-dec")}</div></div></section>
    ${out.rows.length ? card("逐笔对比：你的成交 vs 模拟假设", `<div class="table-wrap"><table><thead><tr><th>日期</th><th>方向</th><th>代码</th><th class="num">股数</th><th class="num">成交价</th><th class="num">当天开盘价</th><th class="num">价差（bps）</th><th class="num">实际费用</th><th class="num">模拟成本</th></tr></thead>
      <tbody>${out.rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${r.side === "buy" ? "买入" : "卖出"}</td><td><b>${esc(r.ticker)}</b></td><td class="num">${r.shares}</td>
        <td class="num">${num(r.price, 2)}${r.price_given ? "" : " <span class=\"muted\">(开盘)</span>"}</td><td class="num">${num(r.open, 2)}</td>
        <td class="num ${cls(-r.slip_bps)}">${isNum(r.slip_bps) ? r.slip_bps.toFixed(1) : "–"}</td><td class="num">${num(r.fee, 2)}</td><td class="num">${num(r.model_cost, 2)}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted">价差 = 你的成交价相对开盘价的偏离（买入为正表示买贵了，卖出为正表示卖便宜了）。</p>`, "", ["fact", "derived"]) : ""}`;
  bindGoto();
  mkChart(byId("c-rc-nav"), {
    tooltip: { trigger: "axis", valueFormatter: (v) => money(v) }, legend: { top: 0 }, grid: { left: 70, right: 16, top: 36, bottom: 30 },
    xAxis: { type: "category", data: out.dates, boundaryGap: false }, yAxis: { type: "value", scale: true, axisLabel: { formatter: (v) => money(v) } },
    series: [{ name: "实际", type: "line", showSymbol: false, data: out.actual, color: palette()[0], lineStyle: { width: 2 } },
      { name: "模拟", type: "line", showSymbol: false, data: out.sim, color: BENCH_GRAY(), lineStyle: { type: "dashed" } }],
  });
  const items = [["成交价差", d.fill], ["费用差", d.fee], ["现金利息差", d.interest], ["其他", d.other], ["合计", d.total]];
  mkChart(byId("c-rc-dec"), {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => money(v) }, legend: { show: false }, grid: { left: 90, right: 60, top: 10, bottom: 20 },
    xAxis: { type: "value", axisLabel: { formatter: (v) => money(v) } }, yAxis: { type: "category", inverse: true, data: items.map(([n]) => n) },
    series: [{ type: "bar", barMaxWidth: 16, data: items.map(([n, v]) => ({ value: v, itemStyle: { color: n === "合计" ? palette()[0] : v >= 0 ? css("--pos") : css("--neg"), borderRadius: 3 } })),
      label: { show: true, position: "right", formatter: (p) => money(p.value), fontSize: 11, color: css("--ink-2") } }],
  });
}
