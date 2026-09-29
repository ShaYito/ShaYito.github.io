"use strict";
/* 系统模型：定义（取自 config，与实际运行一致）、每个组成部分的研究依据与证据强度、本系统的实测结果与局限。 */

const EVID = { strong: ["较强", "good"], mid: ["中等", "info"], weak: ["较弱", "medium"], against: ["研究结论相反", "high"], none: ["无直接研究", "medium"] };
const evid = (k) => `<span class="chip evid-${k}">${EVID[k][0]}</span>`;
const REFS = {
  faber: "Faber, M. (2007). A Quantitative Approach to Tactical Asset Allocation. Journal of Wealth Management.",
  tsmom: "Moskowitz, T., Ooi, Y. H., & Pedersen, L. H. (2012). Time Series Momentum. Journal of Financial Economics.",
  volman: "Moreira, A., & Muir, T. (2017). Volatility-Managed Portfolios. Journal of Finance.",
  curve: "Estrella, A., & Mishkin, F. (1998). Predicting U.S. Recessions: Financial Variables as Leading Indicators. Review of Economics and Statistics.",
  blb: "Brock, W., Lakonishok, J., & LeBaron, B. (1992). Simple Technical Trading Rules and the Stochastic Properties of Stock Returns. Journal of Finance.",
  stw: "Sullivan, R., Timmermann, A., & White, H. (1999). Data-Snooping, Technical Trading Rule Performance, and the Bootstrap. Journal of Finance.",
  jt: "Jegadeesh, N., & Titman, S. (1993). Returns to Buying Winners and Selling Losers. Journal of Finance.",
  crash: "Daniel, K., & Moskowitz, T. (2016). Momentum Crashes. Journal of Financial Economics.",
  mg: "Moskowitz, T., & Grinblatt, M. (1999). Do Industries Explain Momentum? Journal of Finance.",
  ahxz: "Ang, A., Hodrick, R., Xing, Y., & Zhang, X. (2006). The Cross-Section of Volatility and Expected Returns. Journal of Finance.",
  bbw: "Baker, M., Bradley, B., & Wurgler, J. (2011). Benchmarks as Limits to Arbitrage: Understanding the Low-Volatility Anomaly. Financial Analysts Journal.",
  rev: "Jegadeesh, N. (1990). Evidence of Predictable Behavior of Security Returns. Journal of Finance；Lehmann, B. (1990). Fads, Martingales, and Market Efficiency. Quarterly Journal of Economics.",
  ann: "Frazzini, A., & Lamont, O. (2007). The Earnings Announcement Premium and Trading Volume. NBER Working Paper；Savor, P., & Wilson, M. (2016). Earnings Announcements and Systematic Risk. Journal of Finance.",
  hvol: "Gervais, S., Kaniel, R., & Mingelgrin, D. (2001). The High-Volume Return Premium. Journal of Finance.",
  gk: "Grinold, R., & Kahn, R. (2000). Active Portfolio Management (2nd ed.). McGraw-Hill.",
  gkx: "Gu, S., Kelly, B., & Xiu, D. (2020). Empirical Asset Pricing via Machine Learning. Review of Financial Studies.",
  tetlock: "Tetlock, P. (2007). Giving Content to Investor Sentiment: The Role of Media in the Stock Market. Journal of Finance.",
  mp: "McLean, R. D., & Pontiff, J. (2016). Does Academic Research Destroy Stock Return Predictability? Journal of Finance.",
  dgu: "DeMiguel, V., Garlappi, L., & Uppal, R. (2009). Optimal Versus Naive Diversification: How Inefficient Is the 1/N Portfolio Strategy? Review of Financial Studies.",
  mrt: "Maillard, S., Roncalli, T., & Teïletche, J. (2010). The Properties of Equally Weighted Risk Contribution Portfolios. Journal of Portfolio Management.",
};
const REF_ORDER = Object.keys(REFS);
const cite = (...keys) => keys.map((k) => `<sup><a href="#ref-${k}" class="cite">[${REF_ORDER.indexOf(k) + 1}]</a></sup>`).join("");

