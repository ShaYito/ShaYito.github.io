"use strict";
/* 我的持仓：数据只保存在本机浏览器（localStorage），“同步到后台”时用你自己的 GitHub token 触发私有仓库的
   update-holdings workflow（加密存储）。本页不会把持仓发送到任何其他地方。 */

const HOLD_KEY = "invest.holdings.v1";
const TOKEN_KEY = "invest.gh_token";
const HOLD_HOWTO = [
  "在这里按股数填写你的实际持仓与现金，点“保存到本机”：数据只存在这台设备的浏览器里，网站上的 ● 标记、本页的组合分析、“建议 vs 实际”调仓清单都会按你的持仓计算。换设备或清除浏览器数据后需要重新填写（或从后台同步前先导出一份）。",
  "点“同步到后台”：用你自己创建的 GitHub token 触发私有仓库里的更新任务，持仓加密保存为一条带日期的快照。之后每日推送的“与你持仓相关”、周报的“建议 vs 实际”调仓清单和[[tracking|实盘业绩]]都基于最新快照。每次实际调仓后同步一次，业绩跟踪最准确。",
  "价格：系统覆盖的标的自动使用最新收盘价；其他标的（如 VOO、TSLA）请手填估值价格。系统范围外的持仓不参与调仓计算，只计入总资产。",
  "“建议 vs 实际”按整股计算，零头留在现金，成本按单边 0.1% 估算；它是把模型建议换算成你的股数，[[model|模型建议]]本身可能出错，仅供参考。",
];

function loadHoldings() {
  try { const v = JSON.parse(localStorage.getItem(HOLD_KEY) || "null"); return v && v.positions ? v : null; } catch { return null; }
}
function saveHoldings(h) { try { localStorage.setItem(HOLD_KEY, JSON.stringify(h)); return true; } catch { return false; } }
function isHeld(t) {
  const h = loadHoldings();
  if (h && Object.keys(h.positions).length) return (h.positions[t] || 0) > 0;
  return !!META.universe.find((u) => u.ticker === t)?.held;
}
function holdingsMode() { const h = loadHoldings(); return h && Object.keys(h.positions).length ? "mine" : "suggested"; }

async function latestPrices() {
  const raw = await load("sim/prices.json");
  const out = {};
  for (const a of raw.assets) {
    const c = raw.close[a.ticker];
    for (let i = c.length - 1; i >= 0; i--) if (c[i] != null) { out[a.ticker] = c[i]; break; }
  }
  return { prices: out, asof: raw.dates[raw.dates.length - 1] };
}
async function suggestedTarget() {
  const o = await load("overview.json").catch(() => null);
  if (o?.available) return { target: Object.fromEntries(o.allocation.map((x) => [x.ticker, x.weight])), source: `周报 ${o.signal_date}` };
  const s = await load("sim/system.json").catch(() => null);
  if (s?.targets?.length) return { target: s.targets[s.targets.length - 1], source: `回测模拟 ${s.dates[s.dates.length - 1]}（首份正式周报前）` };
  return { target: {}, source: "无" };
}

