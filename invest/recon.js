"use strict";
/* 实盘对账（纯计算，不依赖 DOM；node 可 require 做测试）。

   用你的实际调仓验证模拟运算：同一起始持仓、同一批调仓，分别按
   - 实际：原始价格（复权价 ÷ 复权因子）估值；按你填写的成交价与费用成交；除息日按持股数收到现金分红；现金可选按 ^IRX 计息
   - 模拟：Sim.run 的规则——复权价（分红再投资）；调仓日前一交易日收盘产生信号、调仓日开盘按“调仓后比例”成交；
           成本 = 成交额 × 单边 bps；现金按 ^IRX 计息
   两条资产曲线的差异分解为：成交价差（你的成交价 vs 当日开盘价）、费用差（实际费用 vs 模拟成本假设）、
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

  const isFlow = (t) => t.side === "deposit" || t.side === "withdraw";
  const flowAmount = (t) => (t.side === "withdraw" ? -1 : 1) * (t.shares || 0);

  /* start: {date, positions: {t: 股数}, cash}
     trades: [{date, ticker, side: "buy"|"sell", shares, price?, fee?}]；资金流水：{date, side: "deposit"|"withdraw", ticker: "CASH", shares: 金额}
     opts: {costBps, cashInterest(默认 true), end(日期，默认最新)} */
  function reconcile(P, raw, start, trades, opts = {}) {
    const costBps = opts.costBps ?? 10;
    const cashInterest = opts.cashInterest !== false;
    const s0 = sessionOnOrBefore(P, start.date);
    if (s0 < 1) throw new Error("起始日期早于数据范围");
    const end = opts.end ? sessionOnOrBefore(P, opts.end) : P.n - 1;
    const warnings = [];
    const known = (t) => !!P.C[t];
    const allTickers = [...new Set([...Object.keys(start.positions), ...trades.filter((x) => !isFlow(x)).map((x) => x.ticker)])];
    const unknown = allTickers.filter((t) => !known(t));
    if (unknown.length) warnings.push(`以下标的没有行情数据，已排除在对账之外：${unknown.join("、")}`);
    const tickers = allTickers.filter(known);
    const px = Object.fromEntries(tickers.map((t) => [t, rawPrice(P, raw, t)]));
    const divAt = Object.fromEntries(tickers.map((t) => [t, Object.fromEntries((raw.corp?.[t]?.div || []).map(([i, d]) => [i, d]))]));

    // 交易按成交日归到交易日；早于起点或晚于数据末日的交易单列
    const byDay = {};
    const rows = [];
    let before = 0, after = 0;
    const cashFlows = {};
    let flowTotal = 0;
    for (const tr of trades.filter(isFlow)) {
      const i = sessionOnOrAfter(P, tr.date);
      if (i < 0 || i > end) { after++; continue; }
      if (i <= s0) { before++; continue; }
      cashFlows[i] = (cashFlows[i] || 0) + flowAmount(tr);
      flowTotal += flowAmount(tr);
    }
    for (const tr of trades) {
      if (isFlow(tr) || !known(tr.ticker)) continue;
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
    const decisions = []; // 每个操作日：调仓前 / 后状态（决策评估用）
    const postTrade = {}; // 交易日 → 调仓后按开盘价计的比例（模拟用）
    actual.push(mark(s0) + cash);
    const start0 = actual[0];
    for (let i = s0 + 1; i <= end; i++) {
      if (cashInterest) { const a = cash * (P.rate[i - 1] || 0) * P.gap[i] / 360; cash += a; interest += a; }
      for (const t of tickers) { const d = divAt[t][i]; if (d && shares[t] > 0) { cash += shares[t] * d; dividends += shares[t] * d; } }
      if (cashFlows[i]) cash += cashFlows[i]; // 资金存入 / 取出：开盘前计入现金（模拟路径同样计入）
      if (byDay[i]) {
        const pre = { shares: { ...shares }, cash, i };
        const dayRows = [];
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
          dayRows.push({ ticker: tr.ticker, side: tr.side, shares: n, price: p, fee });
          if (shares[tr.ticker] < -1e-9) warnings.push(`${P.dates[i]} ${tr.ticker} 卖出后股数为负，请检查`);
        }
        decisions.push({ i, date: P.dates[i], pre, post: { shares: { ...shares }, cash }, trades: dayRows });
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
    const res = Sim.run(P, strategy, { start: s0 + 1, end, costBps, initial: start0, initialWeights: w0, monthly: 0, cashFlows });
    const sim = [start0, ...res.value];
    const dates = P.dates.slice(s0, end + 1);
    const total = actual[actual.length - 1] - sim[sim.length - 1];
    const interestDiff = interest - res.interest;
    const feeDiff = -(fees - res.costSum);
    const decomposition = { total, fill: fillDiff, fee: feeDiff, interest: interestDiff, other: total - fillDiff - feeDiff - interestDiff };
    const flowList = Object.entries(cashFlows).map(([i, a]) => ({ date: P.dates[+i], amount: a }));
    return { dates, actual, sim, rows, decomposition, warnings, dividends, interest, fees, model_cost: res.costSum, flows: flowList, flow_total: flowTotal,
      final_positions: { ...shares }, final_cash: cash, start_value: start0,
      _ctx: { decisions, tickers, s0, end, cashInterest, costBps, cashFlows, w0, start0 } };
  }

  function latestSystemTarget(P, sys, i) {
    let k = -1;
    for (let j = 0; j < sys.dates.length && sys.dates[j] <= P.dates[i]; j++) k = j;
    return k < 0 ? null : { date: sys.dates[k], weights: sys.targets[k] };
  }

  /* 整体对比：从对账起始日开始，三条资产曲线（存取款同时计入）
     actual = 你的实际账户；follow = 起始时一次性换成系统配置、之后每周跟随系统模型；hold = 起始持仓一直不动 */
  function compareFollow(P, raw, recon, sys) {
    const { s0, end, costBps, cashFlows, w0, start0, tickers } = recon._ctx;
    const hold = Sim.run(P, { assets: tickers, lastTarget: null, onClose: () => null },
      { start: s0 + 1, end, costBps, initial: start0, initialWeights: w0, cashFlows, noCashInterest: !recon._ctx.cashInterest });
    let follow = null;
    if (sys) {
      const strat = Sim.makeStrategy(P, { mode: "system", overlays: {} }, sys);
      const assets = [...new Set([...strat.assets, ...Object.keys(w0)])];
      follow = Sim.run(P, { ...strat, assets, onClose: strat.onClose.bind(strat) },
        { start: s0 + 1, end, costBps, initial: start0, initialWeights: w0, cashFlows, noCashInterest: !recon._ctx.cashInterest });
    }
    return { dates: recon.dates, actual: recon.actual, hold: [start0, ...hold.value],
      follow: follow ? [start0, ...follow.value] : null, followTrades: follow ? follow.trades.filter((t) => !t.contribution).length : 0,
      followCost: follow ? follow.costSum : 0 };
  }

  /* 决策评估：对每个操作日 d，从同一起点价值（调仓前持仓按 d 前一交易日收盘估值）出发比较
     A = 调仓后持有（你的实际操作，含成交价与费用），B = 调仓前持有（不操作），
     C = 同一天改按系统建议清单调到建议配置后持有（可选；当天开盘成交、成本按模拟假设）。A、C 都只调整一次，比较的是同一天两种操作。
     窗口：now = 持有至今（数据截止日）；next = 到下一次操作前一日收盘；数字 = 固定交易日数（封顶到数据截止日）。
     A − B 拆分为：择时 = 净买入金额 ×（SPY 收益 − 现金收益）——加减仓时机；
                  选股 = Σ 成交额 ×（该股收益 − SPY 收益）——买入的是否跑赢大盘、卖出的是否跑输大盘；成本 = 费用。窗口内的资金进出不计入（对 A / B / C 相同）。 */
  function evaluateDecisions(P, raw, recon, opts = {}) {
    const { decisions, tickers, end, cashInterest, costBps } = recon._ctx;
    const horizon = opts.horizon || "next";
    const px = Object.fromEntries(tickers.map((t) => [t, rawPrice(P, raw, t)]));
    const divAt = Object.fromEntries(tickers.map((t) => [t, Object.fromEntries((raw.corp?.[t]?.div || []).map(([k, d]) => [k, d]))]));
    const lastClose = (t, k) => { for (let j = k; j >= 0; j--) { const v = px[t].close(j); if (Number.isFinite(v)) return v; } return 0; };
    const valueAt = (sh, k) => tickers.reduce((a, t) => a + (sh[t] || 0) * lastClose(t, k), 0);
    // 持有 sh 与现金 c 从 i 收盘到 e 收盘的价值（含 i 之后的分红与现金利息）
    const hold = (sh, c, i, e) => {
      let cash = c;
      for (let k = i + 1; k <= e; k++) {
        if (cashInterest) cash += cash * (P.rate[k - 1] || 0) * P.gap[k] / 360;
        for (const t of tickers) { const d = divAt[t][k]; if (d && sh[t] > 0) cash += sh[t] * d; }
      }
      return valueAt(sh, e) + cash;
    };
    const out = [];
    decisions.forEach((d, n) => {
      const next = decisions[n + 1];
      const e = horizon === "next" ? (next ? next.i - 1 : end) : horizon === "now" ? end : Math.min(d.i + (+horizon) - 1, end);
      const full = horizon === "next" ? !!next : horizon === "now" ? end - d.i + 1 >= 126 : d.i + (+horizon) - 1 <= end;
      const v0 = valueAt(d.pre.shares, d.i - 1) + d.pre.cash;
      const a = hold(d.post.shares, d.post.cash, d.i, Math.max(e, d.i));
      const b = hold(d.pre.shares, d.pre.cash, d.i, Math.max(e, d.i));
      // C：同一天从同一持仓出发，按系统建议清单调到建议配置（当天开盘成交、成本按模拟假设），之后持有到窗口结束
      let c = null, sysDate = null;
      const tgt = opts.sys ? latestSystemTarget(P, opts.sys, d.i - 1) : null;
      if (tgt && e >= d.i) {
        const w0 = {};
        tickers.forEach((t) => { if ((d.pre.shares[t] || 0) > 0) w0[t] = d.pre.shares[t] * lastClose(t, d.i - 1) / v0; });
        const assets = [...new Set([...Object.keys(tgt.weights), ...Object.keys(w0)])].filter((t) => P.C[t]);
        const strat = { assets, lastTarget: null, onClose: (k, st) => (st.first ? tgt.weights : null) };
        try {
          c = Sim.run(P, strat, { start: d.i, end: Math.max(e, d.i), costBps, initial: v0, initialWeights: w0, noCashInterest: !cashInterest }).final;
          sysDate = tgt.date;
        } catch { c = null; }
      }
      // ---- A − B 拆分：择时 / 选股 / 成本（恒等式：A − B = 择时 + 选股 − 成本 + 其他）----
      const ee = Math.max(e, d.i);
      let cashG = 1;
      if (cashInterest) for (let k = d.i + 1; k <= ee; k++) cashG *= 1 + (P.rate[k - 1] || 0) * P.gap[k] / 360;
      const rCash = cashG - 1;
      const spyOk = P.C.SPY && Number.isFinite(P.O.SPY[d.i]) && Number.isFinite(P.C.SPY[ee]);
      const rM = spyOk ? P.C.SPY[ee] / P.O.SPY[d.i] - 1 : NaN; // SPY 从操作日开盘到窗口结束的总收益（含分红）
      let netBuy = 0, selection = 0;
      const legs = [];
      for (const t of d.trades) {
        if (!px[t.ticker]) continue;
        const sign = t.side === "sell" ? -1 : 1;
        const tv = sign * t.shares * t.price; // 买入为正
        let divs = 0;
        for (let k = d.i + 1; k <= ee; k++) divs += divAt[t.ticker][k] || 0;
        const rT = (lastClose(t.ticker, ee) + divs) / t.price - 1; // 该股从成交价到窗口结束的收益（含分红）
        netBuy += tv;
        if (Number.isFinite(rM)) selection += tv * (rT - rM);
        legs.push({ ticker: t.ticker, side: t.side, value: Math.abs(tv), r: rT, excess: Number.isFinite(rM) ? rT - rM : NaN });
      }
      const timing = Number.isFinite(rM) ? netBuy * (rM - rCash) : NaN;
      const cost = d.trades.reduce((x, t) => x + (t.fee || 0), 0) * cashG;
      const gross = legs.reduce((x, l) => x + l.value, 0);
      out.push({ date: d.date, window_end: P.dates[Math.max(e, d.i)], sessions: Math.max(e, d.i) - d.i + 1, full, trades: d.trades,
        v0, a, b, c, added: a - b, added_pct: (a - b) / v0, a_ret: a / v0 - 1, b_ret: b / v0 - 1, c_ret: c == null ? null : c / v0 - 1,
        vs_c: c == null ? null : a - c, sys_date: sysDate,
        timing, selection: Number.isFinite(rM) ? selection : NaN, cost, other: (a - b) - (timing || 0) - (selection || 0) + cost,
        net_buy: netBuy, gross, r_market: rM, selection_pct: gross > 0 && Number.isFinite(rM) ? selection / gross : NaN, legs, fees: d.trades.reduce((x, t) => x + (t.fee || 0), 0) });
    });
    return out;
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
      const side = { 买: "buy", 买入: "buy", buy: "buy", b: "buy", 卖: "sell", 卖出: "sell", sell: "sell", s: "sell",
        存入: "deposit", 转入: "deposit", 入金: "deposit", deposit: "deposit", 取出: "withdraw", 转出: "withdraw", 出金: "withdraw", withdraw: "withdraw" }[(p[1] || "").toLowerCase()];
      if (side === "deposit" || side === "withdraw") {
        const amt = parseFloat((p[2] || "").replace(/[$,]/g, ""));
        if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(date) || !(amt > 0)) { errors.push(`第 ${k + 1} 行无法识别：${rawLine}`); continue; }
        const [y2, m2, d2] = date.split("-");
        out.push({ date: `${y2}-${m2.padStart(2, "0")}-${d2.padStart(2, "0")}`, side, ticker: "CASH", shares: amt, price: null, fee: 0 });
        continue;
      }
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
      if (isFlow(tr)) { c += flowAmount(tr); continue; }
      const sign = tr.side === "sell" ? -1 : 1;
      pos[tr.ticker] = (pos[tr.ticker] || 0) + sign * tr.shares;
      if (tr.price > 0) c -= sign * tr.shares * tr.price;
      c -= tr.fee || 0;
      if (Math.abs(pos[tr.ticker]) < 1e-9) delete pos[tr.ticker];
    }
    return { positions: pos, cash: c, missingPrice: trades.filter((t) => !isFlow(t) && !(t.price > 0)).map((t) => `${t.date} ${t.ticker}`) };
  }

  /* 由当前持仓倒推过去某日的持仓：撤销 (fromDate, toDate] 之间的交易。
     现金按成交额与费用反推；没有成交价的交易无法反推现金，单列返回。 */
  function reverseTrades(positions, cash, trades, fromDate, toDate) {
    const pos = { ...positions };
    let c = cash;
    const used = trades.filter((t) => t.date > fromDate && (!toDate || t.date <= toDate));
    for (const tr of used) {
      if (isFlow(tr)) { c -= flowAmount(tr); continue; }
      const sign = tr.side === "sell" ? -1 : 1;
      pos[tr.ticker] = (pos[tr.ticker] || 0) - sign * tr.shares;
      if (tr.price > 0) c += sign * tr.shares * tr.price;
      c += tr.fee || 0;
    }
    const negative = Object.entries(pos).filter(([, s]) => s < -1e-9).map(([t]) => t);
    for (const t of Object.keys(pos)) if (Math.abs(pos[t]) < 1e-9) delete pos[t];
    return { positions: pos, cash: c, used: used.length, negative,
      missingPrice: used.filter((t) => !isFlow(t) && !(t.price > 0)).map((t) => `${t.date} ${t.ticker}`) };
  }

  /* 拆股换算：行情与分红都是拆股后口径，把录入的股数 / 成交价换算到同一口径（股数 × 之后发生的拆股比例、价格 ÷ 比例）。
     拆股生效日当天及之后的交易已是新口径；起始持仓按起始日收盘后的状态换算。 */
  function splitFactorAfter(P, raw, t, i) {
    let m = 1;
    for (const [k, r] of raw.corp?.[t]?.split || []) if (k > i) m *= r;
    return m;
  }
  function splitNormalize(P, raw, start, trades) {
    const s0 = sessionOnOrBefore(P, start.date);
    const positions = {}, cost = {};
    for (const [t, n] of Object.entries(start.positions || {})) {
      const m = splitFactorAfter(P, raw, t, s0);
      positions[t] = n * m;
      if (start.cost?.[t] > 0) cost[t] = start.cost[t] / m;
    }
    const tr = trades.map((x) => {
      if (isFlow(x)) return { ...x };
      const i = sessionOnOrAfter(P, x.date);
      const m = i < 0 ? 1 : splitFactorAfter(P, raw, x.ticker, i);
      return m === 1 ? { ...x } : { ...x, shares: x.shares * m, price: x.price > 0 ? x.price / m : x.price, split_mult: m };
    });
    // 非整数比例多为分拆（spin-off，yfinance 按拆股处理）：股数按比例换算后市值连续，但分拆出的新公司股票不单独计算
    const notes = [];
    const touched = new Set([...Object.keys(start.positions || {}), ...trades.filter((x) => !isFlow(x)).map((x) => x.ticker)]);
    for (const t of touched) {
      for (const [k, r] of raw.corp?.[t]?.split || []) {
        if (k <= s0) continue;
        notes.push(Math.abs(r - Math.round(r)) > 1e-6
          ? `${t} 在 ${P.dates[k]} 有分拆（行情按比例 ${r} 调整），股数已按该比例换算；分拆得到的新公司股票未单独计算`
          : `${t} 在 ${P.dates[k]} 按 1 拆 ${r} 拆股，之前的股数与成交价已自动换算`);
      }
    }
    return { start: { ...start, positions, cost }, trades: tr, notes };
  }

  /* 账本：由起始持仓 + 交易记录逐日推算（券商式持仓页用）。
     - 股数与成本按平均成本法：买入 成本 += 股数 × 成交价 + 费用；卖出按平均成本结转，已实现盈亏 = 卖出净额 − 结转成本
     - 起始持仓的成本：填写了成本价就用成本价，否则按起始日收盘价（标注为估计）
     - 现金：起始现金 + 存取款 + 分红 + 利息（可关）− 买入 + 卖出 − 费用
     - 没有成交价的交易按当天开盘价；晚于价格数据截止日的交易仍计入股数与现金（估值用最新收盘价）
     - 没有行情的标的：计入股数与成本，市值按最后一笔成交价估计（标注）
     返回 {rows, closed, account, curve, snapshot, warnings} */
  function ledgerBook(P, raw, start0, trades0, opts = {}) {
    const cashInterest = opts.cashInterest !== false;
    const { start, trades, notes } = splitNormalize(P, raw, start0, trades0);
    const s0 = sessionOnOrBefore(P, start.date);
    if (s0 < 0) throw new Error("起始日期早于价格数据范围");
    const end = P.n - 1;
    const warnings = [...notes];
    const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
    const early = sorted.filter((x) => x.date <= start.date);
    if (early.length) warnings.push(`${early.length} 笔记录不晚于起始持仓日期（${start.date}），未计入`);
    const used = sorted.filter((x) => x.date > start.date);
    const tickers = [...new Set([...Object.keys(start.positions), ...used.filter((x) => !isFlow(x)).map((x) => x.ticker)])];
    const known = (t) => !!P.C[t];
    const px = Object.fromEntries(tickers.filter(known).map((t) => [t, rawPrice(P, raw, t)]));
    const divAt = Object.fromEntries(tickers.map((t) => [t, Object.fromEntries((raw.corp?.[t]?.div || []).map(([k, d]) => [k, d]))]));
    const lastPx = {}; // 最近可用的估值价格
    const closeAt = (t, i) => { if (px[t]) { const c = px[t].close(i); if (Number.isFinite(c)) lastPx[t] = c; } return lastPx[t]; };
    const st = Object.fromEntries(tickers.map((t) => [t, { shares: 0, basis: 0, realized: 0, divs: 0, fees: 0, bought: 0, sold: 0, estCost: false, openBuys: 0, first: null }]));
    let cash = start.cash || 0, interest = 0, flows = 0;
    for (const t of tickers) {
      const n = start.positions[t] || 0;
      if (!(n > 0)) continue;
      const c = start.cost?.[t] > 0 ? start.cost[t] : closeAt(t, s0);
      st[t].shares = n; st[t].first = start.date;
      if (Number.isFinite(c)) { st[t].basis = n * c; st[t].estCost = !(start.cost?.[t] > 0); }
      else warnings.push(`${t} 没有起始日价格也没有填写成本价，成本按 0 计`);
    }
    const apply = (x, i) => {
      if (isFlow(x)) { cash += flowAmount(x); flows += flowAmount(x); return; }
      const s = st[x.ticker];
      let p = x.price > 0 ? x.price : NaN;
      if (!Number.isFinite(p) && px[x.ticker] && i != null) { p = px[x.ticker].open(i); if (x.side !== "sell" && Number.isFinite(p)) s.openBuys += 1; } // 没填成交价的买入：成本按开盘价估计
      if (!Number.isFinite(p)) { warnings.push(`${x.date} ${x.ticker} 没有成交价也没有行情，按 0 计，请补填成交价`); p = 0; }
      if (!px[x.ticker] || lastPx[x.ticker] == null) lastPx[x.ticker] = p;
      const fee = x.fee > 0 ? x.fee : 0;
      s.fees += fee;
      if (x.side === "sell") {
        const n = Math.min(x.shares, s.shares);
        if (x.shares > s.shares + 1e-9) warnings.push(`${x.date} ${x.ticker} 卖出 ${x.shares} 股多于持有 ${+s.shares.toFixed(4)} 股，按持有股数结转成本`);
        const out = s.shares > 0 ? s.basis * n / s.shares : 0;
        s.realized += x.shares * p - fee - out;
        s.basis -= out; s.shares -= x.shares; s.sold += x.shares * p;
        if (Math.abs(s.shares) < 1e-9) { s.shares = 0; s.basis = 0; s.openBuys = 0; s.estCost = false; }
        cash += x.shares * p - fee;
      } else {
        if (!(s.shares > 0)) s.first = x.date;
        s.shares += x.shares; s.basis += x.shares * p + fee; s.bought += x.shares * p;
        cash -= x.shares * p + fee;
      }
    };
    const byDay = {}, late = [];
    for (const x of used) { const i = sessionOnOrAfter(P, x.date); if (i < 0) late.push(x); else (byDay[i] ||= []).push(x); }
    const value = (i) => tickers.reduce((a, t) => a + (st[t].shares ? st[t].shares * (closeAt(t, i) ?? 0) : 0), 0) + cash;
    const curve = { dates: [P.dates[s0]], value: [value(s0)], flow: [0], twr: [1] };
    let twr = 1;
    for (let i = s0 + 1; i <= end; i++) {
      const prev = curve.value[curve.value.length - 1];
      if (cashInterest) { const a = cash * (P.rate[i - 1] || 0) * P.gap[i] / 360; cash += a; interest += a; }
      for (const t of tickers) { const d = divAt[t][i]; if (d && st[t].shares > 0) { cash += st[t].shares * d; st[t].divs += st[t].shares * d; } }
      let f = 0;
      for (const x of byDay[i] || []) { if (isFlow(x)) f += flowAmount(x); apply(x, i); }
      const v = value(i);
      // 时间加权：资金在开盘前进出，当天收益 = 收盘价值 ÷（前一日价值 + 当天资金流）
      if (prev + f > 0) twr *= v / (prev + f);
      curve.dates.push(P.dates[i]); curve.value.push(v); curve.flow.push(f); curve.twr.push(twr);
    }
    if (late.length) {
      warnings.push(`${late.length} 笔记录晚于价格数据截止日（${P.dates[end]}），已计入股数与现金，估值用最新收盘价`);
      for (const x of late) apply(x, null);
    }
    if (cash < -1e-6) warnings.push("现金为负：可能漏录了卖出或存入资金");
    // ---------- 汇总 ----------
    const last = (t) => (px[t] ? closeAt(t, end) : lastPx[t]);
    const prevClose = (t) => { if (!px[t]) return NaN; for (let k = end - 1; k >= 0; k--) { const v = px[t].close(k); if (Number.isFinite(v)) return v; } return NaN; };
    const lateToday = new Set(late.filter((x) => !isFlow(x)).map((x) => x.ticker));
    const todayTraded = new Set((byDay[end] || []).filter((x) => !isFlow(x)).map((x) => x.ticker));
    const total = value(end) + 0; // value() 已含现金
    const rows = [], closed = [];
    for (const t of tickers) {
      const s = st[t], p = last(t);
      const base = { ticker: t, realized: s.realized, divs: s.divs, fees: s.fees, has_data: !!px[t] };
      if (s.shares > 1e-9) {
        const mv = s.shares * (p ?? NaN), pc = prevClose(t);
        const dayChg = Number.isFinite(pc) && !todayTraded.has(t) && !lateToday.has(t) ? s.shares * (p - pc) : NaN;
        rows.push({ ...base, shares: s.shares, price: p, prev_close: pc, day_change: dayChg, day_pct: Number.isFinite(pc) ? p / pc - 1 : NaN,
          market_value: mv, cost_basis: s.basis, avg_cost: s.basis / s.shares, unrealized: mv - s.basis, unrealized_pct: s.basis > 0 ? mv / s.basis - 1 : NaN,
          weight: total > 0 ? mv / total : NaN, total_gain: mv - s.basis + s.realized + s.divs, est_cost: s.estCost || s.openBuys > 0, est_start: s.estCost, est_open: s.openBuys, since: s.first });
      } else if (Math.abs(s.realized) > 1e-9 || s.divs > 0) closed.push({ ...base, total_gain: s.realized + s.divs });
    }
    rows.sort((a, b) => (b.market_value || 0) - (a.market_value || 0));
    const sum = (arr, k) => arr.reduce((a, r) => a + (Number.isFinite(r[k]) ? r[k] : 0), 0);
    const all = [...rows, ...closed];
    const n = curve.value.length;
    const startValue = curve.value[0];
    const account = {
      asof: P.dates[end], start_date: P.dates[s0], total_value: total, cash, invested: total - cash,
      day_change: n >= 2 ? curve.value[n - 1] - curve.value[n - 2] - curve.flow[n - 1] : NaN,
      day_pct: n >= 2 && curve.value[n - 2] + curve.flow[n - 1] > 0 ? curve.value[n - 1] / (curve.value[n - 2] + curve.flow[n - 1]) - 1 : NaN,
      start_value: startValue, net_flows: flows, total_gain: total - startValue - flows, twr: curve.twr[n - 1] - 1,
      unrealized: sum(rows, "unrealized"), realized: sum(all, "realized"), dividends: sum(all, "divs"), interest, fees: sum(all, "fees"),
      cost_basis: sum(rows, "cost_basis"), late: late.length,
    };
    const snapshot = { date: late.length ? late[late.length - 1].date : P.dates[end],
      positions: Object.fromEntries(rows.map((r) => [r.ticker, +r.shares.toFixed(6)])), cash: Math.round(cash * 100) / 100,
      cost: Object.fromEntries(rows.filter((r) => Number.isFinite(r.avg_cost)).map((r) => [r.ticker, +r.avg_cost.toFixed(4)])),
      prices: Object.fromEntries(rows.filter((r) => !r.has_data && Number.isFinite(r.price)).map((r) => [r.ticker, r.price])), note: "由交易记录推算" };
    return { rows, closed, account, curve, snapshot, warnings };
  }

  /* 分批持仓（FIFO，先买先卖）：持有期与税务参考用。
     - 起始持仓的实际买入日未知，按起始日计（from_start 标注）；成本：填写了成本价就用，否则按起始日收盘价
     - 买入批次成本含费用；卖出按 FIFO 消耗批次，已实现盈亏 = 卖出净价 × 股数 − 批次成本
     返回 {lots: [{ticker, date, shares, cost, from_start}], realized: [{ticker, buy_date, sell_date, shares, gain, from_start}]} */
  function fifoLots(P, raw, start0, trades0) {
    const { start, trades } = splitNormalize(P, raw, start0, trades0);
    const s0 = sessionOnOrBefore(P, start.date);
    const q = {};
    const realized = [];
    for (const [t, n] of Object.entries(start.positions)) {
      if (!(n > 0)) continue;
      const c = start.cost?.[t] > 0 ? start.cost[t] : P.C[t] && s0 >= 0 ? rawPrice(P, raw, t).close(s0) : NaN;
      (q[t] ||= []).push({ ticker: t, date: start.date, shares: n, cost: c, from_start: true });
    }
    const used = trades.filter((x) => !isFlow(x) && x.date > start.date).sort((a, b) => a.date.localeCompare(b.date));
    for (const x of used) {
      let p = x.price > 0 ? x.price : NaN;
      if (!Number.isFinite(p) && P.C[x.ticker]) { const i = sessionOnOrAfter(P, x.date); if (i >= 0) p = rawPrice(P, raw, x.ticker).open(i); }
      const fee = x.fee > 0 ? x.fee : 0;
      if (x.side === "sell") {
        let left = x.shares;
        const net = Number.isFinite(p) ? (x.shares * p - fee) / x.shares : NaN;
        const lots = q[x.ticker] || [];
        while (left > 1e-9 && lots.length) {
          const lot = lots[0], take = Math.min(left, lot.shares);
          realized.push({ ticker: x.ticker, buy_date: lot.date, sell_date: x.date, shares: take, gain: take * (net - lot.cost), from_start: lot.from_start });
          lot.shares -= take; left -= take;
          if (lot.shares < 1e-9) lots.shift();
        }
      } else {
        (q[x.ticker] ||= []).push({ ticker: x.ticker, date: x.date, shares: x.shares, cost: Number.isFinite(p) ? (x.shares * p + fee) / x.shares : NaN, from_start: false });
      }
    }
    return { lots: Object.values(q).flat().filter((l) => l.shares > 1e-9), realized };
  }

  /* 收益归因：区间（from 之后的第一个交易日起，到最新）内各持仓的盈亏与相对 SPY 的超额。
     - 盈亏（含分红、费用）：当日收盘市值 − 前一日收盘市值 − 买入花费 + 卖出所得 + 分红
     - 相对 SPY：每天把前一日收盘市值按 SPY 当日涨跌（含分红）计机会成本，超额 = 盈亏 − 机会成本
       （当天买入的部分从买入价起算，近似忽略当天的机会成本）
     - 现金：利息 − 前一日现金 × SPY 涨跌
     各项超额相加 ≈ 账户盈亏 − 把同样的资金（同一天存取）一直放在 SPY 的盈亏 */
  function attribution(P, raw, start0, trades0, from, opts = {}) {
    const cashInterest = opts.cashInterest !== false;
    const { start, trades } = splitNormalize(P, raw, start0, trades0);
    const s0 = sessionOnOrBefore(P, start.date);
    if (s0 < 0) throw new Error("起始日期早于价格数据范围");
    const end = P.n - 1;
    const k0 = Math.max(s0, sessionOnOrBefore(P, from)); // 区间基点（这天收盘后开始计）
    const used = trades.filter((x) => x.date > start.date);
    const tickers = [...new Set([...Object.keys(start.positions), ...used.filter((x) => !isFlow(x)).map((x) => x.ticker)])];
    const px = Object.fromEntries(tickers.filter((t) => P.C[t]).map((t) => [t, rawPrice(P, raw, t)]));
    const divAt = Object.fromEntries(tickers.map((t) => [t, Object.fromEntries((raw.corp?.[t]?.div || []).map(([k, d]) => [k, d]))]));
    const lastPx = {};
    const closeAt = (t, i) => { if (px[t]) { const c = px[t].close(i); if (Number.isFinite(c)) lastPx[t] = c; } return lastPx[t]; };
    const sh = Object.fromEntries(tickers.map((t) => [t, start.positions[t] > 0 ? start.positions[t] : 0]));
    for (const t of tickers) closeAt(t, s0);
    const byDay = {};
    for (const x of used) { const i = sessionOnOrAfter(P, x.date); if (i >= 0) (byDay[i] ||= []).push(x); }
    const spy = P.C.SPY;
    const out = Object.fromEntries(tickers.map((t) => [t, { ticker: t, pnl: 0, bench: 0, value_days: 0, has_data: !!px[t] }]));
    let cash = start.cash || 0, interestP = 0, cashBench = 0, flowsP = 0, days = 0;
    const startValue = { v: NaN };
    for (let i = s0 + 1; i <= end; i++) {
      const inP = i > k0;
      const rs = spy && Number.isFinite(spy[i]) && Number.isFinite(spy[i - 1]) ? spy[i] / spy[i - 1] - 1 : 0;
      if (i === k0 + 1) startValue.v = cash + tickers.reduce((a, t) => a + sh[t] * (lastPx[t] ?? 0), 0);
      const prev = Object.fromEntries(tickers.map((t) => [t, sh[t] * (lastPx[t] ?? 0)]));
      const cashPrev = cash;
      let interest = 0;
      if (cashInterest) { interest = cash * (P.rate[i - 1] || 0) * P.gap[i] / 360; cash += interest; }
      const flowT = Object.fromEntries(tickers.map((t) => [t, 0]));
      for (const t of tickers) { const d = divAt[t][i]; if (d && sh[t] > 0) { cash += sh[t] * d; flowT[t] += sh[t] * d; } }
      for (const x of byDay[i] || []) {
        if (isFlow(x)) { cash += flowAmount(x); if (inP) flowsP += flowAmount(x); continue; }
        let p = x.price > 0 ? x.price : px[x.ticker] ? px[x.ticker].open(i) : NaN;
        if (!Number.isFinite(p)) p = lastPx[x.ticker] ?? 0;
        if (!px[x.ticker]) lastPx[x.ticker] = p;
        const fee = x.fee > 0 ? x.fee : 0;
        if (x.side === "sell") { const n = Math.min(x.shares, sh[x.ticker]); sh[x.ticker] -= n; cash += x.shares * p - fee; flowT[x.ticker] += x.shares * p - fee; }
        else { sh[x.ticker] += x.shares; cash -= x.shares * p + fee; flowT[x.ticker] -= x.shares * p + fee; }
        if (Math.abs(sh[x.ticker]) < 1e-9) sh[x.ticker] = 0;
      }
      for (const t of tickers) closeAt(t, i);
      if (!inP) continue;
      days++;
      for (const t of tickers) {
        const o = out[t];
        o.pnl += sh[t] * (lastPx[t] ?? 0) - prev[t] + flowT[t];
        o.bench += prev[t] * rs;
        o.value_days += prev[t];
      }
      interestP += interest;
      cashBench += cashPrev * rs;
    }
    const rows = Object.values(out).filter((o) => Math.abs(o.pnl) > 1e-9 || o.value_days > 0)
      .map((o) => ({ ticker: o.ticker, pnl: o.pnl, excess: o.pnl - o.bench, avg_value: days ? o.value_days / days : 0, has_data: o.has_data }))
      .sort((a, b) => b.pnl - a.pnl);
    const total = rows.reduce((a, r) => a + r.pnl, 0) + interestP;
    const bench = rows.reduce((a, r) => a + (r.pnl - r.excess), 0) + cashBench;
    return { from: P.dates[k0], to: P.dates[end], days, start_value: startValue.v, net_flows: flowsP, rows,
      cash: { interest: interestP, excess: interestP - cashBench }, total_pnl: total, spy_pnl: bench, excess: total - bench };
  }

  const api = { reconcile, evaluateDecisions, compareFollow, parseTrades, applyTrades, reverseTrades, rawPrice, splitNormalize, ledgerBook, fifoLots, attribution };
  root.Recon = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
