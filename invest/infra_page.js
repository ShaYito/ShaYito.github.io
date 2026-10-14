/* AI 基础设施（M61 第一步：财务）：大公司与新型云厂商的资本支出（含融资租赁）、资本支出强度、
   花钱与赚钱（资本支出增速 vs 云业务收入增速、折旧增速 vs 收入增速）、未履约合同与债务、资本支出指引（AI 从新闻标题提取）、
   需求方（OpenAI / Anthropic）的算力合同。
   数据：ai_infra.json（建站时由 SEC companyfacts + segments.json + web_data/ai_infra_guidance.json 生成）、private_cos.json */

const IF_ROLE = { hyperscaler: "大型云 / 平台", neocloud: "新型云（GPU 云）" };
const IF_KIND = { capex_guide: "资本支出指引", backlog: "积压订单 / 未履约合同", ai_revenue: "AI 收入" };
const IF_DIR = { raise: "上调", cut: "下调", maintain: "维持", initial: "首次给出", unknown: "" };
const IF_DEAL_KINDS = new Set(["cloud", "compute", "datacenter"]);
const ifB = (v, d = 1) => (isNum(v) ? `${v < 0 ? "−" : ""}$${num(Math.abs(v) / 1e9, Math.abs(v) >= 1e11 ? 0 : d)}B` : "–");
const ifLast = (arr) => { for (let i = (arr || []).length - 1; i >= 0; i--) if (isNum(arr[i])) return [arr[i], i]; return [null, -1]; };
const ifColor = (i) => palette()[i % palette().length];
let IF_DATA = null;
async function ifData() {
  if (!IF_DATA) IF_DATA = await load("ai_infra.json").catch(() => null);
  return IF_DATA?.companies?.length ? IF_DATA : null;
}

const IF_HOWTO = [
  "这一页看大公司在 AI 基础设施上花了多少钱、钱从哪来、有没有换回收入。数字来自 SEC 季度财报（10-Q / 10-K 的 XBRL 数据，用最新报告的数值，含重述），每天更新。",
  "资本支出 = 现金购买的固定资产（服务器、数据中心建筑与设备）+ 新增融资租赁资产。微软、甲骨文有大量数据中心以融资租赁方式取得，不计入现金资本支出，只看现金部分会低估。经营租赁（如租用的数据中心）另列，不计入。",
  "各公司财年不同，图上按季度末所在的日历季度对齐（如甲骨文截至 8 月 31 日的季度算作第三季度）。“近 4 季”= 最近 4 个季度合计，同比 = 与一年前的近 4 季合计相比。",
  "资本支出指引、积压订单、AI 收入是 AI 从财报前后的新闻标题中提取的：每条都附原标题，金额必须出现在标题中，但 AI 仍可能把期间或口径弄错，以原文为准。",
];

