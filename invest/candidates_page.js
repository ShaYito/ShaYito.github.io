"use strict";
/* 产业链页“AI 相关股票候选池”（data/candidates.json，每周扫描）：
   来源 = 主题 ETF 持仓 + SEC 全文检索；门槛 = 市值与成交额；证据 = ETF、申报文件检索、年报 AI 文本强度、年报点名的 AI 生态公司。
   权重调节器：在本页按自定义权重重算得分与排名（只影响显示，保存在本机）；可同时显示现有选股池的得分作对比。
   审核按钮触发 review-candidate workflow（复用“同步到后台”的 GitHub token）：关注 / 加入选股池 / 忽略 / 撤销。 */

const CAND_COMP = { etf: "ETF 持有", filings: "申报文件检索", text: "年报 AI 文本强度", relations: "点名 AI 生态公司" };
const CAND_REVIEW_ZH = { watch: "已关注", add: "已加入选股池", ignore: "已忽略" };
const CAND_W_KEY = "invest.cand.weights";
let CAND_STATE = { filter: "pending", all: false, uni: true };
const capFmt = (v) => (!isNum(v) ? "–" : v >= 1e12 ? `${num(v / 1e12, 2)} 万亿` : `${Math.round(v / 1e8).toLocaleString()} 亿`);

// 四类证据的计算方式与可信度（页面常驻说明）
const CAND_METHOD = [
  ["etf", "被几只 AI / 半导体主题 ETF 持有：持有 0 / 1 / 2 / 3 只及以上 = 0 / 33% / 67% / 100%。",
    "中", "ETF 发行商按各自指数规则选股，“AI 主题”定义较宽（会包含特斯拉、百度、互联网与数据中心 REIT）；目前只取到 4 只免费公开持仓的 ETF（iShares、VanEck 等需要浏览器会话），大公司更容易被多只持有；被持有不代表收入来自 AI。"],
  ["filings", "SEC 全文检索近 15 个月的年报、季报与 8-K：命中几个 AI 检索短语（占 50%），以及命中文件总数（取对数，20 份及以上满分，占 50%）。",
    "中–低", "实测 EDGAR 全文检索没有收录部分大公司的年报 / 季报（如 Dell 只命中 8-K 与委托书），会系统性低估这些公司；季报多的公司命中更多；外国公司只交年报（20-F），命中偏少；检索短语偏硬件与基础设施（“NVIDIA”“hyperscale”“AI infrastructure”“accelerated computing”“AI data center”），文件中出现也可能只是风险因素或竞争描述。"],
  ["text", "直接下载最新年报（10-K / 20-F / 40-F）全文，统计下列 AI 关键词（整词匹配、不区分大小写）每万词合计出现次数，在本页全部股票（候选 + 选股池）中按排名换算成 0–100%；没有年报按 0 分。关键词：{TERMS}。",
    "中–低", "只数词频、不看收入：管理层“讲 AI”多不等于 AI 收入多；“data center”“inference”等词也用于非 AI 语境；年报越长（含大量财务报表、业务线多）密度越被稀释（如 Dell、Apple 偏低）；是相对排名，会随参与比较的股票变化。"],
  ["relations", "最新年报中点名了几家选股池里的 AI 生态公司（半导体、云与 AI 平台、AI 基础设施、消费科技主题；不含自己）：5 家及以上满分；没有年报按 0 分。",
    "中", "被点名的可能是客户、供应商、合作方，也可能是竞争对手，需看“证据与审核”里的原文摘录判断；业务线多的大公司天然点名更多；公司别名有限（如只认“Nvidia”），个别写法会漏。客户集中度披露（如“客户包括 Microsoft、Meta”）是这一项里最有力的证据。"],
];

function candWeights(def) {
  try { const w = JSON.parse(localStorage.getItem(CAND_W_KEY) || "null"); if (w && Object.keys(CAND_COMP).every((k) => isNum(w[k]))) return w; } catch { /* 忽略 */ }
  return { ...def };
}
// 按权重计算得分（0–100）：缺失的证据（没有年报）按 0 分
function candScore(r, w) {
  const ws = Object.keys(CAND_COMP).reduce((a, k) => a + (w[k] || 0), 0);
  return ws > 0 ? (Object.keys(CAND_COMP).reduce((a, k) => a + (w[k] || 0) * (r.components[k] ?? 0), 0) / ws) * 100 : 0;
}

