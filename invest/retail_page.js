/* 散户热度（M40）：个股页卡片 + 市场页“散户热度”子标签。数据：retail.json（每日推送时抓取的快照） */
const RETAIL_NOTE = "散户情绪极端或讨论暴增常是过热 / 拥挤信号，不是买入理由；Stocktwits 看多比例只算用户自己标注了看多 / 看空的帖子。";
const RETAIL_SRC = { stocktwits: "Stocktwits", apewisdom: "ApeWisdom（Reddit 提及）", reddit: "Reddit" };
const RETAIL_STATE = { ok: "", failed: "（本次未取到）", skipped: "（未配置）" };
const ratioTxt = (v, b) => (isNum(v) && isNum(b) && b > 0 ? `，平时 ${num(b, b < 10 ? 1 : 0)}（${(v / b).toFixed(1)} 倍）` : "");

function retailSourcesLine(src) {
  return `<p class="muted">来源：${Object.entries(src || {}).map(([k, v]) => `${esc(RETAIL_SRC[k] || k)}${RETAIL_STATE[v] ?? ""}`).join(" · ")}。${esc(RETAIL_NOTE)}</p>`;
}

async function fillRetailCard(t) {
  const el = byId("retail-card");
  if (!el) return;
  let d;
  try { d = await load("retail.json"); } catch { return; }
  const row = (d.rows || []).find((x) => x.ticker === t);
  if (!d.asof || !row) return;
  const alerts = (d.alerts || []).filter((a) => a.ticker === t);
  const items = [];
  if (isNum(row.bull_ratio)) items.push(`Stocktwits 看多 <b>${pct(row.bull_ratio, 0)}</b><span class="muted">（${row.tagged} 条有标注${isNum(row.bull_base) ? `，平时 ${pct(row.bull_base, 0)}` : ""}）</span>`);
  if (isNum(row.per_hour)) items.push(`讨论频率 <b>${num(row.per_hour, 1)}</b> 帖 / 小时<span class="muted">${ratioTxt(row.per_hour, row.per_hour_base)}</span>`);
  if (isNum(row.watchlist)) items.push(`<span class="muted">Stocktwits 关注 ${row.watchlist.toLocaleString()} 人</span>`);
  if (isNum(row.mentions)) items.push(`Reddit 24 小时提及 <b>${row.mentions}</b> 次<span class="muted">${ratioTxt(row.mentions, row.mentions_base)}${isNum(row.rank) ? ` · 全市场第 ${row.rank} 名` : ""}</span>`);
  if (isNum(row.reddit_posts)) items.push(`Reddit 帖子 <b>${row.reddit_posts}</b> 篇<span class="muted">（得分 ${row.reddit_score}，评论 ${row.reddit_comments}）</span>`);
  const top = (row.reddit_top || []).map((p) => `<li><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a> <span class="muted">r/${esc(p.sub || "")} · ${p.score} 赞 · ${p.comments} 评论</span></li>`).join("");
  const h = d.history?.[t];
  const hasHist = h && h.dates.length >= 2;
  el.hidden = false;
  el.innerHTML = `<h3>散户热度（${esc(d.asof)}）${badge("fact")}${badge("derived")}</h3>
    ${alerts.length ? `<p>${alerts.map((a) => `<span class="chip warnchip">${esc(a.text)}</span>`).join(" ")}</p>` : ""}
    <p>${items.join(" · ") || "暂无数据"}</p>${top ? `<b>Reddit 热帖</b><ul>${top}</ul>` : ""}
    ${hasHist ? chartDiv("c-retail", "short") : `<p class="muted">每天记录一次，积累几天后显示趋势与“平时水平”。</p>`}
    ${retailSourcesLine(d.sources)}`;
  if (hasHist) {
    mkChart(byId("c-retail"), {
      tooltip: { trigger: "axis" }, legend: { top: 0 }, grid: { left: 44, right: 44, top: 28, bottom: 24 },
      xAxis: { type: "category", data: h.dates.map((x) => x.slice(5)) },
      yAxis: [{ type: "value", name: "提及 / 帖子" }, { type: "value", name: "看多", min: 0, max: 1, axisLabel: { formatter: (v) => `${Math.round(v * 100)}%` } }],
      series: [
        { name: "Reddit 提及", type: "bar", data: h.mentions, itemStyle: { color: css("--accent") } },
        { name: "Stocktwits 看多比例", type: "line", yAxisIndex: 1, data: h.bull_ratio, connectNulls: true, itemStyle: { color: css("--good") } },
      ],
    });
  }
}

