/* 新闻页（M42 重构）：宏观与政策 / 深度事件 / 简讯 统一成一个列表，按日期分组、默认折叠为一行；
   顶部按标签筛选；点击展开：左边详情，右边相关公司（直接影响、产业链传导）+ 只含这些公司的小关系图。
   右侧栏：本页重点、与你持仓相关、本周摘要。全节点产业链图在“产业链”页。
   M43：未读标记（只存本机浏览器）；跨天合并同一件事（展开看来龙去脉）；宏观事件落到你的持仓（受影响部分占账户多少）；
   个股页“相关事件”复用同样的折叠行（展开时再加载当天存档）。 */
const NKIND_ZH = { macro: "宏观与政策", deep: "深度分析", brief: "简讯" };
const WD_ZH = "日一二三四五六";
const dirDot = (d) => `<span class="ndot ${d || "neutral"}" title="${esc(DIR_ZH[d] || "中性")}"></span>`;
const sentDir = (s) => (!isNum(s) || Math.abs(s) <= 0.15 ? "neutral" : s > 0 ? "positive" : "negative");
const NEWS_FILTERS = [
  ["cat", "类别", NKIND_ZH],
  ["type", "事件", EVENT_ZH],
  ["policy", "政策", Object.fromEntries(Object.entries(POLICY_ZH).filter(([k]) => k !== "none"))],
  ["scope", "范围", SCOPE_ZH],
  ["dir", "方向", { positive: "利好", negative: "利空", mixed: "影响不一" }],
];

// ---------------- 未读标记（M43）：本机记住已看过的条目；首次打开时全部视为已读 ----------------
const SEEN_KEY = "invest.news.seen";
let NEWS_SEEN = undefined; // 本次打开网页时读到的“已看过”集合（筛选 / 翻周时不变，下次打开网页才清掉“新”标记）
function seenBase() {
  if (NEWS_SEEN !== undefined) return NEWS_SEEN;
  try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) || "null"); NEWS_SEEN = v && Array.isArray(v.ids) ? new Set(v.ids) : null; } catch { NEWS_SEEN = null; }
  return NEWS_SEEN;
}
function markSeen(keys) {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) || "null");
    const ids = [...new Set([...(v?.ids || []), ...keys])].slice(-5000);
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ids, at: new Date().toISOString() }));
  } catch { /* 浏览器不允许存储时不标未读 */ }
}
const itemKey = (it) => `${it.kind}:${it.id}`;
function isUnread(it) { const b = seenBase(); return !!b && !b.has(itemKey(it)); }

// ---------------- 跨天合并（M43）：同一件事连续几天都有报道 → 合成一条“事件线” ----------------
const THREAD_DAYS = 4; // 相隔不超过 4 天
// 财经标题里的高频词（金额、涨跌、财报等）不算“相似”的证据
const STOP_BIGRAMS = new Set(["亿美", "美元", "万美", "股价", "公司", "上涨", "下跌", "市场", "增长", "财报", "收入", "营收", "季度", "宣布", "达成", "预期", "利好", "利空", "构成", "推动", "投资", "分析", "分析师"]);
function bigrams(t) {
  const x = (t || "").toLowerCase().replace(/[\s\p{P}\p{S}\p{N}]/gu, "");
  const out = new Set();
  for (let i = 0; i < x.length - 1; i++) { const b = x.slice(i, i + 2); if (!STOP_BIGRAMS.has(b)) out.add(b); }
  return out;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
}
const dayGap = (a, b) => Math.abs(new Date(`${a}T12:00:00Z`) - new Date(`${b}T12:00:00Z`)) / 864e5;
function sameStory(a, b) {
  if (a.date === b.date || dayGap(a.date, b.date) > THREAD_DAYS) return false;
  const sim = jaccard(a._bg, b._bg);
  if (a.kind === "macro" || b.kind === "macro") return a.kind === b.kind && ((a.policy && a.policy === b.policy && sim >= 0.2) || sim >= 0.4);
  const ca = a.companies[0]?.t, cb = b.companies[0]?.t;
  if (ca && ca === cb && a.type === b.type && sim >= 0.2) return true;
  const overlap = a.companies.some((c) => b.companies.some((d) => d.t === c.t));
  return overlap && sim >= 0.35;
}
// 输入按日期倒序的条目；输出每条事件线的最新一条（附 thread = 按时间正序的全部成员）
function mergeThreads(items) {
  for (const it of items) it._bg = bigrams(it.title);
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    if (find(i) !== find(j) && sameStory(items[i], items[j])) parent[find(j)] = find(i);
  }
  const groups = {};
  items.forEach((it, i) => (groups[find(i)] ||= []).push(it));
  const out = [];
  for (const it of items) {
    const g = groups[find(items.indexOf(it))];
    if (g[0] !== it) continue; // 每组只保留最新的一条作为“线头”
    out.push(g.length > 1 ? { ...it, thread: [...g].reverse() } : it);
  }
  return out;
}

