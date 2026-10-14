/* 未上市公司（M57）：对选股池影响大的未上市公司——融资与估值、基金季度估值（N-PORT）、上市公司持股、合作与合同、
   经营数据、投资者文件（Form D、上市申请）、上市公司申报提及、新闻。
   数据：private_cos.json（每周 run_private.py 生成；人工整理部分在 config/private_cos.yaml） */

const PV_KIND = { primary: "融资", tender: "员工股出售 / 回购", debt: "债务融资", other: "二级市场交易" };
const PV_DEAL = { compute: "算力", cloud: "云", chip: "芯片", power: "电力", datacenter: "数据中心", customer: "客户 / 合作", investment: "投资 / 收购", other: "其他" };
const PV_DOC = { governance: "公司治理", filing: "申报文件", letter: "公开信", other: "其他" };
let PV_DATA = null;

async function pvData() {
  if (!PV_DATA) PV_DATA = await load("private_cos.json");
  return PV_DATA?.companies ? PV_DATA : null;
}
const pvB = (v) => (isNum(v) ? (v >= 1000 ? `${num(v / 1000, 2)} 万亿美元` : `${(v * 10).toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 1 : 0 })} 亿美元`) : "–");
const pvDate = (x) => (x.precision === "month" ? `${x.date.slice(0, 7)}（约）` : x.date);
const pvSrc = (x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener" class="small">来源</a>${x.basis === "reported" ? ' <span class="muted small" title="媒体报道（据知情人士），公司未正式公布">据报道</span>' : ""}`;
const pvTk = (t, inPool) => (t ? (inPool ? `<a href="#/stock/${esc(t)}"><b>${esc(t)}</b></a>` : `<b>${esc(t)}</b>`) : "");
const pvName = (c) => `${esc(c.name)}${c.name_zh ? ` <span class="muted">${esc(c.name_zh)}</span>` : ""}`;
const pvVal = (m) => (m.unit === "十亿美元" ? pvB(m.value) : `${num(m.value, m.value < 10 ? 1 : 0)} ${esc(m.unit)}`);
function pvLatestMetric(c, re) { return [...c.metrics].reverse().find((m) => re.test(m.label)); }
function pvEvents(c) {
  return [
    ...c.rounds.map((x) => ({ date: x.date, x, text: `${PV_KIND[x.kind]}：${x.name}${isNum(x.post_money_b) ? `，估值 ${pvB(x.post_money_b)}` : ""}` })),
    ...c.deals.map((x) => ({ date: x.date, x, text: `${PV_DEAL[x.kind]}：${x.counterparty}${isNum(x.amount_b) ? ` ${pvB(x.amount_b)}` : ""}` })),
    ...c.docs.map((x) => ({ date: x.date, x, text: `${PV_DOC[x.kind]}：${x.title}` })),
  ].sort((a, b) => b.date.localeCompare(a.date));
}

const PV_HOWTO = [
  "收录对选股池影响大的未上市公司：它们的融资估值、算力 / 芯片采购合同、上市公司持股，会直接影响相关上市公司（如英伟达、甲骨文、微软、亚马逊）的订单与利润。",
  "“基金估值折算”：富达、T. Rowe Price 等公募基金每月 / 每季度向 SEC 申报持仓（N-PORT），其中未上市公司的每股估值由基金自己按模型给出。两轮融资之间，它能看出估值的变化方向；按最近一轮融资的价格折算成公司整体估值，只作参考（不同类别股份每股价值可能不同，基金估值通常滞后）。",
  "人工整理的内容（融资、合同、持股、经营数据）每条都附来源；标“据报道”的是媒体援引知情人士，公司未正式公布。经营数据多为“年化收入”（近一个月收入 × 12），不是全年收入。",
];

PAGES.private = async (r) => {
  const d = await pvData();
  if (!d) { app().innerHTML = `<h2>未上市公司</h2>${card("未上市公司", empty("数据尚未生成（每周运行 run_private.py）"))}`; return; }
  if (r.arg) { const c = d.companies.find((x) => x.id === r.arg); if (c) return renderPrivate(d, c); }
  const rows = d.companies.map((c) => {
    const lr = c.latest_round, imp = c.implied, rev = pvLatestMetric(c, /年化收入|全年收入/), ev = pvEvents(c)[0];
    return `<tr><td><a href="#/private/${c.id}"><b>${pvName(c)}</b></a><div class="muted small">${esc(c.position)}</div></td>
      <td class="num">${lr ? `<b>${pvB(lr.post_money_b)}</b><div class="muted small">${esc(pvDate(lr))} ${esc(lr.name)}</div>` : "–"}</td>
      <td class="num">${imp ? `${pvB(imp.latest_b)}<div class="muted small">${esc(imp.latest_period)}，较“${esc(imp.round)}” <span class="${cls(imp.change)}">${pct(imp.change, 0, true)}</span></div>` : "–"}</td>
      <td class="num">${rev ? `${pvVal(rev)}<div class="muted small">${esc(rev.label)} ${esc(pvDate(rev))}</div>` : "–"}</td>
      <td class="wrap small">${ev ? `${esc(pvDate(ev.x))}：${esc(ev.text)}` : ""}</td>
      <td class="wrap">${c.related.map((x) => pvTk(x.ticker, x.in_pool)).join(" ")}</td></tr>`;
  }).join("");
  const cos = d.companies;
  const tickers = [...new Set(d.matrix.map((m) => m.ticker))];
  const cell = (t, id) => { const m = d.matrix.find((x) => x.ticker === t && x.co === id); return m ? `<td class="wrap small">${m.items.map(esc).join("<br>")}</td>` : "<td></td>"; };
  const inPool = (t) => d.matrix.some((m) => m.ticker === t && m.in_pool);
  tickers.sort((a, b) => d.matrix.filter((m) => m.ticker === b).length - d.matrix.filter((m) => m.ticker === a).length || a.localeCompare(b));
  app().innerHTML = `<h2>未上市公司 <span class="muted">${cos.length} 家 · 数据截至 ${esc(d.asof)}</span></h2>
    ${howto(PV_HOWTO)}
    <section class="card"><h3>一览 ${badge("fact")}${badge("derived")}</h3><div class="table-wrap"><table><thead><tr><th>公司</th><th class="num">最近一轮估值</th><th class="num">基金估值折算</th><th class="num">最新收入</th><th>最近大事</th><th>关系最紧密的上市公司</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    ${card("估值走势", `${chartDiv("c-pv-val", "tall")}<p class="muted small">实心点 = 融资 / 员工股交易的估值（空心 = 媒体报道）；虚线 = 基金每股估值按最近一轮折算的估值（月度，滞后约 2 个月公开）。对数刻度。</p>`, "", ["fact", "derived"])}
    <section class="card"><h3>上市公司 × 未上市公司：持股与合同 ${badge("fact")}</h3><p class="muted small">金额多为合同上限或媒体报道值；点击代码进入个股页（选股池内）。</p>
      <div class="table-wrap"><table><thead><tr><th>上市公司</th>${cos.map((c) => `<th>${esc(c.name)}</th>`).join("")}</tr></thead><tbody>
      ${tickers.map((t) => `<tr><td>${pvTk(t, inPool(t))}</td>${cos.map((c) => cell(t, c.id)).join("")}</tr>`).join("")}</tbody></table></div></section>`;
  drawPvValuation(byId("c-pv-val"), cos);
};

function drawPvValuation(el, cos) {
  const series = [];
  cos.forEach((c, i) => {
    const color = palette()[i % palette().length];
    const pts = c.rounds.filter((x) => isNum(x.post_money_b));
    series.push({ name: c.name, type: "line", color, data: pts.map((x) => ({ value: [x.date, x.post_money_b], x, symbol: "circle",
      itemStyle: x.basis === "reported" ? { color: css("--surface"), borderColor: color, borderWidth: 2 } : { color } })), symbol: "circle", symbolSize: 9, lineStyle: { width: 1.5, color } });
    if (c.implied) series.push({ name: c.name, type: "line", color, showSymbol: false, lineStyle: { type: "dashed", width: 1.5 },
      data: c.implied.points.map((p) => [`${p.period}-28`, p.value_b]) });
  });
  mkChart(el, {
    legend: { top: 4, data: cos.map((c) => c.name) }, grid: { left: 70, right: 24, top: 36, bottom: 36 },
    tooltip: { trigger: "item", formatter: (p) => (p.data?.x ? `${esc(p.seriesName)} ${esc(pvDate(p.data.x))}<br>${esc(p.data.x.name)}：${pvB(p.data.x.post_money_b)}` : `${esc(p.seriesName)} ${esc(p.value[0].slice(0, 7))}<br>基金估值折算：${pvB(p.value[1])}`) },
    xAxis: { type: "time", min: "2023-01-01" }, yAxis: { type: "log", axisLabel: { formatter: (v) => pvB(v) } }, series,
  });
}

// ---------------- 单家公司 ----------------
function renderPrivate(d, c) {
  const lr = c.latest_round, imp = c.implied, fh = c.fund_holders;
  const rev = pvLatestMetric(c, /年化收入|全年收入/);
  const nav = `<div class="tk-nav"><a href="#/private" class="chip">← 全部</a>${d.companies.map((x) => `<a href="#/private/${x.id}" class="chip ${x.id === c.id ? "on" : ""}">${esc(x.name)}</a>`).join("")}</div>`;
  const kpis = `<div class="kpis">
    <div class="kpi"><span class="muted">最近一轮估值</span><b>${lr ? pvB(lr.post_money_b) : "–"}</b><span class="muted small">${lr ? `${esc(pvDate(lr))} ${esc(lr.name)}` : ""}</span></div>
    <div class="kpi"><span class="muted">基金估值折算</span><b>${imp ? pvB(imp.latest_b) : "–"}</b><span class="muted small">${imp ? `${esc(imp.latest_period)}，较“${esc(imp.round)}” <span class="${cls(imp.change)}">${pct(imp.change, 0, true)}</span>` : "无足够的基金估值"}</span></div>
    <div class="kpi"><span class="muted">最新收入</span><b>${rev ? pvVal(rev) : "–"}</b><span class="muted small">${rev ? `${esc(rev.label)} ${esc(pvDate(rev))}${rev.basis === "reported" ? "（据报道）" : ""}` : ""}</span></div>
    <div class="kpi"><span class="muted">公募基金持有</span><b>${fh.n_funds ? `${fh.n_funds} 只` : "–"}</b><span class="muted small">${fh.n_funds ? `合计约 ${num(fh.value_m / 100, 1)} 亿美元（${esc(fh.period)}）` : ""}</span></div></div>`;
  app().innerHTML = `${nav}<h2>${pvName(c)} <span class="muted">${esc(c.position)} · 数据截至 ${esc(d.asof)}</span></h2>
    <section class="card"><p>${esc(c.summary)}</p>${kpis}
      <p class="small">关系最紧密的上市公司：${c.related.map((x) => pvTk(x.ticker, x.in_pool)).join(" ")}</p></section>
    ${card("估值：融资轮次与基金估值折算", `${chartDiv("c-pv-one", "tall")}<p class="muted small">点 = 融资 / 员工股交易的估值（空心 = 媒体报道）；虚线 = 基金每股估值${imp ? (imp.method === "price" ? `按“${esc(imp.round)}”的每股价格（${num(imp.anchor_per_share, 2)} 美元）折算` : `按“${esc(imp.round)}”（${esc(imp.anchor_period)} 基金每股估值 ${num(imp.anchor_per_share, 2)} 美元 ↔ ${pvB(imp.post_money_b)}）折算`) : ""}。</p>`, "", ["fact", "derived"])}
    ${pvRoundsHtml(c)}
    ${card("基金季度估值（N-PORT，每股）", `${chartDiv("c-pv-marks")}<p class="muted small">各基金公司对该公司股份的每股估值（同月取中位数；不同类别股份价值可能不同）。基金按月申报、约 60 天后公开，所以最新一期通常是 2 个多月前。</p>${pvFundTable(fh)}`, "", ["fact", "derived"])}
    ${pvHoldersHtml(c)}
    ${pvDealsHtml(c)}
    ${pvMetricsHtml(c)}
    ${pvDocsHtml(c)}
    ${card("上市公司申报文件中提到它（8-K / 10-Q / 10-K）", `${chartDiv("c-pv-mention", "short")}${pvMentionList(c)}`, "", ["fact"])}
    ${pvNewsHtml(c)}`;
  drawPvOne(byId("c-pv-one"), c);
  drawPvMarks(byId("c-pv-marks"), c);
  drawPvCounts(byId("c-pv-mention"), [["提到它的申报文件数", c.mention_counts]]);
  if (byId("c-pv-spv")) drawPvCounts(byId("c-pv-spv"), [["新备案的投资载体（SPV）数", c.spv_counts]]);
  c.metrics.length && drawPvMetrics(c);
}

function drawPvOne(el, c) {
  const color = palette()[0];
  const pts = c.rounds.filter((x) => isNum(x.post_money_b));
  mkChart(el, {
    legend: { show: false }, grid: { left: 70, right: 24, top: 20, bottom: 36 },
    tooltip: { trigger: "item", formatter: (p) => (p.data?.x ? `${esc(pvDate(p.data.x))} ${esc(p.data.x.name)}<br>估值 ${pvB(p.data.x.post_money_b)}${isNum(p.data.x.amount_b) ? `，金额 ${pvB(p.data.x.amount_b)}` : ""}` : `${esc(p.value[0].slice(0, 7))} 基金估值折算 ${pvB(p.value[1])}`) },
    xAxis: { type: "time" }, yAxis: { type: "log", axisLabel: { formatter: (v) => pvB(v) } },
    series: [
      { type: "line", color, symbol: "circle", symbolSize: 10, lineStyle: { color }, data: pts.map((x) => ({ value: [x.date, x.post_money_b], x, itemStyle: x.basis === "reported" ? { color: css("--surface"), borderColor: color, borderWidth: 2 } : { color } })),
        label: { show: true, position: "top", fontSize: 10, color: css("--ink-2"), formatter: (p) => p.data.x.name } },
      ...(c.implied ? [{ type: "line", color: palette()[1], showSymbol: false, lineStyle: { type: "dashed" }, data: c.implied.points.map((p) => [`${p.period}-28`, p.value_b]) }] : []),
    ],
  });
}
function drawPvMarks(el, c) {
  const fams = Object.entries(c.marks.families).slice(0, 8);
  if (!fams.length) { el.innerHTML = empty("没有找到基金持仓"); return; }
  mkChart(el, {
    grid: { left: 60, right: 24, top: 40, bottom: 36 }, xAxis: { type: "time" }, yAxis: { type: "value", scale: true, name: "美元 / 股" },
    tooltip: { trigger: "axis", valueFormatter: (v) => (isNum(v) ? `${num(v, 2)} 美元` : "–") },
    series: [{ name: "全部基金中位数", type: "line", color: css("--ink"), lineStyle: { width: 3 }, showSymbol: false, step: "end", data: c.marks.all.map((p) => [`${p.period}-28`, p.per_share]) },
      ...fams.map(([f, pts], i) => ({ name: f, type: "line", step: "end", color: palette()[i % palette().length], symbolSize: 4, lineStyle: { width: 1.2 }, data: pts.map((p) => [`${p.period}-28`, p.per_share]) }))],
  });
}
function drawPvCounts(el, list) {
  const [name, obj] = list[0];
  const ks = Object.keys(obj || {}).sort();
  if (!ks.length) { el.innerHTML = empty("暂无数据（需要 SEC_USER_AGENT）"); return; }
  mkChart(el, { legend: { show: false }, grid: { left: 44, right: 16, top: 16, bottom: 28 }, xAxis: { type: "category", data: ks.map((k) => `${k.slice(2, 4)}Q${Math.ceil(+k.slice(5, 7) / 3)}${k > (PV_DATA?.asof || "") ? "（至今）" : ""}`) }, yAxis: { type: "value" },
    tooltip: { trigger: "axis" }, series: [{ name, type: "bar", color: "#7c5cff", barMaxWidth: 22, data: ks.map((k) => obj[k]) }] });
}

function pvRoundsHtml(c) {
  if (!c.rounds.length) return "";
  return `<section class="card"><h3>融资与估值 ${badge("fact")}</h3><div class="table-wrap"><table><thead><tr><th>日期</th><th>类型</th><th>名称</th><th class="num">金额</th><th class="num">估值</th><th>领投 / 买方</th><th>说明</th><th></th></tr></thead><tbody>
    ${[...c.rounds].reverse().map((x) => `<tr><td>${esc(pvDate(x))}</td><td>${PV_KIND[x.kind]}</td><td>${esc(x.name)}</td><td class="num">${pvB(x.amount_b)}</td><td class="num"><b>${pvB(x.post_money_b)}</b></td><td class="wrap small">${esc(x.lead)}</td><td class="wrap small">${esc(x.text)}</td><td>${pvSrc(x)}</td></tr>`).join("")}</tbody></table></div></section>`;
}
function pvFundTable(fh) {
  if (!fh.top.length) return "";
  return `<details class="howto"><summary>最近一期持有它的基金（前 ${fh.top.length} 只，共 ${fh.n_funds} 只）</summary><div class="table-wrap"><table><thead><tr><th>申报主体</th><th>基金公司</th><th>报告期</th><th class="num">市值</th><th>持有的股份类别</th><th></th></tr></thead><tbody>
    ${fh.top.map((x) => `<tr><td class="wrap">${esc(x.filer)}</td><td>${esc(x.family)}</td><td>${esc(x.period)}</td><td class="num">${num(x.value_m, 1)} 百万美元</td><td class="wrap small">${x.classes.map(esc).join("；")}</td><td><a href="${esc(x.url)}" target="_blank" rel="noopener" class="small">N-PORT</a></td></tr>`).join("")}</tbody></table></div></details>`;
}
function pvHoldersHtml(c) {
  if (!c.holders.length) return "";
  return `<section class="card"><h3>上市公司的持股与投资披露 ${badge("fact")}</h3><div class="table-wrap"><table><thead><tr><th>日期</th><th>上市公司</th><th>持股 / 投资</th><th>说明</th><th></th></tr></thead><tbody>
    ${[...c.holders].reverse().map((x) => `<tr><td>${esc(pvDate(x))}</td><td>${pvTk(x.ticker, x.in_pool)} ${esc(x.name)}</td><td class="wrap"><b>${esc(x.stake)}</b></td><td class="wrap small">${esc(x.text)}</td><td>${pvSrc(x)}</td></tr>`).join("")}</tbody></table></div></section>`;
}
function pvDealsHtml(c) {
  if (!c.deals.length) return "";
  return `<section class="card"><h3>合作与合同 ${badge("fact")}</h3><div class="table-wrap"><table><thead><tr><th>日期</th><th>类型</th><th>对方</th><th class="num">金额</th><th>期限 / 规模</th><th>说明</th><th></th></tr></thead><tbody>
    ${[...c.deals].reverse().map((x) => `<tr><td>${esc(pvDate(x))}</td><td>${PV_DEAL[x.kind]}</td><td class="wrap">${esc(x.counterparty)} ${pvTk(x.ticker, x.in_pool)}</td><td class="num">${pvB(x.amount_b)}</td><td class="wrap small">${esc(x.term)}</td><td class="wrap small">${esc(x.text)}</td><td>${pvSrc(x)}</td></tr>`).join("")}</tbody></table></div><p class="muted small">金额多为“最多”或合同总额上限，按年确认的收入远小于此；意向书（LOI）不具约束力。</p></section>`;
}
function pvMetricsHtml(c) {
  if (!c.metrics.length) return "";
  const labels = [...new Set(c.metrics.map((m) => `${m.label}|${m.unit}`))];
  const charts = labels.filter((l) => c.metrics.filter((m) => `${m.label}|${m.unit}` === l).length >= 2);
  return `<section class="card"><h3>经营数据 ${badge("fact")}</h3>${charts.length ? `<div class="grid two">${charts.map((l, i) => `<div><b>${esc(l.split("|")[0])}（${esc(l.split("|")[1])}）</b>${chartDiv(`c-pv-m-${i}`, "short")}</div>`).join("")}</div>` : ""}
    <div class="table-wrap"><table><thead><tr><th>日期</th><th>指标</th><th class="num">数值</th><th>说明</th><th></th></tr></thead><tbody>
    ${[...c.metrics].reverse().map((x) => `<tr><td>${esc(pvDate(x))}</td><td>${esc(x.label)}</td><td class="num"><b>${pvVal(x)}</b></td><td class="wrap small">${esc(x.text)}</td><td>${pvSrc(x)}</td></tr>`).join("")}</tbody></table></div></section>`;
}
function drawPvMetrics(c) {
  const labels = [...new Set(c.metrics.map((m) => `${m.label}|${m.unit}`))].filter((l) => c.metrics.filter((m) => `${m.label}|${m.unit}` === l).length >= 2);
  labels.forEach((l, i) => {
    const el = byId(`c-pv-m-${i}`);
    const ms = c.metrics.filter((m) => `${m.label}|${m.unit}` === l);
    mkChart(el, { legend: { show: false }, grid: { left: 44, right: 16, top: 16, bottom: 28 }, xAxis: { type: "time" }, yAxis: { type: "value" }, tooltip: { trigger: "axis" },
      series: [{ type: "line", color: "#7c5cff", symbol: "circle", symbolSize: 8, lineStyle: { color: "#7c5cff" }, data: ms.map((m) => ({ value: [m.date, m.value], itemStyle: m.basis === "reported" ? { color: css("--surface"), borderColor: "#7c5cff", borderWidth: 2 } : { color: "#7c5cff" } })) }] });
  });
}
function pvDocsHtml(c) {
  const own = c.form_d || [], ipo = c.ipo_filings || [];
  const docs = c.docs.length ? `<ul>${[...c.docs].reverse().map((x) => `<li><b>${esc(pvDate(x))}</b> ${PV_DOC[x.kind]}：${esc(x.title)} <span class="muted small">${esc(x.text)}</span> ${pvSrc(x)}</li>`).join("")}</ul>` : `<p class="muted">暂无人工整理的文件。</p>`;
  const ipoHtml = ipo.length ? `<ul>${ipo.map((x) => `<li><b>${esc(x.date)}</b> ${esc(x.form)} · ${esc(x.filer)} <a href="${esc(x.url)}" target="_blank" rel="noopener" class="small">EDGAR</a></li>`).join("")}</ul>` : `<p class="muted small">EDGAR 上尚无公开的上市申请文件（秘密提交的草案不公开）。</p>`;
  const fd = own.length ? `<div class="table-wrap"><table><thead><tr><th>日期</th><th>表格</th><th>主体</th><th class="num">发行金额</th><th class="num">已售</th><th>首次出售</th><th>证券类型</th><th></th></tr></thead><tbody>
    ${own.slice(0, 12).map((x) => `<tr><td>${esc(x.date)}</td><td>${esc(x.form)}</td><td class="wrap">${esc(x.entity || x.issuer || "")}</td><td class="num">${isNum(x.offering) ? `${num(x.offering / 1e8, 1)} 亿美元` : "不限"}</td><td class="num">${isNum(x.sold) ? `${num(x.sold / 1e8, 1)} 亿美元` : "–"}</td><td>${esc(x.first_sale || "")}</td><td class="small">${esc((x.types || []).join(" / "))}</td><td><a href="${esc(x.url)}" target="_blank" rel="noopener" class="small">EDGAR</a></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted small">公司本身没有 Form D 备案（或通过其他豁免融资）。</p>`;
  return `<section class="card"><h3>投资者文件 ${badge("fact")}</h3>
    <h4>关键文件</h4>${docs}<h4>上市申请（S-1 / F-1 / 424B4，自动检测）</h4>${ipoHtml}
    <h4>公司自己的 Form D（私募融资备案）</h4>${fd}
    <h4>投资它的载体（SPV）新备案数</h4>${chartDiv("c-pv-spv", "short")}<p class="muted small">Form D 中名称提到该公司的投资载体（多为专门投资它的 SPV / 系列基金），按季度统计；增加通常说明二级市场需求升温。</p></section>`;
}
function pvMentionList(c) {
  const m = c.mentions || [];
  if (!m.length) return `<p class="muted small">暂无数据。</p>`;
  return `<div class="table-wrap"><table><thead><tr><th>日期</th><th>表格</th><th>申报公司</th><th></th></tr></thead><tbody>
    ${m.map((x, i) => `<tr class="${i >= 10 ? "x-more" : ""}"><td>${esc(x.date)}</td><td>${esc(x.form)}</td><td class="wrap">${esc(x.filer)}</td><td><a href="${esc(x.url)}" target="_blank" rel="noopener" class="small">原文</a></td></tr>`).join("")}</tbody></table></div>${moreButton(m.length, 10, "份")}
    <p class="muted small">近一年提到它的上市公司申报（全文检索，含只顺带提及的）；8-K 常是合同或投资公告。</p>`;
}
function pvNewsHtml(c) {
  const n = c.news || [];
  if (!n.length) return card("相关新闻", empty("近期新闻存档中没有标题提到它的文章"), "", ["fact"]);
  return `<section class="card"><h3>相关新闻 ${badge("fact")}</h3><div class="nlist"><ul class="news-list">${n.map((a, i) => `<li class="${i >= 15 ? "x-more" : ""}"><span class="muted small">${esc(a.date)}</span> <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a> <span class="muted small">${esc(a.publisher || "")}${a.tickers.length ? ` · ${a.tickers.map(esc).join(" ")}` : ""}</span></li>`).join("")}</ul></div>${moreButton(n.length, 15, "篇")}
    <p class="muted small">近 200 天每日新闻存档中标题提到它（${esc((c.aliases || []).join("、"))}）的文章。</p></section>`;
}
