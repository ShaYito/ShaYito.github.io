"use strict";
/* 个股页：财报与预期、分析师预期修正（数据：stocks/<t>.json 的 earnings_q，来自 yfinance，按日更新）。 */

const PERIOD_ZH = { "0q": "本季", "+1q": "下季", "0y": "今年", "+1y": "明年" };
const REC_ZH = { strong_buy: "强烈买入", buy: "买入", hold: "持有", underperform: "跑输", sell: "卖出", none: "无" };
const SURPRISE_CLIP = 0.5; // 图上超预期幅度截断在 ±50%（一次性项目会造成极端值）
const moneyShort = (v) => (!isNum(v) ? "–" : Math.abs(v) >= 1e9 ? `${num(v / 1e9, 1)}B` : Math.abs(v) >= 1e6 ? `${num(v / 1e6, 0)}M` : num(v, 0));

function earningsInsights(s) {
  const q = s.earnings_q;
  if (!q?.history?.length) return [];
  const out = [];
  const m = q.summary;
  if (m.n) out.push({ level: m.beats >= m.n - 1 ? "good" : m.beats <= m.n / 2 ? "medium" : "info", kind: "fact", target: "c-eq-sur",
    text: `近 ${m.n} 季有 ${m.beats} 季 EPS 超预期${m.streak >= 3 ? `（已连续 ${m.streak} 季）` : ""}，平均超出 ${pct(m.avg_surprise, 1)}。` });
  if (m.beat_but_fell >= 2) out.push({ level: "medium", kind: "derived", target: "c-eq-react",
    text: `近 ${m.n} 季有 ${m.beat_but_fell} 次“超预期却下跌”（财报后相对大盘跌超 ${pct(q.big_reaction, 0)}）：市场的预期比分析师更高，只“超预期”已不够，指引和增速更关键。` });
  const last = q.history[q.history.length - 1];
  if (last && isNum(last.react_rel)) out.push({ level: Math.abs(last.react_rel) > q.big_reaction ? "medium" : "info", kind: "fact", target: "c-eq-react",
    text: `最近一次财报（${last.announced}${last.timing}）${last.surprise > 0 ? "超预期" : "不及预期"} ${pct(Math.abs(last.surprise), 1)}，次日相对大盘 ${pct(last.react_rel, 1, true)}。` });
  const tr = q.eps_trend?.["0y"], rv = q.eps_revisions?.["0y"];
  if (tr && isNum(tr.current) && isNum(tr.d90) && tr.d90) {
    const ch = tr.current / tr.d90 - 1;
    if (Math.abs(ch) >= 0.02) out.push({ level: ch > 0 ? "good" : "high", kind: "fact", target: "c-eq-rev",
      text: `分析师 90 天内把今年 EPS 预期${ch > 0 ? "上调" : "下调"} ${pct(Math.abs(ch), 1)}${rv ? `（近 30 天上调 ${rv.up30 ?? 0} 人、下调 ${rv.down30 ?? 0} 人）` : ""}。预期修正方向是较稳定的股价信号之一。` });
  }
  if (q.next?.datetime) {
    const days = Math.round((new Date(q.next.datetime) - new Date()) / 864e5);
    if (days >= 0 && days <= 14) out.push({ level: "medium", kind: "fact", text: `${days} 天后发布财报（${q.next.datetime.slice(0, 10)}）；该股财报后平均单日波动约 ±${pct(m.avg_abs_react, 1)}（相对大盘）。` });
  }
  return out;
}

function earningsCard(s) {
  const q = s.earnings_q;
  if (!q?.history?.length) return card("财报与预期", empty("暂无财报预期数据"));
  const m = q.summary, n = q.next || {};
  const nextDate = n.datetime ? n.datetime.slice(0, 10) : null;
  const nextTiming = n.datetime ? (+n.datetime.slice(11, 13) >= 16 ? "盘后" : +n.datetime.slice(11, 13) < 10 ? "盘前" : "时间待定") : "";
  const rows = [...q.history].reverse().slice(0, 12);
  const flag = (h) => (h.surprise > 0 && h.react_rel < -q.big_reaction ? '<span class="chip warnchip">超预期却下跌</span>'
    : h.surprise < 0 && h.react_rel > q.big_reaction ? '<span class="chip">不及预期却上涨</span>' : "");
  return `<section class="card" id="eq-card"><h3>财报与预期 ${badge("fact")}${badge("derived")}</h3>
    <p class="muted">${rich("股价对“已知”的消息反应很小，对“意外”反应大。这里用两把尺子衡量意外：① EPS 相对分析师[[earnings|预期]]超出多少；② 财报后第一个交易日股价相对 SPY 的涨跌（市场自己的打分，包含收入、下季指引等 EPS 之外的信息）。两者方向相反的季度最值得注意。")}</p>
    <div class="kpis">
      <div class="kpi"><span class="muted">近 ${m.n} 季超预期</span><b>${m.beats} / ${m.n}</b><span class="muted">${m.streak >= 2 ? `连续 ${m.streak} 季` : ""}</span></div>
      <div class="kpi"><span class="muted">平均超出预期</span><b>${pct(m.avg_surprise, 1)}</b></div>
      <div class="kpi"><span class="muted">财报后平均波动（相对大盘）</span><b>±${pct(m.avg_abs_react, 1)}</b></div>
      <div class="kpi"><span class="muted">超预期却下跌</span><b>${m.beat_but_fell} 次</b><span class="muted">近 ${m.n} 季</span></div>
      <div class="kpi"><span class="muted">下次财报</span><b>${esc(nextDate || "–")}</b><span class="muted">${esc(nextTiming)}${n.eps?.avg != null ? ` · EPS 预期 ${num(n.eps.avg, 2)}` : ""}</span></div>
      ${n.revenue?.avg != null ? `<div class="kpi"><span class="muted">本季收入预期</span><b>${moneyShort(n.revenue.avg)}</b><span class="muted">同比 ${pct(n.revenue.growth, 1, true)}</span></div>` : ""}
    </div>
    <div class="grid two">${chartDiv("c-eq-sur", "short")}${chartDiv("c-eq-react", "short")}</div>
    <details class="howto"><summary>逐季明细（最近 ${rows.length} 季）</summary><div class="table-wrap"><table>
      <thead><tr><th>公布</th><th>时间</th><th class="num">EPS 预期</th><th class="num">实际</th><th class="num">超预期</th><th class="num">次日相对大盘</th><th class="num">3 日相对大盘</th><th></th></tr></thead>
      <tbody>${rows.map((h) => `<tr><td>${esc(h.announced)}</td><td>${esc(h.timing)}</td><td class="num">${num(h.eps_est, 2)}</td><td class="num">${num(h.eps_act, 2)}</td>
        <td class="num ${cls(h.surprise)}">${pct(h.surprise, 1, true)}</td><td class="num ${cls(h.react_rel)}">${pct(h.react_rel, 1, true)}</td><td class="num ${cls(h.react3_rel)}">${pct(h.react3_rel, 1, true)}</td><td>${flag(h)}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted">EPS 为公司公布的口径，可能包含一次性项目（例如投资收益），个别季度的超预期幅度会因此异常大；图上截断在 ±${pct(SURPRISE_CLIP, 0)}。</p></details></section>`;
}

function drawEarnings(s) {
  const q = s.earnings_q;
  if (!q?.history?.length) return;
  const h = q.history.slice(-16);
  const x = h.map((e) => e.announced.slice(2, 7));
  const clip = (v) => (isNum(v) ? Math.max(-SURPRISE_CLIP, Math.min(SURPRISE_CLIP, v)) : null);
  const tip = (i) => { const e = h[i]; return `${e.announced}（${e.timing}）<br>EPS 预期 ${num(e.eps_est, 2)} → 实际 ${num(e.eps_act, 2)}（${pct(e.surprise, 1, true)}）<br>次日相对大盘 ${pct(e.react_rel, 1, true)} · 3 日 ${pct(e.react3_rel, 1, true)}`; };
  const bar = (id, title, vals, colorFn, marks) => mkChart(byId(id), {
    title: { text: title, left: 0, top: 0, textStyle: { fontSize: 12, fontWeight: 500, color: css("--ink-2") } },
    tooltip: { trigger: "axis", formatter: (ps) => tip(ps[0].dataIndex) }, legend: { show: false }, grid: { left: 48, right: 12, top: 30, bottom: 24 },
    xAxis: { type: "category", data: x }, yAxis: { type: "value", axisLabel: { formatter: (v) => pct(v, 0) } },
    series: [{ type: "bar", barMaxWidth: 16, data: vals.map((v, i) => ({ value: v, itemStyle: { color: colorFn(v, i), borderRadius: 3 } })),
      markLine: { symbol: "none", silent: true, lineStyle: { color: css("--axis") }, label: { show: false }, data: [{ yAxis: 0 }] }, markPoint: marks }],
  });
  bar("c-eq-sur", "① EPS 超预期幅度", h.map((e) => clip(e.surprise)), (v) => (v >= 0 ? css("--pos") : css("--neg")));
  const odd = h.map((e, i) => ((e.surprise > 0 && e.react_rel < -q.big_reaction) || (e.surprise < 0 && e.react_rel > q.big_reaction) ? i : -1)).filter((i) => i >= 0);
  bar("c-eq-react", "② 财报后次日股价（相对 SPY）", h.map((e) => e.react_rel), (v) => (v >= 0 ? css("--pos") : css("--neg")),
    { symbol: "pin", symbolSize: 26, itemStyle: { color: css("--warn") || "#eda100" }, label: { formatter: "!", color: "#fff" },
      data: odd.map((i) => ({ coord: [x[i], h[i].react_rel] })) });
}

function revisionsCard(s) {
  const q = s.earnings_q;
  if (!q || !Object.keys(q.eps_trend || {}).length) return "";
  const per = ["0q", "+1q", "0y", "+1y"].filter((p) => q.eps_trend[p]);
  const t = q.targets || {}, v = q.valuation || {};
  const up = isNum(t.mean) && isNum(t.current) ? t.mean / t.current - 1 : null;
  return `<section class="card" id="rev-card"><h3>分析师预期修正 ${badge("fact")}${badge("derived")}</h3>
    <p class="muted">${rich("分析师对未来 EPS 的预期在过去 90 天如何变化。预期被持续上调，往往意味着公司基本面好于此前判断，是研究中较稳定的正面信号之一；持续下调则相反。目标价和评级是分析师观点，仅供参考（普遍偏乐观）。")}</p>
    <div class="grid two"><div>${chartDiv("c-eq-rev", "short")}</div><div class="table-wrap"><table>
      <thead><tr><th>期间</th><th class="num">当前预期</th><th class="num">90 天变化</th><th class="num">30 天上调 / 下调</th><th class="num">分析师</th><th class="num">预期同比</th></tr></thead>
      <tbody>${per.map((p) => { const r = q.eps_trend[p], rv = q.eps_revisions?.[p] || {}, es = q.eps_estimate?.[p] || {}; const ch = isNum(r.current) && isNum(r.d90) && r.d90 ? r.current / r.d90 - 1 : null;
        return `<tr><td>${PERIOD_ZH[p]}</td><td class="num">${num(r.current, 2)}</td><td class="num ${cls(ch)}">${pct(ch, 1, true)}</td>
          <td class="num"><span class="pos">↑${rv.up30 ?? 0}</span> / <span class="neg">↓${rv.down30 ?? 0}</span></td><td class="num">${es.n ?? "–"}</td><td class="num ${cls(es.growth)}">${pct(es.growth, 1, true)}</td></tr>`; }).join("")}</tbody></table></div></div>
    ${isNum(t.low) && isNum(t.high) ? `<h4>目标价与评级</h4>${chartDiv("c-eq-tgt", "mini")}
      <p>目标价均值 ${num(t.mean, 2)}（${up == null ? "" : `较现价 ${pct(up, 1, true)}`}），区间 ${num(t.low, 2)} – ${num(t.high, 2)}；评级 ${esc(REC_ZH[v.recommendationKey] || v.recommendationKey || "–")}${isNum(v.recommendationMean) ? `（${num(v.recommendationMean, 2)}，1 = 强烈买入 … 5 = 卖出）` : ""}，${v.numberOfAnalystOpinions ?? "–"} 位分析师。</p>` : ""}
    <p class="muted">数据：yfinance，更新于 ${esc(q.fetched || "–")}。</p></section>`;
}

function drawRevisions(s) {
  const q = s.earnings_q;
  if (!q || !byId("c-eq-rev")) return;
  const pts = [["d90", "90 天前"], ["d60", "60 天前"], ["d30", "30 天前"], ["d7", "7 天前"], ["current", "现在"]];
  const per = ["0q", "+1q", "0y", "+1y"].filter((p) => q.eps_trend[p] && isNum(q.eps_trend[p].d90) && q.eps_trend[p].d90);
  mkChart(byId("c-eq-rev"), {
    title: { text: "EPS 预期变化（90 天前 = 0）", left: 0, top: 0, textStyle: { fontSize: 12, fontWeight: 500, color: css("--ink-2") } },
    tooltip: { trigger: "axis", valueFormatter: (v) => pct(v, 2, true) }, legend: { top: 18 }, grid: { left: 52, right: 16, top: 48, bottom: 24 },
    xAxis: { type: "category", data: pts.map(([, n]) => n), boundaryGap: false }, yAxis: { type: "value", axisLabel: { formatter: (v) => pct(v, 1) } },
    series: per.map((p, i) => ({ name: PERIOD_ZH[p], type: "line", color: palette()[i], symbolSize: 6,
      data: pts.map(([k]) => (isNum(q.eps_trend[p][k]) ? q.eps_trend[p][k] / q.eps_trend[p].d90 - 1 : null)) })),
  });
  const t = q.targets || {};
  if (byId("c-eq-tgt") && isNum(t.low) && isNum(t.high)) {
    mkChart(byId("c-eq-tgt"), {
      tooltip: { show: false }, legend: { show: false }, grid: { left: 16, right: 16, top: 24, bottom: 24 },
      xAxis: { type: "value", min: Math.floor(Math.min(t.low, t.current) * 0.95), max: Math.ceil(Math.max(t.high, t.current) * 1.05),
        axisLabel: { formatter: (v) => num(v, 0), showMinLabel: false, showMaxLabel: false } },
      yAxis: { type: "category", data: [""], show: false },
      series: [{ type: "bar", stack: "r", data: [t.low], itemStyle: { color: "transparent" }, barWidth: 10, silent: true },
        { type: "bar", stack: "r", data: [t.high - t.low], itemStyle: { color: css("--chip"), borderRadius: 5 }, barWidth: 10, silent: true,
          markLine: { symbol: "none", silent: true, data: [
            { xAxis: t.current, lineStyle: { color: css("--ink"), width: 2 }, label: { formatter: `现价 ${num(t.current, 0)}`, position: "end", color: css("--ink") } },
            { xAxis: t.mean, lineStyle: { color: palette()[0], width: 2, type: "dashed" }, label: { formatter: `均值 ${num(t.mean, 0)}`, position: "start", color: palette()[0] } },
          ] } }],
    });
  }
}

// K 线上的财报竖线按“超预期 / 不及预期”着色
function earningsLineStyle(s, date) {
  const h = (s.earnings_q?.history || []).find((e) => e.date === date || e.announced === date);
  if (!h || !isNum(h.surprise)) return null;
  return { lineStyle: { color: h.surprise >= 0 ? css("--pos") : css("--neg"), type: "dashed" },
    label: { formatter: `财报 ${h.surprise >= 0 ? "超" : "低于"}预期`, color: h.surprise >= 0 ? css("--pos") : css("--neg") } };
}