PAGES.infra = async () => {
  const d = await ifData();
  if (!d) { app().innerHTML = `<h2>AI 基础设施</h2>${card("AI 基础设施", empty("数据尚未生成"))}`; return; }
  const pv = await load("private_cos.json").catch(() => null);
  const cos = d.companies;
  app().innerHTML = `<h2>AI 基础设施 <span class="muted">${cos.length} 家公司 + 需求方 · SEC 数据截至 ${esc(d.asof)}</span></h2>
    ${howto(IF_HOWTO)}
    <section class="card" id="if-sum"><h3>一览 ${badge("fact")}${badge("derived")}</h3>${ifSummary(d)}</section>
    <section class="card"><h3>资本支出（含融资租赁） ${badge("fact")}</h3>
      <div class="row"><div class="seg" id="if-capex-mode"><button type="button" data-m="q" class="on">每季</button><button type="button" data-m="ttm">近 4 季合计</button></div></div>
      ${chartDiv("c-if-capex", "tall")}
      <p class="muted small">按日历季度堆叠；悬停看每家的现金资本支出与新增融资租赁。甲骨文财年比其他公司早一个月结束，最近一个季度常常只有它已公布（悬停可见“已公布几家”）。新型云厂商的数字较小，在下方强度图中更容易比较。</p></section>
    <section class="card"><h3>资本支出强度 ${badge("derived")}</h3>
      <div class="row"><div class="seg" id="if-int-mode"><button type="button" data-m="capex_to_ocf" class="on">÷ 经营现金流</button><button type="button" data-m="capex_to_rev">÷ 收入</button><button type="button" data-m="fcf_ttm">近 4 季 FCF</button></div></div>
      ${chartDiv("c-if-int")}
      <p class="muted small" id="if-int-note"></p></section>
    <section class="card"><h3>花钱与赚钱 ${badge("derived")}</h3>
      ${chartDiv("c-if-ret", "tall")}
      <p class="muted small">横轴 = 资本支出（近 4 季合计）同比，纵轴 = 云业务收入（单季）同比；每家公司画最近 8 个季度的轨迹，大圆点是最新一季。落在对角线右下方 = 花钱增速快于云收入增速。Meta 没有对外出售的云业务，不在图中。云业务口径：微软“服务器与云”、谷歌 Google Cloud、亚马逊 AWS、甲骨文 OCI、Nebius AI 云（年度）、CoreWeave 公司总收入。</p>
      ${chartDiv("c-if-dna")}
      <p class="muted small">折旧（近 4 季合计）同比 vs 收入（近 4 季合计）同比：资本支出会在之后几年变成折旧；折旧增速持续高于收入增速，利润率就会被压低。微软 2025 财年起才在 XBRL 中单独标注折旧，同比要再等几个季度。</p></section>
    <section class="card"><h3>未履约合同、资产与债务 ${badge("fact")}</h3>
      <div class="row"><div class="seg" id="if-bs-mode"><button type="button" data-m="rpo" class="on">未履约合同余额</button><button type="button" data-m="ppe">固定资产净值</button><button type="button" data-m="debt">债务（不含租赁）</button><button type="button" data-m="fin_lease_liab">融资租赁负债</button><button type="button" data-m="op_lease_liab">经营租赁负债</button></div></div>
      ${chartDiv("c-if-bs")}
      <p class="muted small" id="if-bs-note"></p></section>
    <section class="card" id="if-guide"><h3>资本支出指引、积压订单与 AI 收入 ${badge("fact")}${badge("model")}</h3>${ifGuideHtml(d, cos)}</section>
    <section class="card"><h3>需求方：OpenAI / Anthropic 的算力合同 ${badge("fact")}</h3>${ifDemandHtml(d, pv, cos)}</section>
    <section class="card"><h3>说明与局限</h3><ul>${ifNotes(cos).map((x) => `<li>${x}</li>`).join("")}</ul></section>`;
  drawIfCapex(cos, "q");
  segBind("if-capex-mode", (m) => drawIfCapex(cos, m));
  drawIfIntensity(cos, "capex_to_ocf");
  segBind("if-int-mode", (m) => drawIfIntensity(cos, m));
  drawIfReturn(cos); drawIfDna(cos);
  drawIfBs(cos, "rpo"); drawIfGuide(d, cos);
  segBind("if-bs-mode", (m) => drawIfBs(cos, m));
};
function segBind(id, fn) {
  document.querySelectorAll(`#${id} button`).forEach((b) => (b.onclick = () => {
    document.querySelectorAll(`#${id} button`).forEach((x) => x.classList.toggle("on", x === b));
    fn(b.dataset.m);
  }));
}
function ifAxis(cos) { return [...new Set(cos.flatMap((c) => c.cq))].sort(); }
function ifOn(c, axis, key) { const m = Object.fromEntries(c.cq.map((q, i) => [q, c.series[key]?.[i]])); return axis.map((q) => m[q] ?? null); }
function ifLatestGuide(d, t) {
  return [...(d.guidance || [])].filter((x) => x.ticker === t && x.kind === "capex_guide").sort((a, b) => a.earnings.localeCompare(b.earnings)).at(-1);
}
const ifAmt = (v) => num(v, v < 10 ? 1 : 0);
const ifRange = (x) => (x.upto ? `最多 $${ifAmt(x.high)}B` : x.low === x.high ? `$${ifAmt(x.low)}B` : `$${ifAmt(x.low)}–${ifAmt(x.high)}B`);

