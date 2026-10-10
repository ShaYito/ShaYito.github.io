/* 宏观与政策（M39）：新闻页“宏观与政策”卡片 + 市场页“宏观与异动”子标签 */
const SCOPE_ZH = { market: "整个市场", sector: "行业", company: "单个公司" };
const POLICY_ZH = { monetary: "货币政策", trade: "贸易 / 关税", export_control: "出口管制", fiscal: "财政", regulation: "监管",
  geopolitics: "地缘政治", economic_data: "经济数据", none: "" };
const dirCls = (d) => (d === "positive" ? "pos" : d === "negative" ? "neg" : "");

function macroTag(m) { return [POLICY_ZH[m.policy] || "", SCOPE_ZH[m.scope] || ""].filter(Boolean).join(" · "); }

// 市场反应一行：反应日、各标的涨跌与“几倍日常波动”，异常时加醒目标记
function reactionHtml(r) {
  if (!r) return "";
  if (r.status === "pending") return `<span class="chip">市场反应：${esc(r.label || "待开盘")}</span>`;
  const moves = Object.entries(r.moves || {}).map(([t, m]) => `${esc(t)} <span class="${m.ret > 0 ? "pos" : m.ret < 0 ? "neg" : ""}">${pct(m.ret, 1, true)}</span><span class="muted">（${Math.abs(m.z).toFixed(1)} 倍）</span>`).join(" · ");
  if (!moves) return "";
  const flag = r.status === "abnormal" ? `<span class="chip warnchip" title="SPY 或 QQQ 当天涨跌超过日常波动的 2 倍">⚠ 引起市场波动</span>` : `<span class="chip">市场未明显反应</span>`;
  return `<span class="muted">${esc((r.session || "").slice(5))} 收盘：</span>${moves} ${flag}`;
}

function macroItem(m) {
  const aff = (m.affected || []).map((a) => `<b class="${dirCls(a.direction)}">${esc(a.name)}</b>（${esc(a.rationale)}）`).join("；");
  return `<article class="event nosel ${m.direction || ""}">
    <div><span class="chip">${esc((m.date || "").slice(5))}</span>${macroTag(m) ? `<span class="chip">${esc(macroTag(m))}</span>` : ""}
      <span class="chip ${dirCls(m.direction)}">大盘${esc(DIR_ZH[m.direction] || "")}</span>${m.tier === "extractive" ? `<span class="chip">标题摘录</span>` : ""}</div>
    <h4>${esc(m.headline)}</h4>${m.summary && m.summary !== m.headline ? `<p>${esc(m.summary)}</p>` : ""}
    ${aff ? `<p><b>影响：</b>${aff}</p>` : ""}
    <p>${reactionHtml(m.reaction)}</p>
    ${m.watch ? `<p class="muted">关注：${esc(m.watch)}</p>` : ""}
    <p class="src">${srcLinks(m.sources, 3)}</p></article>`;
}

// 新闻页：所选日期范围内的宏观与政策事件（按日期新到旧）
function macroNewsCard(recs, ticker) {
  let items = recs.flatMap((rec) => (rec.macro || []).map((m) => ({ ...m, date: rec.date })));
  if (ticker) items = items.filter((m) => (m.affected || []).some((a) => a.target === ticker || a.target === META.universe.find((u) => u.ticker === ticker)?.theme));
  if (!items.length) return "";
  items.sort((a, b) => b.date.localeCompare(a.date) || (b.importance || 0) - (a.importance || 0));
  const ab = items.filter((m) => m.reaction?.status === "abnormal").length;
  return card(`宏观与政策（${items.length} 个事件${ab ? `，${ab} 个当天市场异常波动` : ""}）`,
    `<p class="muted">影响整个市场或某个行业的政策 / 宏观新闻。方向与影响是 AI 推断；“市场反应”是事件后首个收盘日的实际涨跌（同一天可能还有其他消息，不代表因果）。<a href="#/macro">市场异动日 →</a></p>
    ${items.slice(0, 4).map(macroItem).join("")}
    ${items.length > 4 ? `<details><summary>其余 ${Math.min(items.length, 20) - 4} 个宏观事件</summary>${items.slice(4, 20).map(macroItem).join("")}</details>` : ""}`, "", ["fact", "model"]);
}

const MACRO_HOWTO = [
  "经济政策不确定性指数（EPU）：统计美国主要报纸中同时出现“经济 + 政策 + 不确定”类词语的文章比例（1985–2009 年平均 = 100）。升高时市场波动通常更大，但它描述的是当下气氛，不预测方向。",
  "预测市场：Polymarket 上用真钱交易的“某事件会不会发生”合约，价格 ≈ 市场给出的概率；看的是概率怎么变（例如降息概率一周内从 30% 升到 60%），说明市场预期在快速调整。成交额小的事件不显示。",
  "上半部分：近期 SPY 涨跌超过日常波动 2 倍的“市场异动日”，以及当天记录到的宏观 / 政策新闻——用来回答“那天大盘为什么大涨 / 大跌”。",
  "“几倍日常波动” = 当天涨跌 ÷ 过去 60 个交易日的日收益标准差；2 倍以上大约每 20 个交易日出现一次。",
  "下半部分：最近的宏观与政策事件，以及事后市场是否真的有反应。AI 判断“影响大”但市场没动，说明市场早已预期或并不在意。",
];

