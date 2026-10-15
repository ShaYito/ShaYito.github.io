// 技术页“AI 加速芯片”：财报披露的 AI 收入与指引（M62；数据 chip_disclosures.json，由 run_ai_infra.py chips 生成）
// 每个数字都来自 SEC 8-K 财报附件的原文（悬停可看引用原文）；跨公司对比用各家的“AI 相关收入”指标，口径不同（见说明）。

let CHIP_D = null;
const CHIP_PREF = "invest.tech.chips";
const CHIP_VIEWS = [["ai", "AI 相关收入"], ["revenue", "总收入"], ["yoy", "AI 相关收入同比"]];
const CHIP_KIND = { ai_revenue: "已实现 AI 收入", target: "AI 收入目标 / 展望", bookings: "订单 / 积压", guide: "收入指引" };

async function chipData() {
  if (!CHIP_D) CHIP_D = await load("chip_disclosures.json").catch(() => ({ available: false }));
  return CHIP_D;
}
function chipView() {
  try { return { view: "ai", co: null, ...JSON.parse(localStorage.getItem(CHIP_PREF) || "{}") }; } catch { return { view: "ai", co: null }; }
}
function saveChipView(v) { try { localStorage.setItem(CHIP_PREF, JSON.stringify(v)); } catch { /* 忽略 */ } }

const chipColor = (d, t) => palette()[d.companies.findIndex((c) => c.ticker === t) % palette().length];
const chipName = (c) => `${c.ticker}${c.name_zh ? ` ${c.name_zh}` : ""}`;
const chipVal = (d, m, v) => (d.metrics[m]?.unit === "pct" ? `${num(v, 1)}%` : `$${num(v, v >= 10 ? 1 : 2)}B`);
const chipRange = (d, m, g) => (g.low !== g.high ? `${chipVal(d, m, g.low)}–${chipVal(d, m, g.high)}` : chipVal(d, m, g.mid));
const chipDate = (s, days) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10); };
function chipBeat(d, m, b) {
  if (!isNum(b)) return "";
  const s = d.metrics[m]?.unit === "pct" ? `${b > 0 ? "+" : ""}${num(b, 1)} 个百分点` : pct(b, 1, true);
  return `<span class="${b >= 0 ? "pos" : "neg"}">${s}</span>`;
}

// 某公司某指标的季度序列：[{x: 季度末, v, q}]；下季指引另给一点（季度末 + 91 天）
function chipSeries(c, m, key = "v") {
  return c.quarters.filter((q) => q.actual[m] && isNum(q.actual[m][key])).map((q) => ({ x: q.period_end, v: q.actual[m][key], q }));
}
function chipGuidePoint(c, m) {
  const q = c.quarters[c.quarters.length - 1];
  const g = q?.guide?.[m];
  return g ? { x: chipDate(q.period_end, 91), g, q } : null;
}

async function fillTechChips(t) {
  const el = byId("tk-chips");
  if (!el) return;
  const d = await chipData();
  if (!d?.available || d.tech !== t.id) return;
  el.hidden = false;
  const v = chipView();
  if (!d.companies.some((c) => c.ticker === v.co)) v.co = d.companies[0].ticker;
  renderChips(el, d, v);
}

