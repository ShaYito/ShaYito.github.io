/* 证据型指标（M44，个股页）：只把各方面的事实与历史规律摆在一起，不给买卖 / 仓位建议。
   1. 个股体检卡：估值、增长、盈利、财务、预期修正、财报兑现、内部人、趋势、新闻情绪、散户、空头逐项一句话解读
   2. 财报前后表现：前 N 日是否提前上涨、财报跳动是平时日波动的几倍、之后是否继续漂移（数据：earnings_q.window）
   3. 同行对比雷达：增长 / 盈利 / 估值便宜度 / 财务健康 / 价格趋势 / 分析师预期 / 新闻情绪，在选股池中的分位 vs 同主题中位数 */

const TONE = {
  pos: { label: "偏正面", cls: "pos" },
  neg: { label: "偏负面", cls: "neg" },
  warn: { label: "需留意", cls: "warn" },
  neu: { label: "中性", cls: "muted" },
  na: { label: "无数据", cls: "muted" },
};
const toneChip = (k) => `<span class="tone t-${k}">${TONE[k].label}</span>`;
function metricOf(s, key) {
  for (const g of s.metrics?.groups || []) for (const it of g.items) if (it.key === key) return it;
  return null;
}
const vsMed = (v, m, f) => (isNum(v) && isNum(m) ? `（同主题中位数 ${f(m)}）` : "");

