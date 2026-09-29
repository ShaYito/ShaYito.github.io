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
      text: `预期市盈率（${num(v.forward_pe, 1)}）明显高于 TTM 市盈率（${num(v.pe.now, 1)}）：近 4 季 EPS 可能含一次性收益，TTM 市盈率与历史百分位会偏低，以预期市盈率为准。` });
    else out.push({ level: p >= 0.85 ? "medium" : p <= 0.15 ? "good" : "info", kind: "derived", target: "val-card",
      text: `市盈率（TTM）${num(v.pe.now, 1)}，处于自身近 ${v.pe.years} 年的第 ${Math.round(p * 100)} 百分位（中位数 ${num(v.pe.median, 0)}）${p >= 0.85 ? "：偏贵，对业绩失望更敏感" : p <= 0.15 ? "：处于历史低位" : ""}。` });
  }
  const m = v.margins;
  if (m?.op_margin?.length >= 5) {
    const a = m.op_margin.at(-1), b = m.op_margin.at(m.frequency === "annual" ? -2 : -5);
    if (isNum(a) && isNum(b) && Math.abs(a - b) >= 0.03) out.push({ level: a > b ? "good" : "medium", kind: "fact", target: "val-card",
      text: `营业利润率 ${pct(a, 1)}，较一年前${a > b ? "提高" : "下降"} ${Math.abs((a - b) * 100).toFixed(1)} 个百分点（利润率${a > b ? "扩张通常推动盈利超预期" : "收缩会拖累盈利"}）。` });
  }
  return out;
}

function valuationCard(s) {
  const v = s.valuation;
  if (!v) return "";
  const kpi = (label, val, sub = "") => `<div class="kpi"><span class="muted">${label}</span><b>${val}</b>${sub ? `<span class="muted">${sub}</span>` : ""}</div>`;
  return `<section class="card" id="val-card"><h3>估值与利润率 ${badge("fact")}${badge("derived")}</h3>
    <p class="muted">${rich("估值决定“同样的好消息还能涨多少”：市盈率处于自身历史高位时，市场已经预期了很多，稍有失望就容易大跌；处于低位时相反。利润率扩张意味着每一美元收入赚得更多，常常是盈利超预期的来源。")}</p>
    <div class="kpis">
      ${kpi("市盈率（TTM）", num(v.pe?.now ?? v.trailing_pe, 1), v.pe ? (v.pe.oneoff ? "⚠ 可能受一次性收益影响" : `近 ${v.pe.years} 年第 ${Math.round(v.pe.pct * 100)} 百分位`) : "")}
      ${kpi("预期市盈率", num(v.forward_pe, 1), "按未来 12 个月 EPS 预期")}
      ${kpi("市销率（TTM）", num(v.ps, 1))}
      ${kpi("PEG", num(v.peg, 2), "市盈率 ÷ 盈利增速；约 1 为合理")}
    </div>
    <div class="grid two">${v.pe ? chartDiv("c-val-pe", "short") : empty("暂无历史市盈率（亏损或数据不足）")}${v.margins?.periods?.length ? chartDiv("c-val-margin", "short") : empty("暂无利润率数据")}</div>
    <p class="muted">市盈率 = 实际股价 ÷ 近 4 季 EPS 之和（EPS 与分析师预期同口径，每季只在财报公布后才计入）；亏损期间不显示${v.pe && v.pe.max > v.pe.median * 3 ? `；图表纵轴截断在中位数的 3 倍（历史最高 ${num(v.pe.max, 0)}，出现在盈利很低的时期）` : ""}。利润率来自 SEC 财报（公司合计）。</p></section>`;
}

function drawValuation(s) {
  const v = s.valuation;
  if (!v) return;
  if (v.pe && byId("c-val-pe")) {
    mkChart(byId("c-val-pe"), { title: { text: `市盈率（TTM）· 近 ${v.pe.years} 年`, left: 0, top: 0, textStyle: { fontSize: 12, fontWeight: 500, color: css("--ink-2") } },
      tooltip: { trigger: "axis", valueFormatter: (x) => num(x, 1) }, legend: { show: false }, grid: { left: 44, right: 60, top: 30, bottom: 24 },
      xAxis: { type: "category", data: v.pe.dates, boundaryGap: false },
      yAxis: { type: "value", scale: true, max: v.pe.max > v.pe.median * 3 ? Math.ceil(v.pe.median * 3) : null }, // 早期极端值（盈利很低时）截断，避免压扁近期走势
      series: [{ name: "市盈率", type: "line", showSymbol: false, color: palette()[0], lineStyle: { width: 1.8 }, data: v.pe.values,
        markLine: { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" }, label: { color: css("--muted"), fontSize: 10, position: "end" },
          data: [{ yAxis: v.pe.median, label: { formatter: `中位数 ${num(v.pe.median, 0)}` } }] } }] });
  }
  const m = v.margins;
  if (m?.periods?.length && byId("c-val-margin")) {
    const labels = m.periods.map((d) => periodLabel(d, m.frequency));
    mkChart(byId("c-val-margin"), { title: { text: "毛利率 / 营业利润率", left: 0, top: 0, textStyle: { fontSize: 12, fontWeight: 500, color: css("--ink-2") } },
      tooltip: { trigger: "axis", valueFormatter: (x) => pct(x, 1) }, legend: { top: 0, right: 0 }, grid: { left: 48, right: 16, top: 30, bottom: 24 },
      xAxis: { type: "category", data: labels, boundaryGap: false }, yAxis: { type: "value", scale: true, axisLabel: { formatter: (x) => pct(x, 0) } },
      series: [
        ...(m.gross_margin?.some(isNum) ? [{ name: "毛利率", type: "line", color: palette()[2], symbolSize: 5, data: m.gross_margin }] : []),
        ...(m.op_margin?.some(isNum) ? [{ name: "营业利润率", type: "line", color: palette()[0], symbolSize: 5, lineStyle: { width: 2.2 }, data: m.op_margin }] : []),
      ] });
  }
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
