/* 技术路线图（M68；数据 roadmap.json）：技术页子页面 #/tech/roadmap，以及各技术子页的“路线图带来的需求变化”卡片。
   ① 代际时间轴（机柜功率 / scale-up 域 / 每 GPU 显存 / 每 GPU 网络带宽，按出货时间排列，空心 = 计划）
   ② 逐代参数对比表 ③ 参数变化 → 需求变化：变化内容、时点、确定性、供给状态、涉及技术、受益 / 可能受损公司
   （附近 6 / 12 个月相对本地大盘，粗看市场是否已经押注）、可验证的观察点、来源。全部为人工整理，待用户审核。 */

let RM_D = null;
const RM_PREF = "invest.tech.roadmap";
const RM_CERT = { shipped: ["已量产", "good"], official: ["官方路线图 / 公告", "accent"], report: ["报道（未经官方确认）", "warn"], disputed: ["报道与官方说法冲突", "bad"] };
const RM_SUPPLY = { tight: ["偏紧", "bad"], easing: ["正在缓解", "warn"], ok: ["供给充足", "good"], unknown: ["未知", "muted"] };
const RM_STATUS = { shipped: "已量产", plan: "官方计划", plan_risk: "计划（有延期 / 变更报道）" };
const RM_METRICS = [
  ["rack_kw", "机柜功率", "kW", "每个机柜的功耗；决定散热与配电方式"],
  ["domain", "scale-up 域", "颗 GPU", "能像一台机器一样高速互连的 GPU 数；决定机柜内互连（铜缆 / PCB 中板 / 光）"],
  ["hbm_gb", "每 GPU 显存", "GB", "每颗 GPU 的 HBM 容量；决定 HBM 与先进封装需求"],
  ["nic_gbps", "每 GPU 网络带宽", "Gb/s", "每颗 GPU 的横向（scale-out）网卡速率；决定光模块与激光器需求"],
];
const RM_ROWS = [
  ["ship", "出货"], ["rack", "机柜形态"], ["rack_kw_text", "机柜功率"], ["scale_up", "scale-up 互连"], ["hbm", "显存（HBM）"],
  ["scale_out", "横向网络"], ["cooling", "散热"], ["power", "配电"], ["package", "封装"], ["process", "制程"], ["cpu", "CPU / 配套芯片"],
];
const RM_VENDOR_COLOR = { NVIDIA: 0, AMD: 1, 谷歌: 2 };

