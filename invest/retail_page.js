/* 散户热度（M40）：个股页卡片 + 市场页“散户热度”子标签。数据：retail.json（每日推送时抓取的快照） */
const RETAIL_NOTE = "散户情绪极端或讨论暴增常是过热 / 拥挤信号，不是买入理由；Stocktwits 看多比例只算用户自己标注了看多 / 看空的帖子。";
const RETAIL_SRC = { stocktwits: "Stocktwits", apewisdom: "ApeWisdom（Reddit 提及）", reddit: "Reddit" };
const RETAIL_STATE = { ok: "", failed: "（本次未取到）", skipped: "（未配置）" };
const ratioTxt = (v, b) => (isNum(v) && isNum(b) && b > 0 ? `，平时 ${num(b, b < 10 ? 1 : 0)}（${(v / b).toFixed(1)} 倍）` : "");

function retailSourcesLine(src) {
  return `<p class="muted">来源：${Object.entries(src || {}).map(([k, v]) => `${esc(RETAIL_SRC[k] || k)}${RETAIL_STATE[v] ?? ""}`).join(" · ")}。${esc(RETAIL_NOTE)}</p>`;
}

const TONE_ZH = { bullish: "偏多", bearish: "偏空", mixed: "分歧", neutral: "中性" };
const SRC_ZH = { stocktwits: "Stocktwits", reddit: "Reddit" };
const medianOf = (a) => { const v = a.filter(isNum).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
const chg = (v) => (isNum(v) ? `<span class="${v > 0 ? "pos" : v < 0 ? "neg" : ""}">${pct(v, 1, true)}</span>` : "–");

async function fillRetailCard(t) {
  const el = byId("retail-card");
  if (!el) return;
  let d;
  try { d = await load("retail.json"); } catch { return; }
  const dg = await load("retail_digest.json").catch(() => null);
  const row = (d.rows || []).find((x) => x.ticker === t);
  const dr = dg?.rows?.[t];
  if ((!d.asof || !row) && !dr) return;
  const alerts = (d.alerts || []).filter((a) => a.ticker === t);
  const items = [];
  if (row) {
    if (isNum(row.bull_ratio)) items.push(`Stocktwits 看多 <b>${pct(row.bull_ratio, 0)}</b><span class="muted">（${row.tagged} 条有标注${isNum(row.bull_base) ? `，平时 ${pct(row.bull_base, 0)}` : ""}）</span>`);
    if (isNum(row.per_hour)) items.push(`讨论频率 <b>${num(row.per_hour, 1)}</b> 帖 / 小时<span class="muted">${ratioTxt(row.per_hour, row.per_hour_base)}</span>`);
    if (isNum(row.mentions)) items.push(`Reddit 24 小时提及 <b>${row.mentions}</b> 次<span class="muted">${ratioTxt(row.mentions, row.mentions_base)}</span>`);
    if (isNum(row.reddit_posts)) items.push(`Reddit 帖子 <b>${row.reddit_posts}</b> 篇<span class="muted">（得分 ${row.reddit_score}，评论 ${row.reddit_comments}）</span>`);
  }
  // 关注度变化：Stocktwits 关注人数（7 / 30 天）、ApeWisdom 全市场排名（24 小时前）与点赞数
  const watch = row && isNum(row.watchlist) ? `Stocktwits 关注 <b>${row.watchlist.toLocaleString()}</b> 人<span class="muted">（${isNum(row.watch_chg_7) ? `7 天 ${chg(row.watch_chg_7)}${isNum(row.watch_chg_30) ? `，30 天 ${chg(row.watch_chg_30)}` : ""}` : "积累 7 天后显示变化"}）</span>` : "";
  const rankUp = row && isNum(row.rank) && isNum(row.rank_24h_ago) ? row.rank_24h_ago - row.rank : null;
  const rank = row && isNum(row.rank) ? `Reddit 提及全市场第 <b>${row.rank}</b> 名<span class="muted">（24 小时前${isNum(row.rank_24h_ago) ? `第 ${row.rank_24h_ago} 名，${rankUp > 0 ? `上升 ${rankUp}` : rankUp < 0 ? `下降 ${-rankUp}` : "持平"}` : "未上榜"}${isNum(row.upvotes) ? ` · 相关帖子点赞 ${row.upvotes.toLocaleString()}` : ""}）</span>` : "";
  const top = (row?.reddit_top || []).map((p) => `<li><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a> <span class="muted">r/${esc(p.sub || "")} · ${p.score} 赞 · ${p.comments} 评论</span></li>`).join("");
  const h = d.history?.[t];
  const hasHist = h && h.dates.length >= 2;
  el.hidden = false;
  el.innerHTML = `<h3>散户热度（${esc(d.asof || dg?.date || "")}）${badge("fact")}${badge("derived")}</h3>
    ${alerts.length ? `<p>${alerts.map((a) => `<span class="chip warnchip">${esc(a.text)}</span>`).join(" ")}</p>` : ""}
    <p>${items.join(" · ") || "暂无热度数据"}</p>${watch || rank ? `<p>${[watch, rank].filter(Boolean).join(" · ")}</p>` : ""}
    ${digestBlock(t, dg, dr)}
    ${top ? `<b>Reddit 热帖</b><ul>${top}</ul>` : ""}
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

// 散户讨论摘要（retail_digest.json，每天推送后单独生成）：AI 归纳 + 投机用语占比 + 版块分布 + 最新 Reddit 帖子
function digestBlock(t, dg, r) {
  if (!r) return dg?.asof ? `<p class="muted">散户讨论摘要（${esc(dg.date)}）：近 ${dg.window_hours} 小时没有找到讨论 ${esc(t)} 的帖子。</p>` : "";
  const v = r.view;
  const pts = (xs) => xs.map((p) => `<li>${esc(p.text)} ${p.sources.map((s, i) => `<a href="${esc(s.url)}" target="_blank" rel="noopener" class="muted small">[${SRC_ZH[s.src] || "原帖"}${p.sources.length > 1 ? ` ${i + 1}` : ""}]</a>`).join(" ")}</li>`).join("");
  const hist = Object.entries(dg.history || {}).filter(([day]) => day !== dg.date).map(([, x]) => x[t]?.spec);
  const base = hist.filter(isNum).length >= 5 ? medianOf(hist) : null;
  const n = r.n_stocktwits + r.n_reddit;
  const spec = isNum(r.spec_ratio) ? `投机 / 期权用语 <b>${pct(r.spec_ratio, 0)}</b><span class="muted">（${r.spec_n} / ${n} 条${isNum(base) ? `，平时 ${pct(base, 0)}` : "，积累 5 天后与平时比"}）</span>` : "";
  const subs = Object.entries(r.subs || {});
  const wsb = subs.find(([k]) => k.toLowerCase() === "wallstreetbets")?.[1] || 0;
  const subTxt = subs.length ? `Reddit 版块：${subs.map(([k, c]) => `r/${esc(k)} ${c}`).join(" · ")}${r.n_reddit >= 3 && wsb / r.n_reddit >= 0.6 ? ` <span class="chip warnchip">多在 WSB，偏投机</span>` : ""}` : "";
  const posts = (r.reddit_posts || []).map((p) => `<li><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a> <span class="muted">r/${esc(p.sub)} · ${esc(p.time.slice(5, 16).replace("T", " "))}${p.in_title === false ? " · 正文提到" : ""}${isNum(p.score) ? ` · ${p.score} 赞 · ${p.comments} 评论` : ""}</span></li>`).join("");
  return `<div class="digest"><h4>散户在讨论什么 ${badge("model")} <span class="muted small">${esc(dg.date)} · 近 ${dg.window_hours} 小时 Stocktwits ${r.n_stocktwits} 条 + Reddit ${r.n_reddit} 篇</span></h4>
    ${v ? `<p><span class="chip">${TONE_ZH[v.tone] || v.tone}</span> ${esc(v.summary)}</p>
      <div class="grid two"><div><b>看多理由</b>${v.bull.length ? `<ul>${pts(v.bull)}</ul>` : `<p class="muted">没有明确的看多理由</p>`}</div>
      <div><b>看空理由 / 担忧</b>${v.bear.length ? `<ul>${pts(v.bear)}</ul>` : `<p class="muted">没有明确的看空理由</p>`}</div></div>`
      : `<p class="muted">帖子太少（少于 5 条有内容的帖子），不做 AI 归纳。</p>`}
    <p>${[spec, subTxt].filter(Boolean).join(" · ")}</p>
    ${posts ? `<details><summary>最新 Reddit 帖子（${r.reddit_posts.length}）</summary><ul>${posts}</ul></details>` : ""}
    <p class="muted small">AI 只归纳帖子里的说法（每条附原帖），不代表事实；投机 / 期权用语 = 帖子中出现 calls、puts、0DTE、YOLO、行权价等词的比例，比例高说明讨论偏短线投机。${dg.reddit_mode === "rss" ? "Reddit 目前用公开 RSS（没有点赞 / 评论数；官方接口获批后自动补上）。" : ""}</p></div>`;
}

const RETAIL_HOWTO = [
  "每天推送时抓取一次：Stocktwits（用户发帖时自己标注看多 / 看空）、ApeWisdom（汇总 Reddit 各版块 24 小时提及次数）、Reddit 官方接口（配置后统计帖子与热帖）。",
  "推送之后另做一次“散户讨论摘要”：读 Stocktwits 帖子正文与 Reddit 帖子（未获官方接口时用公开 RSS），统计投机 / 期权用语比例、Reddit 版块分布，并由 AI 归纳讨论基调与看多 / 看空理由（每条附原帖；只归纳帖子里的说法）。",
  "“平时”= 此前每日记录的中位数；刚开始记录的几天，Reddit 提及用 24 小时前的数作对比。",
  "看多比例 ≥ 85% 或 ≤ 35%、讨论量是平时 2.5 倍以上会标为异动。散户一致看多往往出现在短期高点附近——把它当作拥挤度指标。",
];

PAGES.retail = async (r) => {
  const d = await load("retail.json");
  const dg = await load("retail_digest.json").catch(() => null);
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
    <td class="num">${num(x.per_hour, 1)}</td>${hasReddit ? `<td class="num">${isNum(x.reddit_posts) ? x.reddit_posts : "–"}</td>` : ""}
    <td>${dg?.rows?.[x.ticker]?.view ? `<span class="chip" title="${esc(dg.rows[x.ticker].view.summary)}">${TONE_ZH[dg.rows[x.ticker].view.tone]}</span>` : "<span class=\"muted\">–</span>"}</td>
    <td class="num">${isNum(dg?.rows?.[x.ticker]?.spec_ratio) ? pct(dg.rows[x.ticker].spec_ratio, 0) : "–"}</td></tr>`;
  app().innerHTML = `<h2>散户热度 <span class="muted">${esc(d.asof)} · 已记录 ${d.history_days + 1} 天</span></h2>
    ${howto(RETAIL_HOWTO)}
    ${market.length ? card("大盘散户情绪（Stocktwits）", `<p>${market.map((x) => `<b>${esc(x.ticker)}</b> 看多 ${pct(x.bull_ratio, 0)}<span class="muted">（${x.tagged} 条有标注${isNum(x.bull_base) ? `，平时 ${pct(x.bull_base, 0)}` : ""}）</span>`).join(" · ")}</p>`, "", ["fact"]) : ""}
    ${(d.alerts || []).length ? card(`异动（${d.alerts.length}）`, `<ul>${d.alerts.map((a) => `<li><a href="#/stock/${a.ticker}">${esc(a.ticker)}</a>：${esc(a.text)}</li>`).join("")}</ul>`, "", ["derived"]) : ""}
    ${card("选股池散户热度", `<div class="table-wrap"><table><thead><tr><th>股票</th>${th("mentions", "Reddit 提及")}${th("surge", "对比平时")}${th("bull", "Stocktwits 看多")}${th("activity", "帖子 / 小时")}${hasReddit ? th("reddit", "Reddit 帖子") : ""}<th title="AI 归纳的讨论基调（鼠标悬停看一句话概括；详见个股页）">讨论基调</th><th class="num" title="帖子中出现 calls / puts / 0DTE / YOLO 等投机用语的比例">投机用语</th></tr></thead>
      <tbody>${rows.map(tr).join("")}</tbody></table></div>${retailSourcesLine(d.sources)}`, "", ["fact", "derived"])}`;
};