async function drawCandidates() {
  const host = byId("cand-card");
  if (!host) return;
  const d = await load("candidates.json").catch(() => null);
  if (!d?.candidates) { host.innerHTML = `<h3>AI 相关股票候选池</h3>${empty("尚未扫描（每周日自动更新）")}`; return; }
  const uniRows = (d.universe || []).map((r) => ({ ...r, group: "universe" }));
  const status = (r) => (r.group === "universe" || r.in_universe ? "add" : r.review?.action || "pending");
  const counts = { pending: 0, watch: 0, add: 0, ignore: 0 };
  d.candidates.forEach((r) => { counts[status(r)] = (counts[status(r)] || 0) + 1; });
  const themes = META.themes.map((t) => `<option value="${t.key}">${esc(t.name)}</option>`).join("");
  const seg = [["pending", "待审核"], ["watch", "已关注"], ["add", "已加入"], ["ignore", "已忽略"], ["all", "全部"]];
  host.innerHTML = `<h3>AI 相关股票候选池 ${badge("fact")}${badge("derived")}<span class="muted" style="font-weight:400"> 扫描于 ${esc(d.generated)} · ${d.candidates.length} 只候选通过门槛</span></h3>
    <p class="muted">${rich(`从公开数据中找出选股池以外、与 AI 相关的美国上市公司（含 ADR），每周日更新；只列证据，不判断投资价值，加入关注 / 选股池由你审核。来源：${d.sources.etfs.map((e) => `${e.ticker}（${e.name}，${e.holdings} 只）`).join("、")} 的持仓，以及 SEC 全文检索（近 15 个月年报、季报与 8-K 中提到 ${Object.keys(d.sources.sec_queries).map((q) => `“${q}”`).join("、")} 的公司）。门槛：市值 ≥ ${capFmt(d.thresholds.min_market_cap)} 美元、近 3 个月日均成交额 ≥ ${num(d.thresholds.min_dollar_volume / 1e6, 0)} 百万美元。`)}</p>
    <details class="howto" open><summary>四类得分怎么算、可信度如何</summary>
      <div class="table-wrap"><table class="cand-method"><thead><tr><th style="width:14%">证据</th><th>怎么算</th><th style="width:7%">可信度</th><th style="width:38%">已知问题</th></tr></thead><tbody>
      ${CAND_METHOD.map(([k, how, rel, issue]) => `<tr><td><span class="cand-dot seg-${k}"></span><b>${CAND_COMP[k]}</b></td><td>${esc(how.replace("{TERMS}", (d.ai_terms || []).map((x) => `“${x}”`).join("、")))}</td><td><b>${esc(rel)}</b></td><td class="muted">${esc(issue)}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted">总分 = 四项按权重加权平均 × 100（没有年报的股票，文本强度与点名两项按 0 分）。页面只保留得分前 ${d.max_candidates || 100} 只候选（已审核过的始终保留）。这个得分衡量的是“公开文件中与 AI 相关的证据有多少”，用于缩小研究范围，<b>不是质量、估值或未来收益的预测，也没有做过回测验证</b>；以软件为主的 AI 公司（如 Palantir）信号较弱、得分偏低；比特币矿商转型 AI 数据中心的也会出现。勾选“同时显示选股池”可以看到现有股票在同一尺子下的得分，用来校准：选股池里一些明显与 AI 相关的公司（如 Dell）得分也不高，正是上表“已知问题”造成的。加入选股池后会参与系统模型的训练与回测，但它“被挑中”本身带有事后选择偏差，建议先关注观察一段时间。</p></details>
    <div class="cand-weights"><b>权重</b> <span class="muted">（拖动即时重算得分与排名；只影响本页显示，记在这台设备）</span>
      ${Object.keys(CAND_COMP).map((k) => `<label class="cand-w"><span class="cand-dot seg-${k}"></span>${CAND_COMP[k]} <input type="range" min="0" max="50" step="5" data-w="${k}"><b data-wv="${k}"></b></label>`).join("")}
      <button type="button" class="ghost sm" id="cand-w-reset">恢复默认（各 ${d.weights.etf}）</button></div>
    <div class="row"><div class="seg" id="cand-f">${seg.map(([k, n]) => `<button type="button" data-v="${k}" class="${CAND_STATE.filter === k ? "on" : ""}">${n}${k !== "all" ? `（${counts[k] || 0}）` : ""}</button>`).join("")}</div>
      <label><input type="checkbox" id="cand-uni" ${CAND_STATE.uni ? "checked" : ""}> 同时显示选股池（${uniRows.length} 只，对比）</label></div>
    <div id="cand-body"></div>`;

  let W = candWeights(d.weights);
  const total = () => Object.values(W).reduce((a, b) => a + b, 0) || 1;
  const sync = () => {
    host.querySelectorAll("[data-w]").forEach((el) => { el.value = W[el.dataset.w]; });
    host.querySelectorAll("[data-wv]").forEach((el) => { el.textContent = `${W[el.dataset.wv]}（${Math.round((W[el.dataset.wv] / total()) * 100)}%）`; });
  };
  const bar = (r) => `<div class="cand-bar" title="${esc(Object.entries(r.components).map(([k, v]) => `${CAND_COMP[k]}：${v == null ? "无年报，按 0 分" : `${Math.round(v * 100)}%`}`).join("\n"))}">
      ${Object.entries(r.components).map(([k, v]) => `<span class="seg-${k}" style="width:${v == null ? 0 : (v * W[k]) / total() * 100}%"></span>`).join("")}</div>`;
  const named = (a) => Object.keys(a?.named || {}).slice(0, 6).map((t) => `<span class="chip">${esc(t)}</span>`).join("");
  const row = (r, i) => {
    const a = r.annual, st = status(r), isUni = r.group === "universe";
    return `<tr class="${st === "ignore" ? "muted" : ""} ${isUni ? "uni-row" : ""}"><td class="num">${i + 1}</td>
      <td><b>${esc(r.ticker)}</b>${isUni ? ' <span class="chip on">选股池</span>' : ""} <span class="muted">${esc((r.name || r.sec_name || "").slice(0, 40))}</span><br><span class="muted">${esc(r.industry || "")} · ${esc(r.exchange)}</span></td>
      <td class="num">${capFmt(r.market_cap)}</td><td class="num"><b>${num(r._score, 0)}</b>${bar(r)}</td>
      <td class="wrap">${Object.keys(r.etfs).map((e) => `<span class="chip" title="权重 ${pct(r.etfs[e], 2)}">${esc(e)}</span>`).join("")} ${Object.keys(r.queries).length ? `<span class="muted">检索命中 ${Object.keys(r.queries).length} 词 / ${Object.values(r.queries).reduce((x, y) => x + y, 0)} 份文件</span>` : ""}
        ${a ? `<br><span class="muted">年报 AI 词密度 ${num(a.ai_density, 1)}/万词 · 点名</span> ${named(a) || '<span class="muted">无</span>'}` : '<br><span class="muted">未取到年报</span>'}</td>
      <td>${!isUni && st !== "pending" ? `<span class="chip ${st === "add" ? "on" : ""}">${CAND_REVIEW_ZH[st] || st}</span>` : ""}
        ${isUni || r.in_universe ? "" : `<div class="cand-act cand-quick" data-t="${esc(r.ticker)}">
          ${st !== "watch" ? '<button type="button" class="ghost sm" data-act="watch">关注</button>' : ""}
          ${st !== "ignore" ? '<button type="button" class="ghost sm" data-act="ignore">忽略</button>' : ""}
          ${st !== "pending" ? '<button type="button" class="ghost sm" data-act="reset">撤销</button>' : ""}
          <button type="button" class="ghost sm cand-open" title="展开下方，选择主题并填写中文名">加入选股池…</button></div>`}</td></tr>
      <tr class="cand-detail ${isUni ? "uni-row" : ""}"><td></td><td colspan="5"><details><summary>证据${isUni ? "" : "与审核"}</summary>
        ${a ? `<p class="muted">最新年报：<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.form)}（${esc(a.date)}）</a>；点名次数：${esc(Object.entries(a.named || {}).map(([t, n]) => `${t} ${n}`).join("、") || "无")}（可能是客户、供应商、合作方，也可能是竞争对手，见摘录）</p>
          ${a.snippets?.length ? `<ul class="cand-snip">${a.snippets.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}` : ""}
        ${Object.keys(r.queries).length ? `<p class="muted">SEC 全文检索（近 15 个月年报、季报、8-K）：${esc(Object.entries(r.queries).map(([q, n]) => `“${q}” ${n} 份`).join("、"))}</p>` : ""}
        <p class="muted">收入增速 ${isNum(r.revenue_growth) ? pct(r.revenue_growth, 0, true) : "–"} · 日均成交额 ${isNum(r.dollar_volume) ? `${num(r.dollar_volume / 1e6, 0)} 百万美元` : "–"} · ${isUni ? `<a href="#/stock/${esc(r.ticker)}">个股页</a>` : `<a href="https://finance.yahoo.com/quote/${esc(r.ticker)}" target="_blank" rel="noopener">Yahoo 行情</a>`}</p>
        ${isUni ? "" : r.in_universe ? '<p class="pos">已在选股池中。</p>' : `<div class="row cand-act" data-t="${esc(r.ticker)}">
          <button type="button" class="ghost" data-act="watch">关注</button><button type="button" class="ghost" data-act="ignore">忽略</button>
          ${st !== "pending" ? '<button type="button" class="ghost" data-act="reset">撤销</button>' : ""}
          <span class="muted">加入选股池：</span><select class="cand-theme">${themes}</select><input class="cand-name" placeholder="中文名（如 博通）" style="width:130px" maxlength="30">
          <button type="button" class="primary" data-act="add">加入选股池</button></div>`}
      </details></td></tr>`;
  };
  const renderTable = () => {
    const cands = d.candidates.filter((r) => CAND_STATE.filter === "all" || status(r) === CAND_STATE.filter);
    const all = [...cands, ...(CAND_STATE.uni ? uniRows : [])];
    all.forEach((r) => { r._score = candScore(r, W); });
    all.sort((a, b) => b._score - a._score);
    const shown = CAND_STATE.all ? all : all.slice(0, 40);
    byId("cand-body").innerHTML = `<div class="table-wrap"><table class="cand-table"><colgroup><col style="width:4%"><col style="width:23%"><col style="width:9%"><col style="width:10%"><col style="width:38%"><col style="width:16%"></colgroup>
      <thead><tr><th class="num">#</th><th>公司</th><th class="num">市值（美元）</th><th class="num">得分</th><th>证据</th><th>审核</th></tr></thead>
      <tbody>${shown.map(row).join("") || `<tr><td colspan="6" class="muted">没有符合条件的候选</td></tr>`}</tbody></table></div>
      ${all.length > shown.length ? `<p><button type="button" class="ghost" id="cand-more">显示全部 ${all.length} 只</button></p>` : ""}`;
    byId("cand-more")?.addEventListener("click", () => { CAND_STATE.all = true; renderTable(); });
    host.querySelectorAll(".cand-act button[data-act]").forEach((b) => (b.onclick = () => candReview(b)));
    // “加入选股池…”：展开这一行下方的证据与审核，定位到中文名输入框
    host.querySelectorAll(".cand-open").forEach((b) => (b.onclick = () => {
      const det = b.closest("tr").nextElementSibling?.querySelector("details");
      if (!det) return;
      det.open = true;
      det.querySelector(".cand-name")?.focus();
    }));
  };
  host.querySelectorAll("[data-w]").forEach((el) => (el.oninput = () => {
    W = { ...W, [el.dataset.w]: +el.value };
    try { localStorage.setItem(CAND_W_KEY, JSON.stringify(W)); } catch { /* 忽略 */ }
    sync(); renderTable();
  }));
  byId("cand-w-reset").onclick = () => { W = { ...d.weights }; try { localStorage.removeItem(CAND_W_KEY); } catch { /* 忽略 */ } sync(); renderTable(); };
  host.querySelectorAll("#cand-f button").forEach((b) => (b.onclick = () => {
    CAND_STATE = { ...CAND_STATE, filter: b.dataset.v, all: false };
    host.querySelectorAll("#cand-f button").forEach((x) => x.classList.toggle("on", x === b));
    renderTable();
  }));
  byId("cand-uni").onchange = (e) => { CAND_STATE.uni = e.target.checked; renderTable(); };
  sync(); renderTable();
}

