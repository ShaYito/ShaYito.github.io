/* 基建 → 按技术（M61c）：“技术”页面的各项技术 × 大公司 × 四个维度（支出 / 需求 / 变现 / 资金投入）。
   数据：infra_tech.json（建站时由 web/infra_tech.py 汇总：SEC、人工整理、产业链图谱、电力合同库、新闻提取）。
   排序原则：置信度高（SEC、人工整理、已审核的图谱）在前，新闻提取在后，待审核的最后。 */

const IT_DIM = { spend: "支出", demand: "需求", monetize: "变现", fund: "资金投入" };
const IT_DIM_TIP = { spend: "向对手方采购 / 签约（买芯片、光纤、算力、电力）", demand: "需要的数量（GPU 数、GW、订单量）",
  monetize: "靠这项技术获得的收入（对外出售自研芯片、出租算力、云收入）", fund: "对该领域公司的投资、入股、资助" };
const IT_SRC = { sec: ["SEC", "SEC 财报（结构化数据）"], curated: ["人工", "人工整理（未上市公司页面，附来源）"], graph: ["图谱", "产业链图谱中已审核的供应关系"],
  db: ["电力库", "第二步的电力合同 / 项目库（AI 提取，数字已核对标题）"], news: ["新闻", "本页从新闻标题提取（数字已核对标题）"] };
const IT_MONETIZE = new Set(["accel", "compute_cloud"]); // 只有这两项技术谈得上“变现”
let IT_DATA = null;
async function itData() {
  if (!IT_DATA) IT_DATA = await load("infra_tech.json").catch(() => null);
  return IT_DATA?.cells ? IT_DATA : null;
}
const itWho = (d, k) => d.companies.find((c) => c.key === k)?.name || k;
const itAmt = (x) => [isNum(x.amount_b) ? `<b>$${num(x.amount_b, x.amount_b < 10 ? 1 : 0)}B</b>` : "", isNum(x.quantity) ? `<b>${x.unit === "MW" ? ifMw(x.quantity) : `${x.quantity.toLocaleString("en-US")} ${esc(x.unit || "")}`}</b>` : "",
  isNum(x.share_pct) ? `占对方收入 <b>${num(x.share_pct, 0)}%</b>` : ""].filter(Boolean).join(" · ");
const itTk = (t) => (t && META.universe.some((u) => u.ticker === t) ? `<a href="#/stock/${esc(t)}">${esc(t)}</a>` : esc(t || ""));

const IT_HOWTO = [
  "按“技术”页面的各项技术，看每家公司在这项技术上的四件事：支出（向谁买、花多少）、需求（要多少）、变现（靠它赚多少，只适用于加速芯片与算力云）、资金投入（投资了谁）。",
  "来源按置信度排列：SEC 财报 → 人工整理 → 产业链图谱 → 电力合同库 → 新闻提取。新闻提取的金额、数量、占比都必须出现在标题中；有 2 家以上媒体报道的自动通过，其余标“待审核”，可点按钮处理。",
  "“供应商大客户占比”来自供应商 10-K / 10-Q 的结构化数据：客户在申报中是匿名的（客户 A、经销商 B），身份只在新闻报道了相同比例时标“据报道为 …”。",
  "热力图的数字 = 已通过的证据条数（括号内为可加总的支出金额）。证据多不代表花钱多：大额合同常常只有一条报道。",
];