// ---------------- 业务：利润与增长（segments.json 的 profit / growth）----------------
const bn = (v) => (isNum(v) ? `${num(v / 1e9, Math.abs(v) >= 1e10 ? 1 : 2)}B` : "–");
function profitInsights(c) {
  const out = [];
  if (!c) return out;
  const p = c.profit, g = c.growth;
  if (g?.engine) {
    const r = g.rows.find((x) => x.key === g.engine);
    if (r) out.push({ level: "medium", kind: "derived", target: "pg-card",
      text: `主要增长引擎：「${r.name}」贡献了${g.basis}收入增量的 ${pct(r.contrib_pos, 0)}（该业务增长 ${pct(r.growth, 0, true)}）。关于它的新闻和指标对股价影响最大。` });
  }
  if (p) {
    const tilt = p.segments.filter((s) => isNum(s.tilt) && s.tilt >= p.tilt).sort((a, b) => b.tilt - a.tilt)[0];
    if (tilt) out.push({ level: "medium", kind: "fact", target: "pg-card",
      text: `利润主力与收入主体不一致：「${tilt.label}」收入只占 ${pct(tilt.rev_share, 0)}，却贡献 ${pct(tilt.oi_share, 0)} 的分部营业利润（利润率 ${pct(tilt.margin, 0)}）。` });
    const loss = p.segments.filter((s) => s.op_income < 0);
    if (loss.length) out.push({ level: "info", kind: "fact", target: "pg-card", text: `亏损分部：${loss.map((s) => `「${s.label}」${bn(s.op_income)}`).join("、")}（${p.basis}）。` });
  }
  if (g) {
    const last = g.rows.map((r) => [r, g.flags[r.key]?.at(-1), g.yoy[r.key]?.at(-1)]).filter(([, f]) => f);
    if (last.length) out.push({ level: "good", kind: "derived", target: "pg-card",
      text: `最新一期显著增长：${last.map(([r, f, y]) => `「${r.name}」同比 ${pct(y, 0, true)}${f === "accel" ? "（加速）" : ""}`).join("、")}。` });
  }
  return out;
}