// ---------------- 1. 个股体检卡 ----------------
function healthRows(s, t, sp, rt) {
  const rows = [];
  const add = (dim, now, read, tone) => rows.push({ dim, now, read, tone });
  const m = (k) => metricOf(s, k) || {};
  const P = (v, d = 0, sign = false) => pct(v, d, sign);

  // 估值：与自身近 5 年比
  const v = s.valuation || {};
  const exp = [v.pe?.pct, v.ps_hist?.pct, isNum(v.fcf_hist?.pct) ? 1 - v.fcf_hist.pct : null].filter(isNum);
  if (exp.length) {
    const a = exp.reduce((x, y) => x + y, 0) / exp.length;
    const parts = [isNum(v.pe?.pct) ? `市盈率处于近 ${v.pe.years || 5} 年 ${P(v.pe.pct)} 分位` : "", isNum(v.ps_hist?.pct) ? `市销率 ${P(v.ps_hist.pct)} 分位` : "",
      isNum(v.fcf_hist?.pct) ? `自由现金流收益率 ${P(v.fcf_hist.pct)} 分位` : ""].filter(Boolean).join("，");
    const cyc = v.cyclicality?.tier === "strong" ? "强周期股：盈利高峰时市盈率反而低，低市盈率不一定便宜。" : "";
    const split = exp.length >= 2 && Math.max(...exp) - Math.min(...exp) >= 0.5 ? "各估值口径分歧很大（利润快速变化时市盈率与市销率会给出相反的结论），以更贴近公司阶段的口径为准。" : "";
    add("估值（与自身历史比）", parts, `${a >= 0.8 ? "比自己过去多数时候都贵，需要更高的增长来支撑。" : a <= 0.2 ? "比自己过去多数时候便宜，要分辨是机会还是基本面变差。" : "处在自身历史的中间区域。"}${split}${cyc}`,
      a >= 0.8 || split ? "warn" : a <= 0.2 ? "pos" : "neu");
  } else add("估值（与自身历史比）", "–", "缺少足够的历史估值数据。", "na");

  // 增长
  const rg = m("revenue_growth"), eg = m("eps_fwd_growth");
  if (isNum(rg.value)) {
    add("增长", `收入同比 ${P(rg.value, 1, true)}${vsMed(rg.value, rg.theme_median, (x) => P(x, 1, true))}${isNum(eg.value) ? `；预期 EPS 增长 ${P(eg.value, 1, true)}` : ""}`,
      rg.value < 0 ? "收入在萎缩。" : isNum(rg.theme_median) && rg.value >= rg.theme_median ? "增长快于同主题多数公司。" : "增长慢于同主题中位数。",
      rg.value < 0 ? "neg" : isNum(rg.theme_median) && rg.value >= rg.theme_median && rg.value > 0.1 ? "pos" : "neu");
  } else add("增长", "–", "暂无收入增长数据。", "na");

  // 盈利能力与利润率趋势
  const om = m("op_margin");
  const mg = v.margins?.op_margin || [];
  const back = v.margins?.frequency === "quarterly" ? 4 : 1;
  const dm = mg.length > back && isNum(mg[mg.length - 1]) && isNum(mg[mg.length - 1 - back]) ? mg[mg.length - 1] - mg[mg.length - 1 - back] : null;
  if (isNum(om.value) || isNum(dm)) {
    add("盈利能力", `营业利润率 ${P(om.value, 1)}${vsMed(om.value, om.theme_median, (x) => P(x, 1))}${isNum(dm) ? `；较一年前 ${dm >= 0 ? "+" : "−"}${(Math.abs(dm) * 100).toFixed(1)} 个百分点` : ""}`,
      isNum(dm) && dm <= -0.02 ? "利润率在下滑：成本上升或定价能力变弱。" : isNum(dm) && dm >= 0.02 ? "利润率在改善（规模效应或产品结构变好）。" : "利润率基本稳定。",
      isNum(dm) && dm <= -0.02 ? "neg" : isNum(dm) && dm >= 0.02 ? "pos" : "neu");
  }

  // 财务健康
  const nc = m("net_cash_pct"), de = m("debt_to_equity"), cr = m("current_ratio");
  if (isNum(cr.value) || isNum(de.value)) {
    const weak = (isNum(cr.value) && cr.value < 1) || (isNum(de.value) && de.value > 1.5);
    const strong = isNum(nc.value) && nc.value >= 0 && (!isNum(cr.value) || cr.value >= 1.5);
    add("财务健康", `净现金占市值 ${P(nc.value, 1, true)} · 负债 / 股东权益 ${num(de.value, 2)} · 流动比率 ${num(cr.value, 2)}`,
      weak ? "短期偿债或负债水平偏紧，利率上升或业绩下滑时压力更大。" : strong ? "现金多于债务，抗风险能力强。" : "负债水平正常。", weak ? "warn" : strong ? "pos" : "neu");
  }

  // 分析师预期修正
  const q = s.earnings_q || {};
  const tr = q.eps_trend?.["0y"], rv = q.eps_revisions?.["0y"];
  if (tr && isNum(tr.current) && isNum(tr.d90) && tr.d90) {
    const ch = tr.current / tr.d90 - 1;
    add("分析师预期修正", `今年 EPS 预期近 90 天 ${P(ch, 1, true)}${rv ? `；近 30 天上调 ${rv.up30 ?? 0} 家 / 下调 ${rv.down30 ?? 0} 家` : ""}`,
      ch >= 0.03 ? "分析师在上调盈利预期——研究中预期上调往往持续一段时间。" : ch <= -0.03 ? "分析师在下调盈利预期。" : "预期基本没变。",
      ch >= 0.03 ? "pos" : ch <= -0.03 ? "neg" : "neu");
  }

  // 财报兑现
  const sm = q.summary;
  if (sm?.n) {
    const nd = q.next?.datetime ? q.next.datetime.slice(0, 10) : null;
    const days = nd ? Math.round((new Date(nd) - new Date(s.dates[s.dates.length - 1])) / 864e5) : null;
    add("财报兑现", `近 ${sm.n} 季 ${sm.beats} 季超预期${sm.streak >= 2 ? `（连续 ${sm.streak} 季）` : ""}；超预期却下跌 ${sm.beat_but_fell} 次${nd ? `；下次财报 ${nd}` : ""}`,
      `${sm.beat_but_fell >= 3 ? "多次超预期却下跌：市场期待已经很高。" : sm.beats >= sm.n - 1 ? "业绩一贯好于预期。" : "业绩兑现一般。"}${isNum(days) && days >= 0 && days <= 14 ? ` ${days} 天后发布财报，前后波动会放大。` : ""}`,
      isNum(days) && days >= 0 && days <= 14 ? "warn" : sm.beat_but_fell >= 3 ? "warn" : sm.beats >= sm.n - 1 ? "pos" : "neu");
  }

  // 内部人（近 90 天公开市场买卖）
  const lo = new Date(new Date(s.dates[s.dates.length - 1]) - 90 * 864e5).toISOString().slice(0, 10);
  const ins = (s.insider || []).filter((x) => x.date >= lo);
  const buys = ins.filter((x) => x.kind === "purchase"), sells = ins.filter((x) => x.kind === "sale");
  const sumV = (a) => a.reduce((x, y) => x + (y.value || 0), 0);
  add("内部人（近 90 天）", `公开市场买入 ${buys.length} 笔（${moneyShort(sumV(buys))}）· 卖出 ${sells.length} 笔（${moneyShort(sumV(sells))}）`,
    buys.length ? "高管 / 董事用自己的钱买入，通常认为股价被低估。" : "只有卖出或没有交易；卖出常因分散资产、缴税或事先约定的计划，信息量较低。",
    buys.length && sumV(buys) >= 1e5 ? "pos" : "neu");

  // 价格趋势
  const ma = m("vs_ma200"), p52 = m("pos_52w"), fh = m("from_high");
  if (isNum(ma.value)) {
    add("价格趋势", `相对 200 日均线 ${P(ma.value, 1, true)} · 52 周区间位置 ${P(p52.value)} · 距高点 ${P(fh.value, 1, true)}`,
      ma.value < 0 ? "在长期均线下方，长期趋势偏弱。" : isNum(p52.value) && p52.value >= 0.8 ? "接近一年高点，趋势向上。" : "在长期均线上方。",
      ma.value < 0 ? "neg" : isNum(p52.value) && p52.value >= 0.6 ? "pos" : "neu");
  }

  // 新闻情绪（近 7 天 vs 之前 4 周）
  const x = sp?.rows?.[t];
  if (x?.count) {
    add("新闻情绪（7 天）", `${x.count} 篇 · 平均 ${num(x.mean, 2, true)} · 较前 4 周 ${num(x.change, 2, true)}${isNum(x.volume_ratio) ? ` · 新闻量 ${x.volume_ratio.toFixed(1)}×` : ""}`,
      `${(x.flags || []).length ? `${x.flags.join("；")}。` : ""}${isNum(x.mean) && x.mean >= 0.15 ? "近期报道明显偏正面。" : isNum(x.mean) && x.mean <= -0.15 ? "近期报道明显偏负面。" : "报道整体中性。"}情绪描述的是正在发生什么，对之后涨跌的预测力很弱。`,
      (x.flags || []).length ? "warn" : isNum(x.mean) && x.mean >= 0.15 ? "pos" : isNum(x.mean) && x.mean <= -0.15 ? "neg" : "neu");
  } else add("新闻情绪（7 天）", "–", "近 7 天相关新闻太少。", "na");

  // 散户热度
  const rr = (rt?.rows || []).find((r) => r.ticker === t);
  if (rt?.asof && rr) {
    const al = (rt.alerts || []).filter((a) => a.ticker === t);
    add("散户热度", `${isNum(rr.bull_ratio) ? `Stocktwits 看多 ${P(rr.bull_ratio)}${isNum(rr.bull_base) ? `（平时 ${P(rr.bull_base)}）` : ""}` : ""}${isNum(rr.mentions) ? ` · Reddit 提及 ${rr.mentions}${isNum(rr.mentions_base) && rr.mentions_base ? `（平时 ${num(rr.mentions_base, 0)}）` : ""}` : ""}`,
      al.length ? `${al.map((a) => a.text).join("；")}——散户一致看多或讨论暴增常出现在短期过热时。` : "散户关注度与平时差不多。", al.length ? "warn" : "neu");
  } else add("散户热度", "–", "每日推送开始记录后显示。", "na");

  // 空头
  const sf = m("short_pct_float"), sc = m("short_change");
  if (isNum(sf.value)) {
    const hot = sf.value >= 0.1 || (isNum(sc.value) && sc.value >= 0.2);
    add("做空", `空头占流通股 ${P(sf.value, 1)}${isNum(sc.value) ? ` · 较上月 ${P(sc.value, 0, true)}` : ""}`,
      hot ? "做空比例高或在快速增加：有人押注下跌（也可能引发轧空）。" : "做空比例不高。", hot ? "warn" : "neu");
  }
  return rows;
}