PAGES["infra-tech"] = async (r) => {
  const d = await itData();
  if (!d) { app().innerHTML = `<h2>基建 · 按技术</h2>${card("按技术", empty("数据尚未生成"))}`; return; }
  const tech = d.techs.find((t) => t.id === r.query.t) || d.techs[0];
  const co = d.companies.find((c) => c.key === r.query.c)?.key || null;
  app().innerHTML = `<h2>基建 · 按技术 <span class="muted">${d.techs.length} 项技术 × ${d.companies.length} 家公司 · 截至 ${esc(d.asof)}</span></h2>
    ${howto(IT_HOWTO)}
    <section class="card"><h3>技术 × 公司 ${badge("fact")}${badge("model")}</h3>${chartDiv("c-it-heat", "tall")}
      <p class="muted small">点击格子查看这家公司在这项技术上的明细；点击左侧技术名查看整项技术。格子数字 = 已通过的证据条数，下方为可加总的支出金额，括号 = 只有待审核的记录。“变现”只适用于加速芯片与算力云。</p></section>
    <div class="row seg" id="it-tech">${d.techs.map((t) => `<a class="${t.id === tech.id ? "on" : ""}" href="#/infra-tech?t=${t.id}">${esc(t.name)}</a>`).join("")}</div>
    <section class="card" id="it-panel">${itPanel(d, tech, co)}</section>
    <section class="card"><h3>资金流向：公司 → 供应商 / 被投资方 ${badge("fact")}${badge("model")}</h3>
      <div class="row"><label><input type="checkbox" id="it-net-all"> 显示全部技术（默认只显示上方选中的技术）</label></div>
      ${chartDiv("c-it-net", "tall")}<p class="muted small">粗细 = 已通过的证据条数；颜色 = 维度（支出 / 资金投入 / 变现）。只画已通过的记录。</p></section>`;
  drawItHeat(d, tech, co);
  drawItNet(d, tech, false);
  byId("it-net-all").onchange = (e) => drawItNet(d, tech, e.target.checked);
  drawItConc(d, tech);
  ifBindReview();
};
function itCellScore(c) { return c ? c.n : 0; }
function drawItHeat(d, tech, co) {
  const el = byId("c-it-heat");
  if (!el) return;
  const xs = d.companies.map((c) => c.key), ys = d.techs.map((t) => t.id);
  const data = [];
  ys.forEach((t, j) => xs.forEach((c, i) => { const cell = d.cells[t]?.[c]; data.push([i, j, itCellScore(cell), cell?.spend_b || 0, cell?.n_cand || 0]); }));
  const max = Math.max(1, ...data.map((x) => x[2]));
  const ch = mkChart(el, { grid: { left: 120, right: 20, top: 30, bottom: 40 },
    xAxis: { type: "category", data: xs.map((k) => itWho(d, k)), position: "top", axisLabel: { interval: 0 } },
    yAxis: { type: "category", data: d.techs.map((t) => t.name), inverse: true, triggerEvent: true, axisLabel: { color: (v) => (v === tech.name ? css("--ink") : css("--muted")), fontWeight: (v) => (v === tech.name ? 600 : 400) } },
    visualMap: { show: false, min: 0, max, inRange: { color: [css("--chip") || "#eee", "#2a78d6"] } },
    series: [{ type: "heatmap", data, label: { show: true, formatter: (p) => (p.data[2] ? `${p.data[2]}${p.data[3] ? `\n$${num(p.data[3], 0)}B` : ""}` : p.data[4] ? `(${p.data[4]})` : ""), fontSize: 10 },
      itemStyle: { borderColor: css("--page"), borderWidth: 2 }, emphasis: { itemStyle: { borderColor: css("--ink") } } }],
    tooltip: { formatter: (p) => { const t = d.techs[p.data[1]], k = xs[p.data[0]], c = d.cells[t.id]?.[k];
      return `${esc(t.name)} × ${esc(itWho(d, k))}<br>已通过 ${p.data[2]} 条${p.data[4] ? `，待审核 ${p.data[4]} 条` : ""}${p.data[3] ? `<br>可加总支出 $${num(p.data[3], 1)}B` : ""}<br>${Object.keys(IT_DIM).map((m) => `${IT_DIM[m]} ${(c?.[m] || []).length}`).join(" · ")}`; } } });
  ch?.on("click", (p) => {
    if (p.componentType === "yAxis") { const t = d.techs.find((x) => x.name === p.value); if (t) location.hash = `#/infra-tech?t=${t.id}`; return; }
    if (p.data) location.hash = `#/infra-tech?t=${d.techs[p.data[1]].id}&c=${xs[p.data[0]]}`;
  });
}
function itItem(x) {
  const [badgeTxt, tip] = IT_SRC[x.src];
  const ev = (x.evidence || []).map((e) => `<a href="${esc(e.url)}" target="_blank" rel="noopener" title="${esc(e.date)} ${esc(e.title)}">${esc(e.publisher || "来源")}</a>`).join(" · ");
  const cp = x.counterparty ? `${esc(x.counterparty)}${x.ticker && x.ticker !== x.counterparty ? ` ${itTk(x.ticker)}` : ""}：` : "";
  return `<li class="${x.status === "candidate" ? "muted-row" : ""}"><span class="chip" title="${esc(tip)}">${badgeTxt}</span> ${cp}${esc(x.text)}${itAmt(x) ? ` <span>（${itAmt(x)}）</span>` : ""}
    ${x.reported ? '<span class="muted small">据报道</span>' : ""}<div class="muted small">${x.date ? `${esc(x.date)} · ` : ""}${ev}${x.status === "candidate" ? ` · 待审核 <span class="if-rev">${ifBtns({ id: x.id, status: "candidate" })}</span>` : x.approved_by === "auto" ? " · 自动通过" : ""}</div></li>`;
}
function itDims(d, tech, k) {
  const c = d.cells[tech.id]?.[k];
  return Object.keys(IT_DIM).map((m) => {
    const xs = c?.[m] || [];
    const na = m === "monetize" && !IT_MONETIZE.has(tech.id);
    return `<div class="it-dim"><b title="${esc(IT_DIM_TIP[m])}">${IT_DIM[m]}</b> <span class="muted small">${na ? "不适用" : `${xs.length} 条`}</span>
      ${na ? "" : xs.length ? `<ul class="it-list">${xs.slice(0, 12).map(itItem).join("")}</ul>${xs.length > 12 ? `<p class="muted small">另有 ${xs.length - 12} 条</p>` : ""}` : '<p class="muted small">没有找到</p>'}</div>`;
  }).join("");
}
function itPanel(d, tech, co) {
  const head = `<h3>${esc(tech.name)}${co ? ` × ${esc(itWho(d, co))}` : ""} ${badge("fact")}${badge("model")}</h3>
    <p class="muted">${esc(tech.summary || "")} <a href="#/tech/${esc(tech.id)}">查看“技术”页面（行业信息、瓶颈信号）→</a></p>`;
  const conc = tech.conc.length ? `<h4>供应商大客户占比 <span class="muted small">（SEC 10-K / 10-Q；客户匿名）</span></h4>${chartDiv("c-it-conc")}<div id="it-conc-note" class="muted small"></div>` : "";
  if (co) return `${head}<p><a href="#/infra-tech?t=${tech.id}">← 返回整项技术</a></p><div class="it-grid">${itDims(d, tech, co)}</div>${conc}`;
  const rows = d.companies.filter((c) => d.cells[tech.id]?.[c.key]?.n || d.cells[tech.id]?.[c.key]?.n_cand);
  return `${head}
    ${rows.length ? rows.map((c) => `<details class="it-co" ${rows.length <= 3 ? "open" : ""}><summary><b>${esc(c.name)}</b> <span class="muted small">${Object.keys(IT_DIM).map((m) => `${IT_DIM[m]} ${(d.cells[tech.id][c.key][m] || []).length}`).join(" · ")}${d.cells[tech.id][c.key].spend_b ? ` · 可加总支出 $${num(d.cells[tech.id][c.key].spend_b, 1)}B` : ""}</span>
      <a class="small" href="#/infra-tech?t=${tech.id}&c=${c.key}">单独查看</a></summary><div class="it-grid">${itDims(d, tech, c.key)}</div></details>`).join("") : empty("还没有这项技术的记录")}
    ${conc}`;
}
function drawItConc(d, tech) {
  const el = byId("c-it-conc");
  if (!el) return;
  const series = [], notes = [];
  tech.conc.forEach((tk, i) => {
    const cs = d.concentration[tk]?.customers || [];
    cs.filter((c) => !c.segment).slice(0, 2).forEach((c, j) => {
      const pts = Object.entries(c.annual).sort();
      if (!pts.length) return;
      const who = c.identified?.length ? `（据报道为 ${c.identified.map((k) => itWho(d, k)).join(" / ")}）` : "";
      series.push({ name: `${tk} ${c.label}${who}`, type: "line", data: pts.map(([e, v]) => [e, v]), color: ifColor(i), symbolSize: 5,
        lineStyle: { width: 1.8, type: j ? "dashed" : "solid" } });
    });
    if (!cs.length) notes.push(tk);
  });
  if (!series.length) { el.remove(); byId("it-conc-note").textContent = "所列供应商的申报中没有单一客户占收入 10% 以上的披露（或尚未抓取）。"; return; }
  mkChart(el, { legend: { top: 0, type: "scroll" }, grid: { left: 50, right: 20, top: 40, bottom: 30 }, xAxis: { type: "time" },
    yAxis: { type: "value", axisLabel: { formatter: (x) => `${Math.round(x * 100)}%` } }, series,
    tooltip: { trigger: "item", formatter: (p) => `${esc(p.seriesName)}<br>${esc(p.data[0])} 财年：<b>${pct(p.data[1], 0)}</b>` } });
  byId("it-conc-note").textContent = "每家最多画两个最大的匿名客户（实线 = 第一大）。申报只要求披露占收入 10% 以上的客户，低于 10% 的年份不会出现。";
}
function drawItNet(d, tech, all) {
  const el = byId("c-it-net");
  if (!el) return;
  echarts.getInstanceByDom(el)?.dispose();
  const es = d.edges.filter((e) => all || e.tech === tech.id);
  const cos = new Set(d.companies.map((c) => c.key));
  const nodes = new Map();
  const addN = (id, big) => { if (!nodes.has(id)) nodes.set(id, { id, name: cos.has(id) ? itWho(d, id) : id, symbolSize: big ? 26 : 11, category: big ? 0 : 1 }); };
  es.forEach((e) => { addN(e.co, true); addN(e.other, cos.has(e.other)); });
  const col = { spend: "#2a78d6", fund: "#e0a419", monetize: "#1baf7a" };
  if (!es.length) { el.innerHTML = empty("这项技术还没有已通过的资金往来记录"); return; }
  mkChart(el, { legend: { show: false }, tooltip: { formatter: (p) => (p.dataType === "edge" ? `${esc(itWho(d, p.data.co))} → ${esc(p.data.other)}<br>${IT_DIM[p.data.dim]} · ${esc(d.techs.find((t) => t.id === p.data.tech)?.name || "")}<br>${p.data.n} 条${p.data.amount_b ? `，合计 $${num(p.data.amount_b, 1)}B` : ""}` : esc(p.data.name)) },
    series: [{ type: "graph", layout: "force", roam: true, draggable: true, force: { repulsion: 160, edgeLength: [60, 160] },
      categories: [{ name: "公司", itemStyle: { color: "#4a3aa7" } }, { name: "对手方", itemStyle: { color: "#9aa0a6" } }],
      label: { show: true, position: "right", fontSize: 10 }, data: [...nodes.values()],
      links: es.map((e) => ({ source: e.co, target: e.other, co: e.co, other: e.other, dim: e.dim, tech: e.tech, n: e.n, amount_b: e.amount_b,
        lineStyle: { color: col[e.dim], width: Math.min(6, 1 + e.n), opacity: 0.7, curveness: 0.1 } })) }] });
}

