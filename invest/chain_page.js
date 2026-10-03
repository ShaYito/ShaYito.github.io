"use strict";
/* 产业链页：AI 算力主链环节全景（上游 → 下游）+ 供给环节；新增与待审核关系；全部供货 / 合作关系的业务关系图。 */

const CHAIN_HOWTO = [
  "从左到右是 AI 算力从“设计”到“被使用”的过程：芯片设计 → 定制芯片设计服务 → 晶圆制造与封装 → 服务器组装 → 云与 AI 算力 → AI 模型与应用。下方是为这些环节提供设备、存储、网络、电力的“供给”环节。",
  "每张卡片是一家公司在该环节的角色（悬停看说明）。同一家公司可能出现在多个环节，例如谷歌既自研 TPU，也出租云算力，还做 Gemini。灰色卡片是未纳入看板的公司（未上市、非美股或暂未加入），只作说明。",
  "上方可切换着色：按[[theme|主题]]；按近 1 月涨跌（绿涨红跌，越深幅度越大）；按近 7 日[[sentiment|新闻情绪]]（AI 打分）。每个环节标题下显示该环节成员的平均涨跌，用来判断资金在追哪一段。",
  "环节划分与公司角色是人工整理的[[model|判断]]（经你审核），涨跌是[[derived|计算]]结果，新闻情绪是 AI 打分。",
];

function chainColor(mode, m) {
  const mix = (v, max, pos, neg) => {
    if (!isNum(v)) return "";
    const a = Math.min(1, Math.abs(v) / max);
    return `background: color-mix(in srgb, ${v >= 0 ? pos : neg} ${Math.round(12 + a * 58)}%, var(--surface));`;
  };
  if (!m) return "";
  if (mode === "ret") return mix(m.ret_1m, 0.2, "var(--pos)", "var(--neg)");
  if (mode === "sent") return m.news_count ? mix(m.sentiment, 0.4, "var(--pos)", "var(--neg)") : "";
  return m.theme ? `background: color-mix(in srgb, ${themeColor(m.theme)} 22%, var(--surface));` : "";
}
function chainChip(mem, c, mode, hl) {
  if (!mem.ticker) return `<span class="chain-chip ext" title="${esc(mem.role)}">${esc(mem.name)}</span>`;
  const m = c.metrics[mem.ticker];
  const val = mode === "sent" ? (m.news_count ? `情绪 ${num(m.sentiment, 2, true)}` : "无新闻") : `${pct(m.ret_1m, 1, true)}`;
  return `<a class="chain-chip ${hl === mem.ticker ? "hl" : ""}" href="#/stock/${mem.ticker}" style="${chainColor(mode, m)}"
    title="${esc(`${mem.ticker} ${m.name_zh}：${mem.role}`)}">${isHeld(mem.ticker) ? "● " : ""}<b>${esc(mem.ticker)}</b> ${esc(m.name_zh)}
    ${mode === "theme" ? "" : `<small>${esc(val)}</small>`}<span class="chain-role">${esc(mem.role)}</span></a>`;
}
function chainInsights(c) {
  const out = [];
  const st = c.stages.filter((s) => isNum(s.avg_ret_1m)).sort((a, b) => b.avg_ret_1m - a.avg_ret_1m);
  if (st.length >= 2) {
    const hi = st[0], lo = st[st.length - 1];
    out.push({ level: "info", kind: "derived", text: `近 1 月最强环节：「${hi.name}」平均 ${pct(hi.avg_ret_1m, 1, true)}；最弱：「${lo.name}」${pct(lo.avg_ret_1m, 1, true)}（SPY ${pct(c.spy_ret_1m, 1, true)}）。` });
  }
  const inp = c.inputs.filter((s) => isNum(s.avg_ret_1m)).sort((a, b) => b.avg_ret_1m - a.avg_ret_1m);
  if (inp.length) out.push({ level: "info", kind: "derived", text: `供给环节中近 1 月最强：「${inp[0].name}」${pct(inp[0].avg_ret_1m, 1, true)}；最弱：「${inp[inp.length - 1].name}」${pct(inp[inp.length - 1].avg_ret_1m, 1, true)}。` });
  const ms = Object.entries(c.metrics).filter(([, m]) => isNum(m.ret_1m)).sort((a, b) => b[1].ret_1m - a[1].ret_1m);
  if (ms.length >= 2) {
    const [ht, hm] = ms[0], [lt, lm] = ms[ms.length - 1];
    out.push({ level: "info", kind: "derived", text: `链上个股近 1 月涨幅最大：${ht} ${hm.name_zh}（${pct(hm.ret_1m, 1, true)}）；跌幅最大：${lt} ${lm.name_zh}（${pct(lm.ret_1m, 1, true)}）。` });
  }
  const neg = Object.entries(c.metrics).filter(([, m]) => m.news_count >= 5 && m.sentiment < 0).sort((a, b) => a[1].sentiment - b[1].sentiment);
  if (neg.length) out.push({ level: neg.some(([t]) => isHeld(t)) ? "high" : "medium", kind: "model",
    text: `近 7 日[[sentiment|新闻情绪]]偏负面：${neg.slice(0, 3).map(([t, m]) => `${t} ${m.name_zh}（${num(m.sentiment, 2, true)}，${m.news_count} 篇）`).join("、")}。` });
  const held = Object.keys(c.metrics).filter((t) => isHeld(t));
  if (held.length) out.push({ level: "info", kind: "model", text: `${holdingsMode() === "mine" ? "你的持仓" : "当前建议持仓"}中位于这条产业链上的：${held.join("、")}。` });
  return out;
}

