"use strict";
/* 产业链页“AI 相关股票候选池”（data/candidates.json，每周扫描）：
   来源 = 主题 ETF 持仓 + SEC 全文检索；门槛 = 市值与成交额；证据 = ETF、申报文件检索、年报 AI 文本强度、年报点名的 AI 生态公司。
   审核按钮触发 review-candidate workflow（复用“同步到后台”的 GitHub token）：关注 / 加入选股池 / 忽略 / 撤销。 */

const CAND_COMP = { etf: "ETF 持有", filings: "申报文件检索", text: "年报 AI 文本强度", relations: "点名 AI 生态公司" };
const CAND_REVIEW_ZH = { watch: "已关注", add: "已加入选股池", ignore: "已忽略" };
let CAND_STATE = { filter: "pending", all: false };
const capFmt = (v) => (!isNum(v) ? "–" : v >= 1e12 ? `${num(v / 1e12, 2)} 万亿` : `${Math.round(v / 1e8).toLocaleString()} 亿`);

async function drawCandidates() {
  const host = byId("cand-card");
  if (!host) return;
  const d = await load("candidates.json").catch(() => null);
  if (!d?.candidates) { host.innerHTML = `<h3>AI 相关股票候选池</h3>${empty("尚未扫描（每周日自动更新）")}`; return; }
  const status = (r) => (r.in_universe ? "add" : r.review?.action || "pending");
  const counts = { pending: 0, watch: 0, add: 0, ignore: 0 };
  d.candidates.forEach((r) => { counts[status(r)] = (counts[status(r)] || 0) + 1; });
  const list = d.candidates.filter((r) => CAND_STATE.filter === "all" || status(r) === CAND_STATE.filter);
  const shown = CAND_STATE.all ? list : list.slice(0, 30);
  const bar = (r) => `<div class="cand-bar" title="${esc(Object.entries(r.components).map(([k, v]) => `${CAND_COMP[k]}：${v == null ? "无年报，不计入" : `${Math.round(v * 100)}%`}`).join("\n"))}">
    ${Object.entries(r.components).map(([k, v]) => `<span class="seg-${k}" style="width:${v == null ? 0 : (v * d.weights[k]) / 100 * 100}%"></span>`).join("")}</div>`;
  const named = (a) => Object.keys(a?.named || {}).slice(0, 6).map((t) => `<span class="chip">${esc(t)}</span>`).join("");
  const themes = META.themes.map((t) => `<option value="${t.key}">${esc(t.name)}</option>`).join("");
  const row = (r, i) => {
    const a = r.annual, st = status(r);
    return `<tr class="${st === "ignore" ? "muted" : ""}"><td class="num">${i + 1}</td>
      <td><b>${esc(r.ticker)}</b> <span class="muted">${esc((r.name || r.sec_name || "").slice(0, 40))}</span><br><span class="muted">${esc(r.industry || "")} · ${esc(r.exchange)}</span></td>
      <td class="num">${capFmt(r.market_cap)}</td><td class="num"><b>${num(r.score, 0)}</b>${bar(r)}</td>
      <td class="wrap">${Object.keys(r.etfs).map((e) => `<span class="chip" title="权重 ${pct(r.etfs[e], 2)}">${esc(e)}</span>`).join("")} ${Object.keys(r.queries).length ? `<span class="muted">检索命中 ${Object.keys(r.queries).length} 词 / ${Object.values(r.queries).reduce((x, y) => x + y, 0)} 份文件</span>` : ""}
        ${a ? `<br><span class="muted">年报 AI 词密度 ${num(a.ai_density, 1)}/万词 · 点名</span> ${named(a) || '<span class="muted">无</span>'}` : '<br><span class="muted">未取到年报</span>'}</td>
      <td class="nowrap">${st !== "pending" ? `<span class="chip ${st === "add" ? "on" : ""}">${CAND_REVIEW_ZH[st] || st}</span>` : ""}</td></tr>
      <tr class="cand-detail"><td></td><td colspan="5"><details><summary>证据与审核</summary>
        ${a ? `<p class="muted">最新年报：<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.form)}（${esc(a.date)}）</a>；点名次数：${esc(Object.entries(a.named || {}).map(([t, n]) => `${t} ${n}`).join("、") || "无")}（可能是客户、供应商、合作方，也可能是竞争对手，见摘录）</p>
          ${a.snippets?.length ? `<ul class="cand-snip">${a.snippets.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}` : ""}
        ${Object.keys(r.queries).length ? `<p class="muted">SEC 全文检索（近 15 个月年报 / 季报）：${esc(Object.entries(r.queries).map(([q, n]) => `“${q}” ${n} 份`).join("、"))}</p>` : ""}
        <p class="muted">收入增速 ${isNum(r.revenue_growth) ? pct(r.revenue_growth, 0, true) : "–"} · 日均成交额 ${isNum(r.dollar_volume) ? `${num(r.dollar_volume / 1e6, 0)} 百万美元` : "–"} · <a href="https://finance.yahoo.com/quote/${esc(r.ticker)}" target="_blank" rel="noopener">Yahoo 行情</a></p>
        ${r.in_universe ? '<p class="pos">已在选股池中。</p>' : `<div class="row cand-act" data-t="${esc(r.ticker)}">
          <button type="button" class="ghost" data-act="watch">关注</button><button type="button" class="ghost" data-act="ignore">忽略</button>
          ${st !== "pending" ? '<button type="button" class="ghost" data-act="reset">撤销</button>' : ""}
          <span class="muted">加入选股池：</span><select class="cand-theme">${themes}</select><input class="cand-name" placeholder="中文名（如 博通）" style="width:130px" maxlength="30">
          <button type="button" class="primary" data-act="add">加入选股池</button></div>`}
      </details></td></tr>`;
  };
  const seg = [["pending", "待审核"], ["watch", "已关注"], ["add", "已加入"], ["ignore", "已忽略"], ["all", "全部"]];
  host.innerHTML = `<h3>AI 相关股票候选池 ${badge("fact")}${badge("derived")}<span class="muted" style="font-weight:400"> 扫描于 ${esc(d.generated)} · ${d.candidates.length} 只通过门槛</span></h3>
    <p class="muted">${rich(`从公开数据中找出选股池以外、与 AI 相关的美国上市公司（含 ADR），每周日更新；只列证据，不判断投资价值，加入关注 / 选股池由你审核。来源：${d.sources.etfs.map((e) => `${e.ticker}（${e.name}，${e.holdings} 只）`).join("、")} 的持仓，以及 SEC 全文检索（近 15 个月年报 / 季报中提到 ${Object.keys(d.sources.sec_queries).map((q) => `“${q}”`).join("、")} 的公司）。门槛：市值 ≥ ${capFmt(d.thresholds.min_market_cap)} 美元、近 3 个月日均成交额 ≥ ${num(d.thresholds.min_dollar_volume / 1e6, 0)} 百万美元。`)}</p>
    <p class="muted">得分（0–100）由四类证据各占 ${d.weights.etf} 分：${Object.values(CAND_COMP).join("、")}（色条从左到右依次对应）。局限：偏向在申报文件里大量谈论 AI 基础设施、数据中心的公司；以软件为主的 AI 公司（如 Palantir）信号较弱、得分偏低；“点名”的公司可能是客户、供应商，也可能是竞争对手；比特币矿商转型 AI 数据中心的也会出现。加入选股池后会参与系统模型的训练与回测，但它“被挑中”本身带有事后选择偏差，建议先关注观察一段时间。</p>
    <div class="row"><div class="seg" id="cand-f">${seg.map(([k, n]) => `<button type="button" data-v="${k}" class="${CAND_STATE.filter === k ? "on" : ""}">${n}${k !== "all" ? `（${counts[k] || 0}）` : ""}</button>`).join("")}</div></div>
    <div class="table-wrap"><table class="cand-table"><colgroup><col style="width:4%"><col style="width:25%"><col style="width:10%"><col style="width:11%"><col style="width:40%"><col style="width:10%"></colgroup><thead><tr><th class="num">#</th><th>公司</th><th class="num">市值（美元）</th><th class="num">得分</th><th>证据</th><th></th></tr></thead>
      <tbody>${shown.map(row).join("") || `<tr><td colspan="6" class="muted">没有符合条件的候选</td></tr>`}</tbody></table></div>
    ${list.length > shown.length ? `<p><button type="button" class="ghost" id="cand-more">显示全部 ${list.length} 只</button></p>` : ""}`;
  host.querySelectorAll("#cand-f button").forEach((b) => (b.onclick = () => { CAND_STATE = { filter: b.dataset.v, all: false }; drawCandidates(); }));
  byId("cand-more")?.addEventListener("click", () => { CAND_STATE.all = true; drawCandidates(); });
  host.querySelectorAll(".cand-act button").forEach((b) => (b.onclick = () => candReview(b)));
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
