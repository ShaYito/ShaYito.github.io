"use strict";
/* 我的持仓：纯计算（不依赖 DOM；node 可 require，用于与 Python portfolio/rebalance.py 做一致性测试）。
   rebalancePlan 与 Python rebalance_plan 同算法：
   - 只调整系统覆盖范围内的标的；范围外持仓保持不动、单列
   - 目标股数向下取整，零头留现金；成本 = 成交额 × bps；现金不足时从目标比例最大的买入逐股减少 */
(function (root) {
  const CASH_KEYS = new Set(["SPAXX", "CASH"]);

  function rebalancePlan(positions, cash, prices, target, systemTickers, costBps = 10) {
    const rate = costBps / 1e4;
    const sys = new Set(systemTickers);
    const tw = Object.fromEntries(Object.entries(target).filter(([t, w]) => !CASH_KEYS.has(t) && w > 0));
    const targetCashW = Math.max(0, 1 - Object.values(tw).reduce((a, b) => a + b, 0));
    const managed = Object.fromEntries(Object.entries(positions).filter(([t]) => sys.has(t)));
    const unmanaged = Object.fromEntries(Object.entries(positions).filter(([t]) => !sys.has(t)).map(([t, s]) => [t, s * (prices[t] ?? NaN)]));
    let names = [...new Set([...Object.keys(managed), ...Object.keys(tw)])].sort();
    const noPrice = names.filter((t) => !((prices[t] || 0) > 0));
    names = names.filter((t) => !noPrice.includes(t));
    const value = Object.fromEntries(names.map((t) => [t, (managed[t] || 0) * prices[t]]));
    const total = Object.values(value).reduce((a, b) => a + b, 0) + cash;
    const tgt = Object.fromEntries(names.map((t) => [t, Math.floor((tw[t] || 0) * total / prices[t] + 1e-9)]));
    const cashAfter = () => {
      let c = cash;
      for (const t of names) { const d = (tgt[t] - (managed[t] || 0)) * prices[t]; c -= d + Math.abs(d) * rate; }
      return c;
    };
    let buys = names.filter((t) => tgt[t] > (managed[t] || 0)).sort((a, b) => (tw[b] || 0) - (tw[a] || 0));
    let guard = 0;
    while (cashAfter() < -1e-9 && buys.length && guard < 10000) {
      for (const t of buys) if (tgt[t] > (managed[t] || 0)) { tgt[t] -= 1; break; }
      buys = buys.filter((t) => tgt[t] > (managed[t] || 0));
      guard++;
    }
    const ca = cashAfter();
    const rows = names.map((t) => {
      const cur = managed[t] || 0, d = tgt[t] - cur, tv = d * prices[t];
      return { ticker: t, price: prices[t], current_shares: cur, target_shares: tgt[t], trade_shares: d, trade_value: tv,
        cost: Math.abs(tv) * rate, current_weight: total ? value[t] / total : 0, target_weight: tw[t] || 0,
        after_weight: total ? tgt[t] * prices[t] / total : 0 };
    });
    rows.sort((a, b) => (a.trade_value >= 0) - (b.trade_value >= 0) || Math.abs(b.trade_value) - Math.abs(a.trade_value));
    const dev = [...rows.map((r) => Math.abs(r.after_weight - r.target_weight)), total ? Math.abs(ca / total - targetCashW) : 0];
    return {
      rows, managed_value: total, cash_before: cash, cash_after: ca, target_cash_weight: targetCashW,
      total_buy: rows.filter((r) => r.trade_value > 0).reduce((a, r) => a + r.trade_value, 0),
      total_sell: -rows.filter((r) => r.trade_value < 0).reduce((a, r) => a + r.trade_value, 0),
      total_cost: rows.reduce((a, r) => a + r.cost, 0), max_deviation: Math.max(...dev), unmanaged, no_price: noPrice,
    };
  }

  /* 解析粘贴文本：每行“代码 股数 [价格]”，分隔符可为空格 / 逗号 / 制表符；“现金 / CASH 金额”设置现金 */
  function parsePasted(text) {
    const positions = {}, prices = {}, errors = [];
    let cash = null;
    for (const [i, raw] of text.split(/\r?\n/).entries()) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      // 优先按空白 / 中文逗号分隔（保留“1,200”这类千分位）；整行没有空白时才按英文逗号分隔（CSV）
      let parts = line.split(/[\s，]+/).filter(Boolean);
      if (parts.length === 1) parts = line.split(",");
      parts = parts.map((x) => x.replace(/,$/, "").trim()).filter(Boolean);
      const key = parts[0].toUpperCase().replace(/\./g, "-");
      const n = parseFloat((parts[1] || "").replace(/[$,]/g, ""));
      if (!Number.isFinite(n) || n < 0) { errors.push(`第 ${i + 1} 行无法识别：${raw}`); continue; }
      if (key === "CASH" || key === "现金" || key === "SPAXX") { cash = (cash || 0) + n; continue; }
      if (!/^[A-Z0-9^][A-Z0-9\-=^]{0,11}$/.test(key)) { errors.push(`第 ${i + 1} 行代码无效：${parts[0]}`); continue; }
      positions[key] = (positions[key] || 0) + n;
      const p = parseFloat((parts[2] || "").replace(/[$,]/g, ""));
      if (Number.isFinite(p) && p > 0) prices[key] = p;
    }
    return { positions, prices, cash, errors };
  }

  const api = { rebalancePlan, parsePasted };
  root.HoldingsCalc = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