PAGES.chain = async (r) => {
  const [c, flow, rels] = await Promise.all([load("chain.json"), load("chain_flow.json").catch(() => null), load("relations.json").catch(() => null)]);
  const mode = ["theme", "ret", "sent"].includes(r.query.color) ? r.query.color : "ret";
  const hl = r.query.t || "";
  const feedsOf = (key) => c.inputs.filter((i) => i.feeds.includes(key)).map((i) => i.name);
  const stageName = Object.fromEntries(c.stages.map((s) => [s.key, s.name]));
  const stageCard = (s, i) => `<div class="chain-stage" id="cs-${s.key}">
      <div class="chain-head"><span class="chain-no">${i + 1}</span><b>${esc(s.name)}</b></div>
      <p class="muted chain-desc">${esc(s.desc)}</p>
      ${isNum(s.avg_ret_1m) ? `<p class="chain-avg">近 1 月平均 <span class="${cls(s.avg_ret_1m)}">${pct(s.avg_ret_1m, 1, true)}</span></p>` : ""}
      ${feedsOf(s.key).length ? `<p class="chain-feed">↑ 供给：${esc(feedsOf(s.key).join("、"))}</p>` : ""}
      <div class="chain-chips">${s.members.map((m) => chainChip(m, c, mode, hl)).join("")}</div></div>`;
  app().innerHTML = `
    <h2>产业链 <span class="muted">价格截至 ${esc(c.asof_price)} · 环节划分 ${esc(c.as_of)}${c.status === "draft" ? "（草稿）" : ""}</span></h2>
    ${howto(CHAIN_HOWTO)}${insightBox(chainInsights(c))}
    <section class="card"><div class="row"><span class="muted">着色</span><div class="seg" id="ch-mode">${[["theme", "主题"], ["ret", "近 1 月涨跌"], ["sent", "近 7 日新闻情绪"]].map(([k, n]) => `<button type="button" data-m="${k}" class="${k === mode ? "on" : ""}">${n}</button>`).join("")}</div>
      <span class="muted">${mode === "ret" ? "绿 = 上涨，红 = 下跌，颜色越深幅度越大（±20% 封顶）" : mode === "sent" ? "绿 = 偏正面，红 = 偏负面；无底色 = 近 7 日无新闻" : "颜色 = 看板主题"}；● = ${holdingsMode() === "mine" ? "你的持仓" : "当前建议持仓"}；灰色 = 未纳入看板</span></div>
      <h3>主链：从芯片设计到 AI 应用 ${badge("model")}${badge("derived")}</h3>
      <div class="chain-flow">${c.stages.map((s, i) => stageCard(s, i)).join('<div class="chain-arrow" aria-hidden="true">→</div>')}</div>
      <h3 style="margin-top:18px">供给环节 ${badge("model")}${badge("derived")}</h3>
      <div class="chain-inputs">${c.inputs.map((s) => `<div class="chain-stage input" id="cs-${s.key}">
        <div class="chain-head"><b>${esc(s.name)}</b><span class="muted">→ ${esc(s.feeds.map((f) => stageName[f]).join("、"))}</span></div>
        <p class="muted chain-desc">${esc(s.desc)}</p>
        ${isNum(s.avg_ret_1m) ? `<p class="chain-avg">近 1 月平均 <span class="${cls(s.avg_ret_1m)}">${pct(s.avg_ret_1m, 1, true)}</span></p>` : ""}
        <div class="chain-chips">${s.members.map((m) => chainChip(m, c, mode, hl)).join("")}</div></div>`).join("")}</div>
    </section>
    ${relationsCard(rels)}
    <section class="card" id="flow-card"><h3>业务关系图：上下游供应关系（业务线）${badge("fact")}${badge("model")}</h3>
      <div class="row"><span class="muted">着色</span><div class="seg" id="fl-color">${[["growth", "收入增速"], ["theme", "主题"]].map(([k, n], i) => `<button type="button" data-c="${k}" class="${i ? "" : "on"}">${n}</button>`).join("")}</div>
        <label class="muted"><input type="checkbox" id="fl-partner"> 显示合作关系</label></div>
      <div id="c-flow" class="chart" style="height:${flowHeight(flow)}px"></div>
      <div id="flow-info" class="flow-info muted">把鼠标移到圆点或连线上，这里显示详情（收入、增速、供应关系说明）；点击圆点进入个股页。</div>
      ${flow?.missing?.length ? `<p class="muted">未出现在图中的选股池股票：${flow.missing.map((m) => `<a href="#/stock/${esc(m.ticker)}">${esc(m.ticker)}</a>（${esc(m.reason)}）`).join("；")}。</p>` : ""}
      <p class="muted">${rich("从左到右 = 从上游到下游：每个圆点是一家公司的一块业务（SEC 财报的分业务口径），连线表示“左边向右边供货 / 提供服务”。圆点大小 = 该业务近 4 季收入（没有分业务数据的公司用公司总收入，灰色 = 未上市或非美股、没有数据）；颜色 = 收入同比增速（蓝 = 增长、红 = 下降，颜色越深幅度越大，±50% 封顶）。")}</p>
      <p class="muted">${rich("连线只表示存在供应关系（经你审核的产业链关系，属[[model|人工判断]]），粗细不代表交易额：公开数据里没有公司之间的交易金额（财报只披露“大客户占收入 x%”且多不具名）。虚线 = 该关系只确认到公司层面、还没细化到具体业务（挂在该公司收入最大的业务上）。悬停圆点可只看它的上下游。")}</p>
    </section>`;
  bindRelations();
  drawFlow(flow, "growth", false);
  document.querySelectorAll("#fl-color button").forEach((b) => (b.onclick = () => {
    b.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    drawFlow(flow, b.dataset.c, byId("fl-partner").checked);
  }));
  byId("fl-partner").onchange = (e) => drawFlow(flow, document.querySelector("#fl-color .on").dataset.c, e.target.checked);
  document.querySelectorAll("#ch-mode button").forEach((b) => (b.onclick = () => {
    location.hash = `#/chain?color=${b.dataset.m}${hl ? `&t=${hl}` : ""}`;
  }));
  if (hl) setTimeout(() => document.querySelector(".chain-chip.hl")?.scrollIntoView({ block: "center", inline: "center" }), 50);
};