const RETAIL_HOWTO = [
  "每天推送时抓取一次：Stocktwits（用户发帖时自己标注看多 / 看空）、ApeWisdom（汇总 Reddit 各版块 24 小时提及次数）、Reddit 官方接口（配置后统计帖子与热帖）。",
  "“平时”= 此前每日记录的中位数；刚开始记录的几天，Reddit 提及用 24 小时前的数作对比。",
  "看多比例 ≥ 85% 或 ≤ 35%、讨论量是平时 2.5 倍以上会标为异动。散户一致看多往往出现在短期高点附近——把它当作拥挤度指标。",
];

PAGES.retail = async (r) => {
  const d = await load("retail.json");
  if (!d.asof) { app().innerHTML = `<h2>散户热度</h2>${card("散户热度", empty("尚无数据：每日推送开始记录后显示。"))}`; return; }
  const sortKey = r.query.sort || "mentions";
  const val = (x) => ({ mentions: x.mentions, surge: isNum(x.mentions) && x.mentions_base ? x.mentions / x.mentions_base : null, bull: x.bull_ratio, activity: x.per_hour, reddit: x.reddit_posts })[sortKey];
  const market = (d.market || []).map((t) => (d.rows || []).find((x) => x.ticker === t)).filter(Boolean);
  const rows = (d.rows || []).filter((x) => !(d.market || []).includes(x.ticker)).sort((a, b) => (val(b) ?? -1) - (val(a) ?? -1));
  const alerted = new Set((d.alerts || []).map((a) => a.ticker));
  const hasReddit = (d.rows || []).some((x) => isNum(x.reddit_posts));
  const th = (k, label) => `<th class="num"><a href="#/retail?sort=${k}" class="${k === sortKey ? "on" : ""}">${label}${k === sortKey ? " ▼" : ""}</a></th>`;
  const tr = (x) => `<tr><td><a href="#/stock/${x.ticker}">${esc(x.ticker)}</a> ${alerted.has(x.ticker) ? `<span class="chip warnchip">异动</span>` : ""}</td>
    <td class="num">${isNum(x.mentions) ? x.mentions : "–"}</td><td class="num">${isNum(x.mentions) && x.mentions_base ? `${(x.mentions / x.mentions_base).toFixed(1)}×` : "–"}</td>
    <td class="num">${isNum(x.bull_ratio) ? `${pct(x.bull_ratio, 0)} <span class="muted">(${x.tagged})</span>` : "–"}</td>
    <td class="num">${num(x.per_hour, 1)}</td>${hasReddit ? `<td class="num">${isNum(x.reddit_posts) ? x.reddit_posts : "–"}</td>` : ""}</tr>`;
  app().innerHTML = `<h2>散户热度 <span class="muted">${esc(d.asof)} · 已记录 ${d.history_days + 1} 天</span></h2>
    ${howto(RETAIL_HOWTO)}
    ${market.length ? card("大盘散户情绪（Stocktwits）", `<p>${market.map((x) => `<b>${esc(x.ticker)}</b> 看多 ${pct(x.bull_ratio, 0)}<span class="muted">（${x.tagged} 条有标注${isNum(x.bull_base) ? `，平时 ${pct(x.bull_base, 0)}` : ""}）</span>`).join(" · ")}</p>`, "", ["fact"]) : ""}
    ${(d.alerts || []).length ? card(`异动（${d.alerts.length}）`, `<ul>${d.alerts.map((a) => `<li><a href="#/stock/${a.ticker}">${esc(a.ticker)}</a>：${esc(a.text)}</li>`).join("")}</ul>`, "", ["derived"]) : ""}
    ${card("选股池散户热度", `<div class="table-wrap"><table><thead><tr><th>股票</th>${th("mentions", "Reddit 提及")}${th("surge", "对比平时")}${th("bull", "Stocktwits 看多")}${th("activity", "帖子 / 小时")}${hasReddit ? th("reddit", "Reddit 帖子") : ""}</tr></thead>
      <tbody>${rows.map(tr).join("")}</tbody></table></div>${retailSourcesLine(d.sources)}`, "", ["fact", "derived"])}`;
};
