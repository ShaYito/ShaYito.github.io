// 技术页“AI 加速芯片”深入研究（M63；数据 accel_research.json）：产品与路线图、供给分配（CoWoS / HBM）、需求方汇总
// 产品 / 供给为人工整理（每条附来源）；需求方合并人工整理的合作、未上市公司页的芯片合同与已有的资本支出 / 大客户占比

let ACCEL_D = null;
const ACCEL_PREF = "invest.tech.accel";
const ACCEL_VENDORS = ["NVIDIA", "AMD", "谷歌（博通设计）", "亚马逊（自研）", "微软（自研）"];
const ACCEL_SPECS = [["hbm_gb", "HBM 容量", "GB"], ["bw_tbs", "显存带宽", "TB/s"], ["fp8", "FP8 算力（稠密）", "PFLOPS"], ["fp4", "FP4 算力", "PFLOPS"]];

async function accelData() {
  if (!ACCEL_D) ACCEL_D = await load("accel_research.json").catch(() => ({ available: false }));
  return ACCEL_D;
}
function accelView() {
  try { return { spec: "hbm_gb", ...JSON.parse(localStorage.getItem(ACCEL_PREF) || "{}") }; } catch { return { spec: "hbm_gb" }; }
}
function saveAccelView(v) { try { localStorage.setItem(ACCEL_PREF, JSON.stringify(v)); } catch { /* 忽略 */ } }
const accelColor = (vendor) => palette()[Math.max(0, ACCEL_VENDORS.indexOf(vendor)) % palette().length];
const accelSrc = (x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener" class="small">${esc(x.source)}${x.date ? `（${esc(String(x.date))}）` : ""}</a>`;
const accelNum = (v, d = 1) => (isNum(v) ? num(v, v >= 100 ? 0 : d) : "–");
const accelInPool = (t) => !!META?.universe?.some((u) => u.ticker === t);
const tkLink = (t, text) => (accelInPool(t) ? `<a href="#/stock/${esc(t)}">${esc(text)}</a>` : esc(text));

async function fillAccelResearch(t) {
  if (t.id !== "accel") return;
  const d = await accelData();
  if (!d?.available) return;
  const v = accelView();
  renderAccelProducts(d, v);
  renderAccelSupply(d);
  renderAccelDemand(d);
}

// ---------------- 产品与路线图 ----------------
function renderAccelProducts(d, v) {
  const el = byId("tk-products");
  if (!el) return;
  el.hidden = false;
  const spec = ACCEL_SPECS.find((s) => s[0] === v.spec) || ACCEL_SPECS[0];
  const ps = [...d.products].sort((a, b) => a.ship.localeCompare(b.ship));
  el.innerHTML = `<h3>产品与路线图 ${badge("fact")}</h3>
    <p class="muted small">各家数据中心 AI 芯片按量产出货 / 正式上市时间排列；空心 = 计划中。数值为每颗芯片的稠密峰值（不含稀疏加速），各家口径不完全一致，详见表中备注与来源。</p>
    ${chartDiv("c-ac-time", "short")}
    <div class="row"><span class="muted">逐代对比</span><div class="seg" id="ac-spec">${ACCEL_SPECS.map(([k, n]) => `<button type="button" data-v="${k}" class="${k === spec[0] ? "on" : ""}">${n}</button>`).join("")}</div></div>
    ${chartDiv("c-ac-spec")}
    <p class="muted small">每颗芯片的 HBM 容量几年内从 80 GB 涨到 288–432 GB，是 HBM 与先进封装需求增长快于芯片颗数的原因之一；FP4 只有 Blackwell 之后的新一代芯片支持。</p>
    <div class="table-wrap"><table><thead><tr><th>产品</th><th>出货</th><th>制程</th><th class="num">HBM</th><th class="num">带宽 TB/s</th><th class="num">FP8</th><th class="num">FP4</th><th class="num">功耗 W</th><th>价格（第三方估计）</th><th>来源</th></tr></thead><tbody>
    ${ps.map((p) => `<tr><td><b>${tkLink(p.ticker, p.name)}</b><br><span class="muted small">${esc(p.vendor)} · ${esc(p.family)}</span></td>
      <td>${esc(p.ship)}${p.plan ? `<br><span class="muted small">计划</span>` : ""}</td><td class="small">${esc(p.process || "–")}</td>
      <td class="num">${accelNum(p.hbm_gb, 0)} GB<br><span class="muted small">${esc(p.hbm || "")}</span></td><td class="num">${accelNum(p.bw_tbs, 2)}</td>
      <td class="num">${accelNum(p.fp8, 2)}</td><td class="num">${accelNum(p.fp4, 1)}</td><td class="num">${accelNum(p.power_w, 0)}</td>
      <td class="wrap small">${p.price ? `${esc(p.price)}<br>${accelSrc(p.price_src)}` : `<span class="muted">${p.ticker === "NVDA" || p.ticker === "AMD" ? "未找到" : "不对外出售"}</span>`}</td>
      <td class="wrap small">${accelSrc(p)}${p.note ? `<br><span class="muted">${esc(p.note)}</span>` : ""}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="muted small">FP8 / FP4 单位 PFLOPS；NVIDIA Blackwell 按 NVL72 整柜规格折算到每颗；Rubin 的 FP4 取官方“训练”口径 35（推理口径 50）；价格为媒体 / 研究机构估计，厂商不公布报价。</p>`;
  drawAccelTimeline(ps);
  drawAccelSpec(ps, spec);
  el.querySelectorAll("#ac-spec button").forEach((b) => (b.onclick = () => {
    v.spec = b.dataset.v; saveAccelView(v);
    for (const id of ["c-ac-time", "c-ac-spec"]) disposeChart(byId(id));
    renderAccelProducts(d, v);
  }));
}

function accelTip(p) {
  return `<b>${esc(p.name)}</b> <span class="muted">${esc(p.vendor)}</span><br>出货 ${esc(p.ship)}${p.plan ? "（计划）" : ""} · ${esc(p.process || "")}<br>
    HBM ${accelNum(p.hbm_gb, 0)} GB（${esc(p.hbm || "")}）· 带宽 ${accelNum(p.bw_tbs, 2)} TB/s<br>FP8 ${accelNum(p.fp8, 2)} · FP4 ${accelNum(p.fp4, 1)} PFLOPS${isNum(p.power_w) ? ` · ${p.power_w} W` : ""}
    ${p.price ? `<br>价格：${esc(p.price)}` : ""}${p.note ? `<div class="tip-quote">${esc(p.note)}</div>` : ""}`;
}

function drawAccelTimeline(ps) {
  const el = byId("c-ac-time");
  if (!el) return;
  const vendors = ACCEL_VENDORS.filter((x) => ps.some((p) => p.vendor === x));
  mkChart(el, {
    tooltip: { trigger: "item", formatter: (q) => accelTip(q.data.p) },
    legend: { show: false },
    grid: { left: 120, right: 30, top: 10, bottom: 28 },
    xAxis: { type: "time" },
    yAxis: { type: "category", data: vendors, inverse: true, axisLabel: { fontSize: 11 } },
    series: vendors.map((vd) => ({ name: vd, type: "scatter", color: accelColor(vd), symbolSize: 11,
      label: { show: true, position: "top", fontSize: 10, color: css("--ink-2"), formatter: (q) => q.data.p.name.replace(/（.*）/, "") },
      labelLayout: { hideOverlap: true },
      data: ps.filter((p) => p.vendor === vd).map((p) => ({ value: [`${p.ship}-15`, vd], p,
        itemStyle: p.plan ? { color: "transparent", borderColor: accelColor(vd), borderWidth: 2 } : undefined })) })),
  });
}

function drawAccelSpec(ps, spec) {
  const el = byId("c-ac-spec");
  if (!el) return;
  const [key, name, unit] = spec;
  const vendors = ACCEL_VENDORS.filter((x) => ps.some((p) => p.vendor === x && isNum(p[key])));
  mkChart(el, {
    tooltip: { trigger: "item", formatter: (q) => accelTip(q.data.p) },
    legend: { data: vendors },
    grid: { left: 56, right: 24, top: 40, bottom: 28 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: `${name}（${unit}）`, nameTextStyle: { fontSize: 11 } },
    series: vendors.map((vd) => ({ name: vd, type: "line", color: accelColor(vd), symbolSize: 9, lineStyle: { width: 2 },
      label: { show: true, position: "top", fontSize: 10, color: css("--ink-2"), formatter: (q) => q.data.p.name.replace(/（.*）/, "") },
      labelLayout: { hideOverlap: true },
      data: ps.filter((p) => p.vendor === vd && isNum(p[key])).map((p) => ({ value: [`${p.ship}-15`, p[key]], p, symbol: p.plan ? "emptyCircle" : "circle" })) })),
  });
}

// ---------------- 供给分配：CoWoS / HBM ----------------
function renderAccelSupply(d) {
  const el = byId("tk-supply");
  if (!el || (!d.cowos.length && !d.hbm.shares.length)) return;
  el.hidden = false;
  el.innerHTML = `<h3>供给分配：CoWoS 先进封装与 HBM ${badge("fact")}</h3>
    <p class="muted small">AI 芯片的产能上限主要卡在台积电 CoWoS 封装与 HBM。以下为研究机构的估计 / 报道，口径不一，同一张图内才可比较。</p>
    <div class="grid two">
      ${d.cowos.map((c, i) => `<div><b>${esc(c.label)}</b> <span class="muted small">${esc(c.unit)}，合计约 ${num(c.total, 0)}</span>${chartDiv(`c-ac-cw-${i}`)}
        ${c.note ? `<p class="muted small">${esc(c.note)}</p>` : ""}<p>${accelSrc(c)}</p></div>`).join("")}
      <div>${d.hbm.shares.map((h, i) => `<b>${esc(h.label)}</b>${chartDiv(`c-ac-hs-${i}`, "short")}${h.note ? `<p class="muted small">${esc(h.note)}</p>` : ""}<p>${accelSrc(h)}</p>`).join("")}
        ${d.hbm.allocations.map((h) => `<b>${esc(h.label)}</b><ul class="small">${h.items.map((x) => `<li>${esc(x.name)}：${esc(x.value || pct(x.share, 0))}</li>`).join("")}</ul>
          ${h.note ? `<p class="muted small">${esc(h.note)}</p>` : ""}<p>${accelSrc(h)}</p>`).join("")}</div>
    </div>
    <p class="muted small">产能扩张时间表（台积电 CoWoS 月产能等）见 <a href="#/tech/advanced_mfg">先进制程与封测</a>；HBM 价格与紧缺信号见 <a href="#/tech/storage">存储</a>。</p>`;
  d.cowos.forEach((c, i) => {
    const node = byId(`c-ac-cw-${i}`);
    if (!node) return;
    const items = [...c.items].sort((a, b) => b.value - a.value);
    mkChart(node, { tooltip: { trigger: "item", formatter: (q) => { const x = items[q.dataIndex]; return `<b>${esc(x.name)}</b>：${num(x.value, 0)}K 片（${pct(x.value / c.total, 0)}）${x.note ? `<br>${esc(x.note)}` : ""}`; } },
      legend: { show: false }, grid: { left: 110, right: 70, top: 6, bottom: 10 },
      xAxis: { type: "value", show: false }, yAxis: { type: "category", inverse: true, data: items.map((x) => x.name), axisLabel: { fontSize: 11 } },
      series: [{ type: "bar", barMaxWidth: 14, color: palette()[0], itemStyle: { borderRadius: [0, 4, 4, 0] }, data: items.map((x) => x.value),
        label: { show: true, position: "right", fontSize: 11, color: css("--ink-2"), formatter: (q) => `${num(q.value, 1)}（${pct(q.value / c.total, 0)}）` } }] });
  });
  d.hbm.shares.forEach((h, i) => {
    const node = byId(`c-ac-hs-${i}`);
    if (!node) return;
    mkChart(node, { tooltip: { trigger: "axis", valueFormatter: (x) => (isNum(x) ? pct(x, 0) : "–") }, legend: { data: h.items.map((x) => x.name) },
      grid: { left: 40, right: 12, top: 32, bottom: 24 }, xAxis: { type: "category", data: h.periods },
      yAxis: { type: "value", max: 1, axisLabel: { formatter: (x) => `${Math.round(x * 100)}%` } },
      series: h.items.map((x, k) => ({ name: x.name, type: "bar", barMaxWidth: 16, color: palette()[k + 1], itemStyle: { borderRadius: [4, 4, 0, 0] }, data: x.values,
        label: { show: true, position: "top", fontSize: 10, color: css("--ink-2"), formatter: (q) => (isNum(q.value) ? `${Math.round(q.value * 100)}` : "") } })) });
  });
}

// ---------------- 需求方：谁在买哪家的芯片 ----------------
function renderAccelDemand(d) {
  const el = byId("tk-demand");
  if (!el) return;
  el.hidden = false;
  const dm = d.demand, ctx = d.context || {};
  const cell = (b, s) => {
    const xs = dm.deals.filter((x) => x.buyer === b.key && x.source === s.key);
    if (!xs.length) return `<td class="muted small">${s.key === "own" && b.own ? esc(b.own) : "–"}</td>`;
    return `<td class="wrap small">${s.key === "own" && b.own ? `<span class="muted">${esc(b.own)}</span><br>` : ""}${xs.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener" title="${esc(x.text)}">${esc(String(x.date).slice(0, 7))}</a> ${esc(x.scale || x.text)}`).join("<br>")}</td>`;
  };
  const hs = ctx.nvda_hyperscale, conc = ctx.concentration || {};
  el.innerHTML = `<h3>需求方：谁在买哪家的芯片 ${badge("fact")}${badge("derived")}</h3>
    <p class="muted small">主要买方 × 芯片来源的公开合作 / 采购（悬停看说明，点日期打开来源）。各买方具体买了多少英伟达 GPU、自研芯片占比多少，公司都不披露，第三方也没有可靠的分家数据，所以这里不给比例，只列有来源的事实。</p>
    <div class="table-wrap"><table><thead><tr><th>买方</th><th class="num">近 4 季资本支出</th>${dm.sources.map((s) => `<th>${esc(s.name)}</th>`).join("")}</tr></thead><tbody>
    ${dm.buyers.map((b) => `<tr><td><b>${accelInPool(b.key) ? `<a href="#/stock/${esc(b.key)}">${esc(b.name)}</a>` : `<a href="#/private/${esc(b.key)}">${esc(b.name)}</a>`}</b>
        ${b.links ? `<br><a class="small" href="#/infra-tech?t=accel&c=${esc(b.key)}">基建记录 ${b.links} 条 →</a>` : ""}</td>
      <td class="num">${b.capex ? `$${num(b.capex.ttm_b, 0)}B<br><span class="muted small">同比 ${pct(b.capex.yoy, 0, true)}</span>` : `<span class="muted small">未上市</span>`}</td>
      ${dm.sources.map((s) => cell(b, s)).join("")}</tr>`).join("")}
    </tbody></table></div>
    <p class="muted small">资本支出含融资租赁（SEC 财报，截至 ${esc(dm.buyers.find((b) => b.capex)?.capex.period || "")}），包括数据中心建筑、电力与网络，不全是芯片。OpenAI / Anthropic 的合同取自<a href="#/private">未上市公司页</a>；“基建记录”为新闻提取的已通过记录。</p>
    <h4>芯片厂这一侧：收入有多集中</h4>
    <div class="kpis">
      ${hs ? `<div class="kpi"><span class="muted">英伟达 · ${esc(hs.label)}</span><b>${pct(hs.share, 0)}</b><span class="muted small">数据中心收入来自超大规模云厂商（$${num(hs.hyperscale, 1)}B / $${num(hs.datacenter, 1)}B）</span></div>` : ""}
      ${Object.entries(conc).map(([t, rows]) => `<div class="kpi"><span class="muted">${esc(t)} 最大客户（${esc(rows[0].basis)}，${esc(rows[0].period)}）</span><b>${pct(rows[0].share, 0)}</b>
        <span class="muted small">${rows.map((r) => `${esc(r.label)} ${pct(r.share, 0)}`).join("；")}</span></div>`).join("")}
    </div>
    <p class="muted small">大客户占比来自 SEC 10-K / 10-Q（只披露 ≥ 10% 的客户且匿名；英伟达的直接客户多为戴尔、鸿海等整机厂，不等于最终买方）。明细见 <a href="#/infra-tech">基建 · 按技术</a> 的“供应商大客户占比”。</p>`;
}