// ---------------- 业务关系图（上下游，业务线层面）----------------
// a 与 b 两个 #rrggbb 颜色按比例 w（a 的占比）混合（ECharts 在 canvas 上不认 CSS color-mix）
function mixHex(a, b, w) {
  const p = (h) => { const x = h.replace("#", "").trim(); const f = x.length === 3 ? x.split("").map((c) => c + c).join("") : x; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
  const [ca, cb] = [p(a), p(b)];
  if (ca.some(isNaN) || cb.some(isNaN)) return a;
  return `rgb(${ca.map((v, i) => Math.round(v * w + cb[i] * (1 - w))).join(",")})`;
}
function flowRows(flow) {
  const cnt = {};
  for (const n of flow?.nodes || []) cnt[n.layer] = (cnt[n.layer] || 0) + 1;
  return Math.max(1, ...Object.values(cnt));
}
function flowHeight(flow) { return flow ? Math.max(420, flowRows(flow) * 46 + 60) : 120; }
function drawFlow(flow, colorBy, showPartner) {
  const el = byId("c-flow");
  if (!el) return;
  if (!flow?.nodes?.length) { el.innerHTML = empty("暂无业务关系数据"); return; }
  const rows = flowRows(flow);
  const byLayer = {};
  for (const n of flow.nodes) (byLayer[n.layer] ||= []).push(n);
  const cols = flow.columns.map((c) => c.name || `第 ${c.layer + 1} 层`);
  const revs = flow.nodes.map((n) => n.revenue).filter(isNum);
  const maxRev = Math.max(...revs, 1);
  const size = (n) => (isNum(n.revenue) ? 10 + 34 * Math.sqrt(n.revenue / maxRev) : 9);
  const growthColor = (g) => {
    if (!isNum(g)) return BENCH_GRAY();
    const a = Math.min(1, Math.abs(g) / 0.5);
    return mixHex(g >= 0 ? css("--pos") : css("--neg"), css("--surface"), 0.35 + a * 0.65);
  };
  const color = (n) => (!n.listed ? OTHER_GRAY() : colorBy === "theme" ? themeColor(themeOf(n.ticker)) : growthColor(n.growth));
  const money$ = (v) => (isNum(v) ? (v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : `${(v / 1e6).toFixed(0)}M`) : "–");
  const label = (n) => `${n.ticker}${n.business ? ` ${n.business}` : ""}`;
  const data = flow.nodes.map((n) => {
    const col = byLayer[n.layer];
    const y = n.order + (rows - col.length) / 2;
    return { name: n.id, value: [n.layer, y], raw: n, symbolSize: size(n),
      itemStyle: { color: color(n), borderColor: css("--surface"), borderWidth: 1 },
      label: { show: true, position: "right", formatter: label(n).length > 16 ? `${label(n).slice(0, 15)}…` : label(n), fontSize: 10, color: css("--ink-2") } };
  });
  const links = [
    ...flow.edges.map((e) => ({ source: e.source, target: e.target, raw: e,
      lineStyle: e.added ? { color: palette()[1], width: 2, opacity: 0.9, curveness: 0.12, type: e.coarse ? "dashed" : "solid" }
        : { color: css("--axis"), width: 1, opacity: 0.55, curveness: 0.12, type: e.coarse ? "dashed" : "solid" } })),
    ...(showPartner ? flow.partners.map((e) => ({ source: e.source, target: e.target, raw: { ...e, partner: true }, symbol: ["none", "none"],
      lineStyle: { color: palette()[6], width: 1, opacity: 0.6, curveness: 0.3, type: "dotted" } })) : []),
  ];
  const nodeTip = (n) => `<b>${esc(n.ticker)}</b> ${esc(n.company)}${n.business ? `<br>业务：${esc(n.business)}` : ""}
    ${isNum(n.revenue) ? `<br>${esc(n.basis)}：${money$(n.revenue)} 美元` : n.listed ? "<br>暂无收入数据" : "<br>未上市 / 非美股：无数据"}
    ${isNum(n.growth) ? `<br>收入同比：${pct(n.growth, 1, true)}` : ""}${isNum(n.op_margin) ? `<br>公司营业利润率：${pct(n.op_margin, 1)}` : ""}`;
  const name = Object.fromEntries(flow.nodes.map((n) => [n.id, label(n)]));
  const chart = mkChart(el, {
    tooltip: { show: false }, // 详情显示在图下方的信息栏，避免浮动框遮挡节点
    legend: { show: false },
    grid: { left: 10, right: 150, top: 40, bottom: 10 },
    xAxis: { type: "category", data: cols, position: "top", boundaryGap: false, axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { interval: 0, fontWeight: 600, color: css("--ink"), fontSize: 11 }, splitLine: { show: true, lineStyle: { color: css("--grid"), type: "dashed" } } },
    yAxis: { type: "value", show: false, inverse: true, min: -0.7, max: rows - 0.3 },
    series: [{ type: "graph", coordinateSystem: "cartesian2d", layout: "none", data, links, edgeSymbol: ["none", "arrow"], edgeSymbolSize: 6,
      emphasis: { focus: "adjacency", lineStyle: { width: 2, opacity: 1 } }, blur: { itemStyle: { opacity: 0.15 }, lineStyle: { opacity: 0.05 } } }],
  });
  const info = byId("flow-info");
  const edgeTip = (d) => `${esc(name[d.source])} ${d.raw.partner ? "↔" : "→"} ${esc(name[d.target])}：${esc(d.raw.note || "")}${d.raw.coarse ? "（只确认到公司层面）" : ""}${
    d.raw.added ? `<br><span style="color:${palette()[1]}">新增关系（${d.raw.added.approved_by === "auto" ? "SEC 申报点名，自动加入" : "你审核通过"}）</span>，详情见上方“新增与待审核关系”` : ""}`;
  const ups = (id) => flow.edges.filter((e) => e.target === id).map((e) => name[e.source]);
  const downs = (id) => flow.edges.filter((e) => e.source === id).map((e) => name[e.target]);
  chart?.on("mouseover", (p) => {
    if (!info) return;
    info.classList.remove("muted");
    if (p.dataType === "edge") { info.innerHTML = edgeTip(p.data); return; }
    if (p.dataType !== "node") return;
    const id = p.data.name, u = ups(id), d = downs(id);
    info.innerHTML = `${nodeTip(p.data.raw).replace(/<br>/g, " · ")}
      ${u.length ? `<br><span class="muted">上游（${u.length}）：</span>${esc(u.join("、"))}` : ""}
      ${d.length ? `<br><span class="muted">下游（${d.length}）：</span>${esc(d.join("、"))}` : ""}`;
  });
  chart?.on("click", (p) => { if (p.dataType === "node" && p.data.raw.listed) location.hash = `#/stock/${p.data.raw.ticker}`; });
}

// ---------------- 新增与待审核关系（web_data/relations.json）----------------
const REL_STATUS = { candidate: "待审核", approved: "已加入", rejected: "已拒绝" };
const TIER_TIP = { A: "A 级：公司向 SEC 提交的申报文件点名对方（并经确认方向）", B: "B 级：至少 2 家不同媒体报道", C: "C 级：单一来源" };
function relationsCard(R) {
  if (!R) return "";
  const list = R.relations || [];
  const nm = (k) => { const n = R.names?.[k]; return n && n.toLowerCase() !== k.toLowerCase() ? `${k} ${n}` : n || k; };
  const ev = (e) => `<li><span class="chip">${e.kind === "sec" ? `SEC ${esc(e.form)}${e.items ? ` 事项 ${esc(e.items)}` : ""}` : esc(e.publisher || "新闻")}</span>${esc(e.date || "")}
    <a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title || "原文")}</a>${e.quote ? `<br><span class="muted">“${esc(e.quote)}”</span>` : ""}</li>`;
  const react = (r) => Object.entries(r.impact?.reactions || {}).map(([t, x]) => `${esc(t)} ${x.start} 当天相对 SPY <span class="${cls(x.d0)}">${pct(x.d0, 1, true)}</span>${isNum(x.z0) ? `（${num(x.z0, 1, true)} 倍）` : ""}，${x.days} 日累计 <span class="${cls(x.car)}">${pct(x.car, 1, true)}</span>${isNum(x.z) ? `（${num(x.z, 1, true)} 倍）` : ""}${x.vol_ratio ? `，成交量 ${num(x.vol_ratio, 1)} 倍` : ""}`).join("；");
  const btns = (r) => r.status === "candidate"
    ? `<button type="button" class="primary" data-rel="${esc(r.id)}" data-act="approve">通过</button> <button type="button" class="ghost" data-rel="${esc(r.id)}" data-act="reject">拒绝</button>`
    : r.status === "approved" ? `<button type="button" class="ghost" data-rel="${esc(r.id)}" data-act="revoke">撤销</button>` : `<button type="button" class="ghost" data-rel="${esc(r.id)}" data-act="revoke">恢复为待审核</button>`;
  const item = (r) => `<div class="rel-item ${r.status}"><div class="rel-head"><b>${esc(nm(r.source))} ${r.type === "supplier" ? "→" : "↔"} ${esc(nm(r.target))}</b>
      <span class="chip">${r.type === "supplier" ? "供货" : "合作"}</span><span class="chip" title="${esc(TIER_TIP[r.tier])}">${r.tier} 级</span>
      <span class="chip ${r.status === "approved" ? "on" : ""}">${REL_STATUS[r.status]}${r.approved_by === "auto" ? "（自动）" : r.approved_by === "user" ? "（你审核）" : ""}</span>
      ${r.impact?.likely ? '<span class="chip warnchip">可能影响股价</span>' : ""}<span class="muted"> 首次报道 ${esc(r.first_seen || "–")}</span>
      <span style="float:right">${btns(r)}</span></div>
    <p>${esc(r.note || "")}</p>
    ${r.impact?.reasons?.length ? `<p><b>依据：</b>${r.impact.reasons.map(esc).join("；")}${r.impact.reactions ? "。已经大幅波动的消息，后续影响可能已部分反映在价格中。" : ""}</p>` : ""}
    ${!r.impact?.likely && react(r) ? `<p class="muted">股价反应：${react(r)}（均未达到 2 倍正常波动）</p>` : ""}
    ${r.impact?.amount ? `<p class="muted">合同金额：${esc(r.impact.amount.text)}${isNum(r.impact.materiality) ? `，年化约占供货方收入 ${pct(r.impact.materiality, 1)}` : ""}</p>` : ""}
    <details><summary>证据（${r.evidence.length}）与记录</summary><ul>${r.evidence.map(ev).join("")}</ul><p class="muted">${(r.history || []).map(esc).join(" · ")}</p></details></div>`;
  const active = list.filter((r) => r.status !== "rejected"), rejected = list.filter((r) => r.status === "rejected");
  return `<section class="card" id="rel-card"><h3>新增与待审核关系 ${badge("fact")}${badge("model")}<span class="muted" style="font-weight:400"> 待审核 ${list.filter((r) => r.status === "candidate").length} 条</span></h3>
    <p class="muted">${rich("每天从新闻中自动发现图谱里还没有的供货 / 合作关系（AI 只能引用新闻原文），再到 SEC 申报中核实：公司申报文件点名对方且确认方向的（A 级）自动加入，其余等你审核。“可能影响股价”依据：合同金额 ≥ 供货方年收入 5%、首次报道后股价相对 SPY 的波动超过正常的 2 倍、或公司按重大协议（8-K 事项 1.01）披露。按钮使用“我的持仓 → 同步设置”里的 GitHub token，提交后约 2–3 分钟网页更新。")}</p>
    ${active.length ? active.map(item).join("") : empty("目前没有新增或待审核的关系")}
    ${rejected.length ? `<details class="howto"><summary>已拒绝（${rejected.length}）</summary>${rejected.map(item).join("")}</details>` : ""}</section>`;
}
function bindRelations() {
  document.querySelectorAll("[data-rel]").forEach((b) => (b.onclick = async () => {
    const box = b.parentElement; // 这一条关系的按钮区：结果就地显示，避免看不到反馈而重复点击
    const say = (t, cls = "muted") => { box.innerHTML = `<span class="${cls}">${esc(t)}</span>`; };
    let token = ""; try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch { /* 忽略 */ }
    if (!token) { alert("请先在“我的持仓 → 持仓 → 同步设置”中保存 GitHub token（只需 Actions 写权限）"); return; }
    const act = { approve: "通过", reject: "拒绝", revoke: "撤销" }[b.dataset.act];
    if (!confirm(`确认${act}：${b.dataset.rel}？`)) return;
    box.querySelectorAll("button").forEach((x) => { x.disabled = true; });
    try {
      const resp = await fetch(`https://api.github.com/repos/${META.github_repo}/actions/workflows/review-relation.yml/dispatches`, {
        method: "POST",
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
        body: JSON.stringify({ ref: "main", inputs: { id: b.dataset.rel, action: b.dataset.act } }),
      });
      if (resp.status === 204) say(`✓ 已提交${act}；约 2–3 分钟后网页更新（刷新页面查看）`, "pos");
      else {
        say(`提交失败：HTTP ${resp.status}${resp.status === 401 || resp.status === 403 ? "（token 无效或缺少 Actions 写权限）" : resp.status === 404 ? "（token 没有该仓库权限）" : ""}`, "neg");
      }
    } catch (e) { say(`提交失败：${e.message}`, "neg"); }
  }));
}
