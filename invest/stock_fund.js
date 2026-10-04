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
      ${kpi("市盈率 P/E", num(v.pe?.now ?? v.trailing_pe, 1), v.pe ? (v.pe.oneoff ? "⚠ 可能受一次性收益影响" : `近 ${v.pe.years} 年第 ${Math.round(v.pe.pct * 100)} 百分位`) : "")}
      ${kpi("预期市盈率 Forward P/E", num(v.forward_pe, 1), "按未来 12 个月 EPS 预期")}
      ${kpi("市销率 P/S", num(v.ps, 1), "按过去 12 个月收入")}
      ${kpi("PEG", num(v.peg, 2), "市盈率 ÷ 盈利增速；约 1 为合理")}
    </div>
    <div class="grid two">${v.pe ? chartDiv("c-val-pe", "short") : empty("暂无历史市盈率（亏损或数据不足）")}${v.margins?.periods?.length ? chartDiv("c-val-margin", "short") : empty("暂无利润率数据")}</div>
    <p class="muted">市盈率 = 实际股价 ÷ 近 4 季 EPS 之和（EPS 与分析师预期同口径，每季只在财报公布后才计入）；亏损期间不显示${v.pe && v.pe.max > v.pe.median * 3 ? `；图表纵轴截断在中位数的 3 倍（历史最高 ${num(v.pe.max, 0)}，出现在盈利很低的时期）` : ""}。利润率来自 SEC 财报（公司合计）。</p></section>`;
}

function drawValuation(s) {
  const v = s.valuation;
  if (!v) return;
  if (v.pe && byId("c-val-pe")) {
    mkChart(byId("c-val-pe"), { title: { text: `市盈率 P/E · 近 ${v.pe.years} 年`, left: 0, top: 0, textStyle: { fontSize: 12, fontWeight: 500, color: css("--ink-2") } },
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

// ---------------- 关键指标（估值 / 增长 / 盈利能力 / 财务健康 / 价格位置与风险 / 市场预期）----------------
// fmt：x = 倍数，pct = 百分比，pp = 百分比（带正负号），num = 数值；better：low / high / null（无好坏方向）
const METRIC_DEFS = {
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
  return num(v, 2);
}
// 相对同行中位数的一句话（只描述事实：高于 / 低于多少）
function metricCompare(it, d) {
  const ref = isNum(it.theme_median) ? it.theme_median : it.universe_median;
  if (!isNum(it.value) || !isNum(ref)) return "";
  const who = isNum(it.theme_median) ? "同行" : "选股池";
  const pctOrX = d.fmt === "x" || d.fmt === "num2" || d.fmt === "num1";
  const diff = pctOrX ? (ref !== 0 ? it.value / ref - 1 : NaN) : it.value - ref;
  if (!isNum(diff) || Math.abs(diff) < (pctOrX ? 0.1 : 0.02)) return `<span class="muted">与${who}接近</span>`;
  const higher = diff > 0;
  const good = d.better ? (d.better === "high") === higher : null;
  const text = pctOrX ? `${higher ? "高于" : "低于"}${who} ${pct(Math.abs(diff), 0)}` : `${higher ? "高于" : "低于"}${who} ${(Math.abs(diff) * 100).toFixed(1)} 个百分点`;
  return `<span class="${good === null ? "muted" : good ? "pos" : "neg"}">${text}</span>`;
}
function metricsCard(s) {
  const m = s.metrics;
  if (!m) return "";
  const groups = m.groups.map((g) => `<div class="metric-group"><h4>${esc(g.name)}</h4><div class="table-wrap"><table class="metrics"><colgroup><col style="width:34%"><col style="width:13%"><col style="width:14%"><col style="width:14%"><col></colgroup><thead><tr><th>指标（点击看说明）</th><th class="num">本股</th>
      <th class="num">同行中位数</th><th class="num">选股池中位数</th><th>比较</th></tr></thead><tbody>${g.items.map((it) => {
      const d = METRIC_DEFS[it.key] || { name: it.key, fmt: "num2" };
      return `<tr><td class="def"><details><summary><b>${esc(d.name)}</b></summary><p>${esc(d.def || "")}</p><p><b>如何理解：</b>${esc(d.read || "")}</p><p><b>如何使用：</b>${esc(d.use || "")}</p>${d.value ? `<p><b>参考价值：${esc(d.value[0])}</b>——${esc(d.value[1])}</p>` : ""}${d.caveat ? `<p class="muted">注意：${esc(d.caveat)}</p>` : ""}</details></td>
        <td class="num"><b>${fmtMetric(it.value, d.fmt)}</b></td><td class="num">${fmtMetric(it.theme_median, d.fmt)}</td><td class="num">${fmtMetric(it.universe_median, d.fmt)}</td><td>${metricCompare(it, d)}</td></tr>`;
    }).join("")}</tbody></table></div></div>`).join("");
  return `<section class="card" id="metrics-card"><h3>关键指标 ${badge("fact")}${badge("derived")}<span class="muted" style="font-weight:400"> 公司数据 ${esc(m.fetched || "")}（yfinance）· 价格类按最新收盘计算</span></h3>
    ${m.fin_currency && m.fin_currency !== "USD" ? `<p class="warn">该公司财报以 ${esc(m.fin_currency)} 计、股价以美元计：P/S、自由现金流收益率、净现金占比已按最新汇率换算；P/B 与 EV/EBITDA 涉及 ADR 换股比例，无法可靠换算，不显示；P/E 沿用 yfinance 数值，每股收益口径（外币或美元）因公司而异，可能有约一成的汇率偏差。</p>` : ""}
    <p class="muted">同行 = 同主题且同行业${m.sector ? `（${esc(m.sector)}）` : ""}：${m.peers.length >= 3 ? m.peers.map((p) => `<a href="#/stock/${esc(p)}">${esc(p)}</a>`).join("、") : "不足 3 只，只与选股池比较"}。</p>
    <p class="muted">${rich("先看估值和增长是否匹配，再看盈利能力和财务健康是否支撑，最后看价格位置与市场预期。绿色 / 红色只表示相对同行“通常被认为更好 / 更差”的方向，不代表买卖建议；“–”表示该行业不适用或暂无数据。")}
      点击指标名可看含义、用法与参考价值；全部指标的对照表见 <a href="#/glossary?t=metric-dict">术语与说明 → 指标词典</a>。</p>
    ${groups}</section>`;
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

// ---------------- 分析师（机构）目标价：按近半年成功率排序与加权 ----------------
const PT_ZH = { Raises: "上调", Lowers: "下调", Maintains: "维持", Announces: "首次给出", Reiterates: "重申" };
function targetsCard(s) {
  const a = s.analyst_targets;
  if (!a) return "";
  const kpi = (label, v, sub = "", c = "") => `<div class="kpi"><span class="muted">${label}</span><b class="${c}">${v}</b>${sub ? `<span class="muted">${sub}</span>` : ""}</div>`;
  const rows = a.firms.map((f) => `<tr class="${f.outlier ? "muted" : ""}"><td><b>${esc(f.firm)}</b>${f.outlier ? ' <span class="chip warnchip" title="偏离全部目标价中位数超过 50%，不计入加权（可能是数据错误或极端观点）">偏离过大</span>' : ""}</td>
    <td>${esc(f.grade || "–")}</td><td class="num"><b>${num(f.target, 2)}</b></td><td class="num ${cls(f.upside)}">${pct(f.upside, 1, true)}</td>
    <td>${esc(PT_ZH[f.pt_action] || f.pt_action || "")}${f.prior && f.prior !== f.target ? `（原 ${num(f.prior, 0)}）` : ""}</td><td class="nowrap">${esc(f.date)}</td>
    <td class="num">${f.n ? `${pct(f.rate, 0)} <span class="muted">(${Math.round(f.rate * f.n)}/${f.n})</span>` : '<span class="muted">无可评估记录</span>'}</td>
    <td class="num">${num(f.weight, 2)}</td></tr>`).join("");
  return `<section class="card" id="targets-card"><h3>分析师目标价（按近半年成功率排序）${badge("fact")}${badge("derived")}<span class="muted" style="font-weight:400"> ${a.count} 家机构 · 现价 ${num(a.price, 2)}</span></h3>
    <div class="kpis">
      ${kpi("加权目标价", num(a.weighted_target, 2), `较现价 ${pct(a.weighted_upside, 1, true)}`, cls(a.weighted_upside))}
      ${kpi("平均 / 中位数", `${num(a.mean_target, 0)} / ${num(a.median_target, 0)}`, `较现价 ${pct(a.mean_target / a.price - 1, 1, true)} / ${pct(a.median_target / a.price - 1, 1, true)}`)}
      ${kpi("最高 / 最低", `${num(a.high, 0)} / ${num(a.low, 0)}`, `较现价 ${pct(a.high / a.price - 1, 0, true)} / ${pct(a.low / a.price - 1, 0, true)}`)}
      ${kpi("全体机构平均成功率", pct(a.prior_rate, 0), "选股池内全部可评估预测")}</div>
    ${chartDiv("c-targets", "short")}
    <div class="table-wrap"><table><thead><tr><th>机构</th><th>评级</th><th class="num">目标价</th><th class="num">较现价</th><th>最近调整</th><th>日期</th>
      <th class="num" title="最近半年内发布、距今至少 20 个交易日的目标价：发布日至今股价方向与目标价方向一致的比例（该机构在选股池内全部股票合并计算）">近半年成功率</th><th class="num" title="修正后成功率（样本少时向全体平均收缩），用作加权">权重</th></tr></thead><tbody>${rows}</tbody></table></div>
    <details class="howto"><summary>口径与局限</summary>
      <p>${rich(`“分析师”实际是券商 / 研究机构（免费数据只到机构，没有分析师个人）。成功率：取最近 ${Math.round(a.window_days / 30)} 个月内发布、且距今至少 ${a.min_age} 个交易日的每一次目标价（包括维持原目标价的重申），看从发布当天收盘到现在，股价的涨跌方向与目标价隐含的方向（高于 / 低于当时股价）是否一致；同一机构在选股池内所有股票上的记录合并计算。`)}</p>
      <p>${rich(`样本少的机构容易偶然全对，因此用修正后成功率加权：（命中次数 + ${a.k} × 全体平均）÷（样本数 + ${a.k}）。加权目标价只用每家机构近 12 个月的最新目标价${a.excluded ? `；有 ${a.excluded} 家偏离全部目标价中位数超过 ${pct(a.outlier_pct, 0)}，不计入加权（表中标“偏离过大”）` : ""}。`)}</p>
      <p>${rich("局限：目标价通常针对 12 个月，半年内只能部分检验；单边上涨的市场里看涨的预测更容易“命中”，成功率高不代表判断能力强。各机构修正后成功率差距不大时，加权目标价与简单平均接近——它更适合用来识别“过去半年方向判断较准的机构现在怎么看”，而不是作为精确的价格预测。")}</p></details></section>`;
}
function drawTargets(s) {
  const a = s.analyst_targets;
  const el = byId("c-targets");
  if (!a || !el) return;
  const firms = [...a.firms].reverse();
  mkChart(el, { tooltip: { trigger: "item", formatter: (p) => { const f = p.data.raw; return `${esc(f.firm)}：${num(f.target, 2)}（${pct(f.upside, 1, true)}）<br>近半年成功率 ${f.n ? `${pct(f.rate, 0)}（${f.n} 次）` : "无记录"} · 权重 ${num(f.weight, 2)}`; } },
    legend: { show: false }, grid: { left: 130, right: 30, top: 28, bottom: 30 },
    xAxis: { type: "value", scale: true, axisLabel: { formatter: (v) => num(v, 0) } },
    yAxis: { type: "category", data: firms.map((f) => f.firm), axisLabel: { fontSize: 10 } },
    series: [{ type: "scatter", symbolSize: 9, data: firms.map((f) => ({ value: [f.target, f.firm], raw: f,
        itemStyle: { color: f.outlier ? OTHER_GRAY() : palette()[0], opacity: 0.35 + 0.65 * Math.max(0, Math.min(1, (f.weight - 0.3) / 0.5)) } })),
      markLine: { symbol: "none", silent: true, label: { fontSize: 10, color: css("--ink-2") }, data: [
        { xAxis: a.price, lineStyle: { color: css("--ink-2"), type: "solid" }, label: { formatter: `现价 ${num(a.price, 0)}` } },
        { xAxis: a.weighted_target, lineStyle: { color: palette()[1], type: "dashed" }, label: { formatter: `加权 ${num(a.weighted_target, 0)}` } }] } }] });
  el.style.height = `${Math.max(220, firms.length * 16 + 50)}px`;
  echarts.getInstanceByDom(el)?.resize();
}

// ---------------- 指标说明表（对比页与术语页共用）----------------
const METRIC_VALUE_NOTE = "参考价值指这个指标对判断股价有多大帮助：“高 / 中 / 低”参考公开研究的大致结论与本系统回测（单个指标对未来一周涨跌几乎没有预测力），标“风险”的主要用于控制仓位与识别风险，而不是预测涨跌。";
function metricDocTable(keys, defOf = (k) => METRIC_DEFS[k]) {
  const lvCls = (lv) => (lv.startsWith("高") ? "pos" : lv.startsWith("低") && !lv.includes("中") ? "muted" : "");
  return `<div class="table-wrap"><table class="metric-doc"><thead><tr><th>指标</th><th>含义</th><th>怎么看</th><th>怎么用</th><th>参考价值</th></tr></thead><tbody>
    ${keys.map((k) => { const d = defOf(k); if (!d) return ""; return `<tr><td><b>${esc(d.name)}</b></td><td>${esc(d.def || "")}</td><td>${esc(d.read || "")}</td>
      <td>${esc(d.use || "")}${d.caveat ? `<br><span class="muted">注意：${esc(d.caveat)}</span>` : ""}</td>
      <td>${d.value ? `<b class="${lvCls(d.value[0])}">${esc(d.value[0])}</b><br><span class="muted">${esc(d.value[1])}</span>` : "–"}</td></tr>`; }).join("")}</tbody></table></div>`;
}