function renderChips(el, d, v) {
  const c = d.companies.find((x) => x.ticker === v.co);
  const btn = (attr, val, cur, text) => `<button type="button" data-${attr}="${esc(val)}" class="${val === cur ? "on" : ""}">${esc(text)}</button>`;
  el.innerHTML = `<h3>财报披露：AI 收入与指引 ${badge("fact")}${badge("model")}${badge("derived")}</h3>
    <p class="muted small">来源：SEC 8-K 财报附件（新闻稿；NVIDIA 另有 CFO 解读，AMD 有财报幻灯片），由 AI 逐字摘录、程序核对数字与原文后入库（悬停可看原文）。
      数据截至 ${esc(d.asof || "")}；每天检查新财报。</p>
    ${chipLatestHtml(d)}
    <h4>跨公司对比</h4>
    <div class="row"><div class="seg" id="chip-view">${CHIP_VIEWS.map(([k, n]) => btn("v", k, v.view, n)).join("")}</div></div>
    ${chartDiv("c-chip-cmp")}
    <p class="muted small">AI 相关收入的口径各家不同：${d.companies.map((x) => `${esc(x.ticker)} = ${esc(d.metrics[x.ai_metric].name)}`).join("；")}。
      AMD 的数据中心分部含 EPYC CPU，Marvell 的数据中心含光 DSP / 交换 / 存储芯片，NVIDIA 的数据中心含网络；只有博通单独披露“AI 半导体收入”。
      空心点 + 虚线 = 公司给出的下季指引（中值）；横轴为各家财季的结束日期（财年不同，按季度末对齐）。</p>
    <h4>逐家公司</h4>
    <div class="row"><div class="seg" id="chip-co">${d.companies.map((x) => btn("c", x.ticker, v.co, chipName(x))).join("")}</div></div>
    <div class="grid two">
      <div><b>各项收入（十亿美元）</b>${chartDiv("c-chip-co")}</div>
      <div><b>实际值 vs 上季给出的指引中值</b>${chartDiv("c-chip-beat")}
        <p class="muted small">柱 = 实际 ÷ 指引中值 − 1（毛利率为百分点差）。指引区间通常是中值 ±2%–5%，持续大幅超出说明公司指引偏保守或需求超预期。</p></div>
    </div>
    ${chipTableHtml(d, c)}
    ${chipAnnualHtml(d, c)}
    ${chipStatementsHtml(d, c)}
    <details><summary class="muted small">说明与局限</summary><ul class="small muted">
      <li>只收录原文明确写出的数字；AI 给出的每个数字都要求逐字引用原文，引用不在原文中、数字不在引用中、或期间不对（如上年同期）的一律丢弃。</li>
      <li>NVIDIA 的数据中心“计算 / 网络”拆分披露到 2026 财年第 4 季度；2027 财年起改为“超大规模云厂商 / AI 云、企业与主权”两个子市场。</li>
      <li>AMD 新闻稿只披露数据中心分部（含 CPU），Instinct GPU 收入一般只在电话会上口头给出，见“管理层表态”（来自新闻标题，可信度较低）。</li>
      <li>同比优先用原文；原文没有时用 4 个季度前的实际值计算（标注“计算”），重述过的历史数据可能与原文略有差异。</li>
      <li>季度末日期在原文找不到时按发布日前 30 天推算（表中标“约”）。</li>
    </ul></details>`;
  drawChipCompare(d, v);
  drawChipCompany(d, c);
  drawChipBeat(d, c);
  const redraw = () => { saveChipView(v); for (const id of ["c-chip-cmp", "c-chip-co", "c-chip-beat"]) disposeChart(byId(id)); renderChips(el, d, v); };
  el.querySelectorAll("#chip-view button").forEach((b) => (b.onclick = () => { v.view = b.dataset.v; redraw(); }));
  el.querySelectorAll("#chip-co button").forEach((b) => (b.onclick = () => { v.co = b.dataset.c; redraw(); }));
}

function disposeChart(node) {
  const c = node && window.echarts?.getInstanceByDom(node);
  if (!c) return;
  charts = charts.filter((x) => x !== c);
  c.dispose();
}

// 最新一季：每家公司一格（AI 相关收入、同比、下季指引、相对上季指引）
function chipLatestHtml(d) {
  return `<div class="kpis">${d.companies.map((c) => {
    const q = c.quarters[c.quarters.length - 1];
    if (!q) return "";
    const m = c.ai_metric, a = q.actual[m], g = q.guide[m] || q.guide.revenue, gm = q.guide[m] ? m : "revenue";
    return `<div class="kpi"><span class="muted">${esc(chipName(c))} · ${esc(q.label)}</span>
      <b>${a ? chipVal(d, m, a.v) : "–"}</b>
      <span class="muted small">${esc(d.metrics[m].name)}${a && isNum(a.yoy) ? `，同比 ${pct(a.yoy / 100, 0, true)}` : ""}</span>
      ${q.beat[m] !== undefined ? `<span class="small">相对上季指引 ${chipBeat(d, m, q.beat[m])}</span>` : ""}
      ${g ? `<span class="small">下季指引（${esc(d.metrics[gm].name)}）${chipRange(d, gm, g)}</span>` : ""}
      <span class="muted small">发布 ${esc(q.filed)}</span></div>`;
  }).join("")}</div>`;
}

