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

const INSTR_ZH = { QQQ: "纳斯达克 100 指数 ETF 当天涨跌", "^VIX": "波动率指数（恐慌指数）当天涨跌幅" };

PAGES.macro = async () => {
  const m = await load("macro.json");
  const big = m.big_moves || [];
  const ev = m.events || [];
  const st = m.stats || {};
  const rows = big.map((d) => `<tr><td>${esc(d.date)}</td><td class="num ${d.ret > 0 ? "pos" : "neg"}">${pct(d.ret, 1, true)}</td><td class="num">${Math.abs(d.z).toFixed(1)} 倍<span class="muted small">${Math.abs(d.z) >= 3 ? "（罕见）" : ""}</span></td>
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
      <thead><tr><th>日期</th><th class="num" title="标普 500 ETF 当天收盘涨跌">SPY 涨跌</th><th class="num" title="当天涨跌 ÷ 过去 60 个交易日的日常波动">相当于几倍日常波动</th>${(m.instruments || []).slice(1).map((t) => `<th class="num" title="${esc(INSTR_ZH[t] || "")}">${esc(t)}</th>`).join("")}<th>当天的宏观 / 政策新闻</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <ul class="muted small">
        <li><b>SPY</b>：标普 500 指数 ETF，代表美股大盘；<b>QQQ</b>：纳斯达克 100 指数 ETF，偏科技股；<b>^VIX</b>：波动率指数（“恐慌指数”），这一列是它当天的涨跌幅，大幅上升 = 市场更紧张。</li>
        <li><b>几倍日常波动</b>：当天涨跌幅 ÷ 过去 60 个交易日每日涨跌幅的标准差。例如 SPY 平时一天大约波动 ±0.8%，某天跌 2.4% 就是约 3 倍。2 倍以上大约每 20 个交易日出现一次，3 倍以上就很少见。</li>
        <li><b>当天的宏观 / 政策新闻</b>：系统记录到、且“市场反应日”正好是这一天的宏观事件（只能说明同一天发生，不代表就是原因）。${m.first_recorded ? `宏观新闻自 ${esc(m.first_recorded)} 起记录，更早的日子没有。` : "宏观新闻从每日推送开始记录后才有。"}</li>
      </ul>` : empty("近期没有异常波动日"), "", ["fact"])}
    ${card(`近期宏观与政策事件（已有市场反应 ${st.measured || 0} 个，其中引起异常波动 ${st.abnormal || 0} 个）`, ev.length ? `<div class="table-wrap"><table>
      <thead><tr><th>日期</th><th>事件</th><th>类型</th><th title="AI 根据报道内容判断：对美股整体是利好还是利空">AI 判断（大盘）</th><th title="事件后第一个收盘日的实际涨跌">市场反应</th></tr></thead><tbody>${evRows}</tbody></table></div>
      <ul class="muted small">
        <li><b>类型</b>：政策类别 · 影响范围（AI 判断）。<b>AI 判断（大盘）</b>：AI 读完报道后认为对美股整体利好 / 利空 / 中性，是推断。</li>
        <li><b>市场反应</b>：事件后第一个收盘的交易日（美东 16:00 前发布算当天，否则算下一个交易日）各指数的实际涨跌，括号里是“几倍日常波动”；SPY 或 QQQ ≥ 2 倍标“⚠ 引起市场波动”。“待开盘 / 待收盘”= 那一天还没收盘，网站每次更新会补上。</li>
        <li>对照着看：AI 说影响大、市场却没动，往往是市场早有预期；AI 说中性、市场却大动，可能还有别的原因。</li>
      </ul>` : empty("尚无宏观新闻记录（每日推送开始记录后显示）"), "", ["fact", "model"])}`;
  if (m.epu && byId("c-epu")) {
    mkChart(byId("c-epu"), {
      tooltip: { trigger: "axis" }, legend: { show: false }, grid: { left: 44, right: 16, top: 16, bottom: 24 },
      xAxis: { type: "category", data: m.epu.dates }, yAxis: { type: "value", scale: true },
      series: [{ name: "EPU", type: "line", showSymbol: false, data: m.epu.values, itemStyle: { color: css("--accent") },
        markLine: { silent: true, symbol: "none", data: [{ yAxis: m.epu.median, name: "历史中位数" }], label: { formatter: "历史中位数", position: "insideEndTop" }, lineStyle: { type: "dashed", color: css("--muted") } } }],
    });
  }
};