// ---------------- 宏观事件落到持仓（M43）----------------
let NEWS_CTX = { w: null, seg: null }; // w = 你的持仓占账户比例（本机账本 / 个人数据包），seg = segments.json
async function myWeights() {
  const h = loadHoldings();
  if (!h || !Object.keys(h.positions || {}).length) return null;
  let prices = {};
  try { prices = (await latestPrices()).prices; } catch { /* 无价格时按成本估 */ }
  const val = {};
  for (const [t, n] of Object.entries(h.positions)) val[t] = n * (prices[t] || h.prices?.[t] || h.cost?.[t] || 0);
  const total = Object.values(val).reduce((a, b) => a + b, 0) + (h.cash || 0);
  return total > 0 ? Object.fromEntries(Object.entries(val).map(([t, v]) => [t, v / total])) : null;
}
function targetTickers(target) {
  if (target === "gold") return ["GLD"];
  if (META.themes.some((th) => th.key === target)) return META.universe.filter((u) => u.theme === target).map((u) => u.ticker);
  return [target];
}
const EXPO_POLICIES = new Set(["trade", "export_control", "geopolitics"]);
// 返回 {total, lines: [{name, dir, held: [[t, w]], sum}], market, china} 或 null（没有持仓数据）
function macroExposure(it, ctx = NEWS_CTX) {
  const w = ctx.w;
  if (!w || it.kind !== "macro") return null;
  const lines = [];
  const all = new Set();
  for (const a of it.raw.affected || []) {
    const held = targetTickers(a.target).filter((t) => (w[t] || 0) >= 0.0005).map((t) => [t, w[t]]);
    held.forEach(([t]) => all.add(t));
    lines.push({ name: a.name, dir: a.direction, held, sum: held.reduce((x, [, v]) => x + v, 0) });
  }
  const stocks = Object.entries(w).filter(([t]) => t !== "CASH" && t !== "SPAXX");
  const market = it.scope === "market" ? stocks.reduce((x, [, v]) => x + v, 0) : null;
  let china = null;
  if (EXPO_POLICIES.has(it.policy) && ctx.seg?.available) {
    const sh = Object.fromEntries((ctx.seg.exposure || []).filter((x) => isNum(x.shares?.china)).map((x) => [x.ticker, x.shares.china]));
    const cov = stocks.filter(([t]) => t in sh);
    if (cov.length) china = { value: cov.reduce((x, [t, v]) => x + v * sh[t], 0), covered: cov.reduce((x, [, v]) => x + v, 0), top: cov.map(([t, v]) => [t, v * sh[t], sh[t]]).sort((a, b) => b[1] - a[1]).slice(0, 4) };
  }
  return { total: [...all].reduce((x, t) => x + w[t], 0), lines, market, china };
}
function exposureHtml(x) {
  if (!x) return `<p class="muted small">在“我的持仓”填写交易记录（或解锁个人版）后，这里显示这条宏观消息涉及你账户的哪些部分、各占多少。</p>`;
  const rows = x.lines.map((l) => `<li><b class="${dirCls(l.dir)}">${esc(l.name)}</b> <span class="${dirCls(l.dir)}">${esc(DIR_ZH[l.dir] || "")}</span>：${l.held.length ? `你持有 ${l.held.map(([t, v]) => `${esc(t)} ${pct(v, 1)}`).join("、")}，合计 <b>${pct(l.sum, 1)}</b>` : `<span class="muted">你没有持有</span>`}</li>`).join("");
  const mk = x.market != null ? `<li>影响整个市场：你的股票与 ETF 合计占账户 <b>${pct(x.market, 1)}</b>（其余为现金）</li>` : "";
  const cn = x.china ? `<li>${rich("中国收入暴露（按[[geo_revenue|分地区收入]]加权）")}：约占账户 <b>${pct(x.china.value, 1)}</b>${x.china.top.length ? `，主要来自 ${x.china.top.map(([t, , s]) => `${esc(t)}（中国收入 ${pct(s, 0)}）`).join("、")}` : ""}<span class="muted">；有地区数据的持仓占账户 ${pct(x.china.covered, 0)}</span></li>` : "";
  return `<b>落到你的持仓</b><ul class="rel">${rows}${mk}${cn}</ul><p class="muted small">比例 = 持仓市值 ÷ 账户总值（本机计算，不上传）；只说明受影响的部分有多大，方向是 AI 判断。</p>`;
}