function ifSummary(d) {
  const rows = d.companies.map((c) => {
    const s = c.series, [cap, i] = ifLast(s.capex_total_ttm), g = ifLatestGuide(d, c.ticker);
    const v = (k) => (i >= 0 ? s[k]?.[i] : null);
    const [rpo, ri] = ifLast(s.rpo);
    return `<tr><td><a href="#/stock/${esc(c.ticker)}"><b>${esc(c.ticker)}</b></a> <span class="muted">${esc(c.name)}</span><div class="muted small">${IF_ROLE[c.role]}</div></td>
      <td>${esc(c.cq[i] || "–")}</td><td class="num"><b>${ifB(cap)}</b></td><td class="num ${cls(v("capex_ttm_yoy"))}">${pct(v("capex_ttm_yoy"), 0, true)}</td>
      <td class="num">${pct(v("capex_to_ocf"), 0)}</td><td class="num ${cls(v("fcf_ttm"))}">${ifB(v("fcf_ttm"))}</td>
      <td class="num">${isNum(rpo) ? `${ifB(rpo, 0)}<div class="muted small">${esc(c.cq[ri])}</div>` : "–"}</td>
      <td class="num ${cls(ifLast(s.cloud_rev_yoy)[0])}">${pct(ifLast(s.cloud_rev_yoy)[0], 0, true)}</td>
      <td class="small">${g ? `${esc(g.period)} ${ifRange(g)}${IF_DIR[g.direction] ? `（${IF_DIR[g.direction]}）` : ""}<div class="muted">${esc(g.earnings)} 财报</div>` : "–"}</td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table><thead><tr><th>公司</th><th>最新季度</th><th class="num">资本支出（近 4 季）</th><th class="num">同比</th><th class="num">÷ 经营现金流</th><th class="num">FCF（近 4 季）</th><th class="num">未履约合同</th><th class="num">云业务收入同比</th><th>最新资本支出指引</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted small">FCF = 经营现金流 − 现金资本支出 − 融资租赁本金偿还（与亚马逊自己披露的口径相近）。资本支出 ÷ 经营现金流超过 100% = 赚的现金不够投资，差额靠现金储备或借款。</p>`;
}
function drawIfCapex(cos, mode) {
  const el = byId("c-if-capex");
  if (!el) return;
  const axis = ifAxis(cos), key = mode === "ttm" ? "capex_total_ttm" : "capex_total";
  const series = cos.map((c, k) => ({ name: c.ticker, type: "bar", stack: "capex", data: ifOn(c, axis, key), color: ifColor(k), emphasis: { focus: "series" } }));
  echarts.getInstanceByDom(el)?.dispose();
  mkChart(el, { legend: { top: 0 }, grid: { left: 60, right: 20, top: 36, bottom: 30 }, xAxis: { type: "category", data: axis },
    yAxis: { type: "value", axisLabel: { formatter: (x) => `$${x / 1e9}B` } }, series,
    tooltip: { trigger: "axis", formatter: (ps) => {
      const i = ps[0].dataIndex, q = axis[i];
      let tot = 0, n = 0;
      const rows = cos.map((c) => {
        const j = c.cq.indexOf(q);
        if (j < 0) return "";
        const v = c.series[key][j];
        if (isNum(v)) { tot += v; n++; }
        const extra = mode === "q" ? `（现金 ${ifB(c.series.capex[j])}${isNum(c.series.fin_lease_new[j]) ? ` + 融资租赁 ${ifB(c.series.fin_lease_new[j])}` : ""}；${esc(c.periods[j])}）` : `（${esc(c.periods[j])} 为止）`;
        return `${esc(c.ticker)} <b>${ifB(v)}</b> <span class="muted">${extra}</span><br>`;
      }).join("");
      return `${esc(q)} 合计 <b>${ifB(tot, 0)}</b>${n < cos.length ? `<span class="muted">（已公布 ${n} / ${cos.length} 家）</span>` : ""}<br>${rows}`;
    } } });
}
function drawIfIntensity(cos, key) {
  const el = byId("c-if-int");
  if (!el) return;
  const axis = ifAxis(cos), money = key === "fcf_ttm";
  echarts.getInstanceByDom(el)?.dispose();
  mkChart(el, { legend: { top: 0 }, grid: { left: 60, right: 44, top: 36, bottom: 30 }, xAxis: { type: "category", data: axis },
    yAxis: { type: "value", axisLabel: { formatter: (x) => (money ? `$${x / 1e9}B` : `${Math.round(x * 100)}%`) }, max: money ? undefined : (e) => Math.min(e.max, 3) },
    series: cos.map((c, k) => ({ name: c.ticker, type: "line", data: ifOn(c, axis, key), color: ifColor(k), showSymbol: false, connectNulls: false,
      lineStyle: { width: c.role === "neocloud" ? 1.4 : 2.2, type: c.role === "neocloud" ? "dashed" : "solid" },
      markLine: k === 0 && !money ? { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" }, label: { formatter: "100%", color: css("--muted") }, data: [{ yAxis: 1 }] } : undefined })),
    tooltip: { trigger: "axis", valueFormatter: (x) => (money ? ifB(x) : pct(x, 0)) } });
  byId("if-int-note").textContent = { capex_to_ocf: "资本支出（含融资租赁，近 4 季）÷ 经营现金流（近 4 季）。虚线 = 新型云厂商。纵轴最高显示 300%（CoreWeave 早期远高于此，悬停可看真实值）。",
    capex_to_rev: "资本支出（含融资租赁，近 4 季）÷ 收入（近 4 季）：每 1 美元收入投入多少资本支出。", fcf_ttm: "近 4 季 FCF（经营现金流 − 现金资本支出 − 融资租赁本金）。" }[key];
}
function drawIfReturn(cos) {
  const el = byId("c-if-ret");
  if (!el) return;
  const series = [];
  cos.forEach((c, k) => {
    const pts = c.cq.map((q, i) => [c.series.capex_ttm_yoy[i], c.series.cloud_rev_yoy[i], q]).filter((p) => isNum(p[0]) && isNum(p[1])).slice(-8);
    if (!pts.length) return;
    series.push({ name: c.ticker, type: "line", data: pts, color: ifColor(k), symbolSize: (v, p) => (p.dataIndex === pts.length - 1 ? 12 : 5), lineStyle: { width: 1.5, opacity: 0.7 },
      label: { show: true, formatter: (p) => (p.dataIndex === pts.length - 1 ? c.ticker : ""), position: "right" } });
  });
  const all = series.flatMap((s) => s.data.flatMap((p) => [p[0], p[1]]));
  const hi = Math.min(Math.max(1, ...all) * 1.05, 3), lo = Math.min(0, ...all);
  series.push({ name: "对角线", type: "line", data: [[lo, lo], [hi, hi]], showSymbol: false, silent: true, lineStyle: { color: css("--axis"), type: "dashed", width: 1 }, tooltip: { show: false } });
  mkChart(el, { legend: { top: 0, data: series.filter((s) => s.name !== "对角线").map((s) => s.name) }, grid: { left: 60, right: 60, top: 36, bottom: 40 },
    xAxis: { type: "value", name: "资本支出同比", nameLocation: "middle", nameGap: 26, min: lo, max: hi, axisLabel: { formatter: (x) => `${Math.round(x * 100)}%` } },
    yAxis: { type: "value", name: "云收入同比", min: lo, max: hi, axisLabel: { formatter: (x) => `${Math.round(x * 100)}%` } }, series,
    tooltip: { trigger: "item", formatter: (p) => `${esc(p.seriesName)} ${esc(p.data[2])}<br>资本支出同比 <b>${pct(p.data[0], 0, true)}</b><br>云业务收入同比 <b>${pct(p.data[1], 0, true)}</b>` } });
}
function drawIfDna(cos) {
  const el = byId("c-if-dna");
  if (!el) return;
  const list = cos.filter((c) => isNum(ifLast(c.series.dna_ttm_yoy)[0]));
  const names = list.map((c) => c.ticker);
  mkChart(el, { legend: { top: 0 }, grid: { left: 60, right: 20, top: 36, bottom: 30 }, xAxis: { type: "category", data: names },
    yAxis: { type: "value", axisLabel: { formatter: (x) => `${Math.round(x * 100)}%` } },
    series: [{ name: "折旧同比", type: "bar", data: list.map((c) => ifLast(c.series.dna_ttm_yoy)[0]), color: palette()[1] },
      { name: "收入同比", type: "bar", data: list.map((c) => ifLast(c.series.revenue_ttm_yoy)[0]), color: palette()[0] }],
    tooltip: { trigger: "axis", valueFormatter: (x) => pct(x, 0, true) } });
}
function drawIfBs(cos, key) {
  const el = byId("c-if-bs");
  if (!el) return;
  const axis = ifAxis(cos), list = cos.filter((c) => (c.series[key] || []).some(isNum));
  echarts.getInstanceByDom(el)?.dispose();
  mkChart(el, { legend: { top: 0 }, grid: { left: 60, right: 20, top: 36, bottom: 30 }, xAxis: { type: "category", data: axis },
    yAxis: { type: "value", axisLabel: { formatter: (x) => `$${x / 1e9}B` } },
    series: list.map((c) => ({ name: c.ticker, type: "line", data: ifOn(c, axis, key), color: ifColor(cos.indexOf(c)), connectNulls: true, symbolSize: 4,
      lineStyle: { width: c.role === "neocloud" ? 1.4 : 2.2, type: c.role === "neocloud" ? "dashed" : "solid" } })),
    tooltip: { trigger: "axis", valueFormatter: (x) => ifB(x) } });
  const missing = cos.filter((c) => !list.includes(c)).map((c) => c.ticker);
  byId("if-bs-note").textContent = ({
    rpo: "未履约合同余额（RPO）：已签合同中尚未确认为收入的部分，是需求最硬的证据之一。微软、甲骨文的数字包含 OpenAI 的大额合同；亚马逊（AWS 积压订单只在新闻稿中披露）与 Meta 没有这项数据。",
    ppe: "固定资产净值（谷歌、CoreWeave 为含融资租赁资产的口径）。",
    debt: "长期债务（含一年内到期部分，不含租赁负债）。",
    fin_lease_liab: "融资租赁负债。", op_lease_liab: "经营租赁负债（租用的数据中心等）。",
  }[key] || "") + (missing.length ? ` 没有数据：${missing.join("、")}。` : "") + "NBIS 只有年度数据。";
}
function ifGuideHtml(d, cos) {
  const items = [...(d.guidance || [])];
  if (!items.length) return empty("尚未提取（run_ai_infra.py 每天运行）");
  const order = Object.fromEntries(cos.map((c, i) => [c.ticker, i]));
  items.sort((a, b) => (order[a.ticker] ?? 99) - (order[b.ticker] ?? 99) || b.earnings.localeCompare(a.earnings));
  const rows = items.map((x) => `<tr><td><b>${esc(x.ticker)}</b></td><td>${esc(x.earnings)}</td><td>${IF_KIND[x.kind]}</td><td>${esc(x.period)}</td>
    <td class="num"><b>${ifRange(x)}</b></td><td>${IF_DIR[x.direction] || ""}</td><td class="wrap small">${esc(x.text)}<div class="muted">${x.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">${esc(s.publisher || "来源")}</a>`).join(" · ")}</div></td></tr>`).join("");
  return `${chartDiv("c-if-guide")}<p class="muted small">资本支出指引的变化：每条线是一家公司对某一年的指引（区间画中点，竖线为区间），横轴是给出指引的财报日期。</p>
    <p class="muted small">AI 从每次财报前后 ${esc("7")} 天左右的新闻标题中提取，金额必须出现在引用的标题中；悬停来源可看原标题。指引是公司对未来期间的预期，后续财报常被上调或下调。提取日期：${esc(d.guidance_asof || "–")}。</p>
    <div class="table-wrap"><table><thead><tr><th>公司</th><th>财报日期</th><th>类型</th><th>期间</th><th class="num">金额</th><th>变化</th><th>说明与来源</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function drawIfGuide(d, cos) {
  const el = byId("c-if-guide");
  if (!el) return;
  const groups = {};
  (d.guidance || []).filter((x) => x.kind === "capex_guide").forEach((x) => {
    const yr = (x.period.match(/20\d\d/) || [""])[0];
    if (!yr) return;
    const fy = /财年/.test(x.period) && !["GOOGL", "AMZN", "META", "CRWV", "NBIS"].includes(x.ticker) ? " 财年" : "";
    (groups[`${x.ticker} ${yr}${fy}`] ||= []).push(x);
  });
  const keys = Object.keys(groups).sort();
  if (!keys.length) { el.remove(); return; }
  const order = Object.fromEntries(cos.map((c, i) => [c.ticker, i]));
  const series = keys.flatMap((k) => {
    const xs = groups[k].sort((a, b) => a.earnings.localeCompare(b.earnings)), t = k.split(" ")[0], color = ifColor(order[t] ?? 0);
    return [{ name: k, type: "line", data: xs.map((x) => [x.earnings, (x.low + x.high) / 2, x]), color, symbolSize: 7, lineStyle: { width: 1.6 },
      label: { show: true, position: "right", formatter: (p) => (p.dataIndex === xs.length - 1 ? k : ""), fontSize: 10, color: css("--muted") } },
    { name: k, type: "custom", data: xs.filter((x) => x.high > x.low).map((x) => [x.earnings, x.low, x.high]), silent: true, tooltip: { show: false },
      renderItem: (p, api) => { const a = api.coord([api.value(0), api.value(1)]), b = api.coord([api.value(0), api.value(2)]);
        return { type: "line", shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style: { stroke: color, lineWidth: 2 } }; } }];
  });
  mkChart(el, { legend: { show: false }, grid: { left: 60, right: 110, top: 20, bottom: 30 }, xAxis: { type: "time" },
    yAxis: { type: "value", scale: true, axisLabel: { formatter: (x) => `$${x}B` } }, series,
    tooltip: { trigger: "item", formatter: (p) => { const x = p.data[2]; return x ? `${esc(p.seriesName)}<br>${esc(x.earnings)} 财报：<b>${ifRange(x)}</b>${IF_DIR[x.direction] ? `（${IF_DIR[x.direction]}）` : ""}<br>${esc(x.text)}` : ""; } } });
}
function ifDemandHtml(d, pv, cos) {
  const tick = new Set(cos.map((c) => c.ticker));
  const dem = (pv?.companies || []).filter((c) => (d.demand || []).includes(c.id));
  if (!dem.length) return empty("未上市公司数据不可用");
  // 云 / 算力 / 数据中心合同；芯片合同只算本页公司提供的（如谷歌 TPU、亚马逊 Trainium，实际以云算力形式交付）
  const deals = dem.flatMap((c) => (c.deals || []).filter((x) => x.ticker && (IF_DEAL_KINDS.has(x.kind) || (x.kind === "chip" && tick.has(x.ticker)))).map((x) => ({ ...x, co: c })));
  const prov = [...new Set(deals.map((x) => x.ticker))].sort((a, b) => (tick.has(b) - tick.has(a)) || a.localeCompare(b));
  const cell = (t, c) => {
    const xs = deals.filter((x) => x.ticker === t && x.co.id === c.id);
    return `<td class="wrap small">${xs.map((x) => `${esc(x.date.slice(0, 7))} ${isNum(x.amount_b) ? `<b>$${num(x.amount_b, x.amount_b < 10 ? 1 : 0)}B</b>` : "金额未披露"}${x.term ? `<span class="muted">（${esc(x.term)}）</span>` : ""} <a href="${esc(x.url)}" target="_blank" rel="noopener">来源</a>${x.basis === "reported" ? ' <span class="muted">据报道</span>' : ""}`).join("<br>")}</td>`;
  };
  const rpo = (t) => { const c = cos.find((x) => x.ticker === t); const [v, i] = c ? ifLast(c.series.rpo) : [null, -1]; return isNum(v) ? `${ifB(v, 0)}<div class="muted small">${esc(c.cq[i])}</div>` : "–"; };
  return `<p class="muted small">云 / 算力 / 数据中心类合同，来自未上市公司页面的人工整理（每条附来源，金额多为合同上限或媒体报道值）。右侧是该公司最新的未履约合同余额，可以对照合同规模。向芯片公司（英伟达、AMD、博通等）的采购见 <a href="#/private">未上市公司</a> 页面。</p>
    <div class="table-wrap"><table><thead><tr><th>供应方</th>${dem.map((c) => `<th><a href="#/private/${esc(c.id)}">${esc(c.name)}</a></th>`).join("")}<th class="num">未履约合同</th></tr></thead><tbody>
    ${prov.map((t) => `<tr><td>${tick.has(t) ? `<a href="#/stock/${esc(t)}"><b>${esc(t)}</b></a>` : `<b>${esc(t)}</b>`}</td>${dem.map((c) => cell(t, c)).join("")}<td class="num">${rpo(t)}</td></tr>`).join("")}</tbody></table></div>`;
}
function ifNotes(cos) {
  const out = cos.flatMap((c) => (c.notes || []).map((n) => `<b>${esc(c.ticker)}</b>：${esc(n)}`));
  return [...out,
    "数据用各公司最新报告的数值（含重述）；季度值缺失时由累计值相减推出（如第四季度 = 全年 − 前三季）。",
    "云业务收入用各公司分业务披露（见个股页“分业务收入”），微软“服务器与云”包含 Azure 以外的服务器产品；营业利润分部的口径更宽（如微软“智能云”、甲骨文“云与软件”）。",
    "第二步（项目地图、电力合同）与第三步（供应商关系网络）尚未完成。"];
}

// 个股页卡片：这几家公司显示 AI 基础设施的关键数字
async function fillInfraCard(t) {
  const el = byId("infra-card");
  if (!el) return;
  const d = await ifData();
  const c = d?.companies.find((x) => x.ticker === t);
  if (!c) return;
  const s = c.series, [cap, i] = ifLast(s.capex_total_ttm), v = (k) => (i >= 0 ? s[k]?.[i] : null), g = ifLatestGuide(d, t);
  const [rpo, ri] = ifLast(s.rpo);
  el.hidden = false;
  el.innerHTML = `<h3>AI 基础设施 ${badge("fact")}${badge("derived")}</h3>
    <p>截至 ${esc(c.periods[i] || "–")}：近 4 季资本支出（含融资租赁）<b>${ifB(cap)}</b>（同比 <span class="${cls(v("capex_ttm_yoy"))}">${pct(v("capex_ttm_yoy"), 0, true)}</span>），
    占经营现金流 <b>${pct(v("capex_to_ocf"), 0)}</b>，近 4 季 FCF <b class="${cls(v("fcf_ttm"))}">${ifB(v("fcf_ttm"))}</b>${isNum(rpo) ? `；未履约合同 <b>${ifB(rpo, 0)}</b>（${esc(c.cq[ri])}）` : ""}${isNum(ifLast(s.cloud_rev_yoy)[0]) ? `；云业务收入同比 <b>${pct(ifLast(s.cloud_rev_yoy)[0], 0, true)}</b>` : ""}。</p>
    ${g ? `<p>最新资本支出指引（${esc(g.earnings)} 财报）：${esc(g.period)} <b>${ifRange(g)}</b>${IF_DIR[g.direction] ? `，${IF_DIR[g.direction]}` : ""}。<span class="muted small">AI 从新闻标题提取</span></p>` : ""}
    <p><a href="#/infra">查看 AI 基础设施页面（与其他公司对比）→</a></p>`;
}
