"use strict";
/* AI 算力产业链全景：主链环节（上游 → 下游）+ 供给环节；公司卡片按主题 / 近 1 月涨跌 / 近 7 日新闻情绪着色。 */

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
    title="${esc(`${mem.ticker} ${m.name_zh}：${mem.role}`)}">${m.held ? "● " : ""}<b>${esc(mem.ticker)}</b> ${esc(m.name_zh)}
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
  if (neg.length) out.push({ level: neg.some(([, m]) => m.held) ? "high" : "medium", kind: "model",
    text: `近 7 日[[sentiment|新闻情绪]]偏负面：${neg.slice(0, 3).map(([t, m]) => `${t} ${m.name_zh}（${num(m.sentiment, 2, true)}，${m.news_count} 篇）`).join("、")}。` });
  const held = Object.entries(c.metrics).filter(([, m]) => m.held).map(([t]) => t);
  if (held.length) out.push({ level: "info", kind: "model", text: `当前建议持仓中位于这条产业链上的：${held.join("、")}。` });
  return out;
}

PAGES.chain = async (r) => {
  const c = await load("chain.json");
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
    <h2>AI 算力产业链 <span class="muted">价格截至 ${esc(c.asof_price)} · 环节划分 ${esc(c.as_of)}${c.status === "draft" ? "（草稿）" : ""}</span></h2>
    ${howto(CHAIN_HOWTO)}${insightBox(chainInsights(c))}
    <section class="card"><div class="row"><span class="muted">着色</span><div class="seg" id="ch-mode">${[["theme", "主题"], ["ret", "近 1 月涨跌"], ["sent", "近 7 日新闻情绪"]].map(([k, n]) => `<button type="button" data-m="${k}" class="${k === mode ? "on" : ""}">${n}</button>`).join("")}</div>
      <span class="muted">${mode === "ret" ? "绿 = 上涨，红 = 下跌，颜色越深幅度越大（±20% 封顶）" : mode === "sent" ? "绿 = 偏正面，红 = 偏负面；无底色 = 近 7 日无新闻" : "颜色 = 看板主题"}；● = 当前建议持仓；灰色 = 未纳入看板</span></div>
      <h3>主链：从芯片设计到 AI 应用 ${badge("model")}${badge("derived")}</h3>
      <div class="chain-flow">${c.stages.map((s, i) => stageCard(s, i)).join('<div class="chain-arrow" aria-hidden="true">→</div>')}</div>
      <h3 style="margin-top:18px">供给环节 ${badge("model")}${badge("derived")}</h3>
      <div class="chain-inputs">${c.inputs.map((s) => `<div class="chain-stage input" id="cs-${s.key}">
        <div class="chain-head"><b>${esc(s.name)}</b><span class="muted">→ ${esc(s.feeds.map((f) => stageName[f]).join("、"))}</span></div>
        <p class="muted chain-desc">${esc(s.desc)}</p>
        ${isNum(s.avg_ret_1m) ? `<p class="chain-avg">近 1 月平均 <span class="${cls(s.avg_ret_1m)}">${pct(s.avg_ret_1m, 1, true)}</span></p>` : ""}
        <div class="chain-chips">${s.members.map((m) => chainChip(m, c, mode, hl)).join("")}</div></div>`).join("")}</div>
    </section>`;
  document.querySelectorAll("#ch-mode button").forEach((b) => (b.onclick = () => {
    location.hash = `#/chain?color=${b.dataset.m}${hl ? `&t=${hl}` : ""}`;
  }));
  if (hl) setTimeout(() => document.querySelector(".chain-chip.hl")?.scrollIntoView({ block: "center", inline: "center" }), 50);
};