// 某天存档里文章的政策类型 / 影响范围（按链接查），给深度事件与简讯补上政策标签
function articleIndex(rec) {
  const m = {};
  for (const a of rec.articles || []) m[a.url] = a;
  return m;
}
function majority(vals) {
  const c = {};
  for (const v of vals) if (v && v !== "none") c[v] = (c[v] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}
function fromSources(sources, idx) {
  const arts = (sources || []).map((s) => idx[s.url]).filter(Boolean);
  return { policy: majority(arts.map((a) => a.policy)), scope: majority(arts.map((a) => a.scope)) };
}

// 统一的新闻条目：{kind, id, date, title, dir, type, policy, scope, companies: [{t, dir}], raw}
function newsItems(recs, digest, week) {
  const out = [];
  for (const rec of recs) {
    const idx = articleIndex(rec);
    for (const m of rec.macro || []) {
      const comps = (m.affected || []).filter((a) => META.universe.some((u) => u.ticker === a.target)).map((a) => ({ t: a.target, dir: a.direction }));
      out.push({ kind: "macro", id: m.event_id, date: rec.date, title: m.headline, dir: m.direction, type: "macro", policy: m.policy !== "none" ? m.policy : null,
        scope: m.scope, companies: comps, themes: (m.affected || []).filter((a) => !comps.some((c) => c.t === a.target)), raw: m, importance: m.importance || 0 });
    }
    for (const e of rec.events || []) {
      const comps = (e.direct_impacts || []).map((d) => ({ t: d.node, dir: d.direction }));
      for (const t of e.tickers || []) if (!comps.some((c) => c.t === t)) comps.push({ t, dir: null });
      for (const c of comps) if ((e.privates || []).includes(c.t)) c.priv = true;
      for (const t of e.privates || []) if (!comps.some((c) => c.t === t)) comps.push({ t, dir: null, priv: true });
      out.push({ kind: "deep", id: e.event_id, date: rec.date, title: e.headline, dir: overallDirection(e), type: e.event_type, ...fromSources(e.sources, idx), companies: comps, raw: e, importance: e.importance || 0 });
    }
    for (const b of rec.briefs || []) {
      out.push({ kind: "brief", id: b.event_id, date: rec.date, title: b.text, dir: sentDir(b.sentiment), type: b.event_type, ...fromSources(b.sources, idx),
        companies: (b.tickers || []).map((t) => ({ t, dir: sentDir(b.sentiment) }))
          .concat((b.privates || []).map((t) => ({ t, dir: sentDir(b.sentiment), priv: true }))), raw: b, importance: 0 });
    }
  }
  for (const e of digest?.events || []) {
    const comps = (e.direct_impacts || []).map((d) => ({ t: d.node, dir: d.direction }));
    out.push({ kind: "deep", id: e.event_id, date: e.sources?.[0]?.date || week, title: e.headline, dir: overallDirection(e), type: e.event_type, policy: null, scope: null, companies: comps, raw: e, importance: e.importance || 0 });
  }
  const order = { macro: 0, deep: 1, brief: 2 };
  return out.sort((a, b) => b.date.localeCompare(a.date) || order[a.kind] - order[b.kind] || b.importance - a.importance);
}

function itemMatches(it, q, ticker, held) {
  if (q.cat && it.kind !== q.cat) return false;
  if (q.type && it.type !== q.type) return false;
  if (q.policy && it.policy !== q.policy) return false;
  if (q.scope && it.scope !== q.scope) return false;
  if (q.dir && it.dir !== q.dir) return false;
  const ts = it.companies.map((c) => c.t).concat((it.raw.propagation || []).map((p) => p.node));
  if (ticker) {
    const th = META.universe.find((u) => u.ticker === ticker)?.theme;
    if (!ts.includes(ticker) && !(it.themes || []).some((a) => a.target === th)) return false;
  }
  if (q.held && !ts.some((t) => held.has(t))) return false;
  return true;
}

function companyChip(c, held) {
  // 未上市公司（M58）：链接到“未上市”页面（id = 公司名小写）
  if (c.priv) return `<a class="ctag ${c.dir || ""}" href="#/private/${esc(c.t.toLowerCase())}" title="${esc(`${c.t} · 未上市${c.dir ? ` · ${DIR_ZH[c.dir]}` : ""}`)}">${esc(c.t)}</a>`;
  const name = META.names_zh?.[c.t] || "";
  return `<a class="ctag ${c.dir || ""} ${held.has(c.t) ? "held" : ""}" href="#/stock/${esc(c.t)}" title="${esc(`${c.t} ${name}${c.dir ? ` · ${DIR_ZH[c.dir]}` : ""}${held.has(c.t) ? " · 持仓" : ""}`)}">${held.has(c.t) ? "● " : ""}${esc(c.t)}</a>`;
}
function newsRow(it, held, open) {
  const tags = [it.kind === "macro" ? "宏观" : EVENT_ZH[it.type] || "", it.policy ? POLICY_ZH[it.policy] : "", it.kind === "macro" && it.scope ? SCOPE_ZH[it.scope] : ""].filter(Boolean);
  const comps = it.companies.slice(0, 5).map((c) => companyChip(c, held)).join("") + (it.companies.length > 5 ? `<span class="muted">+${it.companies.length - 5}</span>` : "")
    + (it.themes || []).slice(0, 2).map((a) => `<span class="ctag theme ${a.direction || ""}">${esc(a.name)}</span>`).join("");
  const react = it.kind === "macro" && it.raw.reaction?.status === "abnormal" ? `<span class="chip warnchip" title="事件后首个收盘日 SPY 或 QQQ 涨跌超过日常波动 2 倍">⚠ 市场异动</span>` : "";
  const ex = macroExposure(it);
  const expo = ex && ex.total >= 0.005 ? `<span class="chip expo" title="这条消息直接涉及的你的持仓占账户比例">持仓 ${pct(ex.total, 0)}</span>` : "";
  const th = it.thread ? `<span class="chip thread" title="同一件事 ${it.thread.length} 条报道，展开看来龙去脉">🧵 ${it.thread[0].date.slice(5)} 起 · ${it.thread.length} 条</span>` : "";
  const unread = (it.thread || [it]).some(isUnread) ? `<span class="nnew" title="上次打开网页之后新增">新</span>` : "";
  return `<article class="nrow ${it.kind} ${open ? "open" : ""}" data-key="${esc(it.kind)}:${esc(it.id)}">
    <div class="nhead">${dirDot(it.dir)}${unread}<span class="nkind k-${it.kind}">${NKIND_ZH[it.kind]}</span><span class="ntitle">${esc(it.title)}</span>
      <span class="ntags">${th}${expo}${tags.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}${react}${comps}</span></div>
    <div class="ndetail">${open ? newsDetail(it) : ""}</div></article>`;
}

// ---------------- 展开后的详情 ----------------
function relatedPanel(it) {
  const e = it.raw;
  const direct = (e.direct_impacts || []).map((d) => `<li>${companyChip({ t: d.node, dir: d.direction }, new Set(heldTickers()))} <span class="${dirCls(d.direction)}">${DIR_ZH[d.direction]}</span> <span class="muted">· 程度${LEVEL_ZH[d.magnitude]} · ${HORIZON_ZH[d.horizon]}</span><div class="muted small">${esc(d.rationale)}</div></li>`).join("");
  const prop = (e.propagation || []).map((p) => `<li>${p.relation === "industry" ? `<b>${esc(p.node)}</b>` : companyChip({ t: p.node, dir: p.direction }, new Set(heldTickers()))} <span class="muted">${esc(REL_ZH[p.relation] || p.relation)}</span> <span class="${dirCls(p.direction)}">${DIR_ZH[p.direction]}</span> <span class="muted">· 置信度${LEVEL_ZH[p.confidence]}</span><div class="muted small">${esc(p.rationale)}</div></li>`).join("");
  const aff = (e.affected || []).map((a) => `<li>${META.universe.some((u) => u.ticker === a.target) ? companyChip({ t: a.target, dir: a.direction }, new Set(heldTickers())) : `<b class="${dirCls(a.direction)}">${esc(a.name)}</b>`} <span class="${dirCls(a.direction)}">${DIR_ZH[a.direction] || ""}</span><div class="muted small">${esc(a.rationale)}</div></li>`).join("");
  const plain = it.kind === "brief" ? it.companies.map((c) => `<li>${companyChip(c, new Set(heldTickers()))} <span class="muted">${esc(META.names_zh?.[c.t] || "")}</span></li>`).join("") : "";
  const body = (direct ? `<b>直接影响</b><ul class="rel">${direct}</ul>` : "") + (prop ? `<b>产业链传导（推断）</b><ul class="rel">${prop}</ul>` : "")
    + (aff ? `<b>受影响的行业 / 公司</b><ul class="rel">${aff}</ul>` : "") + (plain ? `<b>涉及公司</b><ul class="rel">${plain}</ul>` : "");
  return body ? `${body}<div class="mini-graph" id="mg-${esc(it.id)}"></div>` : `<p class="muted">没有明确受影响的选股池公司。</p>`;
}
function reactionNote(r) {
  if (!r) return "";
  return `<p><b>市场反应：</b>${reactionHtml(r)}</p><p class="muted small">“几倍”= 当天涨跌 ÷ 过去 60 个交易日的日常波动；SPY 或 QQQ ≥ 2 倍记为异动。同一天可能还有其他消息，不代表就是这条新闻造成的。</p>`;
}
function newsDetail(it) {
  const e = it.raw;
  let left = "";
  if (it.kind === "macro") {
    left = `${e.summary && e.summary !== e.headline ? `<p>${esc(e.summary)}</p>` : ""}${reactionNote(e.reaction)}
      ${e.watch ? `<p><b>关注：</b>${esc(e.watch)}</p>` : ""}<p class="muted small">AI 判断对大盘：<span class="${dirCls(e.direction)}">${esc(DIR_ZH[e.direction] || "")}</span> · ${esc(TIER_ZH[e.tier] || e.tier || "")}</p>`;
  } else if (it.kind === "deep") {
    const facts = (e.facts || []).map((f) => `<li>${esc(f.text)} <span class="src">${srcLinks(f.sources, 2)}</span></li>`).join("");
    left = `<p>${esc(e.summary)}</p>${facts ? `<b>关键事实</b><ul>${facts}</ul>` : ""}
      ${(e.watch_items || []).length ? `<p><b>需跟踪：</b>${e.watch_items.map(esc).join("；")}</p>` : ""}
      <p class="muted small">${esc(TIER_ZH[e.tier] || e.tier || "")} · 重要性 ${num(e.importance, 1)}</p>`;
  } else {
    left = `<p class="muted small">简讯（一句话摘要，未做深度分析）${isNum(e.sentiment) ? ` · 情绪 ${num(e.sentiment, 2, true)}` : ""}</p>`;
  }
  left += `<p class="src">来源：${srcLinks(e.sources, 5)}</p>`;
  const right = (it.kind === "macro" ? exposureHtml(macroExposure(it)) : "") + relatedPanel(it);
  return `<div class="ndgrid"><div>${threadHtml(it)}${left}</div><div class="nside-rel">${right}</div></div>`;
}

// 事件线：按时间列出同一件事的每条报道（最新一条的详情在下方）
function threadHtml(it) {
  if (!it.thread) return "";
  const li = (m) => `<li>${dirDot(m.dir)} <span class="muted">${esc(m.date.slice(5))} · ${esc(NKIND_ZH[m.kind])}</span> ${esc(m.title)}${m.raw.summary && m.kind !== "brief" && m !== it.thread[it.thread.length - 1] ? `<div class="muted small">${esc(m.raw.summary)}</div>` : ""} <span class="src">${srcLinks(m.raw.sources, 1)}</span></li>`;
  return `<div class="nthread"><b>来龙去脉（${it.thread.length} 条，${esc(it.thread[0].date.slice(5))} → ${esc(it.thread[it.thread.length - 1].date.slice(5))}）</b><ol>${it.thread.map(li).join("")}</ol><b>最新：</b></div>`;
}

// 只含本事件相关公司的小关系图：节点 = 直接影响 + 传导 + 涉及公司，连线 = 图谱中它们之间的关系
function drawMiniGraph(it, g) {
  const el = byId(`mg-${it.id}`);
  if (!el || !g || !window.echarts) return;
  const impact = {};
  for (const c of it.companies) impact[c.t] = c.dir;
  for (const p of it.raw.propagation || []) if (p.relation !== "industry" && !(p.node in impact)) impact[p.node] = p.direction;
  const ids = new Set(Object.keys(impact).filter((t) => g.nodes.some((n) => n.id === t)));
  const edges = g.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  if (ids.size < 2 || !edges.length) { el.remove(); return; }
  el.style.height = `${Math.min(300, 140 + ids.size * 14)}px`;
  const color = { positive: "#0ca30c", negative: "#d03b3b", mixed: "#fab219", neutral: "#898781" };
  const ec = edgeColors();
  const c = echarts.init(el);
  charts.push(c);
  c.setOption(baseOption({
    tooltip: { trigger: "item", formatter: (p) => (p.dataType === "edge" ? `${esc(p.data.source)} → ${esc(p.data.target)}<br>${EDGE_ZH[p.data.relation]}：${esc(p.data.value)}` : `<b>${esc(p.data.id)}</b> ${esc(META.names_zh?.[p.data.id] || "")}${impact[p.data.id] ? `<br>${DIR_ZH[impact[p.data.id]]}` : ""}`) },
    legend: { show: false },
    series: [{ type: "graph", layout: "force", roam: false, data: [...ids].map((t) => ({ id: t, name: t, symbolSize: 16,
      itemStyle: { color: color[impact[t]] || BENCH_GRAY(), borderColor: css("--surface"), borderWidth: 2 }, label: { show: true, position: "right", color: css("--ink-2"), fontSize: 11 } })),
      links: edges.map((e) => ({ source: e.source, target: e.target, value: e.note, relation: e.type, symbol: e.type === "supplier" ? ["none", "arrow"] : ["none", "none"], symbolSize: 6,
        lineStyle: { color: ec[e.type], width: 1.4, opacity: 0.8, curveness: 0.1, type: e.type === "competitor" ? "dashed" : "solid" } })),
      force: { repulsion: 160, edgeLength: [50, 90], gravity: 0.12 } }],
  }));
  c.on("click", (p) => { if (p.dataType === "node" && META.universe.some((u) => u.ticker === p.data.id)) location.hash = `#/stock/${p.data.id}`; });
}

const NEWS_HOWTO2 = [
  "每行是一条新闻：● 圆点颜色 = 方向（绿利好 / 红利空 / 黄不一 / 灰中性），之后是类别（宏观与政策 / 深度分析 / 简讯）、标题、分类标签和相关公司（● = 持仓）。点击一行展开详情，再点收起。",
  "上方标签用来筛选：同一行内单选，再点一次取消。“政策”标签来自 AI 对每篇报道的政策类型判断；“范围”只对宏观事件有意义。",
  "展开后右边是相关公司：直接影响、[[supply_chain|产业链传导]]（AI 推断，看置信度），下方小图只画出这些公司之间的供应 / 竞争 / 合作关系；完整的公司关系图在“产业链”页。宏观消息还会列出它落到你持仓的哪些部分、各占账户多少。",
  "“新”= 上次打开网页之后新增（只记在这台设备的浏览器里）。🧵 = 同一件事连续几天都有报道，已合成一条，展开后按时间看来龙去脉；不想合并可关掉上方的“合并同一件事”。",
];

PAGES.news = async (r) => {
  const idx = await load("news/index.json");
  const days = idx.days;
  const weeks = idx.weeks || [];
  if (!days.length && !weeks.length) { app().innerHTML = card("新闻", empty("尚无新闻存档。")); return; }
  const latest = days.length ? days[days.length - 1].date : weeks[weeks.length - 1].week_end;
  const weekOf = (d) => { const x = new Date(`${d}T12:00:00Z`); const wd = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - wd); return x.toISOString().slice(0, 10); };
  const plusDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const curWeek = weekOf(latest);
  const week = r.query.date ? null : (r.query.week || curWeek);
  const pickDays = week ? days.filter((d) => d.date >= week && d.date <= plusDays(week, 6)) : days.filter((d) => d.date === r.query.date);
  const [recs, digest] = await Promise.all([
    Promise.all(pickDays.map((d) => load(`news/${d.date}.json`))),
    week && weeks.some((w) => w.week_start === week) ? load(`news/weeks/${week}.json`) : Promise.resolve(null),
  ]);
  const ticker = r.query.ticker || "";
  const held = new Set(heldTickers());
  const [w, seg] = await Promise.all([myWeights().catch(() => null), load("segments.json").catch(() => null)]);
  NEWS_CTX = { w, seg };
  const all = newsItems(recs, digest, week);
  const merged = r.query.nomerge ? all.filter((it) => itemMatches(it, r.query, ticker, held)) : mergeThreads(all.filter((it) => itemMatches(it, r.query, ticker, held)));
  const items = r.query.unread ? merged.filter((it) => (it.thread || [it]).some(isUnread)) : merged;
  const unreadN = merged.filter((it) => (it.thread || [it]).some(isUnread)).length;
  // 每个筛选标签的条数（在其他筛选条件下）
  const countFor = (key, val) => all.filter((it) => itemMatches(it, { ...r.query, [key]: val }, ticker, held)).length;
  const q = (o) => { const p = new URLSearchParams({ ...r.query, ...o }); for (const [k, v] of [...p]) if (!v) p.delete(k); return `#/news?${p}`; };
  const filterRow = ([key, label, opts]) => {
    const chips = Object.entries(opts).map(([k, n]) => [k, n, countFor(key, k)]).filter(([k, , c]) => c || r.query[key] === k);
    if (!chips.length) return "";
    return `<div class="frow"><span class="flabel">${label}</span>${chips.map(([k, n, c]) => `<a class="chip ${r.query[key] === k ? "on" : ""}" href="${q({ [key]: r.query[key] === k ? "" : k, open: "" })}">${esc(n)} <span class="muted">${c}</span></a>`).join("")}</div>`;
  };
  const allWeeks = [...new Set([curWeek, ...weeks.map((w) => w.week_start), ...days.map((d) => weekOf(d.date))])].sort().reverse();
  const weekOpts = allWeeks.map((w) => `<option value="w:${w}" ${week === w ? "selected" : ""}>${w === curWeek ? "本周" : "周"} ${w} – ${plusDays(w, 6).slice(5)}</option>`).join("");
  const dayOpts = [...days].reverse().slice(0, 21).map((d) => `<option value="d:${d.date}" ${r.query.date === d.date ? "selected" : ""}>${d.date}${d.mode === "weekend" ? "（周末汇总）" : d.mode === "backfill" ? "（回补）" : ""}</option>`).join("");
  const tickOpts = `<option value="">全部股票</option>` + META.universe.map((u) => `<option value="${u.ticker}" ${u.ticker === ticker ? "selected" : ""}>${esc(tickerLabel(u.ticker))}</option>`).join("");
  // 旧链接 ?event=<id>（Discord、个股页“相关事件”）：展开对应条目
  const evKey = r.query.event ? items.find((it) => it.id === r.query.event || (it.thread || []).some((m) => m.id === r.query.event)) : null;
  const openKey = r.query.open || (evKey ? `${evKey.kind}:${evKey.id}` : "");
  let lastDate = "";
  const list = items.slice(0, 300).map((it) => {
    const head = it.date !== lastDate ? `<h4 class="ndate">${esc(it.date)}（周${WD_ZH[new Date(`${it.date}T12:00:00Z`).getUTCDay()]}）</h4>` : "";
    lastDate = it.date;
    return head + newsRow(it, held, openKey === `${it.kind}:${it.id}`);
  }).join("");
  const articles = recs.flatMap((rec) => rec.articles || []).filter((a) => !ticker || (a.tickers || []).includes(ticker));
  const deepEvents = items.filter((it) => it.kind === "deep").map((it) => ({ ...it.raw, date: it.date }));
  const digestHtml = digest?.digest ? card(`本周摘要（${digest.week_start} – ${digest.week_end}）`,
    `<p>${esc(digest.digest.summary)}</p><ul>${digest.digest.highlights.map((h) => `<li>${esc(h.text)} <span class="src">${srcLinks(h.sources, 1)}</span></li>`).join("")}</ul>`) : "";
  const active = NEWS_FILTERS.some(([k]) => r.query[k]) || r.query.held || r.query.unread;
  app().innerHTML = `
    <h2>新闻 <span class="muted">${items.length} 条${active || ticker ? `（共 ${all.length} 条）` : ""}${unreadN ? ` · <b class="nnew-t">${unreadN} 条新</b>` : ""} · 宏观 ${all.filter((x) => x.kind === "macro").length} · 深度 ${all.filter((x) => x.kind === "deep").length} · 简讯 ${all.filter((x) => x.kind === "brief").length}</span></h2>
    <section class="card nfilters"><div class="row">
      <label>范围 <select id="n-range"><optgroup label="按周">${weekOpts}</optgroup><optgroup label="按天（最近 21 天）">${dayOpts}</optgroup></select></label>
      <label>股票 <select id="n-ticker">${tickOpts}</select></label>
      <a class="chip ${r.query.held ? "on" : ""}" href="${q({ held: r.query.held ? "" : "1", open: "" })}">● 只看与持仓相关</a>
      <a class="chip ${r.query.unread ? "on" : ""}" href="${q({ unread: r.query.unread ? "" : "1", open: "" })}" title="上次打开网页之后新增的条目（记录只保存在这台设备的浏览器里）">只看新的 <span class="muted">${unreadN}</span></a>
      <a class="chip ${r.query.nomerge ? "" : "on"}" href="${q({ nomerge: r.query.nomerge ? "" : "1", open: "" })}" title="同一件事连续几天都有报道时合成一条，展开看来龙去脉">🧵 合并同一件事</a>
      ${active ? `<a class="chip" href="${q(Object.fromEntries([...NEWS_FILTERS.map(([k]) => [k, ""]), ["held", ""], ["unread", ""], ["open", ""]]))}">清除筛选</a>` : ""}</div>
      ${NEWS_FILTERS.map(filterRow).join("")}</section>
    <div class="news-layout">
      <div class="news-main">${howto(NEWS_HOWTO2)}<section class="card nlist">${list || empty("没有符合条件的新闻")}${items.length > 300 ? `<p class="muted">只显示前 300 条，请缩小范围。</p>` : ""}</section>
        <details class="card"><summary>相关报道原文（${articles.length} 篇）</summary>${newsSourceLine(recs)}<div class="table-wrap"><table><tbody>${articles.slice(0, 120).map((a) => `<tr><td class="num ${cls(a.sentiment)}">${num(a.sentiment, 2, true)}</td><td class="wrap"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a> <span class="muted">${esc(a.publisher || "")} · ${esc((a.published || "").slice(5, 16).replace("T", " "))}</span></td></tr>`).join("")}</tbody></table></div></details></div>
      <aside class="news-side">${insightBox(newsInsights(deepEvents))}
        ${personalNewsCard(personalNews(pickDays.map((d) => d.date)).filter((n) => !ticker || (n.lines || []).some((l) => l.startsWith(ticker))))}
        ${digestHtml}
        <section class="card"><h3>更多</h3><p><a href="#/macro">宏观与异动 →</a> 市场异动日、政策不确定性、预测市场概率</p><p><a href="#/retail">散户热度 →</a> Stocktwits / Reddit 讨论与情绪</p><p><a href="#/chain">产业链全图 →</a></p></section></aside>
    </div>`;
  byId("n-range").onchange = (e) => { const [k, v] = e.target.value.split(":"); location.hash = q({ week: k === "w" ? v : "", date: k === "d" ? v : "", open: "" }); };
  byId("n-ticker").onchange = (e) => { location.hash = q({ ticker: e.target.value, open: "" }); };
  const byKey = Object.fromEntries(items.map((it) => [`${it.kind}:${it.id}`, it]));
  markSeen(all.map(itemKey)); // 本次看到的都记为已读（本次打开期间“新”标记保留）
  // 展开 / 收起：不改地址（避免整页重绘与滚动跳动），只更新这一行
  document.querySelectorAll(".nrow .nhead").forEach((h) => h.addEventListener("click", (ev) => {
    if (ev.target.closest("a")) return;
    const row = h.parentElement;
    const it = byKey[row.dataset.key];
    const open = !row.classList.contains("open");
    row.classList.toggle("open", open);
    row.querySelector(".ndetail").innerHTML = open ? newsDetail(it) : "";
    if (open) drawMiniGraph(it, idx.graph);
  }));
  if (openKey && byKey[openKey]) {
    drawMiniGraph(byKey[openKey], idx.graph);
    document.querySelector(`.nrow[data-key="${CSS.escape(openKey)}"]`)?.scrollIntoView({ block: "center" });
  }
};