function drawChipCompare(d, v) {
  const el = byId("c-chip-cmp");
  if (!el) return;
  const series = [];
  for (const c of d.companies) {
    const m = v.view === "revenue" ? "revenue" : c.ai_metric;
    const pts = chipSeries(c, m, v.view === "yoy" ? "yoy" : "v");
    const col = chipColor(d, c.ticker);
    series.push({ name: c.ticker, type: "line", showSymbol: true, symbolSize: 6, color: col, lineStyle: { width: 2 },
      data: pts.map((p) => ({ value: [p.x, p.v], q: p.q, m })) });
    const gp = v.view !== "yoy" && chipGuidePoint(c, m);
    if (gp && pts.length) {
      series.push({ name: c.ticker, type: "line", color: col, lineStyle: { width: 2, type: "dashed" }, symbol: "emptyCircle", symbolSize: 8,
        data: [{ value: [pts[pts.length - 1].x, pts[pts.length - 1].v], q: pts[pts.length - 1].q, m }, { value: [gp.x, gp.g.mid], guide: gp.g, q: gp.q, m }], tooltip: { show: true } });
    }
  }
  const fmt = (val) => (v.view === "yoy" ? `${Math.round(val)}%` : `$${val}B`);
  mkChart(el, {
    tooltip: { trigger: "item", formatter: (p) => chipTip(d, p) },
    legend: { data: d.companies.map((c) => c.ticker) },
    grid: { left: 56, right: 24, top: 36, bottom: 28 },
    xAxis: { type: "time" },
    yAxis: { type: "value", axisLabel: { formatter: fmt } },
    series,
  });
}

function chipTip(d, p) {
  const x = p.data, c = d.companies.find((k) => k.ticker === p.seriesName), m = x.m;
  if (x.guide) return `<b>${esc(p.seriesName)} 下季指引</b>（${esc(x.q.label)} 财报给出）<br>${esc(d.metrics[m].name)}：${chipRange(d, m, x.guide)}<div class="tip-quote">“${esc(x.guide.quote)}”</div>`;
  const a = x.q.actual[m];
  return `<b>${esc(chipName(c))} ${esc(x.q.label)}</b><span class="muted">（${x.q.approx ? "约 " : ""}${esc(x.q.period_end)} 结束，${esc(x.q.filed)} 发布）</span><br>
    ${esc(d.metrics[m].name)}：${chipVal(d, m, a.v)}${isNum(a.yoy) ? `，同比 ${pct(a.yoy / 100, 0, true)}（${esc(a.yoy_src)}）` : ""}
    ${x.q.guided[m] ? `<br>上季指引 ${chipRange(d, m, x.q.guided[m])}，实际 ${chipBeat(d, m, x.q.beat[m])}` : ""}<div class="tip-quote">“${esc(a.quote)}”</div>`;
}

function drawChipCompany(d, c) {
  const el = byId("c-chip-co");
  if (!el) return;
  const ms = c.metrics.filter((m) => d.metrics[m].unit === "usd");
  const series = [];
  ms.forEach((m, i) => {
    const pts = chipSeries(c, m);
    const col = palette()[i % palette().length];
    series.push({ name: d.metrics[m].name, type: "line", showSymbol: true, symbolSize: 6, color: col, lineStyle: { width: 2 },
      data: pts.map((p) => ({ value: [p.x, p.v], q: p.q, m, co: c.ticker })) });
    const gp = chipGuidePoint(c, m);
    if (gp && pts.length) {
      series.push({ name: d.metrics[m].name, type: "line", color: col, lineStyle: { width: 2, type: "dashed" }, symbol: "emptyCircle", symbolSize: 8,
        data: [{ value: [pts[pts.length - 1].x, pts[pts.length - 1].v], q: pts[pts.length - 1].q, m, co: c.ticker }, { value: [gp.x, gp.g.mid], guide: gp.g, q: gp.q, m, co: c.ticker }] });
    }
  });
  mkChart(el, {
    tooltip: { trigger: "item", formatter: (p) => chipTip(d, { ...p, seriesName: p.data.co }) },
    legend: { data: ms.map((m) => d.metrics[m].name), type: "scroll" },
    grid: { left: 56, right: 16, top: 40, bottom: 28 },
    xAxis: { type: "time" },
    yAxis: { type: "value", axisLabel: { formatter: (x) => `$${x}B` } },
    series,
  });
}