async function candReview(b) {
  const box = b.closest(".cand-act"), t = box.dataset.t, act = b.dataset.act;
  const say = (msg, c = "muted") => { box.innerHTML = `<span class="${c}">${esc(msg)}</span>`; };
  let token = ""; try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch { /* 忽略 */ }
  if (!token) { alert("请先在“我的持仓 → 持仓 → 同步设置”中保存 GitHub token（只需 Actions 写权限）"); return; }
  const theme = box.querySelector(".cand-theme")?.value || "", name = (box.querySelector(".cand-name")?.value || "").trim();
  if (act === "add" && !name) { alert("加入选股池需要填写中文名"); return; }
  const what = { watch: "关注", ignore: "忽略", reset: "撤销审核", add: `加入选股池（主题：${themeName(theme)}，中文名：${name}）` }[act];
  if (!confirm(`确认对 ${t} ${what}？${act === "add" ? "\n加入后会修改配置，从下次运行起参与系统模型的选股、训练与回测。" : ""}`)) return;
  box.querySelectorAll("button, select, input").forEach((x) => { x.disabled = true; });
  try {
    const resp = await fetch(`https://api.github.com/repos/${META.github_repo}/actions/workflows/review-candidate.yml/dispatches`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ ref: "main", inputs: { ticker: t, action: act, theme: act === "add" ? theme : "", name_zh: act === "add" ? name : "" } }),
    });
    if (resp.status === 204) say(`✓ 已提交${what}；约 2–3 分钟后网页更新（刷新页面查看）`, "pos");
    else say(`提交失败：HTTP ${resp.status}${resp.status === 401 || resp.status === 403 ? "（token 无效或缺少 Actions 写权限）" : resp.status === 404 ? "（token 没有该仓库权限）" : ""}`, "neg");
  } catch (e) { say(`提交失败：${e.message}`, "neg"); }
}