PAGES.holdings = async () => {
  const [{ prices, asof }, sugg] = await Promise.all([latestPrices(), suggestedTarget()]);
  const saved = loadHoldings();
  let h = saved ? structuredClone(saved) : { date: new Date().toISOString().slice(0, 10), positions: {}, cash: 0, prices: {}, cost: {}, note: "" };
  h.prices ||= {}; h.cost ||= {};
  const sysSet = new Set(META.allocation_tickers_system || []);
  const money = (v) => (isNum(v) ? `${v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}` : "–");
  app().innerHTML = `
    <h2>我的持仓 <span class="muted">只保存在本机浏览器 · 价格截至 ${esc(asof)}</span></h2>
    ${howto(HOLD_HOWTO)}
    <section class="card"><h3>编辑持仓 ${badge("fact")}</h3>
      <div class="row"><label>快照日期 <input type="date" id="h-date" value="${esc(h.date)}"></label>
        <label>现金 <input type="number" id="h-cash" min="0" step="100" value="${h.cash || 0}" style="width:120px"></label>
        <label>备注 <input type="text" id="h-note" value="${esc(h.note || "")}" placeholder="如：调仓后" style="width:180px"></label></div>
      <div class="table-wrap"><table><thead><tr><th>代码</th><th>名称</th><th class="num">股数</th><th class="num">估值价格</th><th class="num">成本价（可选）</th><th></th></tr></thead><tbody id="h-rows"></tbody></table></div>
      <div class="row"><input type="text" id="h-new" placeholder="代码，如 NVDA / VOO" style="width:140px"><button type="button" class="ghost" id="h-add">添加</button>
        <details class="howto" style="flex:1 1 320px"><summary>粘贴导入（每行“代码 股数 [价格]”，现金写“现金 金额”）</summary>
          <textarea id="h-paste" rows="5" style="width:100%" placeholder="NVDA 10\nSPY 25\nVOO 5 480\n现金 12000"></textarea>
          <div class="row"><button type="button" class="ghost" id="h-paste-btn">解析并覆盖当前表格</button><span class="muted" id="h-paste-msg"></span></div></details></div>
      <div class="row"><button type="button" class="primary" id="h-save">保存到本机</button>
        <button type="button" class="ghost" id="h-sync">同步到后台</button>
        <button type="button" class="ghost" id="h-export">导出 JSON</button>
        <button type="button" class="ghost" id="h-clear">清除本机数据</button><span class="muted" id="h-msg"></span></div>
      <details class="howto"><summary>同步设置（首次使用需要一个 GitHub token）</summary>
        <ol class="muted">
          <li>打开 GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。</li>
          <li>Repository access 选 “Only select repositories” → <b>${esc(META.github_repo || "")}</b>；Permissions → Repository permissions → <b>Actions: Read and write</b>（其他保持 No access）；有效期建议 90 天。</li>
          <li>生成后复制 token 粘贴到下面，点“保存 token”。token 只保存在这台设备的浏览器里；它只能触发这个仓库的 workflow，不能读取代码或持仓数据。</li>
        </ol>
        <div class="row"><input type="password" id="h-token" placeholder="github_pat_…" style="width:320px" autocomplete="off">
          <button type="button" class="ghost" id="h-token-save">保存 token</button><button type="button" class="ghost" id="h-token-del">删除 token</button>
          <span class="muted" id="h-token-msg"></span></div></details>
    </section>
    <div id="h-report"></div>`;

  const rowsEl = byId("h-rows");
  const draw = () => {
    const tickers = Object.keys(h.positions).sort();
    rowsEl.innerHTML = tickers.map((t) => {
      const auto = prices[t];
      return `<tr><td><b>${esc(t)}</b>${sysSet.has(t) ? "" : ' <span class="chip">范围外</span>'}</td><td>${esc(META.names_zh?.[t] || "")}</td>
        <td class="num"><input type="number" class="h-sh" data-t="${t}" min="0" step="1" value="${h.positions[t]}" style="width:100px"></td>
        <td class="num">${auto ? num(auto, 2) : `<input type="number" class="h-px" data-t="${t}" min="0" step="0.01" value="${h.prices[t] || ""}" placeholder="请填写" style="width:90px">`}</td>
        <td class="num"><input type="number" class="h-cost" data-t="${t}" min="0" step="0.01" value="${h.cost[t] || ""}" style="width:90px"></td>
        <td><button type="button" class="ghost h-del" data-t="${t}">移除</button></td></tr>`;
    }).join("") || `<tr><td colspan="6" class="muted">尚未添加持仓</td></tr>`;
    rowsEl.querySelectorAll(".h-sh").forEach((el) => (el.onchange = () => { h.positions[el.dataset.t] = Math.max(0, +el.value || 0); report(); }));
    rowsEl.querySelectorAll(".h-px").forEach((el) => (el.onchange = () => { const v = +el.value; if (v > 0) h.prices[el.dataset.t] = v; else delete h.prices[el.dataset.t]; report(); }));
    rowsEl.querySelectorAll(".h-cost").forEach((el) => (el.onchange = () => { const v = +el.value; if (v > 0) h.cost[el.dataset.t] = v; else delete h.cost[el.dataset.t]; report(); }));
    rowsEl.querySelectorAll(".h-del").forEach((el) => (el.onclick = () => { delete h.positions[el.dataset.t]; delete h.prices[el.dataset.t]; delete h.cost[el.dataset.t]; draw(); report(); }));
  };
  const readHead = () => { h.date = byId("h-date").value || h.date; h.cash = Math.max(0, +byId("h-cash").value || 0); h.note = byId("h-note").value.trim(); };
  const snapshot = () => {
    readHead();
    const positions = Object.fromEntries(Object.entries(h.positions).filter(([, s]) => s > 0));
    const px = Object.fromEntries(Object.entries(h.prices).filter(([t]) => positions[t] && !prices[t]));
    const cost = Object.fromEntries(Object.entries(h.cost).filter(([t]) => positions[t]));
    return { date: h.date, positions, cash: h.cash, prices: px, cost, note: h.note };
  };
  const report = () => { readHead(); renderHoldingsReport(snapshot(), prices, sugg, sysSet, money); };
  byId("h-cash").onchange = report;
  byId("h-add").onclick = () => {
    const t = byId("h-new").value.trim().toUpperCase().replace(/\./g, "-");
    if (!/^[A-Z0-9^][A-Z0-9\-=^]{0,11}$/.test(t)) { byId("h-msg").textContent = "代码无效"; return; }
    if (!(t in h.positions)) h.positions[t] = 0;
    byId("h-new").value = ""; draw();
  };
  byId("h-paste-btn").onclick = () => {
    const p = HoldingsCalc.parsePasted(byId("h-paste").value);
    h.positions = p.positions; h.prices = { ...p.prices }; if (p.cash != null) { h.cash = p.cash; byId("h-cash").value = p.cash; }
    byId("h-paste-msg").textContent = `识别 ${Object.keys(p.positions).length} 个标的${p.cash != null ? "和现金" : ""}${p.errors.length ? `；${p.errors.length} 行无法识别：${p.errors.slice(0, 2).join("；")}` : ""}`;
    draw(); report();
  };
  byId("h-save").onclick = () => {
    const s = snapshot();
    byId("h-msg").textContent = saveHoldings(s) ? `已保存到本机（${Object.keys(s.positions).length} 个标的）` : "保存失败：浏览器禁止了本地存储";
  };
  byId("h-export").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(snapshot(), null, 1)], { type: "application/json" }));
    a.download = `holdings_${h.date}.json`; a.click();
  };
  byId("h-clear").onclick = () => {
    if (!confirm("清除这台设备上保存的持仓？（不影响已同步到后台的快照）")) return;
    try { localStorage.removeItem(HOLD_KEY); } catch { /* 忽略 */ }
    h = { date: new Date().toISOString().slice(0, 10), positions: {}, cash: 0, prices: {}, cost: {}, note: "" };
    byId("h-cash").value = 0; draw(); report(); byId("h-msg").textContent = "已清除";
  };
  let token = ""; try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch { /* 忽略 */ }
  byId("h-token-msg").textContent = token ? "已保存 token" : "尚未设置";
  byId("h-token-save").onclick = () => {
    const v = byId("h-token").value.trim();
    if (!v) return;
    try { localStorage.setItem(TOKEN_KEY, v); token = v; byId("h-token").value = ""; byId("h-token-msg").textContent = "已保存 token"; } catch { byId("h-token-msg").textContent = "保存失败"; }
  };
  byId("h-token-del").onclick = () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* 忽略 */ } token = ""; byId("h-token-msg").textContent = "已删除"; };
  byId("h-sync").onclick = async () => {
    const s = snapshot();
    if (!Object.keys(s.positions).length && !s.cash) { byId("h-msg").textContent = "持仓为空，未同步"; return; }
    const missing = Object.keys(s.positions).filter((t) => !prices[t] && !s.prices[t] && !s.cost[t]);
    if (missing.length && !confirm(`以下标的没有价格，后台将无法估值：${missing.join("、")}。仍然同步？`)) return;
    if (!token) { byId("h-msg").textContent = "请先在“同步设置”中保存 GitHub token"; return; }
    saveHoldings(s);
    byId("h-msg").textContent = "同步中…";
    try {
      const resp = await fetch(`https://api.github.com/repos/${META.github_repo}/actions/workflows/update-holdings.yml/dispatches`, {
        method: "POST",
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
        body: JSON.stringify({ ref: "main", inputs: { holdings: JSON.stringify(s) } }),
      });
      byId("h-msg").textContent = resp.status === 204
        ? `已提交同步（${s.date}，${Object.keys(s.positions).length} 个标的）；约 1 分钟后生效，可在仓库 Actions 页查看 update-holdings 运行结果`
        : `同步失败：HTTP ${resp.status}${resp.status === 401 || resp.status === 403 ? "（token 无效或缺少 Actions 写权限）" : resp.status === 404 ? "（token 没有该仓库的权限）" : ""}`;
    } catch (e) { byId("h-msg").textContent = `同步失败：${e.message}`; }
  };
  draw(); report();
};

