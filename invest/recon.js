"use strict";
/* 实盘对账（纯计算，不依赖 DOM；node 可 require 做测试）。

   用你的实际调仓验证模拟运算：同一起始持仓、同一批调仓，分别按
   - 实际：原始价格（复权价 ÷ 复权因子）估值；按你填写的成交价与费用成交；除息日按持股数收到现金分红；现金可选按 ^IRX 计息
   - 模拟：Sim.run 的规则——复权价（分红再投资）；调仓日前一交易日收盘产生信号、调仓日开盘按“调仓后比例”成交；
           成本 = 成交额 × 单边 bps；现金按 ^IRX 计息
   两条资产曲线的差异分解为：成交价差（你的成交价 vs 当日开盘价）、费用差（实际费用 vs 模型成本）、
   现金利息差、其他（差额的复利、分红到账方式等）。无交易、无利息差时两条曲线应一致。 */
(function (root) {
  const Sim = root.Sim || (typeof require !== "undefined" ? require("./sim.js") : null);

  function factorFn(P, raw, t) {
    const seg = raw.corp?.[t]?.factor;
    if (!seg || !seg.length) return () => 1;
    return (i) => { let f = seg[0][1]; for (const [k, v] of seg) { if (k <= i) f = v; else break; } return f; };
  }
  function rawPrice(P, raw, t) {
    const f = factorFn(P, raw, t);
    return { open: (i) => P.O[t][i] / f(i), close: (i) => P.C[t][i] / f(i) };
  }
  const sessionOnOrBefore = (P, d) => { let k = -1; for (let i = 0; i < P.n && P.dates[i] <= d; i++) k = i; return k; };
  const sessionOnOrAfter = (P, d) => P.dates.findIndex((x) => x >= d);

  /* start: {date, positions: {t: 股数}, cash}；trades: [{date, ticker, side: "buy"|"sell", shares, price?, fee?}]
     opts: {costBps, cashInterest(默认 true), end(日期，默认最新)} */
  function reconcile(P, raw, start, trades, opts = {}) {
    const costBps = opts.costBps ?? 10;
    const cashInterest = opts.cashInterest !== false;
    const s0 = sessionOnOrBefore(P, start.date);
    if (s0 < 1) throw new Error("起始日期早于数据范围");
    const end = opts.end ? sessionOnOrBefore(P, opts.end) : P.n - 1;
    const warnings = [];
    const known = (t) => !!P.C[t];
    const allTickers = [...new Set([...Object.keys(start.positions), ...trades.map((x) => x.ticker)])];
    const unknown = allTickers.filter((t) => !known(t));
    if (unknown.length) warnings.push(`以下标的没有行情数据，已排除在对账之外：${unknown.join("、")}`);
    const tickers = allTickers.filter(known);
    const px = Object.fromEntries(tickers.map((t) => [t, rawPrice(P, raw, t)]));
    const divAt = Object.fromEntries(tickers.map((t) => [t, Object.fromEntries((raw.corp?.[t]?.div || []).map(([i, d]) => [i, d]))]));

    // 交易按成交日归到交易日；早于起点或晚于数据末日的交易单列
    const byDay = {};
    const rows = [];
    let before = 0, after = 0;
    for (const tr of trades) {
      if (!known(tr.ticker)) continue;
      const i = sessionOnOrAfter(P, tr.date);
      if (i < 0 || i > end) { after++; continue; }
      if (i <= s0) { before++; continue; }
      (byDay[i] ||= []).push(tr);
    }

    if (before) warnings.push(`${before} 笔交易不晚于起始持仓日期（${P.dates[s0]}），未计入对账。要验证这些调仓，请把起始持仓日期改到它们之前（可用“由当前持仓倒推到该日期”）`);
    if (after) warnings.push(`${after} 笔交易晚于价格数据截止日（${P.dates[end]}），暂未计入`);

    // ---------- 实际路径 ----------
    const shares = Object.fromEntries(tickers.map((t) => [t, start.positions[t] || 0]));
    let cash = start.cash || 0;
    let interest = 0, dividends = 0, fees = 0, fillDiff = 0, modelCost = 0;
    const lastClose = {};
    const mark = (i) => tickers.reduce((a, t) => {
      const c = px[t].close(i);
      if (Number.isFinite(c)) lastClose[t] = c;
      return a + shares[t] * (lastClose[t] ?? 0);
    }, 0);
    const actual = [];
    const postTrade = {}; // 交易日 → 调仓后按开盘价计的比例（模拟用）
    actual.push(mark(s0) + cash);
    const start0 = actual[0];
    for (let i = s0 + 1; i <= end; i++) {
      if (cashInterest) { const a = cash * (P.rate[i - 1] || 0) * P.gap[i] / 360; cash += a; interest += a; }
      for (const t of tickers) { const d = divAt[t][i]; if (d && shares[t] > 0) { cash += shares[t] * d; dividends += shares[t] * d; } }
      if (byDay[i]) {
        for (const tr of byDay[i]) {
          const o = px[tr.ticker].open(i);
          const p = tr.price > 0 ? tr.price : o;
          const n = tr.shares, sign = tr.side === "sell" ? -1 : 1;
          const fee = tr.fee > 0 ? tr.fee : 0;
          shares[tr.ticker] += sign * n;
          cash -= sign * n * p + fee;
          fees += fee;
          // 成交价差：以开盘价为基准，买得更便宜 / 卖得更贵为正
          fillDiff += -sign * n * (p - o);
          const mc = n * o * costBps / 1e4;
          modelCost += mc;
          rows.push({ date: P.dates[i], ticker: tr.ticker, side: tr.side, shares: n, price: p, open: o,
            slip_bps: Number.isFinite(o) && o > 0 ? sign * (p / o - 1) * 1e4 : NaN, fee, model_cost: mc, price_given: tr.price > 0 });
          if (shares[tr.ticker] < -1e-9) warnings.push(`${P.dates[i]} ${tr.ticker} 卖出后股数为负，请检查`);
        }
        const val = tickers.reduce((a, t) => a + shares[t] * (px[t].open(i) || lastClose[t] || 0), 0) + cash;
        postTrade[i] = Object.fromEntries(tickers.filter((t) => shares[t] > 0).map((t) => [t, shares[t] * (px[t].open(i) || lastClose[t]) / val]));
      }
      actual.push(mark(i) + cash);
    }
    if (cash < -1e-6) warnings.push("实际路径中现金为负：可能漏填了卖出或存入资金");

    // ---------- 模拟路径 ----------
    const w0 = {};
    tickers.forEach((t) => { const c = px[t].close(s0); if ((start.positions[t] || 0) > 0 && Number.isFinite(c)) w0[t] = start.positions[t] * c / start0; });
    const strategy = { assets: tickers, lastTarget: null,
      onClose(i) { const w = postTrade[i + 1]; if (w) this.lastTarget = w; return w || null; } };
    const res = Sim.run(P, strategy, { start: s0 + 1, end, costBps, initial: start0, initialWeights: w0, monthly: 0 });
    const sim = [start0, ...res.value];
    const dates = P.dates.slice(s0, end + 1);
    const total = actual[actual.length - 1] - sim[sim.length - 1];
    const interestDiff = interest - res.interest;
    const feeDiff = -(fees - res.costSum);
    const decomposition = { total, fill: fillDiff, fee: feeDiff, interest: interestDiff, other: total - fillDiff - feeDiff - interestDiff };
    return { dates, actual, sim, rows, decomposition, warnings, dividends, interest, fees, model_cost: res.costSum,
      final_positions: { ...shares }, final_cash: cash, start_value: start0 };
  }

  /* 粘贴交易：每行“日期 买/卖 代码 股数 [成交价] [费用]”，分隔符为空格 / 逗号 / 制表符 */
  function parseTrades(text) {
    const out = [], errors = [];
    for (const [k, rawLine] of text.split(/\r?\n/).entries()) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      let p = line.split(/[\s，]+/).filter(Boolean);
      if (p.length === 1) p = line.split(",");
      p = p.map((x) => x.replace(/,$/, "").trim()).filter(Boolean);
      const date = (p[0] || "").replace(/\//g, "-");
      const side = { 买: "buy", 买入: "buy", buy: "buy", b: "buy", 卖: "sell", 卖出: "sell", sell: "sell", s: "sell" }[(p[1] || "").toLowerCase()];
      const ticker = (p[2] || "").toUpperCase().replace(/\./g, "-");
      const shares = parseFloat((p[3] || "").replace(/,/g, ""));
      if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(date) || !side || !/^[A-Z0-9^][A-Z0-9\-=^]{0,11}$/.test(ticker) || !(shares > 0)) {
        errors.push(`第 ${k + 1} 行无法识别：${rawLine}`);
        continue;
      }
      const [y, m, d] = date.split("-");
      out.push({ date: `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`, side, ticker, shares,
        price: parseFloat((p[4] || "").replace(/[$,]/g, "")) || null, fee: parseFloat((p[5] || "").replace(/[$,]/g, "")) || 0 });
    }
    return { trades: out, errors };
  }

  /* 把交易应用到持仓：返回新的股数与现金（现金只按成交额与费用变化，不含期间分红与利息——请以券商显示为准） */
  function applyTrades(positions, cash, trades) {
    const pos = { ...positions };
    let c = cash;
    for (const tr of trades) {
      const sign = tr.side === "sell" ? -1 : 1;
      pos[tr.ticker] = (pos[tr.ticker] || 0) + sign * tr.shares;
      if (tr.price > 0) c -= sign * tr.shares * tr.price;
      c -= tr.fee || 0;
      if (Math.abs(pos[tr.ticker]) < 1e-9) delete pos[tr.ticker];
    }
    return { positions: pos, cash: c, missingPrice: trades.filter((t) => !(t.price > 0)).map((t) => `${t.date} ${t.ticker}`) };
  }

  /* 由当前持仓倒推过去某日的持仓：撤销 (fromDate, toDate] 之间的交易。
     现金按成交额与费用反推；没有成交价的交易无法反推现金，单列返回。 */
  function reverseTrades(positions, cash, trades, fromDate, toDate) {
    const pos = { ...positions };
    let c = cash;
    const used = trades.filter((t) => t.date > fromDate && (!toDate || t.date <= toDate));
    for (const tr of used) {
      const sign = tr.side === "sell" ? -1 : 1;
      pos[tr.ticker] = (pos[tr.ticker] || 0) - sign * tr.shares;
      if (tr.price > 0) c += sign * tr.shares * tr.price;
      c += tr.fee || 0;
    }
    const negative = Object.entries(pos).filter(([, s]) => s < -1e-9).map(([t]) => t);
    for (const t of Object.keys(pos)) if (Math.abs(pos[t]) < 1e-9) delete pos[t];
    return { positions: pos, cash: c, used: used.length, negative,
      missingPrice: used.filter((t) => !(t.price > 0)).map((t) => `${t.date} ${t.ticker}`) };
  }

  const api = { reconcile, parseTrades, applyTrades, reverseTrades, rawPrice };
  root.Recon = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
