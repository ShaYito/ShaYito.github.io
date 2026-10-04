"use strict";
/* 相对大盘走势（纯计算，不依赖 DOM；node 可直接 require，用于与 Python 参考实现做一致性测试）。

   - 相对大盘：每日超额收益 = 个股日收益 − 基准日收益，按日复利累计：Π(1 + r_s − r_m) − 1
   - 剔除 beta：每日残差收益 = r_s − β_t × r_m，按日复利累计；
     β_t 只用 t 之前（不含 t）最近 WIN 个交易日中双方都有收益的日子估计（OLS：Cov / Var），至少 MIN_OBS 个，
     不使用未来数据
   输入为同一日期轴上的复权收盘价数组（缺失为 null）。 */
(function (root) {
  const WIN = 252;
  const MIN_OBS = 120;

  function returns(c) {
    const out = new Array(c.length).fill(null);
    for (let i = 1; i < c.length; i++) if (c[i] != null && c[i - 1] != null && c[i - 1] > 0) out[i] = c[i] / c[i - 1] - 1;
    return out;
  }

  /* 滚动 beta：β_i 用索引 [i − win, i − 1] 内双方都有收益的日子 */
  function rollingBeta(rs, rm, win = WIN, minObs = MIN_OBS) {
    const n = rs.length, out = new Array(n).fill(null);
    let k = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    const add = (j, s) => {
      if (j < 0 || rs[j] == null || rm[j] == null) return;
      k += s; sx += s * rm[j]; sy += s * rs[j]; sxx += s * rm[j] * rm[j]; sxy += s * rm[j] * rs[j];
    };
    for (let i = 0; i < n; i++) {
      if (i >= 1) add(i - 1, 1);
      if (i - win - 1 >= 0) add(i - win - 1, -1);
      if (k >= minObs) {
        const cov = sxy / k - (sx / k) * (sy / k), v = sxx / k - (sx / k) ** 2;
        out[i] = v > 0 ? cov / v : null;
      }
    }
    return out;
  }

  /* 每日超额（rel）与残差（resid）收益、滚动 beta */
  function daily(sc, bc, opts = {}) {
    const rs = returns(sc), rm = returns(bc);
    const beta = rollingBeta(rs, rm, opts.win || WIN, opts.minObs || MIN_OBS);
    const rel = rs.map((x, i) => (x != null && rm[i] != null ? x - rm[i] : null));
    const resid = rs.map((x, i) => (x != null && rm[i] != null && beta[i] != null ? x - beta[i] * rm[i] : null));
    return { rel, resid, beta };
  }

  /* 区间 [i0, i1] 内累计（i0 处为 0）；个股在 i0 之后才有数据时从首个有价格的日子起算，之前为 null */
  function cum(x, sc, i0, i1) {
    const out = [];
    let lvl = null;
    for (let i = i0; i <= i1; i++) {
      if (lvl == null) { if (sc[i] != null) lvl = 1; out.push(lvl == null ? null : 0); continue; }
      if (x[i] != null) lvl *= 1 + x[i];
      out.push(lvl - 1);
    }
    return out;
  }

  /* 最近 n 个交易日的累计（不足 n 日或缺少数据时为 null） */
  function trailing(x, end, n) {
    if (end - n + 1 < 1) return null;
    let lvl = 1, k = 0;
    for (let i = end - n + 1; i <= end; i++) if (x[i] != null) { lvl *= 1 + x[i]; k++; }
    return k >= n * 0.8 ? lvl - 1 : null;
  }

  const api = { WIN, MIN_OBS, returns, rollingBeta, daily, cum, trailing };
  root.RelStr = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