async function roadmapData() {
  if (!RM_D) RM_D = await load("roadmap.json").catch(() => ({ available: false }));
  return RM_D;
}
function roadmapView() {
  try { return { metric: "rack_kw", ...JSON.parse(localStorage.getItem(RM_PREF) || "{}") }; } catch { return { metric: "rack_kw" }; }
}
function saveRoadmapView(v) { try { localStorage.setItem(RM_PREF, JSON.stringify(v)); } catch { /* 忽略 */ } }
const rmChip = (pair, prefix = "") => `<span class="rm-tag ${pair[1]}">${esc(prefix)}${esc(pair[0])}</span>`;
const rmSrc = (s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.source)}</a>${s.date ? `<span class="muted">（${esc(s.date)}）</span>` : `<span class="muted">（日期不详）</span>`}：${esc(s.text)}</li>`;
const rmTechLinks = (s) => s.techs.map((t) => `<a class="chip" href="#/tech/${esc(t)}">${esc(s.tech_names?.[t] || t)}</a>`).join(" ");
function rmCoLink(tk, q) {
  const name = q?.name && q.name !== tk ? `${q.name}` : tk;
  const label = `${esc(name)} <span class="muted small">${esc(tk)}</span>`;
  return q?.in_pool ? `<a href="#/stock/${esc(q.pool_ticker)}">${label}</a> <span class="rm-pool" title="已在你的选股池">●</span>` : label;
}
function rmMedian(xs) {
  const v = xs.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// ---------------- 子页面 #/tech/roadmap ----------------
const RM_HOWTO = [
  "为什么看路线图：瓶颈研究发现，80 个样本中 71 个的股价上涨早于第一条公开的“紧缺”报道。英伟达、AMD、谷歌每年公布未来 2–3 代产品的规格，功率、带宽、容量这些物理参数一变，配套环节的需求就跟着变——这是比新闻更早、而且可以核实的依据。",
  "怎么用：先看“参数变化 → 需求变化”总表，找出“确定性高（已量产 / 官方）+ 供给偏紧”的变化；再看受益公司近 6 个月相对大盘涨了多少——已经大涨说明市场可能已经押注，涨得少说明还没反映或者市场有疑虑。",
  "局限：路线图只说明“会需要什么”，不说明“供给能否跟上”，也不说明哪家公司能拿到订单；计划经常推迟或改规格（如 Kyber 推迟报道、Rubin CPX 撤出、Rubin Ultra 由 4 芯片改 2 芯片）。所有内容为人工整理，每条附来源，待你审核。",
];

async function renderRoadmap(ts, query) {
  const d = await roadmapData();
  if (!d?.available) { app().innerHTML = `${techNav(ts, "roadmap")}<h2>技术路线图</h2>${card("技术路线图", empty("数据尚未生成"))}`; return; }
  const v = roadmapView();
  app().innerHTML = `${techNav(ts, "roadmap")}
    <h2>技术路线图 <span class="muted">整理于 ${esc(d.asof)} · 行情截至 ${esc(d.quotes_asof || "–")}</span></h2>
    ${howto(RM_HOWTO)}
    <section class="card"><h3>参数变化 → 需求变化：总表 ${badge("fact")}${badge("derived")}</h3>
      <p class="muted small">点击一行展开下方详情。“受益公司近 6 月相对大盘（中位数）”= 列出的受益公司各自相对本地大盘的涨跌取中位数，粗看市场是否已经押注；不是收益预测。</p>
      ${rmSummaryTable(d)}</section>
    <section class="card"><h3>代际时间轴 ${badge("fact")}</h3>
      <div class="row"><div class="seg" id="rm-metric">${RM_METRICS.map(([k, n]) => `<button type="button" data-v="${k}" class="${k === v.metric ? "on" : ""}">${n}</button>`).join("")}</div></div>
      <p class="muted small" id="rm-metric-tip"></p>
      ${chartDiv("c-rm-time")}
      <p class="muted small">按量产出货 / 正式上市时间排列（对数刻度）；实心 = 已量产，空心 = 计划，橙色边框 = 有延期 / 变更报道。没有公开数字的代际不画点（见下表文字）。</p></section>
    <section class="card"><h3>逐代参数对比 ${badge("fact")}</h3>${rmTable(d)}</section>
    <section class="card" id="rm-shifts"><h3>参数变化 → 需求变化：详情 ${badge("fact")}${badge("derived")}</h3>
      ${d.shifts.map((s) => rmShiftHtml(s)).join("")}</section>`;
  drawRoadmapTime(d, v);
  byId("rm-metric").querySelectorAll("button").forEach((b) => (b.onclick = () => {
    v.metric = b.dataset.v; saveRoadmapView(v);
    byId("rm-metric").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    disposeChart(byId("c-rm-time"));
    drawRoadmapTime(d, v);
  }));
  document.querySelectorAll(".rm-row").forEach((tr) => (tr.onclick = (e) => {
    if (e.target.closest("a")) return;
    rmOpen(tr.dataset.id);
  }));
  if (query?.s) rmOpen(query.s);
}
function rmOpen(id) {
  const el = byId(`rm-s-${id}`);
  if (!el) return;
  el.open = true;
  el.scrollIntoView({ block: "start" }); // 页面内跳转不用平滑滚动
}

function rmSummaryTable(d) {
  return `<div class="table-wrap"><table class="rm-sum"><thead><tr><th>变化</th><th>时点</th><th>确定性</th><th>供给</th><th>涉及技术</th><th class="num">受益公司近 6 月<br>相对大盘（中位数）</th></tr></thead><tbody>
    ${d.shifts.map((s) => {
      const m6 = rmMedian(s.winners.map((w) => w.quote?.rel?.["6m"]));
      return `<tr class="rm-row" data-id="${esc(s.id)}"><td><b>${esc(s.title)}</b></td><td class="wrap small">${esc(s.when)}</td>
        <td>${rmChip(RM_CERT[s.certainty])}</td><td>${rmChip(RM_SUPPLY[s.supply_state])}</td><td>${rmTechLinks(s)}</td>
        <td class="num ${cls(m6)}">${pct(m6, 0, true)}<br><span class="muted small">${s.winners.filter((w) => isNum(w.quote?.rel?.["6m"])).length} 家</span></td></tr>`;
    }).join("")}</tbody></table></div>`;
}

function rmTable(d) {
  const ps = d.platforms;
  return `<div class="table-wrap"><table class="rm-table"><thead><tr><th></th>${ps.map((p) => `<th><b>${esc(p.name)}</b><br><span class="muted small">${esc(p.vendor)} · ${esc(RM_STATUS[p.status])}</span></th>`).join("")}</tr></thead><tbody>
    ${RM_ROWS.map(([k, n]) => `<tr><th class="small">${n}</th>${ps.map((p) => `<td class="wrap small">${esc(p[k] ?? "–")}</td>`).join("")}</tr>`).join("")}
    <tr><th class="small">说明</th>${ps.map((p) => `<td class="wrap small muted">${esc(p.note || "")}</td>`).join("")}</tr>
    </tbody></table></div>
    <details><summary class="small">来源（${ps.reduce((a, p) => a + p.sources.length, 0)} 条）</summary>
      ${ps.map((p) => `<p class="small"><b>${esc(p.name)}</b></p><ul class="small">${p.sources.map(rmSrc).join("")}</ul>`).join("")}</details>`;
}

function drawRoadmapTime(d, v) {
  const [key, label, unit, tip] = RM_METRICS.find((m) => m[0] === v.metric) || RM_METRICS[0];
  byId("rm-metric-tip").textContent = tip;
  const pal = palette();
  const vendors = [...new Set(d.platforms.map((p) => p.vendor))];
  const series = vendors.map((vd) => {
    const pts = d.platforms.filter((p) => p.vendor === vd && isNum(p[key])).sort((a, b) => a.ship.localeCompare(b.ship));
    const color = pal[(RM_VENDOR_COLOR[vd] ?? vendors.indexOf(vd)) % pal.length];
    return { name: vd, type: "line", color, symbol: "circle", symbolSize: 11, lineStyle: { width: 1.5, type: "dashed" },
      label: { show: true, position: "top", fontSize: 11, formatter: (x) => x.data.p.name.replace(/（.*）/, "") },
      data: pts.map((p) => ({ value: [`${p.ship}-15`, p[key]], p,
        itemStyle: p.status === "shipped" ? { color } : { color: "transparent", borderColor: p.status === "plan_risk" ? "#e8590c" : color, borderWidth: 2 } })) };
  });
  mkChart(byId("c-rm-time"), {
    grid: { left: 60, right: 30, top: 40, bottom: 30 },
    legend: { top: 0 },
    xAxis: { type: "time", min: "2022-01-01", max: "2029-06-30" },
    yAxis: { type: "log", name: unit, scale: true },
    tooltip: { trigger: "item", formatter: (x) => {
      const p = x.data.p;
      return `<b>${esc(p.name)}</b>（${esc(p.ship)}，${esc(RM_STATUS[p.status])}）<br>${esc(label)}：${num(p[key], 0)} ${esc(unit)}<br><span style="opacity:.75">${esc(key === "rack_kw" ? p.rack_kw_text : key === "domain" ? p.scale_up : key === "hbm_gb" ? p.hbm : p.scale_out)}</span>`;
    } },
    series,
  });
}

function rmQuoteCells(q) {
  if (!q) return `<td class="num muted" colspan="4">无行情</td>`;
  const r6 = q.rel?.["6m"], r1 = q.rel?.["1y"];
  return `<td class="num ${cls(r6)}">${pct(r6, 0, true)}</td><td class="num ${cls(r1)}">${pct(r1, 0, true)}</td>
    <td class="num">${pct(q.from_high, 0)}</td><td class="num">${isNum(q.fwd_pe) && q.fwd_pe > 0 ? num(q.fwd_pe, 1) : "–"}</td>`;
}
function rmShiftHtml(s) {
  return `<details class="rm-shift" id="rm-s-${esc(s.id)}"><summary><b>${esc(s.title)}</b> ${rmChip(RM_CERT[s.certainty])} ${rmChip(RM_SUPPLY[s.supply_state], "供给：")}</summary>
    <div class="rm-body">
      <p><b>变化</b>：${esc(s.change)}</p>
      <p><b>时点</b>：${esc(s.when)}　<b>涉及技术</b>：${rmTechLinks(s)}</p>
      <p><b>为什么带来需求变化</b>：${esc(s.why)}</p>
      <div class="table-wrap"><table><thead><tr><th>可能受益</th><th>原因</th><th class="num">近 6 月<br>相对大盘</th><th class="num">近 1 年<br>相对大盘</th><th class="num">距 52 周高点</th><th class="num">预期 P/E</th></tr></thead><tbody>
        ${s.winners.map((w) => `<tr><td>${rmCoLink(w.ticker, w.quote)}</td><td class="wrap small">${esc(w.why)}</td>${rmQuoteCells(w.quote)}</tr>`).join("")}
      </tbody></table></div>
      ${s.losers.length ? `<p><b>可能受损</b>：</p><ul class="small">${s.losers.map((x) => `<li>${x.ticker ? rmCoLink(x.ticker, x.quote) : esc(x.name)}${x.ticker ? `（${esc(x.name)}）` : ""}：${esc(x.why)}</li>`).join("")}</ul>` : ""}
      <p><b>供给准备情况</b>：${esc(s.supply)}</p>
      <p><b>可验证的观察点</b>：</p><ul class="small">${s.watch.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
      <p class="muted small">受益 / 受损公司为人工判断（这项变化与公司业务的关系），不代表公司一定拿到订单；相对大盘为当地货币、相对本地大盘指数。</p>
      <p class="small"><b>来源</b></p><ul class="small">${s.sources.map(rmSrc).join("")}</ul>
    </div></details>`;
}

// ---------------- 各技术子页：路线图带来的需求变化 ----------------
async function fillTechRoadmap(t) {
  const el = byId("tk-roadmap");
  if (!el || t.history) return;
  const d = await roadmapData();
  const ss = (d?.shifts || []).filter((s) => s.techs.includes(t.id));
  if (!ss.length) return;
  el.hidden = false;
  el.innerHTML = `<h3>路线图带来的需求变化 ${badge("fact")}</h3>
    <p class="muted small">AI 硬件路线图中与这项技术相关的参数变化（人工整理，${esc(d.asof)}）。完整内容见 <a href="#/tech/roadmap">技术路线图</a>。</p>
    <ul class="rm-mini">${ss.map((s) => `<li><a href="#/tech/roadmap?s=${esc(s.id)}"><b>${esc(s.title)}</b></a> ${rmChip(RM_CERT[s.certainty])} ${rmChip(RM_SUPPLY[s.supply_state], "供给：")}
      <br><span class="small">${esc(s.change)}</span><br><span class="muted small">时点：${esc(s.when)}</span></li>`).join("")}</ul>`;
}

// 技术看板上的入口卡片
async function roadmapEntryHtml() {
  const d = await roadmapData();
  if (!d?.available) return "";
  const hot = d.shifts.filter((s) => (s.certainty === "shipped" || s.certainty === "official") && s.supply_state === "tight");
  return `<section class="card rm-entry"><h3><a href="#/tech/roadmap">技术路线图 → 下一个瓶颈</a> ${badge("fact")}</h3>
    <p class="small">${d.platforms.length} 代平台的物理参数（机柜功率、互连规模、显存、网络带宽）· ${d.shifts.length} 条“参数变化 → 需求变化”。确定性高且供给偏紧的：${hot.map((s) => esc(s.title.split(" → ").pop())).join("、") || "无"}。</p>
    <p class="small"><a href="#/tech/roadmap">查看技术路线图 →</a></p></section>`;
}
