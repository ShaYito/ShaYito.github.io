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