function drawChipBeat(d, c) {
  const el = byId("c-chip-beat");
  if (!el) return;
  const ms = ["revenue", c.ai_metric].filter((m, i, a) => a.indexOf(m) === i && c.quarters.some((q) => isNum(q.beat[m])));
  if (!ms.length) { el.innerHTML = empty("没有可对比的指引（公司未给出该指标的下季指引）"); return; }
  const qs = c.quarters.filter((q) => ms.some((m) => isNum(q.beat[m])));
  mkChart(el, {
    tooltip: { trigger: "axis", formatter: (ps) => { const q = qs[ps[0].dataIndex];
      return `<b>${esc(q.label)}</b>${ms.map((m) => (q.guided[m] ? `<br>${esc(d.metrics[m].name)}：指引 ${chipRange(d, m, q.guided[m])}，实际 ${chipVal(d, m, q.actual[m].v)}（${chipBeat(d, m, q.beat[m])}）` : "")).join("")}`; } },
    legend: { data: ms.map((m) => d.metrics[m].name), show: ms.length > 1 },
    grid: { left: 48, right: 16, top: ms.length > 1 ? 36 : 16, bottom: 28 },
    xAxis: { type: "category", data: qs.map((q) => q.label), axisLabel: { fontSize: 10 } },
    yAxis: { type: "value", axisLabel: { formatter: (x) => `${Math.round(x * 100)}%` } },
    series: ms.map((m, i) => ({ name: d.metrics[m].name, type: "bar", barMaxWidth: 14, color: palette()[i],
      itemStyle: { borderRadius: [4, 4, 0, 0] }, data: qs.map((q) => (isNum(q.beat[m]) ? q.beat[m] : null)) })),
  });
}

function chipCell(d, q, m) {
  const a = q.actual[m];
  if (!a) return `<td class="num muted">–</td>`;
  return `<td class="num" title="${esc(a.quote)}">${chipVal(d, m, a.v)}${isNum(a.yoy) ? `<br><span class="muted small">${pct(a.yoy / 100, 0, true)}${a.yoy_src === "计算" ? "*" : ""}</span>` : ""}</td>`;
}

function chipTableHtml(d, c) {
  const ms = c.metrics;
  const gms = ms.filter((m) => c.quarters.some((q) => q.guide[m]));
  const rows = [...c.quarters].reverse().map((q) => `<tr><td><a href="${esc(q.url)}" target="_blank" rel="noopener">${esc(q.label)}</a><br><span class="muted small">${esc(q.filed)} 发布</span></td>
    ${ms.map((m) => chipCell(d, q, m)).join("")}
    <td class="small">${Object.keys(q.beat).map((m) => `${esc(d.metrics[m].name)} ${chipBeat(d, m, q.beat[m])}`).join("<br>") || "–"}</td>
    <td class="small">${gms.filter((m) => q.guide[m]).map((m) => `<span title="${esc(q.guide[m].quote)}">${esc(d.metrics[m].name)} ${chipRange(d, m, q.guide[m])}</span>`).join("<br>") || "–"}</td></tr>`).join("");
  return `<div class="table-wrap"><table><thead><tr><th>财季</th>${ms.map((m) => `<th class="num">${esc(d.metrics[m].name)}</th>`).join("")}<th>相对上季指引</th><th>本次给出的下季指引</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <p class="muted small">单元格下方为同比（* = 按 4 个季度前的实际值计算，其余为原文）；悬停数字可看原文引用；点击财季打开 SEC 申报。</p>`;
}

function chipAnnualHtml(d, c) {
  if (!c.annual.length) return "";
  return `<h4>全年指引</h4><ul class="small">${c.annual.map((a) => `<li>FY${String(a.fy).slice(2)} ${esc(d.metrics[a.metric].name)}：<b>${chipRange(d, a.metric, a)}</b>
    <span class="muted">（${esc(a.filed)} 发布）</span> <a href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.quote)}">原文</a></li>`).join("")}</ul>`;
}

function chipStatementsHtml(d, c) {
  const xs = d.statements.filter((s) => s.ticker === c.ticker).sort((a, b) => b.earnings.localeCompare(a.earnings));
  return `<h4>管理层表态（财报前后新闻标题）${badge("model")}</h4>
    ${xs.length ? `<div class="table-wrap"><table><thead><tr><th>财报</th><th>类型</th><th>期间</th><th class="num">金额</th><th>说明</th><th>来源</th></tr></thead><tbody>
    ${xs.map((s) => `<tr><td class="small">${esc(s.earnings)}</td><td class="small">${esc(CHIP_KIND[s.kind] || s.kind)}</td><td class="small">${esc(s.period)}</td>
      <td class="num">$${num(s.low, 1)}${s.high !== s.low ? `–${num(s.high, 1)}` : ""}B</td><td class="wrap small">${esc(s.text)}</td><td class="small">${srcLinks(s.sources)}</td></tr>`).join("")}
    </tbody></table></div>` : empty("没有提取到带金额的管理层表态")}
    <p class="muted small">来自财报发布后几天的新闻标题（Google News），金额须出现在标题中；是媒体对电话会的转述，可信度低于新闻稿原文。</p>`;
}