function renderHoldingsReport(s, prices, sugg, sysSet, money) {
  const el = byId("h-report");
  const tickers = Object.keys(s.positions);
  if (!tickers.length && !s.cash) { el.innerHTML = ""; return; }
  const px = (t) => prices[t] || s.prices[t] || s.cost[t];
  const rows = tickers.map((t) => ({ t, sh: s.positions[t], p: px(t), v: s.positions[t] * (px(t) || NaN) }));
  const total = rows.reduce((a, r) => a + (isNum(r.v) ? r.v : 0), 0) + s.cash;
  const theme = (t) => META.universe.find((u) => u.ticker === t)?.theme;
  const byTheme = {};
  rows.forEach((r) => { if (isNum(r.v)) { const k = theme(r.t) || (sysSet.has(r.t) ? "etf" : "outside"); byTheme[k] = (byTheme[k] || 0) + r.v; } });
  const themeLabel = (k) => (k === "etf" ? "大盘 / 黄金 ETF" : k === "outside" ? "系统范围外" : themeName(k));
  const plan = HoldingsCalc.rebalancePlan(s.positions, s.cash, Object.fromEntries(tickers.concat(Object.keys(sugg.target)).map((t) => [t, px(t)]).filter(([, p]) => p > 0)),
    sugg.target, [...sysSet], 10);
  const trades = plan.rows.filter((r) => r.trade_shares !== 0);
  // 集中度只对个股提示（指数 ETF 本身已分散）
  const stock = (t) => META.universe.some((u) => u.ticker === t);
  const top = [...rows].filter((r) => isNum(r.v) && stock(r.t)).sort((a, b) => b.v - a.v)[0];
  const ins = [];
  if (top && top.v / total > 0.15) ins.push({ level: top.v / total > 0.25 ? "high" : "medium", kind: "derived", text: `单一个股集中：${top.t} ${META.names_zh?.[top.t] || ""} 占总资产 ${pct(top.v / total, 0)}。` });
  const bigTheme = Object.entries(byTheme).sort((a, b) => b[1] - a[1])[0];
  if (bigTheme && bigTheme[1] / total > 0.4) ins.push({ level: "medium", kind: "derived", text: `主题集中：「${themeLabel(bigTheme[0])}」占总资产 ${pct(bigTheme[1] / total, 0)}。` });
  const pnl = rows.filter((r) => s.cost[r.t] && isNum(r.v)).map((r) => ({ t: r.t, g: r.sh * (r.p - s.cost[r.t]), rr: r.p / s.cost[r.t] - 1 }));
  if (pnl.length) { const sum = pnl.reduce((a, x) => a + x.g, 0); ins.push({ level: sum >= 0 ? "good" : "medium", kind: "derived", text: `填写了成本价的持仓合计浮动盈亏 ${money(sum)}；最大浮盈 ${[...pnl].sort((a, b) => b.g - a.g)[0].t}，最大浮亏 ${[...pnl].sort((a, b) => a.g - b.g)[0].t}。` }); }
  if (trades.length) ins.push({ level: "info", kind: "model", text: `按系统建议（${sugg.source}）需要 ${trades.length} 笔交易，合计买入 ${money(plan.total_buy)}、卖出 ${money(plan.total_sell)}，预估成本 ${money(plan.total_cost)}。` });
  el.innerHTML = `${insightBox(ins)}
    <section class="card"><h3>组合概览 ${badge("fact")}${badge("derived")}</h3><div class="kpis">
      <div class="kpi"><span class="muted">总资产</span><b>${money(total)}</b></div>
      <div class="kpi"><span class="muted">现金</span><b>${money(s.cash)}</b><span class="muted">${pct(s.cash / total, 1)}</span></div>
      <div class="kpi"><span class="muted">持仓数</span><b>${tickers.length}</b></div>
      <div class="kpi"><span class="muted">系统范围外</span><b>${money(Object.values(plan.unmanaged).reduce((a, v) => a + (isNum(v) ? v : 0), 0))}</b></div></div>
      <div class="grid two"><div>${chartDiv("c-h-w")}</div><div>${chartDiv("c-h-theme")}</div></div></section>
    <section class="card"><h3>建议 vs 实际（${esc(sugg.source)}）${badge("model")}${badge("derived")}</h3>
      <p class="muted">可调资金 ${money(plan.managed_value)}（系统范围内持仓 + 现金）；整股计算，零头留现金；成本按单边 0.1%。</p>
      <div class="table-wrap"><table><thead><tr><th>标的</th><th class="num">价格</th><th class="num">当前股数</th><th class="num">目标股数</th><th class="num">买卖</th><th class="num">金额</th><th class="num">成本</th><th class="num">当前</th><th class="num">调仓后</th><th class="num">建议</th></tr></thead>
      <tbody>${plan.rows.map((r) => `<tr><td><b>${esc(r.ticker)}</b> <span class="muted">${esc(META.names_zh?.[r.ticker] || "")}</span></td><td class="num">${num(r.price, 2)}</td>
        <td class="num">${r.current_shares}</td><td class="num">${r.target_shares}</td>
        <td class="num ${r.trade_shares > 0 ? "pos" : r.trade_shares < 0 ? "neg" : ""}">${r.trade_shares ? (r.trade_shares > 0 ? "+" : "") + r.trade_shares : "–"}</td>
        <td class="num">${r.trade_shares ? money(r.trade_value) : "–"}</td><td class="num">${num(r.cost, 2)}</td>
        <td class="num">${pct(r.current_weight, 1)}</td><td class="num">${pct(r.after_weight, 1)}</td><td class="num">${pct(r.target_weight, 1)}</td></tr>`).join("")}</tbody></table></div>
      <p>合计买入 ${money(plan.total_buy)}、卖出 ${money(plan.total_sell)}，预估成本 ${num(plan.total_cost, 2)}；调仓后现金 ${money(plan.cash_after)}（建议 ${pct(plan.target_cash_weight, 1)}），与建议的最大偏差 ${pct(plan.max_deviation, 1)}。</p>
      ${Object.keys(plan.unmanaged).length ? `<p class="muted">不参与调仓（系统范围外）：${Object.entries(plan.unmanaged).map(([t, v]) => `${esc(t)} ${money(v)}`).join("、")}</p>` : ""}
      ${plan.no_price.length ? `<p class="warn">缺少价格、未计算：${plan.no_price.join("、")}</p>` : ""}
      <p class="muted"><a href="#/sim?c=${simEncode({ ...SIM_DEFAULT, posMode: "weight", weights: Object.fromEntries(rows.filter((r) => isNum(r.v) && prices[r.t]).map((r) => [r.t, r.v / total])), initial: Math.round(total), strategy: "hold", start: "2019-01-01" })}">在模拟经营中回测“按当前比例持有”→</a></p></section>`;
  bindGoto();
  const wr = rows.filter((r) => isNum(r.v)).sort((a, b) => b.v - a.v);
  mkChart(byId("c-h-w"), { tooltip: { trigger: "item", valueFormatter: (v) => money(v) }, legend: { show: false },
    series: [{ type: "pie", radius: ["45%", "72%"], label: { formatter: "{b}\n{d}%", fontSize: 11, color: css("--ink-2") },
      itemStyle: { borderColor: css("--surface"), borderWidth: 2 },
      data: [...wr.map((r, i) => ({ name: r.t, value: r.v, itemStyle: { color: palette()[i % 8] } })),
        ...(s.cash > 0 ? [{ name: "现金", value: s.cash, itemStyle: { color: OTHER_GRAY() } }] : [])] }] });
  const tk = Object.entries(byTheme).sort((a, b) => b[1] - a[1]);
  mkChart(byId("c-h-theme"), { tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => pct(v, 1) }, legend: { show: false },
    grid: { left: 110, right: 40, top: 10, bottom: 20 }, xAxis: { type: "value", axisLabel: { formatter: (v) => pct(v, 0) } },
    yAxis: { type: "category", inverse: true, data: [...tk.map(([k]) => themeLabel(k)), "现金"] },
    series: [{ type: "bar", barMaxWidth: 16, data: [...tk.map(([k, v]) => ({ value: v / total, itemStyle: { color: META.themes.some((x) => x.key === k) ? themeColor(k) : BENCH_GRAY(), borderRadius: 3 } })),
      { value: s.cash / total, itemStyle: { color: OTHER_GRAY(), borderRadius: 3 } }], label: { show: true, position: "right", formatter: (p) => pct(p.value, 1), fontSize: 11, color: css("--ink-2"), textBorderWidth: 0 } }] });
}