function epuCard(e) {
  if (!e) return "";
  const level = e.pct >= 0.9 ? "处于历史高位" : e.pct >= 0.7 ? "偏高" : e.pct <= 0.3 ? "偏低" : "处于常见范围";
  return card(`经济政策不确定性指数（${e.smooth} 日均值，FRED ${e.series}）`, `<p>最新 <b>${num(e.latest, 0)}</b>（${esc(e.latest_date)}），${level}：高于 ${e.since.slice(0, 4)} 年以来 ${pct(e.pct, 0)} 的日子；历史中位数 ${num(e.median, 0)}。</p>${chartDiv("c-epu", "short")}`, "", ["fact"]);
}
function polyCard(evs) {
  if (!evs.length) return "";
  const chg = (v) => (isNum(v) && Math.abs(v) >= 0.005 ? ` <span class="${v > 0 ? "pos" : "neg"}">${v > 0 ? "+" : ""}${(v * 100).toFixed(0)}</span>` : "");
  return card("预测市场：政策与宏观事件概率（Polymarket）", `<p class="muted">概率后的数字为一天 / 一周的变化（百分点）。概率来自交易价格，事件临近或成交清淡时可能大幅跳动。</p>
    <div class="grid two">${evs.map((e) => `<div><b><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a></b> <span class="muted">截止 ${esc(e.end)} · 成交 $${Math.round((e.volume || 0) / 1e6 * 10) / 10}M</span>
      <table><tbody>${e.markets.map((x) => `<tr><td class="wrap">${esc(x.label === e.title ? "发生概率" : x.label)}</td><td class="num"><b>${pct(x.prob, x.prob < 0.1 ? 1 : 0)}</b></td><td class="num muted">${chg(x.d1) || "–"} / ${chg(x.w1) || "–"}</td></tr>`).join("")}</tbody></table>
      ${e.more ? `<p class="muted">另有 ${e.more} 个低概率选项</p>` : ""}</div>`).join("")}</div>`, "", ["fact"]);
}

PAGES.macro = async () => {
  const m = await load("macro.json");
  const big = m.big_moves || [];
  const ev = m.events || [];
  const st = m.stats || {};
  const rows = big.map((d) => `<tr><td>${esc(d.date)}</td><td class="num ${d.ret > 0 ? "pos" : "neg"}">${pct(d.ret, 1, true)}</td><td class="num">${Math.abs(d.z).toFixed(1)}</td>
    ${(m.instruments || []).slice(1).map((t) => `<td class="num ${d[t] > 0 ? "pos" : d[t] < 0 ? "neg" : ""}">${pct(d[t], 1, true)}</td>`).join("")}
    <td class="wrap">${d.events.length ? d.events.map((e) => `<a href="#/news?date=${e.date}">${esc(e.headline)}</a> <span class="chip">${esc(e.tag)}</span>`).join("<br>") : `<span class="muted">${d.recorded ? "没有记录到宏观 / 政策新闻（可能是个股或其他原因）" : "宏观新闻开始记录之前"}</span>`}</td></tr>`).join("");
  const evRows = ev.map((e) => `<tr><td>${esc(e.date.slice(5))}</td><td class="wrap"><a href="#/news?date=${e.date}">${esc(e.headline)}</a></td><td>${esc(e.tag)}</td>
    <td class="${dirCls(e.direction)}">${esc(DIR_ZH[e.direction] || "")}</td><td class="wrap">${reactionHtml(e.reaction)}</td></tr>`).join("");
  app().innerHTML = `
    <h2>宏观与异动 <span class="muted">截至 ${esc(m.asof || "–")}</span></h2>
    ${howto(MACRO_HOWTO)}
    ${epuCard(m.epu)}
    ${polyCard(m.polymarket || [])}
    ${card(`市场异动日（近 ${m.lookback_days} 个交易日，SPY 涨跌 ≥ ${m.abnormal_z} 倍日常波动）`, big.length ? `<div class="table-wrap"><table>
      <thead><tr><th>日期</th><th class="num">SPY</th><th class="num">倍数</th>${(m.instruments || []).slice(1).map((t) => `<th class="num">${esc(t)}</th>`).join("")}<th>当天的宏观 / 政策新闻</th></tr></thead>
      <tbody>${rows}</tbody></table></div>${m.first_recorded ? `<p class="muted">宏观新闻自 ${esc(m.first_recorded)} 起记录。</p>` : ""}` : empty("近期没有异常波动日"), "", ["fact"])}
    ${card(`近期宏观与政策事件（已有市场反应 ${st.measured || 0} 个，其中引起异常波动 ${st.abnormal || 0} 个）`, ev.length ? `<div class="table-wrap"><table>
      <thead><tr><th>日期</th><th>事件</th><th>类型</th><th>AI 判断（大盘）</th><th>市场反应</th></tr></thead><tbody>${evRows}</tbody></table></div>` : empty("尚无宏观新闻记录（每日推送开始记录后显示）"), "", ["fact", "model"])}`;
  if (m.epu && byId("c-epu")) {
    mkChart(byId("c-epu"), {
      tooltip: { trigger: "axis" }, legend: { show: false }, grid: { left: 44, right: 16, top: 16, bottom: 24 },
      xAxis: { type: "category", data: m.epu.dates }, yAxis: { type: "value", scale: true },
      series: [{ name: "EPU", type: "line", showSymbol: false, data: m.epu.values, itemStyle: { color: css("--accent") },
        markLine: { silent: true, symbol: "none", data: [{ yAxis: m.epu.median, name: "历史中位数" }], label: { formatter: "历史中位数", position: "insideEndTop" }, lineStyle: { type: "dashed", color: css("--muted") } } }],
    });
  }
};
