"use strict";
/* 模拟经营：浏览器端回测引擎（纯计算，不依赖 DOM；node 可直接 require，用于与 Python 引擎做一致性测试）。

   规则与 backtest/engine.py 的 simulate 完全一致：
   - 信号在交易日 i 收盘后产生，于 i+1 开盘按目标权重成交；成交额 × 成本（单边 bps）从净值中扣除
   - 未投资部分为现金，按 ^IRX 年化利率计息：利率取前一交易日，按自然日 / 360
   - 某标的某日无价格（未上市 / 停牌）时收益视为 0
   指标公式同 backtest/metrics.py 的 performance_metrics。
   定投：每月第一个交易日开盘追加资金，按当时单位净值折算份额（净值指数 = 时间加权收益）；新资金按最近目标权重买入
   （只买入新增部分、不调整已有持仓，成本按买入金额计），当天若同时有调仓信号则随后照常调仓。 */
(function (root) {
  const TD = 252;

  // ---------------- 数据准备 ----------------
  function dayNum(d) { return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000; }
  function prepare(raw) {
    const n = raw.dates.length;
    const day = raw.dates.map(dayNum);
    const toArr = (a) => Float64Array.from(a, (v) => (v == null ? NaN : v));
    const O = {}, C = {};
    for (const a of raw.assets) { O[a.ticker] = toArr(raw.open[a.ticker]); C[a.ticker] = toArr(raw.close[a.ticker]); }
    const rate = toArr(raw.cash_rate);
    for (let i = 1; i < n; i++) if (!Number.isFinite(rate[i])) rate[i] = rate[i - 1];
    const gap = new Float64Array(n);
    gap[0] = 1;
    for (let i = 1; i < n; i++) gap[i] = day[i] - day[i - 1];
    const idx = Object.fromEntries(raw.dates.map((d, i) => [d, i]));
    return { dates: raw.dates, day, n, O, C, rate, gap, idx, assets: raw.assets, costBps: raw.cost_bps,
      backtestStart: raw.dates.findIndex((d) => d >= raw.backtest_start) };
  }
  const ratio = (a, b) => { const r = a / b; return Number.isFinite(r) ? r : 1; };
  function indexOnOrAfter(P, date) { let i = P.dates.findIndex((d) => d >= date); return i < 0 ? P.n - 1 : i; }
  function indexOnOrBefore(P, date) { let i = -1; for (let k = 0; k < P.n && P.dates[k] <= date; k++) i = k; return Math.max(i, 0); }

  // ---------------- 指标 ----------------
  function ma(arr, i, w) {
    if (i + 1 < w) return NaN;
    let s = 0;
    for (let k = i - w + 1; k <= i; k++) { if (!Number.isFinite(arr[k])) return NaN; s += arr[k]; }
    return s / w;
  }
  function realizedVol(arr, i, w) {
    if (i < w) return NaN;
    const r = [];
    for (let k = i - w + 1; k <= i; k++) { const x = arr[k] / arr[k - 1] - 1; if (Number.isFinite(x)) r.push(x); }
    if (r.length < w * 0.8) return NaN;
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(TD);
  }
  function cashGrowth(P, from, to) { // 现金在 (from, to] 的累计增长
    let g = 1;
    for (let k = from + 1; k <= to; k++) g *= 1 + (P.rate[k - 1] || 0) * P.gap[k] / 360;
    return g;
  }

  // ---------------- 引擎 ----------------
  /* strategy: { assets: [...], onClose(i, state) → 目标权重对象 | null, lastTarget }
     opts: { start, end, costBps, initial, monthly } —— start 为第一个可成交日（信号取 start-1 收盘） */
  function run(P, strategy, opts) {
    const assets = strategy.assets;
    const m = assets.length;
    const O = assets.map((t) => P.O[t]), C = assets.map((t) => P.C[t]);
    const costRate = (opts.costBps ?? P.costBps) / 1e4;
    const start = Math.max(1, opts.start), end = Math.min(P.n - 1, opts.end);
    let v = new Float64Array(m);
    let cash = opts.initial ?? 1;
    let units = cash;
    let invested = cash;
    const navIdx = [], value = [], dates = [], turnover = [], costs = [], trades = [], weightsHist = [], flows = [];
    const pnl = new Float64Array(m);
    let interest = 0, costSum = 0;
    let pending = strategy.onClose(start - 1, { i: start - 1, weights: {}, nav: cash, first: true });
    for (let i = start; i <= end; i++) {
      if (i > start) { const acc = cash * (P.rate[i - 1] || 0) * P.gap[i] / 360; cash += acc; interest += acc; }
      const contribute = i > start && opts.monthly > 0 && P.dates[i].slice(0, 7) !== P.dates[i - 1].slice(0, 7);
      const atOpen = !!pending || contribute;
      // 需要在开盘成交的日子：先把持仓重估到开盘价
      if (atOpen && i > start) for (let j = 0; j < m; j++) { const nv = v[j] * ratio(O[j][i], C[j][i - 1]); pnl[j] += nv - v[j]; v[j] = nv; }
      if (contribute) {
        const navOpen = v.reduce((a, b) => a + b, 0) + cash;
        units += opts.monthly * units / navOpen;
        cash += opts.monthly;
        invested += opts.monthly;
        flows.push({ date: P.dates[i], amount: opts.monthly });
        if (!pending && strategy.lastTarget) {
          const tr = [];
          let buyCost = 0;
          assets.forEach((t, j) => {
            const x = strategy.lastTarget[t] || 0;
            if (x > 0 && Number.isFinite(O[j][i])) {
              const buy = opts.monthly * x;
              v[j] += buy; cash -= buy * (1 + costRate); buyCost += buy * costRate;
              tr.push({ ticker: t, amount: buy, price: O[j][i] });
            }
          });
          costSum += buyCost;
          if (tr.length) trades.push({ date: P.dates[i], nav: navOpen + opts.monthly, items: tr, contribution: true });
        }
      }
      if (pending) {
        const navPre = v.reduce((a, b) => a + b, 0) + cash;
        const w = new Float64Array(m);
        assets.forEach((t, j) => { const x = pending[t] || 0; w[j] = x > 0 && Number.isFinite(O[j][i]) ? x : 0; });
        let trade = 0;
        for (let j = 0; j < m; j++) trade += Math.abs(w[j] * navPre - v[j]);
        const cost = trade * costRate;
        const navPost = navPre - cost;
        const tr = [];
        for (let j = 0; j < m; j++) {
          const target = w[j] * navPost;
          if (Math.abs(target - v[j]) > navPre * 1e-4) tr.push({ ticker: assets[j], amount: target - v[j], price: O[j][i] });
          v[j] = target;
        }
        cash = navPost - v.reduce((a, b) => a + b, 0);
        turnover.push({ i, value: trade / navPre });
        costs.push({ i, value: cost / navPre });
        costSum += cost;
        if (tr.length) trades.push({ date: P.dates[i], nav: navPre, items: tr });
        weightsHist.push({ date: P.dates[i], weights: Object.fromEntries(assets.map((t, j) => [t, w[j]]).filter(([, x]) => x > 0)) });
        pending = null;
      }
      if (atOpen) {
        for (let j = 0; j < m; j++) { const nv = v[j] * ratio(C[j][i], O[j][i]); pnl[j] += nv - v[j]; v[j] = nv; }
      } else if (i > start) {
        for (let j = 0; j < m; j++) { const nv = v[j] * ratio(C[j][i], C[j][i - 1]); pnl[j] += nv - v[j]; v[j] = nv; }
      }
      const nav = v.reduce((a, b) => a + b, 0) + cash;
      navIdx.push(nav / units);
      value.push(nav);
      dates.push(P.dates[i]);
      if (i < end) {
        const weights = {};
        assets.forEach((t, j) => { if (v[j] > 0) weights[t] = v[j] / nav; });
        pending = strategy.onClose(i, { i, weights, nav }) || pending;
      }
    }
    const idx0 = navIdx[0];
    return {
      dates, value, nav: navIdx.map((x) => x / idx0), turnover, costs, trades, weightsHist, flows,
      invested, final: value[value.length - 1],
      pnl: Object.fromEntries(assets.map((t, j) => [t, pnl[j]])), interest, costSum,
      start, end,
    };
  }

  // ---------------- 指标（同 backtest/metrics.performance_metrics） ----------------
  function metrics(P, res) {
    const nav = res.nav, n = nav.length;
    if (n < 3) return {};
    const r = [], ex = [];
    for (let k = 1; k < n; k++) {
      const ret = nav[k] / nav[k - 1] - 1;
      const i = res.start + k, iPrev = res.start + k - 1;
      // daily_rf：在收益序列自身的索引上 shift(1)，首个元素为 0
      const rf = k === 1 ? 0 : (P.rate[iPrev] || 0) * (P.day[i] - P.day[iPrev]) / 360;
      r.push(ret); ex.push(ret - rf);
    }
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const std = (a) => { const mu = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - mu) ** 2, 0) / (a.length - 1)); };
    const years = Math.max((P.day[res.end] - P.day[res.start]) / 365.25, 1e-9);
    const cagr = (nav[n - 1] / nav[0]) ** (1 / years) - 1;
    const sd = std(r);
    const downside = Math.sqrt(mean(ex.map((x) => Math.min(x, 0) ** 2))) * Math.sqrt(TD);
    let peak = -Infinity, mdd = 0, ddStart = 0, ddTrough = 0, curPeakK = 0;
    for (let k = 0; k < n; k++) {
      if (nav[k] > peak) { peak = nav[k]; curPeakK = k; }
      const dd = nav[k] / peak - 1;
      if (dd < mdd) { mdd = dd; ddStart = curPeakK; ddTrough = k; }
    }
    let recover = null;
    for (let k = ddTrough; k < n; k++) if (nav[k] >= nav[ddStart]) { recover = k; break; }
    // 周胜率：按周五结束的周取最后一个净值
    const weekly = [];
    let lastWeek = null;
    for (let k = 0; k < n; k++) {
      const d = P.day[res.start + k];
      const fri = d + ((4 - ((d + 3) % 7) + 7) % 7); // 1970-01-01 为周四（周一 = 0 时为 3）；取当日或之后的周五
      if (fri !== lastWeek) { weekly.push(nav[k]); lastWeek = fri; } else weekly[weekly.length - 1] = nav[k];
    }
    let win = 0;
    for (let k = 1; k < weekly.length; k++) if (weekly[k] / weekly[k - 1] - 1 > 0) win++;
    const t = res.turnover.map((x) => x.value);
    return {
      CAGR: cagr, Volatility: sd * Math.sqrt(TD),
      Sharpe: sd > 0 ? mean(ex) / sd * Math.sqrt(TD) : NaN,
      Sortino: downside > 0 ? mean(ex) * TD / downside : NaN,
      MaxDrawdown: mdd, Calmar: mdd < 0 ? cagr / Math.abs(mdd) : NaN,
      WinRate: weekly.length > 1 ? win / (weekly.length - 1) : NaN,
      TotalReturn: nav[n - 1] / nav[0] - 1, Years: years,
      Turnover: t.length > 1 ? t.slice(1).reduce((a, b) => a + b, 0) / 2 / years : NaN,
      ddPeak: res.dates[ddStart], ddTrough: res.dates[ddTrough], ddRecover: recover != null ? res.dates[recover] : null,
    };
  }
  function drawdown(nav) { let p = -Infinity; return nav.map((x) => { p = Math.max(p, x); return x / p - 1; }); }
  function monthly(res) {
    const out = {};
    let prev = res.nav[0], cur = null, key = null;
    res.dates.forEach((d, k) => {
      const mk = d.slice(0, 7);
      if (key !== null && mk !== key) { out[key] = cur / prev - 1; prev = cur; }
      key = mk; cur = res.nav[k];
    });
    if (key !== null) out[key] = cur / prev - 1;
    return out; // {"2020-03": -0.12, ...}
  }

  // ---------------- 策略 ----------------
  const weekKey = (day) => Math.floor((day + 3) / 7); // 以周一为一周开始
  function periodEnd(P, i, freq) {
    if (i >= P.n - 1) return true;
    const a = P.dates[i], b = P.dates[i + 1];
    if (freq === "W") return weekKey(P.day[i]) !== weekKey(P.day[i + 1]);
    if (freq === "M") return a.slice(0, 7) !== b.slice(0, 7);
    if (freq === "Q") return a.slice(0, 4) !== b.slice(0, 4) || Math.floor((+a.slice(5, 7) - 1) / 3) !== Math.floor((+b.slice(5, 7) - 1) / 3);
    if (freq === "Y") return a.slice(0, 4) !== b.slice(0, 4);
    return false;
  }
  const sumW = (w) => Object.values(w).reduce((a, b) => a + b, 0);
  function capWeights(w, cap) { // 水位填充：单个权重不超过 cap，超出部分按比例分给未封顶者
    const total = sumW(w);
    let out = { ...w };
    for (let it = 0; it < 20; it++) {
      const over = Object.keys(out).filter((k) => out[k] > cap + 1e-12);
      if (!over.length) break;
      let excess = 0;
      over.forEach((k) => { excess += out[k] - cap; out[k] = cap; });
      const free = Object.keys(out).filter((k) => out[k] < cap - 1e-12);
      const fs = free.reduce((a, k) => a + out[k], 0);
      if (!free.length || fs <= 0) break;
      free.forEach((k) => { out[k] += excess * out[k] / fs; });
    }
    const s = sumW(out);
    return s > total + 1e-9 ? Object.fromEntries(Object.entries(out).map(([k, x]) => [k, x * total / s])) : out;
  }

  /* cfg:
     mode: fixed | invvol | momentum | system | system_custom
     weights: {ticker: 目标比例}（fixed / invvol / momentum 使用其中的标的；比例合计 = 风险资产预算，其余为现金）
     rebalance: none | M | Q | Y | band（system 模式固定为每周信号）
     band: 偏离阈值（绝对值，如 0.05）
     topN, momentumLookback(月)
     overlays: { trend: bool, trendMA: 200, volTarget: 0 或年化目标, stop: 0 或回撤比例 }
     system / system_custom 需要 sys（sim/system.json）；system_custom 可覆盖 layers（各 regime 四层比例）与 topN */
  function makeStrategy(P, cfg, sys) {
    const ov = cfg.overlays || {};
    const userW = Object.fromEntries(Object.entries(cfg.weights || {}).filter(([t, x]) => x > 0 && P.C[t]));
    const budget = Math.min(1, sumW(userW));
    const sysIdx = {};
    if (sys && sys.dates) sys.dates.forEach((d, k) => { const i = P.idx[d]; if (i != null) sysIdx[i] = k; });
    let assets = Object.keys(userW);
    if (cfg.mode === "system" || cfg.mode === "system_custom") {
      const set = new Set();
      if (cfg.mode === "system") sys.targets.forEach((w) => Object.keys(w).forEach((t) => set.add(t)));
      else { sys.tickers.forEach((t) => set.add(t)); sys.core.forEach((t) => set.add(t)); sys.hedge.forEach((t) => set.add(t)); }
      assets = [...set].filter((t) => P.C[t]);
    }
    const valid = (t, i) => Number.isFinite(P.C[t][i]);

    function base(i, cur) {
      if (cfg.mode === "fixed") {
        return Object.fromEntries(Object.entries(userW).filter(([t]) => valid(t, i)));
      }
      if (cfg.mode === "invvol") {
        const inv = {};
        for (const t of Object.keys(userW)) { const vol = realizedVol(P.C[t], i, 60); if (Number.isFinite(vol)) inv[t] = 1 / Math.max(vol, 0.05); }
        const s = sumW(inv);
        return Object.fromEntries(Object.entries(inv).map(([t, x]) => [t, x / s * budget]));
      }
      if (cfg.mode === "momentum") {
        const L = Math.round((cfg.momentumLookback || 12) * 21);
        const hurdle = cashGrowth(P, Math.max(0, i - L), i - 21) - 1;
        const scored = Object.keys(userW).map((t) => ({ t, m: P.C[t][i - 21] / P.C[t][i - L] - 1 })).filter((x) => Number.isFinite(x.m));
        scored.sort((a, b) => b.m - a.m);
        const n = Math.max(1, cfg.topN || 3);
        const pick = scored.slice(0, n).filter((x) => x.m > hurdle); // 绝对动量：跑输现金则该份额留在现金
        return Object.fromEntries(pick.map((x) => [x.t, budget / n]));
      }
      if (cfg.mode === "system") return { ...sys.targets[sysIdx[i]] };
      if (cfg.mode === "system_custom") {
        const k = sysIdx[i];
        const regime = sys.regime[k];
        const layers = (cfg.layers && cfg.layers[regime]) || sys.regime_weights[regime];
        const n = cfg.topN || sys.top_n;
        const ranked = sys.tickers.map((t, j) => ({ t, s: sys.scores[k]?.[j] })).filter((x) => x.s != null && valid(x.t, i)).sort((a, b) => b.s - a.s);
        const keep = ranked.slice(0, n + sys.turnover_buffer).filter((x) => cur.has(x.t)).map((x) => x.t);
        const pick = [...keep];
        for (const x of ranked) { if (pick.length >= n) break; if (!pick.includes(x.t)) pick.push(x.t); }
        const inv = {};
        pick.forEach((t) => { const vol = realizedVol(P.C[t], i, 60); inv[t] = 1 / Math.max(Number.isFinite(vol) ? vol : 0.3, sys.vol_floor); });
        const s = sumW(inv);
        let sat = Object.fromEntries(Object.entries(inv).map(([t, x]) => [t, x / s * layers.satellite]));
        sat = capWeights(sat, sys.max_single);
        const w = { ...sat };
        sys.core.forEach((t) => { w[t] = (w[t] || 0) + layers.core / sys.core.length; });
        sys.hedge.forEach((t) => { w[t] = (w[t] || 0) + layers.hedge / sys.hedge.length; });
        return w;
      }
      return {};
    }
    function applyOverlays(i, w) {
      let out = { ...w };
      if (ov.trend) {
        const L = ov.trendMA || 200;
        for (const t of Object.keys(out)) { const m = ma(P.C[t], i, L); if (Number.isFinite(m) && P.C[t][i] < m) delete out[t]; }
      }
      if (ov.volTarget > 0) {
        // 以目标权重估算组合过去 60 日年化波动；高于目标则整体按比例降仓（不加杠杆）
        const r = [];
        for (let k = i - 59; k <= i; k++) {
          let x = 0;
          for (const [t, wt] of Object.entries(out)) { const q = P.C[t][k] / P.C[t][k - 1] - 1; if (Number.isFinite(q)) x += wt * q; }
          r.push(x);
        }
        const mu = r.reduce((a, b) => a + b, 0) / r.length;
        const vol = Math.sqrt(r.reduce((a, b) => a + (b - mu) ** 2, 0) / (r.length - 1)) * Math.sqrt(TD);
        if (vol > 0) { const sc = Math.min(1, ov.volTarget / vol); out = Object.fromEntries(Object.entries(out).map(([t, x]) => [t, x * sc])); }
      }
      if (sumW(out) > 1) { const s = sumW(out); out = Object.fromEntries(Object.entries(out).map(([t, x]) => [t, x / s])); }
      return out;
    }
    const peak = {}, stopped = new Set();
    let lastBase = null;
    const st = {
      assets, lastTarget: null,
      onClose(i, state) {
        const cur = new Set(Object.keys(state.weights || {}));
        // 移动止损：持仓从持有期间最高收盘价回落超过 stop → 次日开盘卖出，直到下一次定期调仓
        let stopHit = false;
        if (ov.stop > 0 && !state.first) {
          for (const t of Object.keys(peak)) if (!cur.has(t)) delete peak[t];
          for (const t of cur) {
            peak[t] = Math.max(peak[t] || 0, P.C[t][i]);
            if (P.C[t][i] < peak[t] * (1 - ov.stop)) { stopped.add(t); stopHit = true; delete peak[t]; }
          }
        }
        let due;
        if (cfg.mode === "system" || cfg.mode === "system_custom") due = sysIdx[i] != null;
        else if (state.first) due = true;
        else if (cfg.rebalance === "band") due = periodEnd(P, i, "W") && lastBase && Object.keys({ ...lastBase, ...state.weights })
          .some((t) => Math.abs((state.weights[t] || 0) - (lastBase[t] || 0)) > (cfg.band || 0.05));
        else if (cfg.rebalance && cfg.rebalance !== "none") due = periodEnd(P, i, cfg.rebalance);
        else due = ov.trend ? periodEnd(P, i, "M") : false; // 买入持有 + 趋势过滤：每月检查一次均线
        if (state.first && (cfg.mode === "system" || cfg.mode === "system_custom")) {
          // 起点前最近一期系统信号
          let k = i; while (k >= 0 && sysIdx[k] == null) k--;
          if (k < 0) return null;
          const w = applyOverlays(i, baseAt(k, cur));
          st.lastTarget = w; lastBase = w; return w;
        }
        if (due) {
          stopped.clear();
          const w = applyOverlays(i, base(i, cur));
          st.lastTarget = w; lastBase = w;
          return w;
        }
        if (stopHit) {
          const w = { ...state.weights };
          stopped.forEach((t) => delete w[t]);
          return w;
        }
        return null;
      },
    };
    function baseAt(k, cur) { return base(k, cur); }
    return st;
  }

  const api = { prepare, run, metrics, drawdown, monthly, makeStrategy, indexOnOrAfter, indexOnOrBefore, periodEnd, capWeights };
  root.Sim = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