const MODEL_HOWTO = [
  "这一页把“系统模型”拆成四步：① 判断[[regime|市场状态]] → ② 决定四层资金比例 → ③ 用四个模型给股票打分并融合 → ④ 构建卫星层组合。每一步都写明：具体怎么算（参数直接取自系统配置，与每周实际运行一致）、有什么研究依据、证据强不强，以及本系统自己的回测结果。",
  "“证据强度”是对学术研究的概括：较强 = 多个市场、多个时期被反复验证；中等 = 有研究支持但效果随时期变化或较小；较弱 = 研究结论不一致或主要是业界经验；研究结论相反 = 有研究表明该规则的方向可能不利于收益（本系统把它当作风险控制）。",
  "所有回测都是[[simulated|模拟]]：[[oos|样本外]]从 2019 年开始，选股池是今天挑出来的公司（[[survivorship|幸存者偏差]]），收益会被高估。判断模型有没有“选股能力”，关键看 [[rank_ic|Rank IC]]，而不是回测收益。",
];

PAGES.model = async () => {
  const m = await load("model.json");
  const ev = m.evidence;
  const sel = (k) => ev?.selection?.[`OOS|${k}`] || {};
  const selIS = (k) => ev?.selection?.[`IS|${k}`] || {};
  const pf = (k) => ev?.portfolio?.[`OOS|${k}`] || {};
  const lw = m.layers.weights;
  const R = m.rules;
  const cur = m.current || {};
  const ew = cur.ensemble_weights || {};
  const si = cur.sentiment_weight_info;
  const states = [["risk_on", "进攻"], ["neutral", "中性"], ["risk_off", "防守"]];
  const layerZh = { core: `核心（${m.layers.core.join("/")}）`, satellite: "卫星（选股）", hedge: `对冲（${m.layers.hedge.join("/")}）`, cash: `现金（${m.layers.cash.join("/")}）` };
  const p2 = (v) => pct(v, 1), sr = (v) => num(v, 2), ic = (v) => (isNum(v) ? num(v, 3, true) : "–");
  const dSharpe = (a, b) => (isNum(pf(a).Sharpe) && isNum(pf(b).Sharpe) ? pf(a).Sharpe - pf(b).Sharpe : null);
  const dDD = (a, b) => (isNum(pf(a).MaxDrawdown) && isNum(pf(b).MaxDrawdown) ? pf(a).MaxDrawdown - pf(b).MaxDrawdown : null);
  const ruleRows = [
    ["收盘价高于 200 日均线", `+${R.above_ma200}`, "长期趋势向上", cite("blb", "stw"), "weak"],
    ["50 日均线高于 200 日均线（“金叉”状态）", `+${R.golden_cross}`, "中期趋势强于长期", cite("blb", "stw"), "weak"],
    ["12-1 动量（过去 12 个月、跳过最近 1 个月的涨幅）截面前 1/3", `+${R.momentum_top_third}（后 1/3 扣 ${R.momentum_top_third}）`, "强者恒强", cite("jt", "crash"), "strong"],
    ["12 周相对所属主题基准为正", `+${R.rs_theme_positive}`, "行业内相对强势", cite("mg"), "mid"],
    ["12 周相对 SPY 为正", `+${R.rs_spy_positive}`, "相对大盘强势", cite("jt"), "mid"],
    [`ADX > ${R.strong_trend_adx} 且价格在 50 日均线上方`, `+${R.strong_trend_score}`, "趋势强度高", "", "none"],
    [`60 日波动率位于截面前 ${pct(1 - R.high_vol_quantile, 0)}`, `−${R.high_vol_penalty}`, "低波动异象：高波动股长期回报偏低", cite("ahxz", "bbw"), "mid"],
    [`收盘价高于 20 日均线 ${pct(R.overextended_ma20, 0)} 以上`, `−${R.overextended_penalty}`, "短期涨太多，容易回落（短期反转）", cite("rev"), "mid"],
    [`${R.earnings_within_days} 个交易日内发布财报`, `−${R.earnings_penalty}`, "规避财报跳空的事件风险", cite("ann"), "against"],
    ["成交量放大（5 日 / 60 日）且近 1 周上涨", `+${R.volume_breakout_score}`, "放量上涨，关注度提高", cite("hvol"), "mid"],
  ];
  const models = [
    ["A_rules", "A 规则打分", `上表 ${ruleRows.length} 条规则加总，逻辑完全透明`],
    ["B_multifactor", "B 多因子", `${m.multifactor.factors.length} 个技术因子的截面 z 分数加权；权重 = 过去 ${m.multifactor.lookback} 周每个因子已实现的 Rank IC 均值（保留正负号）`],
    ["C_lgbm", "C 机器学习（LightGBM）", `用同一批因子训练梯度提升树，预测未来 ${m.backtest.forward_days} 个交易日相对 SPY 的超额收益排名；滚动 ${m.lgbm.window} 周窗口、每 ${m.lgbm.retrain_weeks} 周重训`],
    ["D_sentiment", "D 新闻情绪", "近 7 天新闻情绪（按来源标准化）+ 0.5 × 情绪变化，按篇数打折"],
  ];
  const insights = [
    { level: "high", kind: "derived", text: `选股模型在[[oos|样本外]]没有稳定的预测力：${models.filter(([k]) => isNum(sel(k).RankIC)).map(([k, n]) => `${n.split(" ")[0]} ${ic(sel(k).RankIC)}`).join("、")}（[[rank_ic|Rank IC]]，0 = 没有预测力），命中率都在 50% 上下。` },
    { level: "medium", kind: "simulated", text: `把卫星层换成选股池[[allocation|等权]]，样本外夏普 ${sr(pf("Regime_EW").Sharpe)}，反而略高于按模型选股的 ${sr(pf("Regime_Quant").Sharpe)}。` },
    { level: "good", kind: "simulated", text: `市场状态调仓的价值更明确：相对固定比例，夏普提高 ${num(dSharpe("Regime_Quant", "Static_Quant"), 2, true)}（模型选股）/ ${num(dSharpe("Regime_EW", "Static_EW"), 2, true)}（等权）；最大回撤变化 ${ppText(dDD("Regime_Quant", "Static_Quant"))} / ${ppText(dDD("Regime_EW", "Static_EW"))} 个百分点（正 = 回撤更小）。` },
    { level: "medium", kind: "simulated", text: `相对 SPY 的大幅超额（年化 ${p2(pf("Regime_Quant").CAGR)} vs ${p2(pf("SPY").CAGR)}）主要来自选股池本身：选股池等权年化 ${p2(sel("Pool_EW").CAGR)}，这是“用今天的赢家回测过去”的[[survivorship|幸存者偏差]]，不能当作未来预期。` },
  ];
  // 表格等处的 [[术语|文字]] 统一换成可点击的术语链接
  const terms = (html) => html.replace(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g, (_, id, t) => term(id, t));
  app().innerHTML = terms(`
    <h2>系统模型 <span class="muted">定义、依据与实测 · 参数与系统配置同步${ev ? ` · 回测数据截至 ${esc(ev.data_end)}` : ""}</span></h2>
    ${howto(MODEL_HOWTO)}${ev ? insightBox(insights, 4) : ""}
    <section class="card"><h3>一句话概括</h3>
      <p>每周五收盘后，先根据大盘趋势、恐慌指数和收益率曲线判断市场处于<b>进攻 / 中性 / 防守</b>，据此决定四层资金比例；再从 ${m.universe.n} 只股票中用四个模型打分、按各自的历史表现加权融合，选出前 ${m.satellite.top_n} 只，按“波动越小、分数越高给得越多”分配卫星层资金，并限制单只和单主题上限。建议在下周一开盘执行。</p>
      <div class="flow">${["数据（周五收盘）", "① 市场状态", "② 四层比例", "③ 选股打分与融合", "④ 组合构建", "每周建议"].map((x) => `<span>${x}</span>`).join('<b aria-hidden="true">→</b>')}</div></section>

    <section class="card"><h3>时间与数据纪律 ${badge("fact")}</h3><ul>
      <li>信号日 = 周五收盘；建议按下一个交易日（通常周一）开盘价执行，回测也按开盘价成交，每次买卖扣 ${num(m.backtest.cost_bps, 0)} bps（0.1%）成本；不计税。</li>
      <li><b>只用当时可得的数据</b>：任何一周的计算都只用该周五及之前的数据；收益率曲线按发布滞后使用前 ${m.regime.curve_lag_days} 个交易日的数据；模型训练和 IC 只用“已经实现”的标签（未来 ${m.backtest.forward_days} 日收益在当时已知之后才计入）。</li>
      <li>回测从 ${esc(m.backtest.start)} 开始，${esc(m.backtest.oos_start)} 之后视为[[oos|样本外]]（参数确定后没有再按这段数据调整）。</li></ul></section>

    <section class="card"><h3>① 市场状态：三项依据打分 ${badge("model")}</h3>
      <div class="table-wrap"><table><thead><tr><th>依据</th><th>规则</th><th>含义</th><th>研究依据</th><th>证据强度</th></tr></thead><tbody>
        <tr><td>SPY 相对 ${m.regime.ma_window} 日均线</td><td>上方 +1，下方 −1</td><td>大盘长期趋势</td><td>趋势跟踪可显著降低大类资产的回撤${cite("faber", "tsmom")}</td><td>${evid("strong")}</td></tr>
        <tr><td>[[vix|VIX]]</td><td>&lt; ${num(m.regime.vix_low, 0)} +1，&gt; ${num(m.regime.vix_high, 0)} −1</td><td>市场恐慌程度</td><td>高波动时期的风险回报比偏低，按波动调整仓位可提高夏普${cite("volman")}</td><td>${evid("mid")}</td></tr>
        <tr><td>[[yield_curve|收益率曲线]]（${esc(m.regime.curve)}）</td><td>倒挂（&lt; 0）−1</td><td>衰退风险</td><td>倒挂是美国衰退的领先指标${cite("curve")}；但领先时间长且不稳定，对股市择时的作用弱于对经济的预测</td><td>${evid("mid")}</td></tr>
      </tbody></table></div>
      <p>三项相加：总分 ≥ ${m.regime.on} → 进攻，≤ ${m.regime.off} → 防守，其余为中性；新状态需<b>连续 ${m.regime.confirm_weeks} 周</b>出现才切换，避免来回抖动。</p>
      ${ev ? `<p class="muted">本系统实测：样本外 ${pct(ev.regime_share?.risk_on, 0)} 的时间处于进攻、${pct(ev.regime_share?.neutral, 0)} 中性、${pct(ev.regime_share?.risk_off, 0)} 防守。VIX 阈值改为 16/26 或 20/32，夏普几乎不变（${(ev.sensitivity || []).filter((x) => x.parameter.startsWith("vix")).map((x) => `${x.value}：${sr(x.Sharpe)}`).join("，")}），说明结果不依赖精确的阈值。</p>` : ""}</section>

    <section class="card"><h3>② 四层资金比例 ${badge("model")}</h3>
      <div class="table-wrap"><table><thead><tr><th>层</th>${states.map(([k, n]) => `<th class="num ${cur.regime === k ? "hl" : ""}">${n}${cur.regime === k ? "（当前）" : ""}</th>`).join("")}<th>作用</th></tr></thead><tbody>
        ${["core", "satellite", "hedge", "cash"].map((l) => `<tr><td>${layerZh[l]}</td>${states.map(([k]) => `<td class="num">${pct(lw[k][l], 0)}</td>`).join("")}<td class="muted">${{ core: "获取市场整体收益，天然分散", satellite: "希望通过选股获得超额收益", hedge: "股市大跌时提供部分保护（见 GLD 页“对冲效果”）", cash: `防守与缓冲，收益按 ${esc(m.layers.cash_proxy)}（13 周国债）近似` }[l]}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="muted">这些比例是按常识设定的（进攻时多配股票、防守时多配现金和黄金），<b>没有用回测去优化</b>，以避免过拟合；证据强度：${evid("weak")}（属于经验设定）。${ev ? `敏感性：卫星层比例 ±10 个百分点，夏普 ${(ev.sensitivity || []).filter((x) => x.parameter === "satellite_shift").map((x) => `${x.value}：${sr(x.Sharpe)}`).join("，")}，变化平滑。` : ""}</p></section>

    <section class="card"><h3>③ 选股：四个模型打分，按历史表现融合 ${badge("model")}</h3>
      <p>候选：${m.universe.n} 只股票，分 ${m.universe.themes.length} 个主题（${m.universe.themes.map((t) => `${esc(t.name)} ${t.n} 只`).join("、")}）；上市不足 ${m.universe.min_history_days} 个交易日的不参与。预测目标：未来 ${m.backtest.forward_days} 个交易日相对 SPY 的超额收益<b>排名</b>（只比相对强弱，不预测大盘涨跌）。</p>
      <h4>模型 A：${ruleRows.length} 条透明规则（分值加总）</h4>
      <div class="table-wrap"><table><thead><tr><th>规则</th><th class="num">分值</th><th>逻辑</th><th>依据</th><th>证据强度</th></tr></thead>
        <tbody>${ruleRows.map(([a, b, c, d, e]) => `<tr><td class="wrap">${a}</td><td class="num">${b}</td><td class="muted wrap">${c}</td><td>${d || "–"}</td><td>${evid(e)}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted">说明：均线类规则在早期研究中有效${cite("blb")}，但考虑数据挖掘偏差后显著性大幅下降${cite("stw")}；动量效应最稳健，但会在市场急转时“崩溃”${cite("crash")}；财报前扣分与研究方向相反（财报期平均反而有更高回报${cite("ann")}），这里是为了避开财报跳空的风险，而不是为了提高收益。学术上已发表的因子，公开发表后效果平均明显下降（该研究估计约下降一半）${cite("mp")}。</p>
      <h4>模型 B / C / D 与融合</h4>
      <div class="table-wrap"><table><thead><tr><th>模型</th><th>怎么算</th><th>依据</th><th class="num">当前权重${cur.signal_date ? `<br><span class="muted" style="font-weight:400">周报 ${esc(cur.signal_date)}</span>` : ""}</th></tr></thead><tbody>
        ${models.map(([k, n, how]) => `<tr><td><b>${n}</b></td><td class="wrap">${how}</td><td class="wrap">${{ A_rules: cite("jt", "ahxz"), B_multifactor: `IC 加权${cite("gk")}`, C_lgbm: `机器学习选股${cite("gkx")}（效果主要来自大量小盘股，${m.universe.n} 只大盘股的样本很小）`, D_sentiment: `媒体情绪${cite("tetlock")}（大公司的新闻很快被价格消化）` }[k]}</td><td class="num">${isNum(ew[k]) ? pct(ew[k], 0) : "–"}</td></tr>`).join("")}
      </tbody></table></div>
      <p>融合：每个模型的分数先在股票之间排名，再按权重相加。A / B / C 的权重 = 各自过去 ${m.ensemble.ic_lookback_weeks} 周已实现 [[rank_ic|Rank IC]] 的均值（为负则记 0），已实现周数不足 ${m.ensemble.min_ic_weeks} 周时等权；D 的权重 = ${pct(m.ensemble.sentiment_max_weight, 0)} × 把握程度（按新闻存档重建的历史 IC 的 t 值，t ≥ ${num(m.ensemble.sentiment_t_full, 0)} 给满，≤ 0 为 0）${si?.basis === "ic" ? `，当前 ${si.weeks} 周 IC 均值 ${ic(si.ic_mean)}、t = ${num(si.t, 2)}` : "。这条规则从下一期周报起生效；按目前的新闻存档计算（25 周 IC 均值 −0.019、t = −0.41），D 的权重将为 0，表中的 10% 是旧规则下的固定权重"}。</p>
      ${ev ? `<h4>本系统实测：选股能力 ${badge("simulated")}</h4>
      <div class="table-wrap"><table><thead><tr><th>只按该模型选股（前 ${m.satellite.top_n} 只）</th><th class="num">样本内 Rank IC</th><th class="num">样本外 Rank IC</th><th class="num">IC 为正的周</th><th class="num">命中率</th><th class="num">样本外年化</th><th class="num">夏普</th><th class="num">最大回撤</th><th class="num">年换手</th></tr></thead><tbody>
        ${[...models.filter(([k]) => ev.selection[`OOS|${k}`]), ["Ensemble", "融合后"], ["Pool_EW", "对照：选股池等权"]].map(([k, n]) => { const o = sel(k), i = selIS(k);
          return `<tr class="${k === "Pool_EW" ? "hl" : ""}"><td>${esc(n)}</td><td class="num">${ic(i.RankIC)}</td><td class="num">${ic(o.RankIC)}</td><td class="num">${pct(o.RankIC_positive, 0)}</td><td class="num">${pct(o.HitRate, 0)}</td><td class="num">${p2(o.CAGR)}</td><td class="num">${sr(o.Sharpe)}</td><td class="num neg">${p2(o.MaxDrawdown)}</td><td class="num">${isNum(o.Turnover) ? `${num(o.Turnover, 1)}×` : "–"}</td></tr>`; }).join("")}
      </tbody></table></div>
      <p class="muted">Rank IC 衡量“分数高的股票之后是否真的涨得多”：0 = 没有预测力；常见的经验是长期稳定在 0.03–0.05 以上才有实用价值。样本内（2016–2018）B、C 有一点预测力，到了样本外全部消失；融合后样本外 Rank IC ≈ 0。</p>` : ""}</section>

    <section class="card"><h3>④ 卫星层组合构建 ${badge("model")}</h3><ul>
      <li>取融合分数前 ${m.satellite.top_n} 只；已持有的股票只要排名还在前 ${m.satellite.top_n + m.satellite.buffer} 名就继续持有（减少换手）。</li>
      <li>权重 ∝ 1 / 波动率（年化波动下限 ${pct(m.satellite.vol_floor, 0)}）×（1 + ${m.satellite.tilt} × 分数 z 值），即波动越小、分数越高给得越多。依据：风险平价思想${cite("mrt")}；但简单等权往往很难被打败${cite("dgu")}。${evid("mid")}</li>
      <li>约束：单只个股 ≤ 总资产 ${pct(m.satellite.max_single, 0)}，单个主题 ≤ ${pct(m.satellite.max_theme, 0)}，低于 ${pct(m.satellite.min_position, 0)} 不建仓；超出部分转入现金。</li>
      ${ev ? `<li class="muted">敏感性：选股只数 ${(ev.sensitivity || []).filter((x) => x.parameter === "top_n").map((x) => `${x.value} 只 → 夏普 ${sr(x.Sharpe)}`).join("，")}；结果平滑，没有“只有某个参数才有效”的尖峰。</li>` : ""}</ul></section>

    ${ev ? `<section class="card"><h3>完整组合的样本外结果（${esc(ev.oos_start)} 至 ${esc(ev.data_end)}）${badge("simulated")}</h3>
      <div class="table-wrap"><table><thead><tr><th>方案</th><th class="num">年化</th><th class="num">波动</th><th class="num">夏普</th><th class="num">最大回撤</th></tr></thead><tbody>
      ${[["Regime_Quant", "系统模型（市场状态 + 模型选股）"], ["Static_Quant", "固定比例 + 模型选股"], ["Regime_EW", "市场状态 + 选股池等权"], ["Static_EW", "固定比例 + 选股池等权"], ["SPY", "SPY"], ["QQQ", "QQQ"]].map(([k, n]) => `<tr class="${k === "Regime_Quant" ? "hl" : ""}"><td>${n}</td><td class="num">${p2(pf(k).CAGR)}</td><td class="num">${p2(pf(k).Volatility)}</td><td class="num">${sr(pf(k).Sharpe)}</td><td class="num neg">${p2(pf(k).MaxDrawdown)}</td></tr>`).join("")}
      </tbody></table></div>
      <h4>结论（按证据由强到弱）</h4><ol>
        <li><b>分散与市场状态调仓有实际价值</b>：相比 SPY 与 QQQ，最大回撤明显更小；市场状态调仓让夏普提高、回撤降低，且对参数不敏感。</li>
        <li><b>模型选股目前没有可验证的价值</b>：样本外 Rank IC ≈ 0，按模型选股不如选股池等权；看起来很高的收益主要来自选股池本身的幸存者偏差。</li>
        <li><b>绝对收益水平不可信</b>：选股池是今天挑出的公司，回测年化会被明显高估；真实可期待的是“相对 SPY 更低的回撤和相近或略好的收益”，而不是回测数字。</li>
        <li><b>实盘记录还很短</b>：从 2026 年 9 月才开始，至少需要 1–2 年才能与回测对照。</li></ol>
      <p class="muted">完整回测图表见 <a href="#/backtest">回测与实盘</a>；用你自己的持仓或其他策略做对比，见 <a href="#/sim">模拟经营</a>。</p></section>` : ""}

    <section class="card"><h3>参考文献</h3><ol class="refs">${REF_ORDER.map((k) => `<li id="ref-${k}">${esc(REFS[k])}</li>`).join("")}</ol>
      <p class="muted">证据强度为对相关研究的概括判断，不代表该规则在本系统中有效；本系统中是否有效以上方实测为准。</p></section>`);
};