function profitGrowthCard(c, t) {
  if (!c || (!c.profit && !c.growth)) return "";
  const p = c.profit, g = c.growth;
  const tag = (s) => (s.op_income < 0 ? '<span class="chip warnchip">亏损</span>' : isNum(s.tilt) && s.tilt >= p.tilt ? '<span class="chip">利润主力</span>' : "");
  const eng = g?.rows.find((r) => r.key === g.engine);
  const totalGrowth = g ? g.total_delta / g.rows.reduce((a, r) => a + r.ttm_prev, 0) : null;
  return `<section class="card" id="pg-card"><h3>业务：利润与增长 ${badge("fact")}${badge("derived")}</h3>
    <p class="muted">${rich("股价反映的是未来能赚多少钱，所以要看：哪块业务在赚钱（利润占比，而不只是收入占比）、哪块业务贡献了增长（增量贡献），以及增长是否在加速。数据来自公司向 SEC 提交的财报。")}</p>
    ${p ? `<h4>收入 vs 营业利润（报告分部，${esc(p.basis)}）</h4>
      <p class="muted">按公司财报的“报告分部”划分（可能与下方收入结构的业务分类不同，例如有的公司只按地区披露利润）；利润占比 = 该分部营业利润 ÷ 盈利分部合计。${isNum(p.corporate) && isNum(p.total_op_income) && Math.abs(p.corporate) > Math.abs(p.total_op_income) * 0.01 ? `另有未分摊到分部的总部费用等 ${bn(p.corporate)}。` : ""}${p.measure === "税前利润" ? "该公司以分部税前利润衡量各分部，下表“营业利润”一栏为分部税前利润。" : ""}</p>
      <div class="grid two">${chartDiv("c-pg-profit", "short")}<div class="table-wrap"><table>
        <thead><tr><th>分部</th><th class="num">收入</th><th class="num">营业利润</th><th class="num">利润率</th><th></th></tr></thead>
        <tbody>${p.segments.map((s) => `<tr><td>${esc(s.label)}</td><td class="num">${bn(s.revenue)}</td><td class="num ${cls(s.op_income)}">${bn(s.op_income)}</td><td class="num">${pct(s.margin, 0)}</td><td>${tag(s)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
    ${g ? `<h4>增量贡献（${esc(g.basis)}）${eng ? ` · 主要增长引擎：<span class="chip hlchip">${esc(eng.name)}</span>` : ""}</h4>
      <p class="muted">收入增加了多少、来自哪块业务。总收入${isNum(totalGrowth) ? `增长 ${pct(totalGrowth, 1, true)}` : "变化"}（${bn(g.total_delta)}）；贡献 ≥ ${pct(0.4, 0)} 的业务标为“主要增长引擎”。</p>
      ${chartDiv("c-pg-contrib", "short")}
      <h4>各业务同比增速与显著增长期</h4>
      <p class="muted">● 大圆点 = 同比 ≥ ${pct(g.fast, 0)}（显著增长）；▲ = 同比比上一期提高 ≥ ${pct(g.accel, 0)}（加速）；${eng ? `底色 = 主要增长引擎「${esc(eng.name)}」处于显著增长的时期。` : ""}</p>
      ${chartDiv("c-pg-yoy")}` : ""}
  </section>`;
}

function drawProfitGrowth(c) {
  if (!c) return;
  const p = c.profit, g = c.growth;
  if (p && byId("c-pg-profit")) {
    const segs = [...p.segments].reverse();
    mkChart(byId("c-pg-profit"), { tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => pct(v, 1) },
      legend: { top: 0 }, grid: { left: 110, right: 40, top: 30, bottom: 20 },
      xAxis: { type: "value", axisLabel: { formatter: (v) => pct(v, 0) } }, yAxis: { type: "category", data: segs.map((s) => s.label) },
      series: [
        { name: "收入占比", type: "bar", barMaxWidth: 10, color: BENCH_GRAY(), itemStyle: { borderRadius: 3 }, data: segs.map((s) => s.rev_share) },
        { name: "营业利润占比", type: "bar", barMaxWidth: 10, color: palette()[0], itemStyle: { borderRadius: 3 }, data: segs.map((s) => s.oi_share),
          label: { show: true, position: "right", fontSize: 10, color: css("--ink-2"), textBorderWidth: 0, formatter: (x) => (isNum(x.value) ? pct(x.value, 0) : "") } },
      ] });
  }
  if (g && byId("c-pg-contrib")) {
    const rows = g.rows;
    mkChart(byId("c-pg-contrib"), { tooltip: { trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (ps) => { const r = rows[ps[0].dataIndex]; return `${esc(r.name)}<br>增量 ${bn(r.delta)}（占总增量 ${pct(r.contrib, 0)}）<br>该业务增长 ${pct(r.growth, 1, true)}`; } },
      legend: { show: false }, grid: { left: 120, right: 60, top: 8, bottom: 20 },
      xAxis: { type: "value", axisLabel: { formatter: (v) => bn(v) } }, yAxis: { type: "category", inverse: true, data: rows.map((r) => r.name) },
      series: [{ type: "bar", barMaxWidth: 14, data: rows.map((r) => ({ value: r.delta,
        itemStyle: { color: r.key === g.engine ? palette()[0] : r.delta >= 0 ? css("--pos") : css("--neg"), opacity: r.key === g.engine ? 1 : 0.55, borderRadius: 3 } })),
        label: { show: true, position: "right", fontSize: 10, color: css("--ink-2"), textBorderWidth: 0, formatter: (x) => (isNum(rows[x.dataIndex].contrib) ? pct(rows[x.dataIndex].contrib, 0) : "") } }] });
  }
  if (g && byId("c-pg-yoy")) {
    const b = c.business;
    const top = [...b.meta].sort((x, y) => (b.latest.find((r) => r.key === y.key)?.share ?? 0) - (b.latest.find((r) => r.key === x.key)?.share ?? 0)).slice(0, 6);
    const labels = b.periods.map((d) => periodLabel(d, b.frequency));
    const areas = [];
    if (g.engine) {
      const f = g.flags[g.engine] || [];
      let s = -1;
      for (let i = 0; i <= f.length; i++) {
        const on = i < f.length && f[i] === "fast";
        if (on && s < 0) s = i;
        if (!on && s >= 0) { areas.push([{ xAxis: labels[s], itemStyle: { color: palette()[0], opacity: 0.08 } }, { xAxis: labels[i - 1] }]); s = -1; }
      }
    }
    mkChart(byId("c-pg-yoy"), { tooltip: { trigger: "axis", valueFormatter: (v) => pct(v, 1, true) }, legend: { type: "scroll", top: 0 },
      grid: { left: 52, right: 20, top: 36, bottom: 30 }, xAxis: { type: "category", data: labels, boundaryGap: false },
      yAxis: { type: "value", axisLabel: { formatter: (v) => pct(v, 0) } },
      series: top.map((m, i) => ({ name: m.name, type: "line", color: palette()[i % 8], lineStyle: { width: m.key === g.engine ? 2.6 : 1.6 },
        symbol: (v, pp) => (g.flags[m.key]?.[pp.dataIndex] === "accel" ? "triangle" : "circle"),
        symbolSize: (v, pp) => (g.flags[m.key]?.[pp.dataIndex] ? 11 : 4),
        data: g.yoy[m.key],
        ...(i === 0 ? { markArea: { silent: true, data: areas }, markLine: { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" }, label: { show: false }, data: [{ yAxis: 0 }, { yAxis: g.fast }] } } : {}) })) });
  }
}

// ---------------- 估值与利润率（stocks/<t>.json 的 valuation）----------------
function valuationInsights(s) {
  const v = s.valuation, out = [];
  if (!v) return out;
  if (v.pe) {
    const p = v.pe.pct;
    if (v.pe.oneoff) out.push({ level: "medium", kind: "derived", target: "val-card",
      text: `预期 P/E（${num(v.forward_pe, 1)}）明显高于 P/E（${num(v.pe.now, 1)}）：近 4 季 EPS 可能含一次性收益，P/E 与历史百分位会偏低，以预期 P/E 为准。` });
    else out.push({ level: p >= 0.85 ? "medium" : p <= 0.15 ? "good" : "info", kind: "derived", target: "val-card",
      text: `市盈率 P/E ${num(v.pe.now, 1)}，处于自身近 ${v.pe.years} 年的第 ${Math.round(p * 100)} 百分位（中位数 ${num(v.pe.median, 0)}）${p >= 0.85 ? "：偏贵，对业绩失望更敏感" : p <= 0.15 ? "：处于历史低位" : ""}。` });
  }
  if (v.ps_hist) {
    const p = v.ps_hist.pct;
    const cyc = v.cyclicality?.tier === "strong";
    if (p >= 0.85 || p <= 0.15 || cyc) out.push({ level: p >= 0.85 ? "medium" : p <= 0.15 ? "good" : "info", kind: "derived", target: "val-card",
      text: `市销率 P/S ${num(v.ps_hist.now, 1)}，处于自身近 ${v.ps_hist.years} 年的第 ${Math.round(p * 100)} 百分位（中位数 ${num(v.ps_hist.median, 1)}）${cyc ? "；强周期股以 P/S 为准" : ""}。` });
  }
  if (v.fcf_hist && isNum(v.fcf_hist.capex_share) && v.fcf_hist.capex_share >= 0.5) out.push({ level: "info", kind: "derived", target: "val-card",
    text: `FCF 收益率 ${pct(v.fcf_hist.now, 1)}（中位数 ${pct(v.fcf_hist.median, 1)}）：资本支出占经营现金流的 ${pct(v.fcf_hist.capex_share, 0)}，现金正大量投入未来，FCF 收益率偏低不等于变贵。` });
  const m = v.margins;
  if (m?.op_margin?.length >= 5) {
    const a = m.op_margin.at(-1), b = m.op_margin.at(m.frequency === "annual" ? -2 : -5);
    if (isNum(a) && isNum(b) && Math.abs(a - b) >= 0.03) out.push({ level: a > b ? "good" : "medium", kind: "fact", target: "val-card",
      text: `营业利润率 ${pct(a, 1)}，较一年前${a > b ? "提高" : "下降"} ${Math.abs((a - b) * 100).toFixed(1)} 个百分点（利润率${a > b ? "扩张通常推动盈利超预期" : "收缩会拖累盈利"}）。` });
  }
  return out;
}

// 三个估值指标各自适用的场景（网页常驻说明）
// [指标, 适用场景, 曲线怎么看（条目）]
const VAL_GUIDE = [
  ["市盈率 P/E", "适合盈利稳定的公司。周期股（存储芯片、半导体设备、硬盘）是反过来的：盈利低谷时 P/E 最高，往往正是底部；盈利高峰时 P/E 最低，往往接近顶部。亏损时没有意义（曲线断开）。", [
    "对照第 ① 栏股价、第 ② 栏拆分：P/E = 股价 ÷ 每股盈利。股价在涨、P/E 却持平或下降，说明盈利增长跟上甚至快于股价，上涨“有根据”；股价涨、P/E 同步走高，是估值扩张（靠预期推动），之后对“不及预期”更敏感。",
    "财报后曲线的台阶式跳变是新一季盈利计入：向下跳 = 盈利增长，向上跳 = 盈利下滑。",
    "明显高出灰色带时，先看第 ⑤ 栏利润率：如果利润率处在低谷（盈利暂时偏低），高 P/E 可能只是暂时的；利润率正常而 P/E 仍高，才是真正“比自己历史贵”。",
    "与上方“预期市盈率”对比：当前 P/E 远高于预期 P/E，说明市场预计盈利大增；之后几个季度如果盈利没兑现，P/E 曲线就降不下来。",
  ]],
  ["市销率 P/S", "不受利润率波动影响，适合高增长、利润还不稳定的公司，也是周期股更可靠的估值尺子。但它忽略利润率变化：利润率大幅提高时，同样的 P/S 其实更便宜。", [
    "P/S = P/E × 净利率。P/S 走高时一定要对照正下方第 ⑤ 栏利润率（同一时间轴）：利润率同时上升，估值抬升有基本面支撑（P/E 可能并没变贵）；利润率持平或下降，就是单纯的估值扩张。",
    "高增长公司收入变大得很快，P/S 会随之自然下降；P/S 持平说明股价跟上了收入增长，P/S 上升说明股价涨得比收入还快。",
    "周期股看 P/S 比看 P/E 稳定：跌到灰色带下沿以下常对应景气低谷，高出上沿常对应景气高峰。",
  ]],
  ["自由现金流收益率 FCF yield", "= 近 4 季（经营现金流 − 资本支出）÷ 市值，最贴近“这家公司每年实际能拿回多少现金”，适合成熟公司（如 AAPL、MSFT、COST）。越高越便宜。资本支出大的公司（如正在大建 AI 数据中心的 AMZN、ORCL）会骤降甚至为负——这本身是有用的信息（现金在投入未来），但不能简单理解为“变贵了”。", [
    "方向与前两个相反：曲线越高越便宜，高于灰色带 = 比自身历史便宜。",
    "上升有两种来源：现金流增加（好）或股价下跌（要分辨是不是价值陷阱）——下一张“FCF 收益率上升期”卡片把两者拆开了，回测显示前者（A 类）之后 1–3 个月明显好于后者（B 类）。",
    "单季大幅下降先看资本支出是否在增加（估值栏提示“FCF 被资本支出压低”）：投资驱动的下降与经营恶化含义完全不同。",
  ]],
];
const VAL_COMMON = "共同的读法：灰色带 = 自身近 5 年 20%–80% 区间，虚线 = 近 5 年中位数；线在灰色带上方，说明比自己过去 5 年的大部分时间都贵（FCF 收益率相反）。只和这家公司自己的历史比，不同行业、不同商业模式的公司数值不能直接比较。估值对未来几周的涨跌几乎没有预测力，处于高位意味着“容错空间小”，而不是“马上会跌”。";
const MARGIN_GUIDE = {
  role: "利润率不是估值指标，和上面三个不是同一类：估值告诉你“市场为这家公司付了多少钱”，利润率解释“为什么值这个价、盈利能不能持续”。所以它不能替代估值，但判断估值是否合理时同样重要——尤其看 P/S 时一定要配合利润率看；看 P/E 时可以用它判断当前盈利是处在正常水平，还是周期高点 / 低谷。",
  items: [
    ["毛利率", "（收入 − 直接成本）÷ 收入，反映定价能力与产品竞争力。持续上升 = 产品更有竞争力，或高毛利业务占比在提高（如英伟达数据中心）；持续下降 = 价格战、成本上涨或低毛利业务占比提高，往往是竞争恶化或周期下行的早期信号。不同行业水平差别很大（软件常在 70% 以上，半导体 / 硬件约 40%–60%，代工与零售更低），只和自己的历史及同行比。"],
    ["营业利润率", "再扣除研发、销售、管理费用后的利润率，反映规模效应与费用控制。收入增长而费用增长较慢时，营业利润率会上升，利润增速就快于收入增速（经营杠杆，常常是盈利超预期的来源）。"],
    ["两条线一起看", "两条都升：定价能力和规模效应同时在改善，最理想。毛利率稳、营业利润率升：主要靠费用控制与规模效应（成熟期软件公司常见）。毛利率升、营业利润率不升：多赚的毛利被费用吃掉了，看是不是在主动加大研发 / 销售投入换增长。毛利率下降：最需要警惕。"],
    ["注意", "强周期股的利润率高点 ≈ 景气高点，此时 P/E 看起来最低，反而要小心；季度数据有季节性（如零售第四季度），看趋势不看单季；减值、重组等一次性费用会让营业利润率单季骤降，看下一季是否恢复。"],
  ],
};
// 针对这只股票：该优先看哪个指标
function valuationHints(v) {
  const out = [];
  const cy = v.cyclicality;
  if (cy?.tier === "strong") out.push(`强周期（${cy.reasons?.join("；") || "人工判断"}）：优先看 P/S 与 FCF 收益率；P/E 偏高未必贵（可能处于盈利低谷），偏低未必便宜（可能处于盈利高峰）。`);
  else if (cy?.tier === "medium") out.push(`中等周期性（${cy.reasons?.join("；") || "人工判断"}）：参考 P/E 时留意盈利处于周期的哪个阶段，结合 P/S 一起看。`);
  if (cy?.override) out.push(`周期性人工修正：${cy.override}`);
  if (!v.pe && !(v.trailing_pe > 0)) out.push("近 4 季亏损或盈利很低：P/E 没有意义，看 P/S。");
  const cs = v.fcf_hist?.capex_share;
  if (isNum(cs) && cs >= 0.5) out.push(`资本支出占经营现金流的 ${pct(cs, 0)}：FCF 收益率被大量投资压低${v.fcf_hist.now < 0 ? "（目前为负）" : ""}，要结合投资回报判断，不能单看它“变贵”。`);
  else if (v.fcf_hist && v.fcf_hist.now > 0 && cy?.tier !== "strong") out.push("现金流稳定、资本支出不高：FCF 收益率是这只股票最直接的估值尺子。");
  return out;
}
function valuationCard(s) {
  const v = s.valuation;
  if (!v) return "";
  const kpi = (label, val, sub = "") => `<div class="kpi"><span class="muted">${label}</span><b>${val}</b>${sub ? `<span class="muted">${sub}</span>` : ""}</div>`;
  const rank = (h) => (h ? `近 ${h.years} 年第 ${Math.round(h.pct * 100)} 百分位` : "");
  const hints = valuationHints(v);
  const panels = valPanels(v);
  const def = !v.pe?.base || v.cyclicality?.tier === "strong" ? "ps" : "pe";
  const modes = [["pe", "按盈利（P/E）"], ["ps", "按收入（P/S）"]].filter(([m]) => (m === "pe" ? v.pe?.base : v.ps_hist?.base));
  const missing = [!v.pe && "P/E（亏损或数据不足）", !v.ps_hist && `P/S（${v.hist_note || "外国公司只有年报且涉及外币 / ADR 口径，或 SEC 数据不足"}）`,
    !v.fcf_hist && "FCF 收益率（缺少资本支出数据，或银行等行业不适用）", !v.margins?.periods?.length && "利润率"].filter(Boolean);
  return `<section class="card" id="val-card"><h3>估值与利润率 ${badge("fact")}${badge("derived")}</h3>
    <p class="muted">${rich("估值决定“同样的好消息还能涨多少”：处于自身历史高位时，市场已经预期了很多，稍有失望就容易大跌；处于低位时相反。估值对未来几周的涨跌几乎没有预测力，适合用来判断风险与控制仓位，而不是择时。")}</p>
    <div class="kpis">
      ${kpi("市盈率 P/E", num(v.pe?.now ?? v.trailing_pe, 1), v.pe ? (v.pe.oneoff ? "⚠ 可能受一次性收益影响" : rank(v.pe)) : "")}
      ${kpi("预期市盈率 Forward P/E", num(v.forward_pe, 1), "按未来 12 个月 EPS 预期")}
      ${kpi("市销率 P/S", num(v.ps_hist?.now ?? v.ps, 1), v.ps_hist ? rank(v.ps_hist) : "按过去 12 个月收入")}
      ${kpi("FCF 收益率", v.fcf_hist ? pct(v.fcf_hist.now, 1) : "–", v.fcf_hist ? `${rank(v.fcf_hist)}（越高越便宜）` : "")}
      ${kpi("PEG", num(v.peg, 2), "市盈率 ÷ 盈利增速；约 1 为合理")}
    </div>
    ${hints.length ? `<div class="warn-box">${hints.map((h) => `<p>💡 ${esc(h)}</p>`).join("")}</div>` : ""}
    ${v.lag_note ? `<p class="muted">⏳ ${esc(v.lag_note)}。</p>` : ""}
    ${panels.length > 1 ? `<div class="row"><b>股价、估值与利润率（同一时间轴，悬停任一栏看当周全部数值）</b>
        ${modes.length ? `<span class="muted">第 ② 栏拆分口径</span><div class="seg" id="decomp-mode">${modes.map(([m, l]) => `<button type="button" data-m="${m}" class="${m === def ? "on" : ""}">${l}</button>`).join("")}</div>` : ""}</div>
      <p id="decomp-sum" class="ph-verdict" data-def="${def}"></p>
      <div id="c-val-all" class="chart" style="height:${valHeight(panels)}px"></div>
      ${missing.length ? `<p class="muted">暂无：${esc(missing.join("；"))}。</p>` : ""}
      <div class="val-guide"><b>怎么读这张图</b><ul>${valReadGuide(v, panels).map((t) => `<li>${t}</li>`).join("")}</ul></div>`
      : empty("暂无估值历史（外国公司只有年报且涉及外币 / ADR 口径，或数据不足）")}
    <details class="howto"><summary>三个估值指标与利润率的详细读法</summary>
      <div class="val-guide"><p>${esc(VAL_COMMON)}</p>
      <ul>${VAL_GUIDE.map(([n, t, curve]) => `<li><b>${n}</b>：${esc(t)}<br><span class="muted">曲线怎么看：</span><ul>${curve.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></li>`).join("")}</ul>
      <p><b>利润率（和估值是什么关系）</b>：${esc(MARGIN_GUIDE.role)}</p>
      <ul>${MARGIN_GUIDE.items.map(([n, t]) => `<li><b>${n}</b>：${esc(t)}</li>`).join("")}</ul>
      <p class="muted">另外：公司业务转型后（如英伟达从游戏显卡转向数据中心、西部数据分拆闪迪后），过去几年的估值区间可比性会变差。</p></div></details>
    <p class="muted">市盈率 = 实际股价 ÷ 近 4 季 EPS 之和（EPS 与分析师预期同口径，每季只在财报公布后才计入）；亏损期间不显示${v.pe && peCap(v.pe) ? `；市盈率栏纵轴截断在 ${num(peCap(v.pe), 0)}（历史最高 ${num(v.pe.max, 0)}，出现在盈利接近 0 的时期；悬停可看真实值）` : ""}。P/S、FCF 收益率按 SEC 季度财报（近 4 季合计，每季在提交 10-Q / 10-K 之后才计入）与稀释股本计算，当前值已与 Yahoo 核对；最新一季财报提交前会滞后一个季度。利润率来自 SEC 财报（公司合计），按季末后约 45 天（财报公布时）计入。股价为实际价格（不含分红）。</p></section>`;
}
// 多栏图包含哪些栏（只放有数据的）
const VAL_PANEL_H = { px: 120, dec: 110, pe: 105, ps: 105, mg: 95, fcf: 95 };
function valPanels(v) {
  return [(v.pe?.px || v.ps_hist?.px) && "px", (v.pe?.base || v.ps_hist?.base) && "dec", v.pe && "pe", v.ps_hist && "ps",
    v.margins?.periods?.length && "mg", v.fcf_hist && "fcf"].filter(Boolean);
}
const valHeight = (panels) => panels.reduce((a, k) => a + VAL_PANEL_H[k] + 42, 40);
function valReadGuide(v, panels) {
  const no = Object.fromEntries(panels.map((k, i) => [k, "①②③④⑤⑥"[i]]));
  const g = [];
  if (no.px) g.push(`<b>${no.px} 股价</b>：每周收盘（实际价格）。其余各栏都和它对齐，竖向指示线同时穿过所有栏。`);
  if (no.dec) g.push(`<b>${no.dec} 每季涨跌拆分</b>：每个色块是一个季度（上季末 → 本季末）。<span style="color:#1baf7a">■ 绿色</span> = 每股盈利（或收入，按上方按钮切换）变化带来的涨跌，<span style="color:#c98500">■ 琥珀色</span> = 估值（P/E 或 P/S）变化带来的涨跌，<b>黑色横线</b> = 股价实际涨跌（= 两者之和）。绿色占大头 = 这一季靠业绩；琥珀色占大头 = 靠估值（市场情绪与预期）；两者方向相反 = 业绩变好但估值收缩（或反过来）。悬停看具体数字。`);
  if (no.pe) g.push(`<b>${no.pe} 市盈率 P/E</b>：灰色带 = 自身近 5 年 20%–80% 区间，虚线 = 中位数。财报后的台阶 = 新一季盈利计入（● 标出跳变 ≥ 10% 的：绿 = 盈利增长使 P/E 下台阶，红 = 盈利下滑使 P/E 上台阶）。${v.cyclicality?.tier === "strong" ? "强周期股：P/E 低位用琥珀底与 ⚠ 标出，往往对应盈利高峰，不代表便宜。" : ""}`);
  if (no.ps) g.push(`<b>${no.ps} 市销率 P/S</b>：读法同上。P/S 抬升时，看${no.mg ? `正下方 ${no.mg} 栏` : "利润率"}同一时间利润率是否也在升：一起升 = 抬升有基本面支撑；利润率持平或下降 = 单纯估值扩张（<span class="neg">▲</span> 标出“P/S 13 周 +15% 而营业利润率两季下降 ≥ 2 个百分点”的时点）。`);
  if (no.mg) g.push(`<b>${no.mg} 毛利率 / 营业利润率</b>：按财报公布时间（季末后约 45 天）画成台阶，和 P/E、P/S 的台阶出现在同一时间，便于上下对照。`);
  if (no.fcf) g.push(`<b>${no.fcf} FCF 收益率</b>：方向与 P/E、P/S 相反，越高越便宜；下一张卡片把它的上升拆成“现金流增加”与“股价下跌”。`);
  g.push(`淡红 / 淡绿底 = 连续 ${VM.run} 周以上高于自身 80% 分位（偏贵）/ 低于 20% 分位（偏便宜），每栏只标最近 ${VM.maxAreas} 段。时间范围跟随上方价格走势的区间按钮与缩放。`);
  return g;
}
// ---------------- 估值曲线标记（A 高位 / 低位区间、C 财报台阶、E P/S 与利润率背离、F 强周期股低 P/E；D“估值 / 业绩驱动”由第 ② 栏拆分取代）----------------
const VM = { run: 4, step: Math.log(1.1), win: 13, psUp: Math.log(1.15), marginDrop: 0.02, marginLagDays: 45, maxPts: 6, maxAreas: 2 };
// 周五日期 → K 线日期中当天或之前最近的交易日
function nearDate(dates, d) {
  let lo = 0, hi = dates.length - 1, ans = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) { ans = dates[m]; lo = m + 1; } else hi = m - 1; }
  return ans;
}
// kind = "pe" | "ps"；返回 { areas: markArea 数据, points: markPoint 数据 }
function valMarks(kind, h, v, dates) {
  const n = h.values.length, val = h.values, base = h.base || [], px = h.px || [];
  const ok = (x) => isNum(x) && x > 0;
  const strongCyc = kind === "pe" && v.cyclicality?.tier === "strong";
  const den = kind === "pe" ? "每股盈利" : "每股收入", mult = kind === "pe" ? "P/E" : "P/S";
  const at = (i) => nearDate(dates, h.dates[i]);
  // A / F：连续 ≥ run 周高于 p80 / 低于 p20 的区间（取最近 maxAreas 段）
  const runs = [];
  for (let i = 0; i < n;) {
    const side = !ok(val[i]) ? null : val[i] > h.p80 ? "high" : val[i] < h.p20 ? "low" : null;
    if (!side) { i++; continue; }
    let j = i;
    while (j + 1 < n && ok(val[j + 1]) && (side === "high" ? val[j + 1] > h.p80 : val[j + 1] < h.p20)) j++;
    if (j - i + 1 >= VM.run) runs.push({ side, i, j });
    i = j + 1;
  }
  const areas = runs.slice(-VM.maxAreas).filter((r) => at(r.i) && at(r.j)).map((r) => {
    const cyc = strongCyc && r.side === "low";
    const color = cyc ? "rgba(237,161,0,0.20)" : r.side === "high" ? "rgba(208,59,59,0.13)" : "rgba(27,175,122,0.13)";
    return [{ xAxis: at(r.i), itemStyle: { color, opacity: 1 }, label: { show: true, position: "insideTop", fontSize: 10, color: css("--muted"), formatter: cyc ? "低位（周期顶？）" : r.side === "high" ? "偏贵" : "偏便宜" } }, { xAxis: at(r.j) }];
  });
  const pts = [];
  // C：财报台阶（分母变化 ≥ 10%）
  for (let i = 1; i < n; i++) {
    if (!ok(base[i]) || !ok(base[i - 1]) || !ok(val[i])) continue;
    const db = Math.log(base[i] / base[i - 1]);
    if (Math.abs(db) < VM.step) continue;
    pts.push({ i, kind: "C", symbol: "circle", symbolSize: 8, color: db > 0 ? css("--good") : css("--bad"),
      tip: `${h.dates[i]} 新一季财报计入：${den}（近 4 季）${pct(Math.expm1(db), 0, true)}，${mult} 因此${db > 0 ? "下" : "上"}台阶 ${pct(Math.abs(Math.expm1(-db)), 0)}` });
  }
  // E：P/S 近 win 周上升 ≥ 15%，营业利润率较两个季度前下降 ≥ 2 个百分点（季度数据按季末 + 45 天视为可用）
  const m = v.margins;
  if (kind === "ps" && m?.frequency === "quarterly" && m.op_margin?.some(isNum)) {
    const eff = m.periods.map((d) => { const x = new Date(d); x.setDate(x.getDate() + VM.marginLagDays); return x.toISOString().slice(0, 10); });
    let last = -Infinity;
    for (let j = VM.win; j < n; j++) {
      if (j - last < VM.win || !ok(val[j]) || !ok(val[j - VM.win]) || Math.log(val[j] / val[j - VM.win]) < VM.psUp) continue;
      let q = -1;
      for (let t = 0; t < eff.length; t++) if (eff[t] <= h.dates[j]) q = t;
      if (q < 2 || !isNum(m.op_margin[q]) || !isNum(m.op_margin[q - 2])) continue;
      const dmg = m.op_margin[q] - m.op_margin[q - 2];
      if (dmg > -VM.marginDrop) continue;
      last = j;
      pts.push({ i: j, kind: "E", symbol: "triangle", symbolSize: 11, color: css("--bad"),
        tip: `${h.dates[j]}：近 ${VM.win} 周 P/S ${pct(val[j] / val[j - VM.win] - 1, 0, true)}，但营业利润率（${m.periods[q]} 季）较两个季度前 ${num(dmg * 100, 1, true)} 个百分点：估值在抬高、盈利能力在变差` });
    }
  }
  // F：强周期股 P/E 低位区间的起点
  if (strongCyc) runs.filter((r) => r.side === "low").forEach((r) => pts.push({ i: r.i, kind: "F", symbol: "path://M12 2 L22 20 L2 20 Z", symbolSize: 13, color: "#eda100",
    tip: `${h.dates[r.i]} 起连续 ${r.j - r.i + 1} 周 P/E 低于自身 20% 分位：强周期股的低 P/E 往往出现在盈利高峰（景气顶部），并不代表便宜，优先看 P/S` }));
  const points = pts.sort((a, b) => a.i - b.i).slice(-VM.maxPts).filter((p) => at(p.i)).map((p) => ({
    coord: [at(p.i), val[p.i]], symbol: p.symbol, symbolSize: p.symbolSize, itemStyle: { color: p.color, borderColor: css("--surface"), borderWidth: 1 },
    label: p.label ? { show: true, formatter: p.label, color: "#fff", fontSize: 10 } : { show: false }, tip: p.tip, symbolOffset: p.kind === "F" ? [0, 12] : [0, 0] }));
  return { areas, points };
}

// 市盈率纵轴上限：盈利接近 0 时 P/E 会出现极端尖峰，压扁其余走势；上限取“5 年中位数 × 3”与“近 52 周第 95 百分位 × 1.1”中较大者，
// 保证近一年的曲线完整显示；没有超出时返回 null（不截断）
function peCap(h) {
  const rec = h.values.slice(-52).filter(isNum).sort((a, b) => a - b);
  const q95 = rec.length ? rec[Math.min(rec.length - 1, Math.floor(rec.length * 0.95))] : 0;
  const c = Math.max(h.median * 3, q95 * 1.1);
  return h.values.some((x) => isNum(x) && x > c) ? Math.ceil(c) : null;
}
// 季度涨跌拆分（第 ② 栏）：上季末 → 本季末，log(股价) = log(分母) + log(倍数)
function valQuarters(axis, px, base, mult) {
  const ok = (i) => [px[i], base[i], mult[i]].every((x) => isNum(x) && x > 0);
  const qOf = (d) => `${d.slice(0, 4)}Q${Math.floor((+d.slice(5, 7) - 1) / 3) + 1}`;
  const ends = [];
  axis.forEach((d, i) => { if (i === axis.length - 1 || qOf(axis[i + 1]) !== qOf(d)) ends.push(i); });
  const out = [];
  for (let t = 1; t < ends.length; t++) {
    const a = ends[t - 1], b = ends[t];
    if (!ok(a) || !ok(b)) { out.push({ a, b, q: qOf(axis[b]), na: true }); continue; }
    out.push({ a, b, q: qOf(axis[b]), dp: Math.log(px[b] / px[a]), db: Math.log(base[b] / base[a]), dm: Math.log(mult[b] / mult[a]) });
  }
  return out;
}
function drawValuation(s, k) {
  const v = s.valuation, el = byId("c-val-all");
  if (!v || !el) return;
  const panels = valPanels(v);
  // 共用周轴：各估值序列的周五日期并集
  const axis = [...new Set([...(v.pe?.dates || []), ...(v.ps_hist?.dates || []), ...(v.fcf_hist?.dates || [])])].sort();
  const onAxis = (h, key = "values") => { if (!h) return axis.map(() => null); const m = Object.fromEntries(h.dates.map((d, i) => [d, h[key]?.[i]])); return axis.map((d) => m[d] ?? null); };
  const px = (() => { const a = onAxis(v.pe, "px"), b = onAxis(v.ps_hist, "px"); return a.map((x, i) => x ?? b[i]); })();
  const pe = onAxis(v.pe), ps = onAxis(v.ps_hist), fcf = onAxis(v.fcf_hist);
  // 利润率：季末 + 45 天（年报 + 75 天）起生效，画成台阶
  const m = v.margins, lag = m?.frequency === "quarterly" ? 45 : 75;
  const eff = (m?.periods || []).map((d) => { const x = new Date(d); x.setDate(x.getDate() + lag); return x.toISOString().slice(0, 10); });
  const mAt = (arr) => axis.map((d) => { let q = -1; for (let t = 0; t < eff.length; t++) if (eff[t] <= d) q = t; return q >= 0 && isNum(arr?.[q]) ? arr[q] : null; });
  const gm = mAt(m?.gross_margin), om = mAt(m?.op_margin);
  const C = { px: css("--ink"), pe: palette()[0], ps: palette()[6], fcf: palette()[2], gm: palette()[5], om: palette()[0], biz: "#1baf7a", val: "#e0a419" };
  // 网格布局
  const grids = [], xAxes = [], yAxes = [], titles = [], series = [];
  let top = 30;
  panels.forEach((key, gi) => {
    const h = VAL_PANEL_H[key];
    grids.push({ left: 56, right: 78, top: top + 8, height: h });
    titles.push({ text: { px: "① 股价", dec: "② 每季涨跌拆分", pe: "③ 市盈率 P/E", ps: "④ 市销率 P/S", mg: "⑤ 毛利率 / 营业利润率", fcf: "⑥ FCF 收益率" }[key].replace(/^[①-⑥]/, "①②③④⑤⑥"[gi]),
      left: 56, top: top - 18, textStyle: { fontSize: 12, fontWeight: 600, color: css("--ink-2") } });
    xAxes.push({ type: "category", data: axis, gridIndex: gi, boundaryGap: false, axisLabel: { show: gi === panels.length - 1 }, axisTick: { show: gi === panels.length - 1 } });
    const fmt = { px: (x) => num(x, 0), dec: (x) => `${num(x, 0)}%`, pe: (x) => num(x, 0), ps: (x) => num(x, 1), mg: (x) => pct(x, 0), fcf: (x) => pct(x, 1) }[key];
    yAxes.push({ type: "value", gridIndex: gi, scale: key !== "dec", splitNumber: 3, axisLabel: { formatter: fmt, fontSize: 10 },
      max: key === "pe" && peCap(v.pe) ? peCap(v.pe) : undefined });
    top += h + 42;
  });
  const gi = (key) => panels.indexOf(key);
  const band = (h, fmt) => ({
    markArea: isNum(h?.p20) ? { silent: true, itemStyle: { color: css("--chip"), opacity: 0.7 }, data: [[{ yAxis: h.p20 }, { yAxis: h.p80 }]] } : undefined,
    markLine: isNum(h?.median) ? { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" }, label: { color: css("--muted"), fontSize: 10, position: "end", formatter: `中位 ${fmt(h.median)}` }, data: [{ yAxis: h.median }] } : undefined });
  const line = (key, name, data, color, extra = {}) => ({ name, type: "line", xAxisIndex: gi(key), yAxisIndex: gi(key), data, color, showSymbol: false, connectNulls: false, lineStyle: { width: 1.6 }, ...extra });
  if (gi("px") >= 0) series.push(line("px", "股价", px, C.px, { lineStyle: { width: 1.8 } }));
  const withMarks = (key, h, kind) => {
    const mk = valMarks(kind, h, v, axis);
    const b = band(h, kind === "pe" ? (x) => num(x, 1) : (x) => num(x, 1));
    if (b.markArea) b.markArea.data.push(...mk.areas);
    return { ...b, markPoint: mk.points.length ? { data: mk.points, tooltip: { trigger: "item", formatter: (p) => esc(p.data.tip) } } : undefined };
  };
  if (gi("pe") >= 0) series.push(line("pe", "P/E", pe, C.pe, withMarks("pe", v.pe, "pe")));
  if (gi("ps") >= 0) series.push(line("ps", "P/S", ps, C.ps, withMarks("ps", v.ps_hist, "ps")));
  if (gi("mg") >= 0) {
    series.push(line("mg", "毛利率", gm, C.gm, { step: "end" }));
    series.push(line("mg", "营业利润率", om, C.om, { step: "end", lineStyle: { width: 2 } }));
  }
  if (gi("fcf") >= 0) series.push(line("fcf", "FCF 收益率", fcf, C.fcf, band(v.fcf_hist, (x) => pct(x, 1))));
  // 第 ② 栏：自定义矩形（横跨整个季度）
  let quarters = [];
  const decIdx = series.length;
  if (gi("dec") >= 0) {
    series.push(line("dec", "零线", axis.map(() => 0), css("--axis"), { lineStyle: { width: 1, type: "dashed" }, silent: true }));
    series.push({ name: "拆分", type: "custom", xAxisIndex: gi("dec"), yAxisIndex: gi("dec"), clip: true, silent: true, data: [], encode: { x: 1, y: [2, 3] }, // 按季末筛选：起点在显示范围外的季度也画出可见部分
      renderItem: (params, api) => {
        const [a, b, lo, hi, kind] = [api.value(0), api.value(1), api.value(2), api.value(3), api.value(4)];
        const w = api.size([1, 0])[0];
        const x0 = api.coord([a, 0])[0] + w / 2, x1 = api.coord([b, 0])[0] + w / 2;
        if (kind === 2) { const y = api.coord([b, hi])[1]; return { type: "rect", shape: { x: x0, y: y - 1.5, width: Math.max(1, x1 - x0), height: 3 }, style: { fill: css("--ink") } }; }
        const y0 = api.coord([a, hi])[1], y1 = api.coord([a, lo])[1];
        return { type: "rect", shape: { x: x0 + 1, y: y0, width: Math.max(1, x1 - x0 - 2), height: Math.max(1, y1 - y0) }, style: { fill: kind === 0 ? C.biz : C.val, opacity: 0.85 } };
      } });
  }
  const setDecomp = (mode) => {
    const h = mode === "ps" ? v.ps_hist : v.pe;
    if (!h?.base || gi("dec") < 0) return;
    quarters = valQuarters(axis, px, onAxis(h, "base"), mode === "ps" ? ps : pe);
    const data = [];
    quarters.filter((q) => !q.na).forEach((q) => {
      const db = q.db * 100, dm = q.dm * 100;
      data.push([q.a, q.b, Math.min(0, db), Math.max(0, db), 0]);
      if (Math.sign(dm) === Math.sign(db)) data.push([q.a, q.b, Math.min(db, db + dm), Math.max(db, db + dm), 1]);
      else data.push([q.a, q.b, Math.min(0, dm), Math.max(0, dm), 1]);
      data.push([q.a, q.b, 0, (q.db + q.dm) * 100, 2]);
    });
    chart.setOption({ series: series.map((x, i) => (i === decIdx + 1 ? { data } : {})) });
    summary(mode);
  };
  const qAt = (i) => quarters.find((q) => i > q.a && i <= q.b);
  const den = () => (decMode === "ps" ? "每股收入" : "每股盈利"), mul = () => (decMode === "ps" ? "P/S" : "P/E");
  const tip = (params) => {
    const i = params?.[0]?.dataIndex;
    if (i == null) return "";
    const row = (name, val, f) => (isNum(val) ? `${name} <b>${f(val)}</b><br>` : "");
    const q = qAt(i);
    const qtxt = !q ? "" : q.na ? `${q.q}：亏损或数据缺口，无法拆分<br>` : `${q.q} 股价 <b>${pct(Math.expm1(q.dp), 0, true)}</b> = ${den()} ${pct(Math.expm1(q.db), 0, true)} × ${mul()} ${pct(Math.expm1(q.dm), 0, true)}<br>`;
    return `${esc(axis[i])}<br>${row("股价", px[i], (x) => num(x, 2))}${qtxt}${row("P/E", pe[i], (x) => num(x, 1))}${row("P/S", ps[i], (x) => num(x, 1))}${row("毛利率", gm[i], (x) => pct(x, 1))}${row("营业利润率", om[i], (x) => pct(x, 1))}${row("FCF 收益率", fcf[i], (x) => pct(x, 2))}`;
  };
  const chart = mkChart(el, { animation: false, title: titles, grid: grids, xAxis: xAxes, yAxis: yAxes, series, legend: { show: false },
    axisPointer: { link: [{ xAxisIndex: "all" }] }, tooltip: { trigger: "axis", formatter: tip, axisPointer: { type: "line" } },
    dataZoom: [{ type: "inside", xAxisIndex: panels.map((_, i) => i), zoomOnMouseWheel: false, moveOnMouseMove: false, moveOnMouseWheel: false }] });
  if (!chart) return;
  // 可见区间的合计拆分（顶部一句话）
  let decMode = byId("decomp-sum")?.dataset.def || "pe";
  const visible = () => {
    const n = s.dates.length, [a, b] = k ? zoomRange(k, n) : [0, n - 1];
    const d0 = s.dates[a], d1 = b === n - 1 ? "9999-12-31" : s.dates[b];
    let i0 = axis.findIndex((d) => d >= d0), i1 = axis.length - 1;
    while (i1 > 0 && axis[i1] > d1) i1--;
    return [Math.max(0, i0), i1];
  };
  function summary(mode) {
    const elS = byId("decomp-sum"), h = mode === "ps" ? v.ps_hist : v.pe;
    if (!elS || !h?.base) return;
    const base = onAxis(h, "base"), mult = mode === "ps" ? ps : pe;
    const ok = (i) => [px[i], base[i], mult[i]].every((x) => isNum(x) && x > 0);
    const [a, b] = visible();
    let i0 = a, i1 = b;
    while (i0 < i1 && !ok(i0)) i0++;
    while (i1 > i0 && !ok(i1)) i1--;
    if (i0 >= i1) { elS.textContent = "显示区间内数据不足（或处于亏损期），无法拆分。"; return; }
    const dp = Math.log(px[i1] / px[i0]), db = Math.log(base[i1] / base[i0]), dm = Math.log(mult[i1] / mult[i0]);
    const share = Math.abs(dp) > 0.02 ? db / dp : null, d = mode === "ps" ? "每股收入" : "每股盈利", mm = mode === "ps" ? "P/S" : "P/E";
    const verdict = share == null ? "股价基本持平" : share >= 0.7 ? `主要来自${d}${db >= 0 ? "增长" : "下滑"}` : share <= 0.3 ? `主要来自估值${dm >= 0 ? "抬升" : "收缩"}` : "业绩与估值共同作用";
    elS.innerHTML = `显示区间（${esc(axis[i0])} → ${esc(axis[i1])}）：股价 <b class="${cls(dp)}">${pct(Math.expm1(dp), 0, true)}</b> = ${d} <b class="${cls(db)}">${pct(Math.expm1(db), 0, true)}</b> × ${mm} <b class="${cls(dm)}">${pct(Math.expm1(dm), 0, true)}</b>，<b>${verdict}</b>。`;
  }
  setDecomp(decMode);
  document.querySelectorAll("#decomp-mode button").forEach((btn) => (btn.onclick = () => {
    decMode = btn.dataset.m;
    document.querySelectorAll("#decomp-mode button").forEach((x) => x.classList.toggle("on", x === btn));
    setDecomp(decMode);
  }));
  // 时间范围跟随 K 线
  const sync = () => { const [a, b] = visible(); chart.dispatchAction({ type: "dataZoom", startValue: a, endValue: b }); summary(decMode); };
  k?.on("datazoom", sync);
  sync();
}

// ---------------- K 线上的“你的买卖点”（本机交易记录；其他设备用已解锁个人版中的账本）----------------
function myTrades(t) {
  let tr = null;
  try { tr = loadReconStart() ? loadTrades() : null; } catch { tr = null; }
  if (!tr && personalOn()) tr = window.PERSONAL.ledger?.trades || null;
  return (tr || []).filter((x) => x.ticker === t && (x.side === "buy" || x.side === "sell"));
}
/* d = 个股 / ETF 数据（已按当前价格口径换算）。成交价先按拆股换算，再换到图上的口径（复权价 = 实际价 × 分红因子）；
   未填成交价的按当天开盘价。同一天同方向合并为一个标记。 */
function tradeMarkPoints(d, t) {
  const trades = myTrades(t);
  if (!trades.length) return [];
  const splitMult = (date) => (d.splits || []).filter(([sd]) => sd > date).reduce((m, [, r]) => m * r, 1);
  const f = priceMode() === "adj" && d.div_factor ? d.div_factor : null;
  const groups = {};
  for (const x of trades) {
    const i = d.dates.findIndex((dd) => dd >= x.date);
    if (i < 0) continue; // 晚于图表数据
    if (x.date < d.dates[0]) continue; // 早于图表区间
    const m = splitMult(x.date);
    const px = x.price > 0 ? (x.price / m) * (f ? f[i] : 1) : d.ohlc[i][0];
    const k = `${i}|${x.side}`;
    const g = (groups[k] ||= { i, side: x.side, shares: 0, value: 0, raw: [] });
    g.shares += x.shares * m; g.value += x.shares * m * px; g.raw.push(x);
  }
  return Object.values(groups).map((g) => ({
    kind: "trade", coord: [d.dates[g.i], g.value / g.shares], date: d.dates[g.i], side: g.side, trades: g.raw,
    symbol: "circle", symbolSize: 17, itemStyle: { color: g.side === "buy" ? css("--pos") : css("--neg"), borderColor: css("--surface"), borderWidth: 2 },
    label: { show: true, formatter: g.side === "buy" ? "买" : "卖", color: "#fff", fontSize: 10, fontWeight: 600 },
  }));
}
function tradeTooltip(p) {
  const rows = p.data.trades.map((x) => `${x.side === "buy" ? "买入" : "卖出"} ${+x.shares.toFixed(4)} 股 @ ${x.price > 0 ? num(x.price, 2) : "开盘价"}${x.fee ? `（费用 ${num(x.fee, 2)}）` : ""}`);
  return `<b>你的交易</b> ${esc(p.data.trades[0].date)}<br>${rows.map(esc).join("<br>")}`;
}

// ---------------- 关键指标（估值 / 增长 / 盈利能力 / 财务健康 / 价格位置与风险 / 市场预期）----------------
// fmt：x = 倍数，pct = 百分比，pp = 百分比（带正负号），num = 数值；better：low / high / null（无好坏方向）
const METRIC_DEFS = {
  market_cap: { name: "市值", value: ["低", "规模本身对收益的预测力在大盘股中很弱，主要用于理解波动与流动性。"], fmt: "cap", better: null, def: "总市值（美元）= 股价 × 总股数（yfinance，随最新股价更新）。",
    read: "衡量公司规模；超大市值公司流动性好、波动通常较小。没有好坏之分。",
    use: "同样的新闻，对小公司的股价影响往往更大；比较估值时注意规模差异，与市值相差很大的同行比较估值要谨慎。" },
  pe_ttm: { name: "市盈率 P/E", value: ["中", "最常用的估值尺度。长期看，低估值股票整体略占优（价值效应），但对未来几个月涨跌几乎没有预测力；高成长公司长期“看起来贵”，单看会错过好公司。"], fmt: "x", better: "low", def: "股价 ÷ 过去 12 个月（TTM）每股收益（EPS）。买入 1 元的年利润要付多少元。",
    read: "越高说明市场对未来增长预期越高（或利润暂时偏低）；和同行、和自己历史比才有意义，单看绝对值意义不大。",
    use: "与预期 P/E 一起看：预期 P/E 明显低于 P/E，说明分析师预计利润会大幅增长。高市盈率股票对“不及预期”更敏感，财报前后波动更大。",
    caveat: "一次性收益 / 亏损会扭曲 TTM 利润；亏损公司不显示。" },
  pe_fwd: { name: "预期市盈率 Forward P/E", value: ["中", "比 P/E 更贴近市场正在定价的利润，适合比较成长股；但依赖分析师预期，预期本身偏乐观且会被修正。"], fmt: "x", better: "low", def: "股价 ÷ 分析师预期的未来 12 个月 EPS。",
    read: "反映市场按“明年的利润”给出的价格；比 P/E 更适合比较高增长公司。",
    use: "预期 P/E 低于同行、而增长不比同行差，可能被低估；但预期本身可能过于乐观，结合“分析师预期修正”方向看。" },
  peg: { name: "PEG", value: ["低–中", "把估值和增长放在一起，概念直观；但增速取自预期且口径不一，周期股和利润刚转正的公司会失真，只适合作粗筛。"], fmt: "num2", better: "low", def: "市盈率 ÷ 预期盈利增速（%）。把估值和增长放在一起看。",
    read: "约 1 被视为估值与增长匹配；明显低于 1 = 相对增长便宜，明显高于 2 = 增长已被充分定价。",
    use: "只适合盈利稳定增长的公司；周期股、利润刚转正的公司 PEG 会失真。",
    caveat: "增速取自分析师预期（yfinance），口径与周期因数据源而异。" },
  ps: { name: "市销率 P/S", value: ["中", "利润为负或波动大的公司唯一可用的估值尺度；必须结合利润率看，否则会把低利润率公司误判为便宜。"], fmt: "x", better: "low", def: "总市值 ÷ 过去 12 个月（TTM）收入。",
    read: "利润为负或波动很大的公司，用收入估值更稳定；高利润率公司天然市销率更高。",
    use: "与“毛利率”“营业利润率”一起看：同样的市销率，利润率高的公司更便宜。" },
  ev_ebitda: { name: "EV / EBITDA", value: ["中–高", "考虑了负债，跨资本结构比较更公平，学术研究中是表现较好的价值指标之一；不适用于银行保险，资本开支大的公司会被高估。"], fmt: "x", better: "low", def: "企业价值（市值 + 负债 − 现金）÷ 息税折旧摊销前利润。",
    read: "把负债也算进价格，比市盈率更适合比较负债结构不同的公司。",
    use: "常用于同行横向比较；银行、保险不适用（显示“–”）。" },
  pb: { name: "市净率 P/B", value: ["低（科技）/ 中（银行）", "对银行、保险等资产型公司是核心估值指标；对科技公司意义很小（价值主要在无形资产）。"], fmt: "x", better: "low", def: "股价 ÷ 每股净资产（账面价值）。",
    read: "对银行、保险等资产型公司最有意义（JPM、BRK-B）；科技公司的价值主要不在账面资产，市净率普遍很高。",
    use: "银行股市净率显著低于同行且 ROE 不差，常被视为便宜；同时看资产质量。" },
  fcf_yield: { name: "自由现金流收益率", value: ["中–高", "用真金白银而非会计利润衡量估值，较难被粉饰；资本开支周期（如 AI 数据中心投入）会让它短期失真。"], fmt: "pct", better: "high", def: "过去 12 个月自由现金流 ÷ 总市值（市盈率倒过来、但用现金而非会计利润）。",
    read: "高于国债利率较多，说明以现金回报衡量估值不贵；为负说明公司还在“烧钱”。",
    use: "与市盈率交叉验证：利润高但自由现金流很低，要留意应收账款、存货或资本开支是否大增。" },
  op_leverage: { name: "经营杠杆", value: ["中–高", "决定财报季的风险：杠杆高的公司收入稍有放缓，利润就会大幅下滑，“不及预期”时跌得更狠；对周期股尤其重要。"], fmt: "num1", better: null,
    def: "收入变化 1% 时营业利润平均变化百分之几：用近 10 年（拟合不好时近 5 年）每季“近 4 季营业利润同比增速”对“近 4 季收入同比增速”回归得到的斜率（SEC 财报）。",
    read: "约 1 = 利润与收入同步；2–4 = 收入增速放大 2–4 倍传到利润（固定成本占比高）；更高 = 利润对收入极敏感（如硬盘、存储芯片）。“–”表示利润被并购摊销、股权激励等扰动，关系不稳定。",
    use: "收入加速时高杠杆公司利润弹性大，收入放缓时风险也大；高杠杆 + 强周期 = 财报前后波动最大的组合，仓位要更保守。" },
  share_change: { name: "股本变化（年化）", value: ["中", "直接影响每股收益：每年回购 3% 相当于每股收益自动多增长约 3%；持续增发（员工股票、换股收购）会悄悄摊薄你的持股。"], fmt: "pp", better: "low",
    def: "稀释后总股数近 3 年的年化变化（SEC 财报，按拆股换算到今天的口径）。负数 = 回购净减少股本，正数 = 净增发。",
    read: "−2% ~ −5%：稳定回购（如苹果、Salesforce）；0 附近：回购大致抵消员工股票；+2% 以上：明显稀释，常见于换股收购或股权激励多的成长股。",
    use: "比较每股收益增速与净利润增速：回购让前者更快。持续稀释的公司，利润增长要比股本增长快得多，股东才真正受益。" },
  cash_conversion: { name: "现金转化率", value: ["中–高", "检查盈利质量最直接的指标：账面利润有没有变成真金白银；长期明显低于 1 往往是激进确认收入或需要大量投入才能维持增长的信号。"], fmt: "num2", better: "high",
    def: "近 12 个季度自由现金流（经营现金流 − 资本支出）之和 ÷ 净利润之和（SEC 财报）。",
    read: "约 1 = 利润基本都变成了现金；> 1 = 现金比利润多（折旧、摊销大或预收款多，如软件订阅）；明显 < 1 = 现金少于利润（资本支出大、应收或存货堆积）；为负 = 自由现金流为负。",
    use: "与资本密集度一起看：大规模投资期（如 AI 数据中心）现金转化率低是暂时的；没有大额投资却长期偏低，要查应收账款与存货。" },
  capex_intensity: { name: "资本密集度", value: ["中", "区分轻资产（软件、芯片设计）与重资产（芯片制造、数据中心）：重资产公司下行期更难调整成本，自由现金流波动更大，但也可能形成更高的进入门槛。"], fmt: "pct", better: null,
    def: "近 4 个季度资本支出 ÷ 收入（SEC 财报）。",
    read: "< 5%：轻资产；5%–15%：中等；> 20%：重资产（晶圆厂、硬盘、云计算数据中心）。近年 AI 数据中心投入让大型云公司明显上升。",
    use: "与自由现金流收益率、现金转化率一起看：资本密集度突然上升，说明公司在押注未来，短期现金回报会变差，要看投资能否带来收入增长。" },
  revenue_growth: { name: "收入增速（同比）", value: ["中", "成长股估值的基础；单季增速噪音大，趋势（加速 / 减速）比数值本身更有信息量。"], fmt: "pp", better: "high", def: "最近一个季度收入相对去年同季的增长。",
    read: "成长股估值的主要支撑；增速放缓往往先于股价重新定价。", use: "看趋势比看单季更重要：连续加速还是减速？详见下方“业务利润与增长”。" },
  earnings_growth: { name: "盈利增速（同比）", value: ["中", "反映经营杠杆；低基数时会非常夸张，需结合绝对利润看。"], fmt: "pp", better: "high", def: "最近一个季度每股收益相对去年同季的增长。",
    read: "盈利增速高于收入增速 = 利润率在扩张（经营杠杆）。", use: "基数很低时（去年接近亏损）增速会非常夸张，结合绝对利润看。" },
  eps_fwd_growth: { name: "预期 EPS 增长", value: ["低–中", "代表市场已经相信的增长；股价能否上涨取决于实际结果能否超出它，本身不是买入理由。"], fmt: "pp", better: "high", def: "未来 12 个月预期 EPS ÷ 过去 12 个月 EPS − 1。",
    read: "市场已经“相信”的增长；股价是否上涨取决于实际结果能否超过它。", use: "预期增长很高的股票，财报只要略低于预期就可能大跌。" },
  gross_margin: { name: "毛利率", value: ["中–高", "反映定价权与竞争力；研究显示毛利率（盈利能力）高的公司长期回报较好，且这一特征较稳定。"], fmt: "pct", better: "high", def: "（收入 − 直接成本）÷ 收入。",
    read: "反映定价权与产品竞争力；软件、芯片设计公司高，零售、制造低。", use: "毛利率持续上升通常意味着竞争地位增强；银行不适用。" },
  op_margin: { name: "营业利润率", value: ["中", "经营效率的综合体现；利润率扩张常是盈利超预期的来源，趋势比单期数值重要。"], fmt: "pct", better: "high", def: "营业利润 ÷ 收入（扣除研发、销售、管理费用后）。",
    read: "比毛利率更完整地反映经营效率。", use: "与过去比：利润率扩张是盈利超预期的常见来源，见下方利润率趋势图。" },
  net_margin: { name: "净利率", value: ["中", "最终留给股东的部分；易受一次性项目、税率影响，波动大于营业利润率。"], fmt: "pct", better: "high", def: "净利润 ÷ 收入。", read: "最终留给股东的部分；受税率、利息、一次性项目影响。", use: "与营业利润率差距很大时，查看是否有一次性收益或亏损。" },
  roe: { name: "ROE（净资产收益率）", value: ["中", "衡量生意好坏的经典指标（质量因子的一部分）；高负债和大量回购会把 ROE 抬高，需结合负债看。"], fmt: "pct", better: "high", def: "净利润 ÷ 股东权益。",
    read: "每 1 元股东资本一年赚多少；长期 15% 以上通常是好生意。", use: "高负债也能抬高 ROE，需结合负债权益比看；回购多的公司权益很小，ROE 会异常高。" },
  roa: { name: "ROA（总资产收益率）", value: ["中", "不受负债结构影响；适合同行业比较，跨行业比较意义不大。"], fmt: "pct", better: "high", def: "净利润 ÷ 总资产。", read: "不受负债结构影响的盈利效率；银行 ROA 1% 左右已属正常。", use: "与同行比较；跨行业比较意义不大。" },
  net_cash_pct: { name: "净现金 / 市值", value: ["中（风险）", "资产负债表缓冲，决定公司在下行期的抗压能力与回购空间；对预测涨跌帮助有限，主要用于控制风险。"], fmt: "pp", better: "high", def: "（现金 − 总负债）÷ 总市值；负数 = 净负债。",
    read: "正值越大，资产负债表越有缓冲，股价下跌时有回购 / 并购的余地。", use: "利率上升期，净负债高的公司利息负担加重；银行的“现金”含义不同，参考价值有限。" },
  debt_to_equity: { name: "负债权益比", value: ["中（风险）", "主要用于识别财务风险，尤其在利率上升期；资本密集行业天然偏高，需同行比较。"], fmt: "x", better: "low", def: "总负债 ÷ 股东权益。",
    read: "1 倍以下一般较稳健；资本密集行业天然更高。", use: "结合利息覆盖与现金流判断偿债压力；银行不适用。" },
  current_ratio: { name: "流动比率", value: ["低–中（风险）", "短期偿债能力；大型科技公司普遍充裕，信息量有限，主要用于排雷。"], fmt: "x", better: "high", def: "流动资产 ÷ 流动负债。", read: "大于 1 表示短期资产足以覆盖一年内到期的负债。", use: "明显低于 1 且现金流为负的公司要警惕短期资金压力。" },
  ret_1m: { name: "近 1 个月涨跌", value: ["低", "短期涨跌噪音大，研究中甚至存在短期反转；主要用于了解近况，不宜据此追涨杀跌。"], fmt: "pp", better: null, def: "含分红的价格变化。", read: "短期动量；单月涨跌包含大量噪音。", use: "与同行中位数比较，判断是公司自身原因还是整个板块在动。" },
  ret_ytd: { name: "今年以来", value: ["低", "描述性数据，帮助了解今年表现与估值变化的原因。"], fmt: "pp", better: null, def: "自上年最后一个交易日收盘起的涨跌（含分红）。", read: "今年的相对表现。", use: "大幅跑赢同行后，估值往往也已抬高，结合估值指标看。" },
  ret_1y: { name: "近 1 年", value: ["中", "中期动量是研究最充分的现象之一（过去一年强的股票短期内略倾向继续强），但会在市场急转时大幅回撤。"], fmt: "pp", better: null, def: "过去 12 个月的涨跌（含分红）。", read: "中期动量；学术研究中“过去 12 个月涨得多的股票”短期内略倾向继续跑赢，但效果不稳定。", use: "不宜单独作为买卖依据。" },
  pos_52w: { name: "52 周区间位置", value: ["中", "接近 52 周高点的股票在研究中倾向继续跑赢（投资者对高点的“锚定”）；接近低点则需要确认基本面是否恶化。"], fmt: "pct0", better: null, def: "（现价 − 52 周最低）÷（52 周最高 − 52 周最低）。0% = 年内最低，100% = 年内最高。",
    read: "反映价格在一年波动范围中的位置。", use: "接近 100%：趋势强但追高风险大；接近 0%：可能便宜，也可能基本面在恶化，要找原因。" },
  from_high: { name: "距 52 周高点", value: ["中（风险）", "衡量当前回撤深度，帮助判断持仓承受的压力；本身不是买卖信号。"], fmt: "pp", better: null, def: "现价相对过去一年最高收盘价的回撤。",
    read: "−20% 以上通常被称为“熊市”区域。", use: "持仓回撤较深时，回到“为什么买它”的理由是否仍成立，而不只看价格。" },
  vs_ma200: { name: "距 200 日均线", value: ["低–中", "常用的趋势过滤器，本系统的市场状态判断也用它；对个股的预测力有限，偏离过大时注意回调风险。"], fmt: "pp", better: null, def: "现价 ÷ 过去 200 个交易日平均价 − 1。",
    read: "正值 = 长期趋势向上；偏离过大（如 +30%）说明短期涨得过快。", use: "很多机构用 200 日均线做趋势过滤；跌破常引发技术性卖盘。" },
  vol_1y: { name: "年化波动率", value: ["高（风险）", "最可靠的风险尺度之一：过去波动大的股票未来通常也波动大，适合用来决定仓位大小；研究中低波动股票的风险调整后收益还略好。"], fmt: "pct", better: "low", def: "过去一年日收益率的标准差 × √252。",
    read: "衡量价格摆动幅度：40% 的股票一年内正负 40% 的波动都算“正常”。", use: "决定仓位大小：波动率高的股票同样的仓位风险更大，可以相应减少仓位。" },
  max_dd_1y: { name: "近 1 年最大回撤", value: ["高（风险）", "直观展示持有体验，帮助评估自己能否承受；对未来收益没有预测力。"], fmt: "pp", better: "high", def: "过去一年从任意高点到之后最低点的最大跌幅。",
    read: "持有这只股票一年中最难受的时候亏了多少。", use: "问自己能否承受同样幅度的下跌而不恐慌卖出。" },
  beta: { name: "Beta（β）", value: ["中（风险）", "衡量与大盘的联动，用于理解组合整体风险；会随时间变化，对收益的预测力很弱。"], fmt: "num2", better: null, def: "股价对大盘涨跌的敏感度（yfinance 按 5 年月度数据计算）。",
    read: "1.5 = 大盘涨跌 1% 时它平均涨跌 1.5%；小于 1 更防御。", use: "组合整体 β 高意味着大盘下跌时损失更大；用来理解“我的组合有多跟着大盘走”。" },
  target_upside: { name: "目标价空间", value: ["低", "分析师目标价整体偏乐观，平均空间常年为正；变化方向（上调 / 下调）比水平更有信息量。"], fmt: "pp", better: null, def: "分析师平均目标价 ÷ 现价 − 1。",
    read: "分析师普遍偏乐观，目标价空间平均就是正的；绝对值意义有限。", use: "更有信息量的是变化方向：目标价被持续上调或下调。见“分析师预期修正”。" },
  rec_mean: { name: "分析师评级均值", value: ["低", "评级普遍偏买入，区分度小；评级的突然下调比水平本身更值得注意。"], fmt: "num2", better: "low", def: "1 = 强烈买入，3 = 持有，5 = 卖出 的平均值。",
    read: "卖出评级极少，2 左右已经很常见。", use: "参考价值有限；评级的突然下调比水平本身更值得注意。" },
  short_pct_float: { name: "空头比例", value: ["中", "研究显示空头比例高的股票未来平均表现偏弱（空头往往掌握负面信息）；但也可能触发轧空，短期波动加大。"], fmt: "pct", better: "low", def: "被卖空的股数 ÷ 流通股（交易所每半月公布，存在滞后）。",
    read: "大盘股通常 1–3%；超过 10% 说明有相当多的投资者押注下跌。", use: "空头比例高 + 利好消息，可能引发轧空式上涨；也提示存在被广泛关注的负面观点。" },
  short_change: { name: "空头变化（较上月）", value: ["低–中", "空头快速增加说明看空的人在变多；数据半月更新、存在滞后。"], fmt: "pp", better: "low", def: "最新空头股数相对上一期的变化。", read: "空头快速增加说明看空的人在增多。", use: "与股价走势一起看：价格上涨但空头增加，分歧在加大。" },
  days_to_cover: { name: "空头回补天数", value: ["中", "比单纯的空头比例更能反映空头拥挤程度，研究中对未来表现有一定预测力；也提示轧空风险。"], fmt: "num1", better: "low", def: "空头股数 ÷ 日均成交量：空头全部买回需要几天。", read: "越大，空头集中回补时价格冲击越大。", use: "超过 5 天且出现利好时，要考虑轧空带来的剧烈波动。" },
  insiders_pct: { name: "内部人持股", value: ["低", "水平本身信息量小，内部人的买卖行为（见个股页“内部人交易”）更有用。"], fmt: "pct", better: null, def: "公司高管与董事持有的股份比例。", read: "创始人主导的公司比例较高；利益与股东更一致。", use: "看变化比看水平更有用：见下方“内部人交易”。" },
  institutions_pct: { name: "机构持股", value: ["低", "描述持股结构；比例极高时机构集中调仓会放大波动。"], fmt: "pct", better: null, def: "基金、养老金等机构持有的比例。", read: "大盘股通常 60–80%。", use: "比例很高时，机构集中调仓会放大股价波动。" },
  dividend_yield: { name: "股息率（近 12 个月）", value: ["低–中", "收息投资者关注；对成长股意义不大，高股息有时只是股价下跌的结果。"], fmt: "pct", better: null, def: "过去 12 个月每股分红 ÷ 现价。", read: "成长股通常很低或为 0；银行、零售较高。", use: "与 10 年国债利率比较，判断这只股票的现金回报吸引力。" },
  payout: { name: "分红比例", value: ["低–中", "用于判断分红能否持续；超过 80% 时分红增长空间有限。"], fmt: "pct", better: null, def: "分红 ÷ 净利润。", read: "超过 80% 意味着分红增长空间有限，利润下滑时可能被迫减少分红。", use: "收息投资者关注它的可持续性。" },
};
function fmtMetric(v, f) {
  if (!isNum(v)) return "–";
  if (f === "x") return `${v.toFixed(v >= 100 ? 0 : 1)}×`;
  if (f === "pct") return pct(v, 1);
  if (f === "pct0") return pct(v, 0);
  if (f === "pp") return pct(v, 1, true);
  if (f === "num1") return num(v, 1);
  if (f === "cap") return v >= 1e12 ? `${num(v / 1e12, 2)} 万亿美元` : `${Math.round(v / 1e8).toLocaleString()} 亿美元`;
  return num(v, 2);
}
// 相对同行中位数的一句话（只描述事实：高于 / 低于多少）
function metricCompare(it, d) {
  const ref = isNum(it.theme_median) ? it.theme_median : it.universe_median;
  if (!isNum(it.value) || !isNum(ref)) return "";
  const who = isNum(it.theme_median) ? "同行" : "选股池";
  if (d.fmt === "cap") { // 规模：用倍数描述，不分好坏
    const r = it.value / ref;
    return r > 0.9 && r < 1.1 ? `<span class="muted">与${who}接近</span>` : `<span class="dir-neutral">${who}中位数的 ${r >= 1 ? `${num(r, r >= 10 ? 0 : 1)} 倍` : pct(r, r < 0.1 ? 1 : 0)}</span>`;
  }
  const pctOrX = d.fmt === "x" || d.fmt === "num2" || d.fmt === "num1";
  const diff = pctOrX ? (ref !== 0 ? it.value / ref - 1 : NaN) : it.value - ref;
  // 接近：倍数类相差 < 10%；百分比类绝对差 < 2 个百分点且相对差 < 25%（避免 1.8% vs 0.2% 这种相差数倍的被算作接近）
  const rel = ref !== 0 ? Math.abs(it.value / ref - 1) : Infinity;
  const close = pctOrX ? Math.abs(diff) < 0.1 : Math.abs(diff) < 0.02 && rel < 0.25;
  if (!isNum(diff) || close) return `<span class="muted">与${who}接近</span>`;
  const higher = diff > 0;
  const good = d.better ? (d.better === "high") === higher : null;
  const text = pctOrX ? `${higher ? "高于" : "低于"}${who} ${pct(Math.abs(diff), 0)}` : `${higher ? "高于" : "低于"}${who} ${(Math.abs(diff) * 100).toFixed(1)} 个百分点`;
  return good === null
    ? `<span class="dir-neutral" title="${esc(d.neutralNote || "该指标没有通用的好坏方向（如涨跌、Beta、持股结构），只列出与同行的差距")}">${text}${d.neutralNote ? " ⓘ" : ""}</span>`
    : `<span class="${good ? "pos" : "neg"}">${text}</span>`;
}
// 强周期股：P/E 类指标与同行相比的高低主要反映盈利处于周期的哪个阶段，不分好坏（标蓝）
const CYC_NEUTRAL = ["pe_ttm", "pe_fwd", "peg", "ev_ebitda"];
const CYC_NOTE = "强周期股：P/E 高低主要反映盈利处于周期的哪个阶段（盈利高峰时 P/E 最低、低谷时最高），不分好坏；参考 P/S 与自由现金流收益率";
function metricsCard(s) {
  const m = s.metrics;
  if (!m) return "";
  const cycStrong = s.valuation?.cyclicality?.tier === "strong";
  const groups = m.groups.map((g) => `<div class="metric-group"><h4>${esc(g.name)}</h4><div class="table-wrap"><table class="metrics"><colgroup><col style="width:34%"><col style="width:13%"><col style="width:14%"><col style="width:14%"><col></colgroup><thead><tr><th>指标（点击看说明）</th><th class="num">本股</th>
      <th class="num">同行中位数</th><th class="num">选股池中位数</th><th>比较</th></tr></thead><tbody>${g.items.map((it) => {
      const d0 = METRIC_DEFS[it.key] || { name: it.key, fmt: "num2" };
      const d = cycStrong && CYC_NEUTRAL.includes(it.key) ? { ...d0, better: null, neutralNote: CYC_NOTE } : d0;
      return `<tr><td class="def"><details><summary><b>${esc(d.name)}</b></summary><p>${esc(d.def || "")}</p><p><b>如何理解：</b>${esc(d.read || "")}</p><p><b>如何使用：</b>${esc(d.use || "")}</p>${d.value ? `<p><b>参考价值：${esc(d.value[0])}</b>——${esc(d.value[1])}</p>` : ""}${d.caveat ? `<p class="muted">注意：${esc(d.caveat)}</p>` : ""}</details></td>
        <td class="num"><b>${fmtMetric(it.value, d.fmt)}</b></td><td class="num">${fmtMetric(it.theme_median, d.fmt)}</td><td class="num">${fmtMetric(it.universe_median, d.fmt)}</td><td>${metricCompare(it, d)}</td></tr>`;
    }).join("")}</tbody></table></div></div>`).join("");
  return `<section class="card" id="metrics-card"><h3>关键指标 ${badge("fact")}${badge("derived")}<span class="muted" style="font-weight:400"> 公司数据 ${esc(m.fetched || "")}（yfinance）· 价格类按最新收盘计算</span></h3>
    ${m.fin_currency && m.fin_currency !== "USD" ? `<p class="warn">该公司财报以 ${esc(m.fin_currency)} 计、股价以美元计：P/S、自由现金流收益率、净现金占比已按最新汇率换算；P/B 与 EV/EBITDA 涉及 ADR 换股比例，无法可靠换算，不显示；P/E 沿用 yfinance 数值，每股收益口径（外币或美元）因公司而异，可能有约一成的汇率偏差。</p>` : ""}
    <p class="muted">同行 = 同主题且同行业${m.sector ? `（${esc(m.sector)}）` : ""}：${m.peers.length >= 3 ? m.peers.map((p) => `<a href="#/stock/${esc(p)}">${esc(p)}</a>`).join("、") : "不足 3 只，只与选股池比较"}。</p>
    ${cycStrong ? `<p class="warn">⚠ ${esc(CYC_NOTE)}；因此下表中市盈率 P/E、预期市盈率、PEG、EV/EBITDA（同样基于盈利）与同行的比较标为蓝色（不分好坏）。周期性依据见“估值与利润率”。</p>` : ""}
    <p class="muted">${rich("先看估值和增长是否匹配，再看盈利能力和财务健康是否支撑，最后看价格位置与市场预期。“比较”一栏的颜色含义见表格下方；“–”表示该行业不适用或暂无数据。")}
      点击指标名可看含义、用法与参考价值；全部指标的对照表见 <a href="#/glossary?t=metric-dict">术语与说明 → 指标词典</a>。</p>
    ${groups}
    <p class="muted">“比较”一栏的颜色：<span class="pos">绿</span> = 与同行相比通常被认为更好；<span class="neg">红</span> = 通常被认为更差；<span class="dir-neutral">蓝</span> = 该指标没有通用的好坏方向（如涨跌、Beta、持股结构、股息率），只列出差距；<span class="muted">灰</span> = 与同行接近（倍数类相差 &lt; 10%；百分比类相差 &lt; 2 个百分点且相对差 &lt; 25%）。颜色只表示方向，不代表买卖建议。</p></section>`;
}
function metricInsights(s) {
  const m = s.metrics;
  if (!m) return [];
  const get = (k) => m.groups.flatMap((g) => g.items).find((i) => i.key === k) || {};
  const out = [];
  const pe = get("pe_fwd"), gr = get("eps_fwd_growth");
  if (isNum(pe.value) && isNum(pe.theme_median) && pe.value > pe.theme_median * 1.3)
    out.push({ level: "medium", kind: "derived", target: "metrics-card", text: `预期 P/E ${fmtMetric(pe.value, "x")}，高于同行中位数 ${fmtMetric(pe.theme_median, "x")}${isNum(gr.value) ? `（预期 EPS 增长 ${pct(gr.value, 0, true)}）` : ""}：估值已包含较高的增长预期。` });
  const fh = get("from_high");
  if (isNum(fh.value) && fh.value <= -0.2) out.push({ level: "high", kind: "fact", target: "metrics-card", text: `距 52 周高点 ${pct(fh.value, 1)}，处于较深的回撤中。` });
  const sc = get("short_change"), sp = get("short_pct_float");
  if (isNum(sc.value) && sc.value >= 0.2 && isNum(sp.value) && sp.value >= 0.02) out.push({ level: "medium", kind: "fact", target: "metrics-card", text: `空头股数较上期增加 ${pct(sc.value, 0)}，空头比例 ${pct(sp.value, 1)}。` });
  return out;
}

// ---------------- 内部人交易（SEC Form 4，经 yfinance 整理）----------------
const INSIDER_ZH = { purchase: "公开市场买入", sale: "卖出", award: "股票授予", gift: "赠与", exercise: "行权", other: "其他" };
function insiderCard(s, t) {
  const list = s.insider || [];
  const since = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); };
  const s6 = since(182);
  const recent = list.filter((x) => x.date >= s6);
  const agg = (k) => recent.filter((x) => x.kind === k).reduce((a, x) => ({ n: a.n + 1, v: a.v + (x.value || 0), sh: a.sh + (x.shares || 0) }), { n: 0, v: 0, sh: 0 });
  const buy = agg("purchase"), sell = agg("sale");
  const money$ = (v) => (v >= 1e8 ? `${(v / 1e8).toFixed(1)} 亿美元` : v >= 1e4 ? `${(v / 1e4).toFixed(0)} 万美元` : v > 0 ? `${Math.round(v)} 美元` : "–");
  const rows = list.slice(0, 15).map((x) => `<tr><td class="nowrap">${esc(x.date)}</td><td>${esc(x.insider)}<br><span class="muted">${esc(x.position)}</span></td>
    <td><span class="${x.kind === "purchase" ? "pos" : x.kind === "sale" ? "neg" : "muted"}">${esc(INSIDER_ZH[x.kind] || x.kind)}</span>${x.direct ? "" : ' <span class="muted" title="通过信托、家族实体等间接持有">（间接）</span>'}</td>
    <td class="num">${isNum(x.shares) ? Math.round(x.shares).toLocaleString() : "–"}</td><td class="num">${money$(x.value)}</td></tr>`).join("");
  return `<section class="card" id="insider-card"><h3>内部人交易（近 1 年）${badge("fact")}</h3>
    ${list.length ? `<div class="kpis">
      <div class="kpi"><span class="muted">近 6 个月公开市场买入</span><b class="${buy.n ? "pos" : ""}">${buy.n} 笔</b><span class="muted">${money$(buy.v)}</span></div>
      <div class="kpi"><span class="muted">近 6 个月卖出</span><b>${sell.n} 笔</b><span class="muted">${money$(sell.v)}</span></div></div>
      <div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>日期</th><th>人员 / 职务</th><th>类型</th><th class="num">股数</th><th class="num">金额</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty("近 1 年没有记录（或数据源暂无）")}
    <p class="muted">${rich("数据来自高管与董事向 SEC 提交的 Form 4（经 Yahoo 整理，申报通常在交易后 2 个工作日内）。如何理解：高管卖出很常见（分散资产、缴税、事先约定的 10b5-1 计划），单独看信息量很小；用自己的钱在公开市场买入则少见得多，多名内部人在同一时期集中买入，历史上是相对有信息量的信号。“股票授予 / 行权”是薪酬的一部分，不代表看法。")}
    ${t ? ` <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;CIK=${esc(t)}&amp;type=4" target="_blank" rel="noopener">SEC 原始申报 →</a>` : ""}</p></section>`;
}

// ---------------- 分析师（机构）目标价：连续准确度、中位数为主、本周变动 ----------------
const PT_ZH = { Raises: "上调", Lowers: "下调", Maintains: "维持", Announces: "首次给出", Reiterates: "重申" };
// 机构准确度的局限（数据每次建站时重算，见 web/analyst_targets.firm_stats / persistence）
function targetsLimits(d, prior) {
  if (!d) return "";
  const pr = d.persistence || {};
  const ps = (x) => (x ? `排名相关 ${num(x.rho, 2)}（p = ${num(x.p, 2)}，${x.firms} 家）` : "样本不足、无法检验");
  return `<p><b>局限（用本选股池数据实测）：</b></p><ul>
    <li><b>样本量差异大</b>：${rich(`有的机构只有 1–2 次可评估预测，有的上百次。样本少时准确度会非常极端（可能 0.0 或 1.0），主要是运气。因此每家机构的准确度都附上约 95% 误差范围；有效样本少于 ${d.min_eff_n} 次的标“样本不足”，不参与排序、权重取中性值。`)}</li>
    <li><b>机构之间的差别大多是噪音</b>：${rich(`假设所有机构能力完全相同、只因样本量不同，就能解释观察到的机构间差异的约 ${pct(d.noise_share, 0)}（“相对共识”约 ${pct(d.noise_share_relative, 0)}）。为此收缩系数由数据估计：准确度 K = ${num(d.k_accuracy, 1)}、相对共识 K = ${num(d.k_relative, 1)}（K 越大，各机构越被拉向平均${isNum(prior) ? ` ${num(prior, 2)}` : ""}）。`)}</li>
    <li><b>覆盖范围的运气</b>：${rich(`所有预测得分的差异中，约 ${pct(d.coverage_share, 0)} 由“预测的是哪只股票、在哪个季度”决定——同一股票同一时期，各机构的得分往往一起高或一起低。直接比较绝对准确度，比的主要是覆盖范围；“相对共识”可以扣掉这部分。`)}</li>
    <li><b>没有持续性</b>：${rich(`按发布日期分为前后两段（${esc(pr.cut || "")} 为界），前段准确的机构在后段并不更准——绝对准确度 ${ps(pr.accuracy)}；相对共识 ${ps(pr.relative)}。`)}</li>
    <li><b>结论</b>：${rich("机构准确度只能当作历史记录，不能据此挑选“更准”的机构；按准确度加权与简单中位数差别很小，页面以中位数为主。")}</li></ul>`;
}
// 目标价修正回测摘要（backtest/target_revisions.py）→ 一句话
function revisionTestText(r) {
  if (!r || !r["1w"]) return "";
  const h = (k, n) => { const x = r[k]; return x ? `${n}：截面 Rank IC ${num(x.ic, 3)}（t ${num(x.ic_t, 1)}），净上调比净下调的超额收益${isNum(x.diff) ? `${x.diff >= 0 ? "多" : "少"} ${num(Math.abs(x.diff) * 100, 2)} 个百分点（p = ${num(x.p, 2)}）` : "无足够样本"}` : ""; };
  return `本系统回测（${r.period?.[0] || ""} ~ ${r.period?.[1] || ""}，${r.weeks} 周、${r.samples} 个“股票-周”）：用一周内目标价净上调家数预测之后的相对 SPY 超额收益——${h("1w", "下 1 周")}；${h("4w", "下 4 周")}。均不显著，即本周的目标价变动对之后涨跌没有可用的预测力，只作信息展示。`;
}
function targetsCard(s) {
  const a = s.analyst_targets;
  if (!a) return "";
  const kpi = (label, v, sub = "", c = "") => `<div class="kpi"><span class="muted">${label}</span><b class="${c}">${v}</b>${sub ? `<span class="muted">${sub}</span>` : ""}</div>`;
  const rows = a.firms.map((f) => `<tr class="${f.outlier ? "muted" : ""}"><td><b>${esc(f.firm)}</b>${f.outlier ? ' <span class="chip warnchip" title="偏离全部目标价中位数超过 50%，不计入加权（可能是数据错误或极端观点）">偏离过大</span>' : ""}</td>
    <td>${esc(f.grade || "–")}</td><td class="num"><b>${num(f.target, 2)}</b></td><td class="num ${cls(f.upside)}">${pct(f.upside, 1, true)}</td>
    <td>${esc(PT_ZH[f.pt_action] || f.pt_action || "")}${f.prior && Math.abs(f.prior / f.target - 1) > 0.01 ? `（原 ${num(f.prior, 0)}）` : ""}</td>
    <td class="nowrap">${esc(f.date)}${f.reiterations ? `<br><span class="muted">之后重申 ${f.reiterations} 次</span>` : ""}</td>
    <td class="num">${f.n ? `${num(f.accuracy, 2)}${isNum(f.acc_ci) ? `<span class="muted"> ± ${num(f.acc_ci, 2)}</span>` : ""} <span class="muted">(${num(f.eff_n, 1)})</span>${f.enough ? "" : '<br><span class="chip" title="有效样本少于 5 次，准确度主要是噪音：不参与排序，权重取中性值">样本不足</span>'}` : '<span class="muted">无可评估记录</span>'}</td>
    <td class="num ${cls(f.vs_consensus)}">${isNum(f.vs_consensus) ? num(f.vs_consensus, 2, true) : "–"}</td>
    <td class="num">${num(f.weight, 2)}</td></tr>`).join("");
  return `<section class="card" id="targets-card"><h3>分析师目标价（中长期参考）${badge("fact")}${badge("derived")}<span class="muted" style="font-weight:400"> ${a.count} 家机构 · 现价 ${num(a.price, 2)}</span></h3>
    <div class="kpis">
      ${kpi("目标价中位数", num(a.median_target, 2), `较现价 ${pct(a.median_target / a.price - 1, 1, true)}`, cls(a.median_target / a.price - 1))}
      ${kpi("按准确度加权", num(a.weighted_target, 2), `较现价 ${pct(a.weighted_upside, 1, true)}`)}
      ${kpi("平均", num(a.mean_target, 0), `较现价 ${pct(a.mean_target / a.price - 1, 1, true)}`)}
      ${kpi("最高 / 最低", `${num(a.high, 0)} / ${num(a.low, 0)}`, `较现价 ${pct(a.high / a.price - 1, 0, true)} / ${pct(a.low / a.price - 1, 0, true)}`)}</div>
    ${a.recent_moves ? `<p>本周（近 ${a.recent_moves.days} 天）：${[a.recent_moves.raises ? `<span class="pos">${a.recent_moves.raises} 家上调</span>` : "", a.recent_moves.lowers ? `<span class="neg">${a.recent_moves.lowers} 家下调</span>` : "", a.recent_moves.initiates ? `${a.recent_moves.initiates} 家首次给出` : ""].filter(Boolean).join("、")}${isNum(a.recent_moves.median_change) ? `，调整幅度中位数 ${pct(a.recent_moves.median_change, 1, true)}` : ""}（${a.recent_moves.items.slice(0, 4).map((i) => `${esc(i.firm)} ${i.prior ? `${num(i.prior, 0)}→` : ""}${num(i.target, 0)}`).join("；")}）</p>` : `<p class="muted">本周（近 7 天）没有机构调整目标价。</p>`}
    ${chartDiv("c-targets", "short")}
    <div class="table-wrap"><table><thead><tr><th>机构</th><th>评级</th><th class="num">目标价</th><th class="num">较现价</th><th>最近调整</th><th>给出日期</th>
      <th class="num" title="历史目标价的连续准确度（0–1）± 约 95% 误差范围，括号内为有效样本数；按 12 个月期限、用波动率标准化">历史准确度</th>
      <th class="num" title="该机构得分 − 同一时刻共识（其他机构目标价中位数）的得分；正 = 比共识准">相对共识</th>
      <th class="num" title="全体平均准确度 + 收缩后的“相对共识”；样本不足的机构取中性值。排序也按此（样本不足的排在最后）">权重</th></tr></thead><tbody>${rows}</tbody></table></div>
    <details class="howto"><summary>准确度怎么算、参考价值如何</summary>
      <p>${rich(`目标价按惯例视为 12 个月目标。机构每给出一个新目标价算一次预测（相差不超过 ${pct(a.same_tol, 0)} 的重申合并）；机构改动目标价时，旧预测在改动当天截止检验。检验时按“复利匀速推进”算出此时应到的价格，与实际价格比较：偏差除以这只股票在这段时间的正常波动（发布前 60 天波动率），完全命中得 1，偏离 1 / 2 / 3 个正常波动约得 0.61 / 0.14 / 0.01。满 12 个月的预测权重为 1，未满的按已过时间比例加权，不足 ${a.min_age} 个交易日的不评估。`)}</p>
      <p>${rich("“相对共识”用同一时刻其他机构目标价的中位数按同样方法打分：机构得分 − 共识得分，比较的是同一只股票、同一时点的判断，能扣掉“覆盖了哪些股票、在什么时候”带来的运气。表格的排序与加权用它（经收缩），绝对准确度只作展示。")}</p>
      ${targetsLimits(a.diagnostics, a.prior_accuracy)}
      <p><b>参考价值：低。</b>${rich("目标价是 12 个月判断，对一周涨跌几乎没有预测力；与每周操作更相关的是上方的“本周变动”。")}</p>
      ${a.revision_test ? `<p><b>本周变动的参考价值：低。</b>${esc(revisionTestText(a.revision_test))}</p>` : ""}</details></section>`;
}
function drawTargets(s) {
  const a = s.analyst_targets;
  const el = byId("c-targets");
  if (!a || !el) return;
  const firms = [...a.firms].reverse();
  mkChart(el, { tooltip: { trigger: "item", formatter: (p) => { const f = p.data.raw; return `${esc(f.firm)}：${num(f.target, 2)}（${pct(f.upside, 1, true)}）<br>历史准确度 ${f.n ? `${num(f.accuracy, 2)}（有效样本 ${num(f.eff_n, 1)}）` : "无记录"} · 权重 ${num(f.weight, 2)}`; } },
    legend: { show: false }, grid: { left: 130, right: 30, top: 28, bottom: 30 },
    xAxis: { type: "value", scale: true, axisLabel: { formatter: (v) => num(v, 0) } },
    yAxis: { type: "category", data: firms.map((f) => f.firm), axisLabel: { fontSize: 10 } },
    series: [{ type: "scatter", symbolSize: 9, data: firms.map((f) => ({ value: [f.target, f.firm], raw: f,
        itemStyle: { color: f.outlier ? OTHER_GRAY() : palette()[0], opacity: 0.35 + 0.65 * Math.max(0, Math.min(1, (f.weight - 0.3) / 0.5)) } })),
      markLine: { symbol: "none", silent: true, label: { fontSize: 10, color: css("--ink-2") }, data: [
        { xAxis: a.price, lineStyle: { color: css("--ink-2"), type: "solid" }, label: { formatter: `现价 ${num(a.price, 0)}` } },
        { xAxis: a.median_target, lineStyle: { color: palette()[1], type: "dashed" }, label: { formatter: `中位数 ${num(a.median_target, 0)}` } }] } }] });
  el.style.height = `${Math.max(220, firms.length * 16 + 50)}px`;
  echarts.getInstanceByDom(el)?.resize();
}

// ---------------- 指标说明表（对比页与术语页共用）----------------
const METRIC_VALUE_NOTE = "参考价值指这个指标对判断股价有多大帮助：“高 / 中 / 低”参考公开研究的大致结论与本系统回测（单个指标对未来一周涨跌几乎没有预测力），标“风险”的主要用于控制仓位与识别风险，而不是预测涨跌。";
function metricDocTable(keys, defOf = (k) => METRIC_DEFS[k]) {
  const dirCls = (d) => (d.better === "high" ? "pos" : d.better === "low" ? "neg" : "dir-neutral");
  const dirTip = (d) => (d.better === "high" ? "通常越高越好" : d.better === "low" ? "通常越低越好" : "没有通用的好坏方向");
  return `<div class="table-wrap"><table class="metric-doc"><thead><tr><th>指标</th><th>含义</th><th>怎么看</th><th>怎么用</th><th>参考价值</th></tr></thead><tbody>
    ${keys.map((k) => { const d = defOf(k); if (!d) return ""; return `<tr><td><b class="${dirCls(d)}" title="${dirTip(d)}">${esc(d.name)}</b></td><td>${esc(d.def || "")}</td><td>${esc(d.read || "")}</td>
      <td>${esc(d.use || "")}${d.caveat ? `<br><span class="muted">注意：${esc(d.caveat)}</span>` : ""}</td>
      <td>${d.value ? `<b>${esc(d.value[0])}</b><br><span class="muted">${esc(d.value[1])}</span>` : "–"}</td></tr>`; }).join("")}</tbody></table></div>
    <p class="muted">指标名颜色：<b class="pos">绿</b> = 通常越高越好；<b class="neg">红</b> = 通常越低越好；<b class="dir-neutral">蓝</b> = 没有通用的好坏方向（要结合情况判断）。这里的“好坏”只是一般规律，不同行业与情形下可能相反，也不代表买卖建议。</p>`;
}

// ---------------- FCF 收益率“自身上升期”（只和自己的历史比；A / B / C 类型 + 阶段）----------------
const PHASE_STAGES = [
  ["非上升期", "收益率近期没有明显上升", ""],
  ["上升早期", "开始上升，仍在自身历史的中低位", "rgba(47,163,122,0.12)"],
  ["上升中段", "已升到自身高位，仍在加速", "rgba(47,163,122,0.26)"],
  ["接近高点", "高位 + 明显减速 + 贴近近期最高点", "rgba(224,164,58,0.38)"],
  ["见顶回落", "刚从上升期的高点回落 ≥ 10%", "rgba(208,59,59,0.20)"],
];
const PHASE_COLOR = Object.fromEntries(PHASE_STAGES.map(([n, , c]) => [n, c]));
const PHASE_KINDS = {
  A: ["A", "基本面领先", "pos", "✅", "每股 FCF 增长 ≥ 5%：公司赚的现金变多了，股价还没跟上。最理想的情况。"],
  B: ["B", "价格驱动", "", "⚠", "每股 FCF 基本不变（±5% 内），收益率上升来自股价下跌：变便宜了，但要看下方检查判断是不是“价值陷阱”。"],
  C: ["C", "双降", "neg", "❌", "每股 FCF 下降，但股价跌得更多：收益率虽然在升，基本面在恶化，应警惕。"],
};
function phaseVerdict(p, t) {
  const k = PHASE_KINDS[p.kind];
  const why = `近 ${p.window} 周每股 FCF ${pct(p.fcf_part, 0, true)}、股价 ${pct(p.price_part, 0, true)}，FCF 收益率因此${p.change >= 0 ? "上升" : "下降"} ${pct(Math.abs(p.change), 0)}`;
  if (p.stage === "非上升期") return `${esc(t)} 的 FCF 收益率<b>不在上升期</b>（${why}）。`;
  if (p.stage === "见顶回落") return `${esc(t)} 的 FCF 收益率<b>刚从上升期的高点回落</b>（已比近 ${p.window} 周最高点低 ${pct(p.off_high, 0)}），${k ? `此前的上升属于 <b>${k[0]} 类（${k[1]}）</b>` : "此前处于上升期"}。${why}。`;
  return `${esc(t)} 的 FCF 收益率处于<b>${esc(p.stage)}</b>，属于 <b>${k[0]} 类（${k[1]}）</b>：${why}。`;
}
// 回测结论（web_data/fcf_phase_backtest_themes.json 中与当前窗口相同的一组，建站时附在 p.backtest）
function phaseBacktest(p) {
  const b = p.backtest;
  if (!b) return `<p class="muted">历史回测：当前窗口（${p.window} / ${p.short} 周）尚无回测结果。</p>`;
  const f = (x) => (!x ? "–" : Math.abs(x.mean) < 0.0005 ? `≈ 0（t ${num(x.t, 1)}）` : `${pct(x.mean, 1, true)}（t ${num(x.t, 1)}）`);
  const yr = (d) => String(d || "").slice(0, 4);
  return `<div class="ph-bt"><b>历史回测怎么说</b> <span class="muted">（${yr(b.period?.[0])}–${yr(b.period?.[1])} 年，选股池及同行业 ${b.tested} 只，每周只用当时的数据判定；收益为相对同期全部股票平均的超额）</span><ul>
    <li><b>阶段只作描述参考</b>：之后 3 个月，上升期比非上升期 ${f(b.h13.rising)}，“接近高点”比“上升中段” ${f(b.h13.near)}，“见顶回落”比非上升期 ${f(b.h13.off)}，都没有稳定差异。</li>
    <li><b>类型对 1–3 个月有参考价值</b>：上升期内 A 类之后 3 个月比 B 类 ${f(b.h13.ab)}${b.ab_halves?.length === 2 ? `，前后两段时间分别 ${b.ab_halves.map(f).join("、")}` : ""}；B 类本身之后 3 个月 ${f(b.h13.b)}，偏向“价值陷阱”。</li>
    <li><b>不能预测一周涨跌</b>：之后 1 周，上升期比非上升期 ${f(b.h1.rising)}，A 类比 B 类 ${f(b.h1.ab)}；“上升中段”的股票下一周跑赢平均的比例约 ${pct(b.h1.hit, 0)}，接近抛硬币。</li></ul>
    <p class="muted">t 的绝对值 ≥ 2 才算统计上比较可靠。股票池来自现在仍上市的公司（结果偏乐观）；同时比较了多种窗口与分组，单个显著结果也可能是偶然。</p></div>`;
}
function phaseCard(s) {
  const p = s.fcf_phase;
  const head = `<h3>FCF 收益率上升期（只和自身历史比）${badge("derived")}<span class="chip" title="已用选股池及同行业股票的历史数据回测：阶段只作描述，类型（A / B）对 1–3 个月有参考价值">已回测</span></h3>`;
  if (!p) return `<section class="card" id="phase-card">${head}${empty("暂无数据：缺少 FCF 收益率历史（外国公司只有年报且涉及外币 / ADR 口径；银行、保险不适用；或 SEC 数据不足）")}</section>`;
  if (p.status !== "ok") return `<section class="card" id="phase-card">${head}${empty(`${p.status}：${p.reason}`)}</section>`;
  const cur = PHASE_STAGES.findIndex(([n]) => n === p.stage);
  const track = PHASE_STAGES.map(([n, d], i) => `<div class="ph-step ${i === cur ? "on" : ""} ${i === 3 ? "ph-hi" : i === 4 ? "ph-down" : ""}" title="${esc(d)}"><b>${esc(n)}</b><span>${esc(d)}</span></div>`).join('<div class="ph-arrow">→</div>');
  const kinds = Object.values(PHASE_KINDS).map(([k, n, c, ic, d]) => `<div class="ph-kind ${p.kind === k ? "on" : ""}"><b class="${c}">${ic} ${k} 类：${n}</b><span>${esc(d)}</span></div>`).join("");
  // 拆分条：每股 FCF 与股价的贡献（对数尺度上 收益率变化 = 每股 FCF 变化 − 股价变化）
  const lf = Math.log1p(p.fcf_part), lp = -Math.log1p(p.price_part), m = Math.max(Math.abs(lf), Math.abs(lp), Math.abs(lf + lp), 0.01);
  const bar = (v, label, val) => `<div class="ph-bar"><span class="ph-lbl">${label}</span><span class="ph-track"><span class="ph-fill ${v >= 0 ? "up" : "dn"}" style="${v >= 0 ? "left:50%" : `right:50%`};width:${(Math.abs(v) / m) * 50}%"></span></span><b class="${cls(v)}">${val}</b></div>`;
  return `<section class="card" id="phase-card">${head}
    <p class="ph-verdict">${phaseVerdict(p, s.ticker)}</p>
    ${phaseBacktest(p)}
    <div class="ph-track-row">${track}</div>
    <p class="muted">已在“${esc(p.stage)}”持续 ${p.weeks_in_stage} 周 · 当前 FCF 收益率 ${pct(p.now, 2)}（自身近 5 年第 ${Math.round(p.pct * 100)} 百分位）· 上升强度 ${num(p.z, 1)}（近 ${p.window} 周变化 ÷ 自身历史波动；≥ 0.5 才算上升期）</p>
    <div class="grid two">
      <div><b>收益率变化从哪来</b>（近 ${p.window} 周）
        ${bar(lf, "每股 FCF", pct(p.fcf_part, 0, true))}
        ${bar(lp, "股价（反向）", pct(p.price_part, 0, true))}
        ${bar(lf + lp, "= FCF 收益率", pct(p.change, 0, true))}
        <p class="muted">FCF 收益率 = 每股 FCF ÷ 股价：每股 FCF 上升、或股价下跌，都会让收益率上升（股价一行按“对收益率的影响”画，股价下跌画在右边）。</p></div>
      <div><b>上升类型</b>${p.kind ? "" : `（近 ${p.window} 周收益率净下降，无类型）`}<div class="ph-kinds">${kinds}</div></div>
    </div>
    ${p.checks?.length ? `<p><b>辅助检查</b> <span class="muted">（不进主信号；用于判断 B 类是不是价值陷阱、A 类的现金流增长是否可靠）</span></p>
      <ul class="ph-checks">${p.checks.map((c) => `<li><span class="${c.ok === false ? "neg" : c.ok ? "pos" : "muted"}">${c.ok === false ? "⚠" : c.ok ? "✓" : "…"}</span> <b>${esc(c.name)}</b>：${esc(c.text)}</li>`).join("")}</ul>` : ""}
    <div class="ph-legend"><b>图中底色</b>：${PHASE_STAGES.slice(1).map(([n, , c]) => `<span><i style="background:${c}"></i>${esc(n)}</span>`).join("")}<span class="muted">蓝线 = FCF 收益率（左轴），灰线 = 股价（右轴）；鼠标悬停显示当周的阶段与类型</span></div>
    ${chartDiv("c-phase")}
    <details class="howto"><summary>怎么判定、怎么用、有哪些局限</summary><ul>
      <li><b>只和自己比</b>：不看收益率高低，也不和别的公司比；“高位”指在这只股票自己近 5 年历史中的百分位 ≥ 70%。</li>
      <li><b>上升期</b>：近 ${p.window} 周收益率上升，且上升强度 ≥ 0.5（同样上升 20%，对平时很平稳的股票是更强的信号）。</li>
      <li><b>阶段</b>：自身百分位 &lt; 70% 为早期；≥ 70% 为中段；≥ 70% 且近 ${p.short} 周的上升速度不到近 ${p.window} 周平均的一半、离近 ${p.window} 周最高点 ≤ 5% 为“接近高点”；从上升期的高点回落 ≥ 10% 为“见顶回落”。</li>
      <li><b>怎么用</b>：重点看类型而不是阶段。A 类（现金流在增长）之后 1–3 个月平均好于 B 类；B 类（只是股价跌）要先用辅助检查排除价值陷阱。阶段只说明收益率走到了哪里，回测中对之后的涨跌没有稳定的预测力。</li>
      <li><b>无前视</b>：图中每一周的底色都只用当时已披露的财报与当时的价格判定，可以直接对照判定之后股价怎么走。</li>
      <li><b>局限</b>：① 每股 FCF 只在交 10-Q / 10-K 后更新，两次财报之间收益率的变化全部来自股价，所以它不适合预测一周内的涨跌，更适合 1–3 个月；② “接近高点”只能事后确认，这里是估计，可能减速后再加速；③ 强周期股的收益率高点常出现在景气顶部；④ 回测见上方“历史回测怎么说”，判定窗口 ${p.window} / ${p.short} 周是据此选定的（同时比较过 26 / 8、52 / 13 周）。</li></ul></details></section>`;
}
function drawPhase(s, k) {
  const p = s.fcf_phase;
  if (!p || p.status !== "ok" || !byId("c-phase")) return;
  const idx = Object.fromEntries(s.dates.map((d, i) => [d, i]));
  const near = (d) => { // 周五日期 → 价格走势中当天或之前最近的交易日
    if (d in idx) return d;
    for (let i = s.dates.length - 1; i >= 0; i--) if (s.dates[i] <= d) return s.dates[i];
    return null;
  };
  const at = {}, wkOf = {};
  p.history.forEach((h) => { const d = near(h.date); if (d) at[d] = h.y; });
  // 每个交易日 → 所在那一周的阶段 / 类型（悬停提示用）
  let hi = 0;
  s.dates.forEach((d) => { while (hi + 1 < p.history.length && p.history[hi + 1].date <= d) hi++; if (p.history[hi]?.date <= d) wkOf[d] = p.history[hi]; });
  const areas = [];
  let cur = null;
  p.history.forEach((h, i) => {
    const st = PHASE_COLOR[h.stage] ? h.stage : null;
    if (cur && cur.stage !== st) { areas.push(cur); cur = null; }
    if (st && !cur) cur = { stage: st, from: h.date, to: h.date };
    if (cur) cur.to = (p.history[i + 1] || h).date;
  });
  if (cur) areas.push(cur);
  const n = s.dates.length;
  const c = mkChart(byId("c-phase"), {
    tooltip: { trigger: "axis", formatter: (ps) => {
      const d = ps[0]?.axisValue, w = wkOf[d], yv = ps.find((x) => x.seriesName === "FCF 收益率")?.value, pv = ps.find((x) => x.seriesName === "股价")?.value;
      return `${d}<br>FCF 收益率 ${isNum(yv) ? pct(yv, 2) : "–"} · 股价 ${num(pv, 2)}${w ? `<br>阶段：<b>${esc(w.stage || "数据不足")}</b>${w.kind ? ` · 类型 <b>${w.kind}</b>（${PHASE_KINDS[w.kind][1]}）` : ""}` : ""}`;
    } },
    legend: { show: false }, grid: { left: 52, right: 60, top: 16, bottom: 24 },
    xAxis: { type: "category", data: s.dates, boundaryGap: false },
    yAxis: [{ type: "value", scale: true, axisLabel: { formatter: (x) => pct(x, 1) } }, { type: "value", scale: true, splitLine: { show: false } }],
    dataZoom: [{ type: "inside", zoomOnMouseWheel: false, moveOnMouseMove: false, moveOnMouseWheel: false }],
    series: [
      { name: "FCF 收益率", type: "line", showSymbol: false, connectNulls: true, color: palette()[0], lineStyle: { width: 2 }, data: s.dates.map((d) => at[d] ?? null),
        markArea: { silent: true, data: areas.map((a) => [{ xAxis: near(a.from), itemStyle: { color: PHASE_COLOR[a.stage] } }, { xAxis: near(a.to) }]).filter((x) => x[0].xAxis && x[1].xAxis) } },
      { name: "股价", type: "line", yAxisIndex: 1, showSymbol: false, color: css("--muted"), lineStyle: { width: 1.2 }, data: s.ohlc.map((x) => x[1]) },
    ],
  });
  followKZoom(k, n, c);
}