// ---------------- 个股页“相关事件”（M43）：同样的折叠行，展开时再加载当天存档 ----------------
function stockEventsHtml(events) {
  if (!events.length) return empty("近期没有深度分析事件");
  const row = (e) => `<article class="nrow deep" data-se="${esc(e.date)}|${esc(e.id)}|${esc(e.week || "")}">
    <div class="nhead">${dirDot(e.direction)}<span class="muted small">${esc(e.date.slice(5))}</span><span class="nkind k-deep">${esc(EVENT_ZH[e.event_type] || "事件")}</span><span class="ntitle">${esc(e.headline)}</span>
      <span class="ntags">${e.more?.length ? `<span class="chip thread" title="${esc(e.more.map((m) => `${m.date} ${m.headline}`).join("\n"))}">🧵 后续 ${e.more.length} 条</span>` : ""}</span></div><div class="ndetail"></div></article>`;
  const SHOW = 8; // 默认只显示最近 8 条
  return `<div class="nlist">${[...events].reverse().map((e, i) => row(e).replace('<article class="nrow deep"', `<article class="nrow deep${i >= SHOW ? " x-more" : ""}"`)).join("")}</div>${moreButton(events.length, SHOW)}<p class="muted small">点击一行展开详情；<a href="#/news">全部新闻 →</a></p>`;
}
async function findNewsItem(date, id, week) {
  try { const it = newsItems([await load(`news/${date}.json`)], null, null).find((x) => x.id === id); if (it) return it; } catch { /* 当天存档不在网站数据中 */ }
  if (week) try { return newsItems([], await load(`news/weeks/${week}.json`), week).find((x) => x.id === id) || null; } catch { /* 无周摘要 */ }
  return null;
}
function bindStockEvents(graph) {
  document.querySelectorAll(".nrow[data-se] > .nhead").forEach((h) => h.addEventListener("click", async (ev) => {
    if (ev.target.closest("a")) return;
    const row = h.parentElement;
    const open = !row.classList.contains("open");
    row.classList.toggle("open", open);
    const box = row.querySelector(".ndetail");
    if (!open) { box.innerHTML = ""; return; }
    const [date, id, week] = row.dataset.se.split("|");
    box.innerHTML = `<p class="muted">加载中…</p>`;
    const it = await findNewsItem(date, id, week);
    if (!row.classList.contains("open")) return;
    box.innerHTML = it ? newsDetail(it) : `<p class="muted">找不到这条事件的详情，<a href="#/news?date=${esc(date)}&event=${esc(id)}">到新闻页查看 →</a></p>`;
    if (it) drawMiniGraph(it, graph);
  }));
}