async function fillHealthCard(s, t) {
  const el = byId("health-card");
  if (!el) return;
  const [sp, rt] = await Promise.all([load("sentiment_profile.json").catch(() => null), load("retail.json").catch(() => null)]);
  const rows = healthRows(s, t, sp, rt);
  const cnt = (k) => rows.filter((r) => r.tone === k).length;
  el.hidden = false;
  el.innerHTML = `<h3>个股体检 ${badge("fact")}${badge("derived")}</h3>
    <p class="muted">把各方面的证据放在一起看：每项给出现状、怎么理解和一个方向标记（按固定规则判断，不是买卖建议，也不合成总分）。
      本次：<span class="pos">偏正面 ${cnt("pos")}</span> · <span class="neg">偏负面 ${cnt("neg")}</span> · <span class="warn-t">需留意 ${cnt("warn")}</span> · 中性 ${cnt("neu")}。</p>
    <table class="health"><thead><tr><th>维度</th><th>现状</th><th>怎么理解</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td><b>${esc(r.dim)}</b><br>${toneChip(r.tone)}</td><td>${esc(r.now)}</td><td class="muted">${esc(r.read)}</td></tr>`).join("")}</tbody></table>
    <p class="muted small">规则：估值看自身近 5 年分位（≥ 80% 偏贵、≤ 20% 偏便宜）；增长、利润率与同主题中位数比；预期修正看今年 EPS 预期 90 天变化（±3%）；新闻情绪 ±0.15；散户看与自身平时比的异动。各项详见下方对应卡片。</p>`;
}

// ---------------- 2. 财报前后表现 ----------------
function earningsWindowCard(s) {
  const w = s.earnings_q?.window;
  if (!w) return "";
  const m = w.summary;
  return `<section class="card" id="ew-card"><h3>财报前后表现（最近 ${m.n} 次，相对 SPY）${badge("fact")}${badge("derived")}</h3>
    <p class="muted">以财报后第一个交易日为 0：线表示从财报前一天收盘起，这只股票相对 SPY 的累计涨跌（负的横轴 = 财报前）。粗线是历次的中位数，细线是每一次。用来看三件事：财报前会不会提前上涨（预期是否已打进价格）、财报当天跳动多大、跳动之后是否继续同方向（“财报后漂移”）。</p>
    <div class="kpis">
      <div class="kpi"><span class="muted">财报前 ${w.pre_days} 日相对 SPY</span><b class="${cls(m.pre_avg)}">${pct(m.pre_avg, 1, true)}</b><span class="muted">平均 · ${m.pre_up}/${m.pre_n} 次提前上涨</span></div>
      <div class="kpi"><span class="muted">财报当天跳动</span><b>±${pct(m.react_abs_avg, 1)}</b><span class="muted">约为平时日波动的 ${num(m.multiple_median, 1)} 倍（中位数）</span></div>
      <div class="kpi"><span class="muted">财报后 ${w.post_days} 日相对 SPY</span><b class="${cls(m.post_avg)}">${pct(m.post_avg, 1, true)}</b><span class="muted">平均（${m.post_n} 次）</span></div>
      <div class="kpi"><span class="muted">明显跳动后继续同方向</span><b>${m.drift_n ? `${m.drift_same} / ${m.drift_n}` : "–"}</b><span class="muted">跳动 ≥ 3% 的次数中</span></div>
    </div>${chartDiv("c-ew")}
    <details class="howto"><summary>逐次明细</summary><div class="table-wrap"><table><thead><tr><th>公布</th><th class="num">财报前 ${w.pre_days} 日</th><th class="num">当天跳动</th><th class="num">平时日波动</th><th class="num">倍数</th><th class="num">之后 ${w.post_days} 日</th></tr></thead>
      <tbody>${[...w.events].reverse().map((e) => `<tr><td>${esc(e.announced)}</td><td class="num ${cls(e.pre)}">${pct(e.pre, 1, true)}</td><td class="num ${cls(e.react)}">${pct(e.react, 1, true)}</td>
        <td class="num">${pct(e.sigma, 1)}</td><td class="num">${isNum(e.multiple) ? `${num(e.multiple, 1)}×` : "–"}</td><td class="num ${cls(e.post)}">${e.post == null ? "未满" : pct(e.post, 1, true)}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted">平时日波动 = 财报前 ${w.pre_days} 日之前的 ${w.vol_days} 个交易日里，每天相对 SPY 涨跌的标准差（避开财报本身）。倍数越大，说明财报带来的“意外”越大。次数少时规律不稳定，只作参考。</p></details></section>`;
}
function drawEarningsWindow(s) {
  const w = s.earnings_q?.window;
  if (!w || !byId("c-ew")) return;
  const x = w.offsets.map((k) => (k === 0 ? "0（反应日）" : k > 0 ? `+${k}` : `${k}`));
  mkChart(byId("c-ew"), {
    tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "–" : pct(v, 1, true)) }, legend: { top: 0, data: ["中位数"] },
    grid: { left: 52, right: 20, top: 40, bottom: 30 }, xAxis: { type: "category", data: x, boundaryGap: false, name: "交易日", nameLocation: "middle", nameGap: 24 },
    yAxis: { type: "value", axisLabel: { formatter: (v) => pct(v, 0) } },
    series: [
      ...w.events.map((e) => ({ name: e.announced, type: "line", showSymbol: false, data: e.path, lineStyle: { width: 1, opacity: 0.35 }, color: BENCH_GRAY(), emphasis: { focus: "series" } })),
      { name: "中位数", type: "line", showSymbol: false, data: w.median, color: palette()[0], lineStyle: { width: 3 }, z: 10,
        markLine: { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" }, label: { show: false }, data: [{ xAxis: x[w.offsets.indexOf(0)] }, { yAxis: 0 }] } },
    ],
  });
}

// ---------------- 3. 同行对比雷达 ----------------
// 每个维度 = 若干指标在选股池中的分位（0–100，方向统一为“越高越好”；估值一栏越高 = 越便宜）的平均
const RADAR_DIMS = [
  ["growth", "增长", [["revenue_growth", 1, "收入增长"], ["eps_fwd_growth", 1, "预期 EPS 增长"], ["earnings_growth", 1, "盈利增长"]]],
  ["profit", "盈利能力", [["gross_margin", 1, "毛利率"], ["op_margin", 1, "营业利润率"], ["roe", 1, "ROE"]]],
  ["value", "估值便宜度", [["pe_fwd", -1, "预期市盈率"], ["ps", -1, "市销率"], ["ev_ebitda", -1, "EV/EBITDA"], ["fcf_yield", 1, "自由现金流收益率"]]],
  ["health", "财务健康", [["net_cash_pct", 1, "净现金 / 市值"], ["debt_to_equity", -1, "负债 / 权益"], ["current_ratio", 1, "流动比率"]]],
  ["trend", "价格趋势", [["vs_ma200", 1, "相对 200 日均线"], ["pos_52w", 1, "52 周区间位置"], ["ret_1y", 1, "1 年涨跌"]]],
  ["street", "分析师预期", [["target_upside", 1, "目标价空间"], ["rec_mean", -1, "评级（1 = 强烈买入）"]]],
  ["news", "新闻情绪", [["_sent", 1, "7 日新闻情绪"]]],
];
// 估值倍数 ≤ 0（亏损）没有意义，不参与排名
const POSITIVE_ONLY = new Set(["pe_fwd", "ps", "ev_ebitda"]);
function radarScores(rows) {
  const pctl = {};
  for (const [, , ms] of RADAR_DIMS) for (const [k, dir] of ms) {
    const vals = rows.map((r) => r[k]).filter((v) => isNum(v) && (!POSITIVE_ONLY.has(k) || v > 0)).sort((a, b) => a - b);
    pctl[k] = (v) => {
      if (!isNum(v) || (POSITIVE_ONLY.has(k) && v <= 0) || vals.length < 5) return null;
      let lo = 0; while (lo < vals.length && vals[lo] < v) lo++;
      let hi = lo; while (hi < vals.length && vals[hi] === v) hi++;
      const p = ((lo + hi) / 2) / vals.length * 100;
      return dir > 0 ? p : 100 - p;
    };
  }
  const out = {};
  for (const r of rows) {
    out[r.ticker] = {};
    for (const [key, , ms] of RADAR_DIMS) {
      const ps = ms.map(([k]) => pctl[k](r[k])).filter(isNum);
      out[r.ticker][key] = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
      for (const [k] of ms) out[r.ticker][`p:${k}`] = pctl[k](r[k]);
    }
  }
  return out;
}
const median = (a) => { const v = a.filter(isNum).sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };

async function fillPeerRadar(t, m) {
  const el = byId("radar-card");
  if (!el) return;
  const [cm, sp] = await Promise.all([load("compare_metrics.json").catch(() => null), load("sentiment_profile.json").catch(() => null)]);
  if (!cm?.rows?.some((r) => r.ticker === t)) return;
  const rows = cm.rows.map((r) => ({ ...r, _sent: sp?.rows?.[r.ticker]?.count ? sp.rows[r.ticker].mean : null }));
  const sc = radarScores(rows);
  const me = rows.find((r) => r.ticker === t);
  // 同行与“关键指标”一致：按主要业务（M53 起）；边界情况（config tags.alt_primary）另按第二种主要业务画一份
  const sets = [{ basis: m?.peer_basis || `同主题「${themeName(me.theme)}」`, list: m?.peers || rows.filter((r) => r.theme === me.theme).map((r) => r.ticker) }];
  if (m?.alt_peers) sets.push({ basis: m.alt_peer_basis, list: m.alt_peers });
  const fmt = (k, v) => (!isNum(v) ? "–" : ["pe_fwd", "ps", "ev_ebitda", "debt_to_equity", "current_ratio", "rec_mean"].includes(k) ? num(v, 2) : k === "_sent" ? num(v, 2, true) : pct(v, 1, ["fcf_yield", "gross_margin", "op_margin", "roe", "pos_52w"].includes(k) ? false : true));
  const blocks = sets.map((set) => {
    const peers = rows.filter((r) => set.list.includes(r.ticker) && r.ticker !== t);
    const med = Object.fromEntries(RADAR_DIMS.map(([k]) => [k, median(peers.map((p) => sc[p.ticker][k]))]));
    return { ...set, peers, med };
  });
  el.hidden = false;
  el.innerHTML = `<h3>同行对比雷达${blocks.length > 1 ? "（边界情况：按两种主要业务各画一份）" : `（${esc(blocks[0].basis)}，${blocks[0].peers.length} 家同行）`}${badge("derived")}</h3>
    <p class="muted">每个维度是几项指标在选股池 ${rows.length} 只股票中的分位（0–100，越靠外越好；“估值便宜度”越靠外 = 越便宜，亏损公司的估值倍数不参与）。实线 = ${esc(t)}，虚线 = 同行中位数（同行与“关键指标”相同，按主要业务划分）。分位只说明相对位置，选股池整体偏贵或偏好时，50 分也不代表绝对水平。</p>
    ${blocks.map((b, bi) => `${blocks.length > 1 ? `<h4>${esc(b.basis)}（${b.peers.length} 家：${b.peers.map((p) => esc(p.ticker)).join("、")}）</h4>` : ""}
    <div class="grid two"><div>${chartDiv(`c-radar-${bi}`, "tall")}</div>
    <div class="table-wrap"><table><thead><tr><th>维度 / 指标</th><th class="num">数值</th><th class="num">分位</th><th class="num">同行中位</th></tr></thead><tbody>
      ${RADAR_DIMS.map(([k, name, ms]) => `<tr class="hl"><td><b>${name}</b></td><td></td><td class="num"><b>${isNum(sc[t][k]) ? Math.round(sc[t][k]) : "–"}</b></td><td class="num">${isNum(b.med[k]) ? Math.round(b.med[k]) : "–"}</td></tr>
        ${ms.map(([mk, , label]) => `<tr><td class="muted">　${label}</td><td class="num">${fmt(mk, me[mk])}</td><td class="num">${isNum(sc[t][`p:${mk}`]) ? Math.round(sc[t][`p:${mk}`]) : "–"}</td><td class="num muted">${fmt(mk, median(b.peers.map((p) => p[mk])))}</td></tr>`).join("")}`).join("")}
    </tbody></table></div></div>`).join("")}`;
  const ind = RADAR_DIMS.map(([, name]) => ({ name, max: 100 }));
  blocks.forEach((b, bi) => mkChart(byId(`c-radar-${bi}`), {
    tooltip: { trigger: "item" }, legend: { bottom: 0 },
    radar: { indicator: ind, radius: "62%", splitNumber: 4, axisName: { color: css("--ink-2") }, splitLine: { lineStyle: { color: css("--grid") } }, splitArea: { show: false }, axisLine: { lineStyle: { color: css("--grid") } } },
    series: [{ type: "radar", data: [
      { name: t, value: RADAR_DIMS.map(([k]) => (isNum(sc[t][k]) ? Math.round(sc[t][k]) : 0)), itemStyle: { color: palette()[0] }, areaStyle: { opacity: 0.18 }, lineStyle: { width: 2 } },
      { name: "同行中位数", value: RADAR_DIMS.map(([k]) => (isNum(b.med[k]) ? Math.round(b.med[k]) : 0)), itemStyle: { color: BENCH_GRAY() }, lineStyle: { type: "dashed" } },
    ] }],
  }));
}