// “技术”页面：这项技术的大公司投入概览（tech_page.js 调用）
async function fillTechInfra(t) {
  const el = byId("tk-infra");
  if (!el) return;
  const d = await itData();
  const row = d?.cells?.[t.id];
  if (!row) return;
  const cos = d.companies.filter((c) => row[c.key]?.n || row[c.key]?.n_cand);
  if (!cos.length) return;
  el.hidden = false;
  el.innerHTML = `<h3>大公司投入 ${badge("fact")}${badge("model")}</h3>
    <div class="table-wrap"><table><thead><tr><th>公司</th>${Object.keys(IT_DIM).map((m) => `<th class="num">${IT_DIM[m]}</th>`).join("")}<th class="num">可加总支出</th><th>最重要的一条</th></tr></thead><tbody>
    ${cos.map((c) => { const x = row[c.key], top = Object.keys(IT_DIM).flatMap((m) => x[m]).find((i) => i.status !== "candidate");
      return `<tr><td><a href="#/infra-tech?t=${t.id}&c=${c.key}"><b>${esc(c.name)}</b></a></td>${Object.keys(IT_DIM).map((m) => `<td class="num">${(x[m] || []).length || "–"}</td>`).join("")}
        <td class="num">${x.spend_b ? `$${num(x.spend_b, 1)}B` : "–"}</td><td class="wrap small">${top ? `${top.counterparty ? `${esc(top.counterparty)}：` : ""}${esc(top.text)}` : ""}</td></tr>`; }).join("")}</tbody></table></div>
    <p><a href="#/infra-tech?t=${t.id}">在“基建 · 按技术”中查看明细与资金流向 →</a></p>`;
}
