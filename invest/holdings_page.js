"use strict";
/* 我的持仓：起始持仓 + 交易记录（账本）只保存在本机浏览器（localStorage）；当前股数、平均成本、现金、盈亏都由账本推算。
   “同步到后台”时用你自己的 GitHub token 触发私有仓库的 update-holdings workflow（加密存储）。
   标签：持仓（券商式持仓与盈亏）/ 交易记录（起始持仓 + 交易）/ 实盘对账（与模拟运算对照、决策评估）/ 调仓建议（建议 vs 实际）。 */

const HOLD_KEY = "invest.holdings.v1"; // 推算出的当前持仓快照（缓存；无账本时为旧版手动填写的持仓）
const TOKEN_KEY = "invest.gh_token";
const TRADES_KEY = "invest.trades.v1";
const RECON_START_KEY = "invest.recon.start.v1";

function loadTrades() { try { return JSON.parse(localStorage.getItem(TRADES_KEY) || "[]"); } catch { return []; } }
function saveTrades(t) { try { localStorage.setItem(TRADES_KEY, JSON.stringify(t)); } catch { /* 忽略 */ } }
function loadReconStart() { try { return JSON.parse(localStorage.getItem(RECON_START_KEY) || "null"); } catch { return null; } }
function saveReconStart(s) { try { localStorage.setItem(RECON_START_KEY, JSON.stringify(s)); } catch { /* 忽略 */ } }
function saveHoldings(h) { try { localStorage.setItem(HOLD_KEY, JSON.stringify(h)); return true; } catch { return false; } }
function ledgerSig(a, b) { let h = 5381; const s = `${a}|${b}`; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0); }

/* 当前持仓（供全站 ● 标记等同步调用）：
   有账本 → 优先用持仓页算好的快照（含拆股换算、分红与利息）；账本改过但还没打开持仓页 → 直接按交易记录加减股数
   没有账本 → 旧版手动填写的持仓 → 已解锁的个人数据包（其他设备：后台最近一次同步的持仓） */
let HOLD_MEMO = { key: null, val: null };
function loadHoldings() {
  let a, b, c;
  try { a = localStorage.getItem(RECON_START_KEY); b = localStorage.getItem(TRADES_KEY); c = localStorage.getItem(HOLD_KEY); } catch { return null; }
  const pv = typeof window !== "undefined" && window.PERSONAL ? window.PERSONAL.generated_at : "";
  const key = `${a}\u0000${b}\u0000${c}\u0000${pv}`;
  if (HOLD_MEMO.key === key) return HOLD_MEMO.val;
  let val = null;
  try {
    const start = JSON.parse(a || "null"), cached = JSON.parse(c || "null");
    if (start && (Object.keys(start.positions || {}).length || start.cash)) {
      const sig = ledgerSig(a, b);
      if (cached?.sig === sig && cached.positions) val = cached;
      else {
        const trades = JSON.parse(b || "[]").filter((t) => t.date > start.date).sort((x, y) => x.date.localeCompare(y.date));
        const r = Recon.applyTrades(start.positions || {}, start.cash || 0, trades);
        // 平均成本（简化版：起始成本价 + 有成交价的交易；缺成本价或成交价的标的不给成本，拆股在持仓页的完整推算中处理）
        const sh = { ...(start.positions || {}) }, basis = {}, bad = new Set();
        for (const [t, n] of Object.entries(sh)) { if (start.cost?.[t] > 0) basis[t] = n * start.cost[t]; else bad.add(t); }
        for (const x of trades) {
          if (x.side !== "buy" && x.side !== "sell") continue;
          const t = x.ticker, cur = sh[t] || 0;
          if (x.side === "buy" && !(x.price > 0)) bad.add(t); // 卖出不改变平均成本，只有买入需要成交价
          if (x.side === "buy") { sh[t] = cur + x.shares; basis[t] = (basis[t] || 0) + x.shares * (x.price || 0) + (x.fee || 0); }
          else { basis[t] = cur > 0 ? (basis[t] || 0) * Math.max(0, cur - x.shares) / cur : 0; sh[t] = cur - x.shares; }
        }
        const cost = Object.fromEntries(Object.entries(r.positions).filter(([t, v]) => v > 0 && !bad.has(t) && basis[t] > 0).map(([t, v]) => [t, basis[t] / v]));
        val = { date: trades.length ? trades[trades.length - 1].date : start.date, positions: Object.fromEntries(Object.entries(r.positions).filter(([, v]) => v > 0)),
          cash: r.cash, prices: {}, cost, note: "由交易记录推算（未含分红与利息）" };
      }
    } else if (cached?.positions && !cached.sig) val = cached;
    else if (pv && window.PERSONAL.snapshot) val = { ...window.PERSONAL.snapshot, note: `个人数据包（同步于 ${window.PERSONAL.snapshot.date}）` };
  } catch { val = null; }
  HOLD_MEMO = { key, val };
  return val;
}
function isHeld(t) {
  const h = loadHoldings();
  if (h && Object.keys(h.positions).length) return (h.positions[t] || 0) > 0;
  return !!META.universe.find((u) => u.ticker === t)?.held;
}
/* 平均成本为估计值的原因（持仓页 / 首页悬停说明） */
function estCostNote(r) {
  return [r.est_start ? "起始持仓未填成本价，按起始日收盘价估计" : "", r.est_open ? `${r.est_open} 笔买入未填成交价，按当天开盘价估计` : ""].filter(Boolean).join("；");
}
function holdingsMode() { const h = loadHoldings(); return h && Object.keys(h.positions).length ? "mine" : "suggested"; }

async function suggestedTarget() {
  const o = await load("overview.json").catch(() => null);
  if (o?.available) return { target: Object.fromEntries(o.allocation.map((x) => [x.ticker, x.weight])), source: `周报 ${o.signal_date}` };
  const s = await load("sim/system.json").catch(() => null);
  if (s?.targets?.length) return { target: s.targets[s.targets.length - 1], source: `回测模拟 ${s.dates[s.dates.length - 1]}（首份正式周报前）` };
  return { target: {}, source: "无" };
}

const money = (v) => (isNum(v) ? `${v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}` : "–");
const money2 = (v) => (isNum(v) ? `${v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "–");
const signed = (v, f = money) => (isNum(v) ? `${v > 0 ? "+" : ""}${f(v)}` : "–");
const shareFmt = (n) => (isNum(n) ? (Math.abs(n - Math.round(n)) < 1e-6 ? String(Math.round(n)) : n.toFixed(4).replace(/0+$/, "")) : "–");
const TICKER_RE = /^[A-Z0-9^][A-Z0-9\-=^]{0,11}$/;
const normTicker = (s) => s.trim().toUpperCase().replace(/\./g, "-");

const HOLD_TABS = [["positions", "持仓"], ["buyplan", "买入计划"], ["attrib", "收益归因"], ["lots", "持有期与税务"], ["ledger", "交易记录"], ["recon", "实盘对账"], ["plan", "调仓建议"]];
const HOLD_HOWTO = {
  positions: [
    "本页由“交易记录”标签里的起始持仓与每一笔交易自动推算：当前股数、[[avg_cost|平均成本]]、现金（含分红与现金利息）、[[unrealized|浮动盈亏]]与[[realized|已实现盈亏]]。价格为最新收盘价（每天更新一次）。",
    "“总盈亏”= 账户总值 − 起始价值 − 净存入资金；“收益率”是[[twr|时间加权收益]]，不受存取款影响，可以直接和 SPY 比较。",
    "起始持仓没有填成本价的，成本按起始日收盘价估计（标“≈”）；想和券商显示的成本一致，请在“交易记录”里补填成本价。",
    "数据只保存在这台设备的浏览器里。换设备或清除浏览器数据前，请用“导出备份”保存一份；“同步到后台”后，每日推送与周报按你的实际持仓分析。",
  ],
  ledger: [
    "先填“起始持仓”：过去某日收盘后的持仓股数、现金（可选填每只的成本价）；之后在“交易记录”里录入这天之后的每一笔买卖和资金存取。持仓页的一切数字都由这两部分推算。",
    "成交价留空时按当天开盘价计；日期不是交易日时按之后第一个交易日计；晚于价格数据截止日的交易也会计入股数与现金（估值用最新收盘价）。拆股会自动换算（按拆股前的实际股数与价格录入即可）。",
    "如果只知道现在券商里的持仓，可以用“由券商当前持仓倒推”：填入现在的股数与现金，再选一个过去的日期，系统撤销这之间的交易，算出那天的起始持仓。",
  ],
  recon: [
    "用你的真实调仓来检验模拟运算：同一起始持仓、同一批交易，分别按“实际”（原始股价估值、你的成交价与费用、除息日收到现金分红）和“模拟”（当天开盘价、单边成本假设、分红再投资）计算两条资产曲线。",
    "两条曲线的差额被拆成：成交价差（你的成交价 vs 当天开盘价）、费用差（实际费用 vs 模拟成本假设）、现金利息差、其他。没有交易时两条曲线应完全一致。",
    "期间的资金存取在当天开盘前同时计入两条曲线，不会被算成差额。下方还有“整体对比：跟随系统模型”和每次操作的“决策评估”。",
  ],
  attrib: [
    "把一段时间内账户的盈亏拆到每只持仓：盈亏 = 期末市值 − 期初市值 − 买入花费 + 卖出所得 + 分红（含费用）。",
    "“相对 SPY”回答“如果这些钱当时放在 SPY，会多赚还是少赚”：每天把每只持仓前一天的市值按 SPY 当天的涨跌（含分红）算一份机会成本，盈亏减去它就是这只持仓相对 SPY 的超额。现金一项 = 利息 − 同样的钱放在 SPY 的收益。",
    "各项超额相加 ≈ 账户盈亏 − 把同样的资金（同一天存取）一直放在 SPY 的盈亏。这是[[fact|事实]]数据的拆分，不涉及模型判断。",
  ],
  lots: [
    "按“先买先卖”（FIFO）把每只持仓拆成买入批次，计算每个批次已持有多少天、还有多少天满 1 年。",
    "美国税法：持有超过 1 年再卖出属于长期资本利得，税率通常明显低于短期（按普通收入计税）。批次快满 1 年又有较大浮盈时，推迟几天卖出可能更划算。",
    "仅供参考，不构成税务建议：券商可能按其他方式（如指定批次）匹配卖出；洗售规则（wash sale：亏损卖出前后 30 天内买回同一股票，亏损不能抵税）未计入；起始持仓的实际买入日未知，按起始日计（标“起始”），请以券商的成本与持有期为准。",
  ],
  plan: [
    "把系统模型的最新建议配置换算成你的股数：只调整系统覆盖范围内的标的，范围外持仓保持不动；整股计算，零头留在现金，成本按单边 0.1% 估算。",
    "这是[[model|模型建议]]，本身可能出错，仅供参考；持仓按交易记录推算，请以券商显示为准。",
  ],
};

PAGES.holdings = async (r) => {
  const tab = HOLD_TABS.some(([k]) => k === r.query.tab) ? r.query.tab : "positions";
  const { P, raw, sys } = await simData();
  // 首次使用：本机有旧版手动填写的持仓、还没有账本 → 作为起始持仓
  if (!loadReconStart()) {
    let legacy = null; try { legacy = JSON.parse(localStorage.getItem(HOLD_KEY) || "null"); } catch { /* 忽略 */ }
    if (legacy?.positions && !legacy.sig && Object.keys(legacy.positions).length) {
      saveReconStart({ date: legacy.date, positions: { ...legacy.positions }, cash: legacy.cash || 0, cost: { ...(legacy.cost || {}) } });
    }
  }
  const start = loadReconStart();
  let book = null, err = "";
  if (start) {
    try {
      book = Recon.ledgerBook(P, raw, start, loadTrades(), { cashInterest: HOLD_CFG.cashInterest });
      const sig = ledgerSig(localStorage.getItem(RECON_START_KEY), localStorage.getItem(TRADES_KEY));
      saveHoldings({ ...book.snapshot, sig, cost_est: book.rows.filter((r) => r.est_cost).map((r) => r.ticker) });
    } catch (e) { console.error(e); err = e.message; }
  }
  app().innerHTML = `
    <h2>我的持仓 <span class="muted">只保存在本机浏览器 · 价格截至 ${esc(P.dates[P.n - 1])}</span></h2>
    <div class="seg" style="margin-bottom:12px">${HOLD_TABS.map(([k, n]) => `<button type="button" class="${k === tab ? "on" : ""}" data-tab="${k}">${n}</button>`).join("")}</div>
    ${howto(tab === "buyplan" ? PLAN_HOWTO : HOLD_HOWTO[tab])}
    ${err ? `<p class="warn">账本推算失败：${esc(err)}（请检查“交易记录”里的起始持仓日期）</p>` : ""}
    <div id="h-body"></div>`;
  document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { location.hash = `#/holdings?tab=${b.dataset.tab}`; }));
  const restorable = !start && personalOn() && window.PERSONAL.ledger;
  const empty = `<section class="card"><p>这台设备上还没有账本。${restorable
    ? `个人数据包里有后台最近一次同步的账本（起始持仓 ${esc(window.PERSONAL.ledger.start.date)}，${window.PERSONAL.ledger.trades.length} 条记录）：<button type="button" class="primary" id="h-restore">恢复到这台设备</button>`
    : `请先到 <a href="#/holdings?tab=ledger">交易记录</a> 填写起始持仓（过去某日收盘后的股数与现金），再录入之后的交易；或在其他设备“导出备份”后在这里导入、或解锁右上角的个人版恢复。`}</p></section>`;
  const bindRestore = () => { const b = byId("h-restore"); if (b) b.onclick = () => { saveReconStart(window.PERSONAL.ledger.start); saveTrades(window.PERSONAL.ledger.trades); route(); }; };
  if (tab === "ledger") return renderLedgerTab(P, raw);
  if (tab === "recon") { if (start) return renderReconTab(P, raw, sys, start); byId("h-body").innerHTML = empty; return bindRestore(); }
  if (!book) { byId("h-body").innerHTML = empty; return bindRestore(); }
  if (tab === "plan") return renderPlanTab(book);
  if (tab === "buyplan") return renderBuyPlanTab(book, r.query);
  if (tab === "attrib") return renderAttribTab(P, raw, start, loadTrades());
  if (tab === "lots") return renderLotsTab(P, raw, start, loadTrades(), book);
  return renderPositionsTab(P, raw, book);
};
const HOLD_CFG = { cashInterest: true };
try { HOLD_CFG.cashInterest = localStorage.getItem("invest.hold.cash_interest") !== "0"; } catch { /* 忽略 */ }

// ---------------- 持仓（券商式）----------------
function renderPositionsTab(P, raw, book) {
  const a = book.account;
  const rows = book.rows;
  const name = (t) => META.names_zh?.[t] || "";
  const theme = (t) => META.universe.find((u) => u.ticker === t)?.theme;
  const sysSet = new Set(META.allocation_tickers_system || []);
  const ins = [];
  const stock = (t) => META.universe.some((u) => u.ticker === t);
  const top = rows.filter((r) => stock(r.ticker) && isNum(r.market_value))[0];
  if (top && top.weight > 0.15) ins.push({ level: top.weight > 0.25 ? "high" : "medium", kind: "derived", text: `单一个股集中：${top.ticker} ${name(top.ticker)} 占账户 ${pct(top.weight, 0)}。` });
  const byTheme = {};
  rows.forEach((r) => { if (isNum(r.market_value)) { const k = theme(r.ticker) || (sysSet.has(r.ticker) ? "etf" : "outside"); byTheme[k] = (byTheme[k] || 0) + r.market_value; } });
  const themeLabel = (k) => (k === "etf" ? "大盘 / 黄金 ETF" : k === "outside" ? "系统范围外" : themeName(k));
  const bigTheme = Object.entries(byTheme).sort((x, y) => y[1] - x[1])[0];
  if (bigTheme && bigTheme[1] / a.total_value > 0.4) ins.push({ level: "medium", kind: "derived", text: `主题集中：「${themeLabel(bigTheme[0])}」占账户 ${pct(bigTheme[1] / a.total_value, 0)}。` });
  const movers = rows.filter((r) => isNum(r.day_change)).sort((x, y) => y.day_change - x.day_change);
  if (movers.length >= 2) ins.push({ level: "info", kind: "fact", text: `${a.asof} 贡献最大：${movers[0].ticker}（${signed(movers[0].day_change)}）；拖累最大：${movers[movers.length - 1].ticker}（${signed(movers[movers.length - 1].day_change)}）。` });
  if (a.late) ins.push({ level: "info", kind: "fact", text: `${a.late} 笔交易晚于价格数据（${a.asof}），已计入股数与现金；明天数据更新后今日涨跌会更准确。` });
  const noData = rows.filter((r) => !r.has_data && isNum(r.market_value) && r.price > 0);
  if (noData.length) ins.push({ level: "medium", kind: "fact", text: `${noData.map((r) => r.ticker).join("、")} 不在系统行情范围内，市值按最后一笔成交价估计。` });
  const noVal = rows.filter((r) => !(r.price > 0));
  if (noVal.length) ins.push({ level: "high", kind: "fact", text: `${noVal.map((r) => r.ticker).join("、")} 没有行情也没有成交价，无法估值（未计入账户总值）；请在“交易记录”里补填成本价。` });
  const est = rows.filter((r) => r.est_cost);
  if (est.length) ins.push({ level: "info", kind: "derived", text: `${est.map((r) => r.ticker).join("、")} 的平均成本含估计（标“≈”：${[est.some((r) => r.est_start) ? "起始持仓未填成本价，按起始日收盘价计" : "", est.some((r) => r.est_open) ? `${est.reduce((a, r) => a + (r.est_open || 0), 0)} 笔买入未填成交价，按当天开盘价计` : ""].filter(Boolean).join("；")}）；在“交易记录”里补填成交价 / 成本价后即为准确值。` });
  const kpi = (label, v, sub = "", c = "") => `<div class="kpi"><span class="muted">${label}</span><b class="${c}">${v}</b>${sub ? `<span class="muted">${sub}</span>` : ""}</div>`;
  const gainCls = (v) => (isNum(v) ? cls(v) : "");
  const td = (v, f = money, c = true) => `<td class="num ${c ? gainCls(v) : ""}">${f(v)}</td>`;
  byId("h-body").innerHTML = `${insightBox(ins)}
    ${book.warnings.length ? `<p class="warn">${book.warnings.map(esc).join("<br>")}</p>` : ""}
    <section class="card"><h3>账户 ${badge("fact")}${badge("derived")}<span class="muted" style="font-weight:400"> 截至 ${esc(a.asof)} 收盘</span></h3><div class="kpis">
      ${kpi("账户总值", money(a.total_value))}
      ${kpi("今日变动", signed(a.day_change), isNum(a.day_pct) ? pct(a.day_pct, 2, true) : "", gainCls(a.day_change))}
      ${kpi(`总盈亏（自 ${esc(a.start_date)}）`, signed(a.total_gain), `收益率 ${pct(a.twr, 2, true)}`, gainCls(a.total_gain))}
      ${kpi("浮动盈亏", signed(a.unrealized), a.cost_basis > 0 ? pct(a.unrealized / a.cost_basis, 2, true) : "", gainCls(a.unrealized))}
      ${kpi("已实现盈亏", signed(a.realized), "", gainCls(a.realized))}
      ${kpi("分红 + 利息", money(a.dividends + a.interest), `分红 ${money(a.dividends)} · 利息 ${money(a.interest)}`)}
      ${kpi("现金", money(a.cash), pct(a.cash / a.total_value, 1))}
      ${kpi("净存入", signed(a.net_flows), `起始价值 ${money(a.start_value)}`)}</div>
      <div class="row" style="margin-top:8px"><div class="seg" id="h-cm">${[["value", "账户价值"], ["ret", "收益率 vs SPY"]].map(([k, n], i) => `<button type="button" data-m="${k}" class="${i ? "" : "on"}">${n}</button>`).join("")}</div>
        <div class="seg" id="h-cp">${["1M", "3M", "YTD", "1Y", "ALL"].map((k) => `<button type="button" data-p="${k}" class="${k === "ALL" ? "on" : ""}">${k === "ALL" ? "全部" : k === "YTD" ? "今年" : k.replace("M", " 个月").replace("1Y", "1 年")}</button>`).join("")}</div></div>
      ${chartDiv("c-h-curve")}</section>
    <section class="card"><h3>持仓 ${badge("fact")}${badge("derived")}</h3>
      <div class="table-wrap"><table class="positions"><thead><tr id="h-pos-head"></tr></thead>
      <tbody id="h-pos-body"></tbody><tbody>        <tr><td><b>现金</b> <span class="muted">SPAXX 等</span></td><td colspan="5"></td><td class="num">${money(a.cash)}</td><td></td><td></td><td></td><td class="num">${pct(a.cash / a.total_value, 1)}</td><td class="num">${signed(a.interest)}</td><td class="num ${gainCls(a.interest)}" title="现金利息">${signed(a.interest)}</td></tr>
        <tr class="total"><td><b>合计</b></td><td></td><td class="num ${gainCls(a.day_pct)}">${pct(a.day_pct, 2, true)}</td>${td(a.day_change, signed)}<td></td><td></td>
          <td class="num"><b>${money(a.total_value)}</b></td><td class="num">${money(a.cost_basis)}</td>${td(a.unrealized, signed)}<td></td><td></td>${td(a.realized + a.dividends + a.interest, signed)}<td class="num" id="h-pos-total"></td></tr></tbody></table></div>
      <p class="muted">“总盈亏”= 浮动盈亏 + 已实现盈亏 + 分红（从买入算起，已扣除交易费用）；合计含已清仓股票与现金利息${book.closed.length ? `（已清仓 ${book.closed.length} 只）` : ""}。今日涨跌按前一交易日收盘计；当天有交易的标的不计今日盈亏。${book.closed.length ? `<label><input type="checkbox" id="h-closed"> 显示已清仓</label>` : ""}<label><input type="checkbox" id="h-int" ${HOLD_CFG.cashInterest ? "checked" : ""}> 现金按短期国债利率计息（放在 SPAXX 等货币基金中）</label></p></section>
    <section class="card"><h3>配置 ${badge("derived")}</h3><div class="grid two"><div>${chartDiv("c-h-w")}</div><div>${chartDiv("c-h-theme")}</div></div></section>
    ${syncCard(book)}`;
  // 持仓表排序：点表头切换（同一列再点一次反向），只重排表格行；选择记在本机
  const posRow = (r) => `<tr><td><a href="#/stock/${esc(r.ticker)}"><b>${esc(r.ticker)}</b></a> <span class="muted">${esc(name(r.ticker))}</span></td>
        <td class="num">${money2(r.price)}</td><td class="num ${gainCls(r.day_pct)}">${pct(r.day_pct, 2, true)}</td>${td(r.day_change, signed)}
        <td class="num">${shareFmt(r.shares)}</td><td class="num" ${r.est_cost ? `title="${esc(estCostNote(r))}"` : ""}>${r.est_cost ? "≈" : ""}${money2(r.avg_cost)}</td>
        <td class="num">${money(r.market_value)}</td><td class="num">${money(r.cost_basis)}</td>${td(r.unrealized, signed)}
        <td class="num ${gainCls(r.unrealized_pct)}">${pct(r.unrealized_pct, 1, true)}</td><td class="num">${pct(r.weight, 1)}</td>${td(r.realized + r.divs, signed)}${td(r.total_gain, signed)}</tr>`;
  const POS_SORT_KEY = "invest.positions.sort";
  const POS_COLS = [["ticker", "代码", ""], ["price", "最新价", "num"], ["day_pct", "今日", "num"], ["day_change", "今日盈亏", "num"], ["shares", "股数", "num"],
    ["avg_cost", "平均成本", "num"], ["market_value", "市值", "num"], ["cost_basis", "成本总额", "num"], ["unrealized", "浮动盈亏", "num"], ["unrealized_pct", "浮动 %", "num"],
    ["weight", "占比", "num"], ["realized_divs", "已实现 + 分红", "num", "已实现盈亏 + 收到的分红"],
    ["total_gain", "总盈亏", "num", "浮动盈亏 + 已实现盈亏 + 分红（从买入算起，已扣除交易费用）"]];
  // 已清仓：灰色行放在持仓之后（同样参与排序；没有的列显示“–”），可以隐藏
  const CLOSED_KEY = "invest.positions.show_closed";
  let showClosed = true;
  try { showClosed = localStorage.getItem(CLOSED_KEY) !== "0"; } catch { /* 忽略 */ }
  const closedRow = (c) => `<tr class="muted closed-row" title="已清仓"><td><a href="#/stock/${esc(c.ticker)}"><b>${esc(c.ticker)}</b></a> <span class="muted">${esc(name(c.ticker))} · 已清仓</span></td>
        <td colspan="10" class="muted" style="text-align:center">已清仓 · 已实现 ${signed(c.realized)}${c.divs ? ` · 分红 ${money(c.divs)}` : ""}${c.fees ? ` · 费用 ${money2(c.fees)}` : ""}</td>${td(c.realized + c.divs, signed)}${td(c.total_gain, signed)}</tr>`;
  let psort = { k: "market_value", d: -1 };
  try { psort = { ...psort, ...JSON.parse(localStorage.getItem(POS_SORT_KEY) || "{}") }; } catch { /* 忽略 */ }
  const pval = (r, k) => (k === "realized_divs" ? r.realized + r.divs : r[k]);
  const drawPos = () => {
    byId("h-pos-head").innerHTML = POS_COLS.map(([k, n, c, tip]) => `<th class="${c} sortable${psort.k === k ? " on" : ""}" data-k="${k}" title="${esc(tip || "点击排序")}">${n}${psort.k === k ? (psort.d > 0 ? " ▲" : " ▼") : ""}</th>`).join("");
    const sorted = [...rows].sort((a, b) => {
      const x = pval(a, psort.k), y = pval(b, psort.k);
      if (typeof x === "string") return x.localeCompare(y) * psort.d;
      const ok = (v) => isNum(v);
      if (!ok(x) || !ok(y)) return ok(x) ? -1 : ok(y) ? 1 : 0; // 缺值（如当天有交易的今日盈亏）在最后
      return (x - y) * psort.d || (b.market_value || 0) - (a.market_value || 0);
    });
    const closed = [...book.closed].sort((a, b) => {
      const x = psort.k === "ticker" ? a.ticker : pval(a, psort.k), y = psort.k === "ticker" ? b.ticker : pval(b, psort.k);
      if (typeof x === "string") return x.localeCompare(y) * psort.d;
      if (!isNum(x) || !isNum(y)) return isNum(x) ? -1 : isNum(y) ? 1 : a.ticker.localeCompare(b.ticker);
      return (x - y) * psort.d;
    });
    byId("h-pos-body").innerHTML = sorted.map(posRow).join("") + (showClosed ? closed.map(closedRow).join("") : "");
    const tg = rows.reduce((x, r) => x + (isNum(r.total_gain) ? r.total_gain : 0), 0) + book.closed.reduce((x, c) => x + c.total_gain, 0) + a.interest;
    byId("h-pos-total").innerHTML = `<b class="${gainCls(tg)}">${signed(tg)}</b>`;
    byId("h-pos-head").querySelectorAll("[data-k]").forEach((th) => (th.onclick = () => {
      psort = psort.k === th.dataset.k ? { k: psort.k, d: -psort.d } : { k: th.dataset.k, d: th.dataset.k === "ticker" ? 1 : -1 };
      try { localStorage.setItem(POS_SORT_KEY, JSON.stringify(psort)); } catch { /* 忽略 */ }
      drawPos();
    }));
  };
  drawPos();
  const hc = byId("h-closed");
  if (hc) {
    hc.checked = showClosed;
    hc.onchange = () => { showClosed = hc.checked; try { localStorage.setItem(CLOSED_KEY, showClosed ? "1" : "0"); } catch { /* 忽略 */ } drawPos(); };
  }
  byId("h-int").onchange = (e) => { try { localStorage.setItem("invest.hold.cash_interest", e.target.checked ? "1" : "0"); } catch { /* 忽略 */ } HOLD_CFG.cashInterest = e.target.checked; route(); };
  drawCurve(P, raw, book, "value", "ALL");
  document.querySelectorAll("#h-cm button, #h-cp button").forEach((b) => (b.onclick = () => {
    b.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    drawCurve(P, raw, book, document.querySelector("#h-cm .on").dataset.m, document.querySelector("#h-cp .on").dataset.p);
  }));
  const total = a.total_value;
  mkChart(byId("c-h-w"), { tooltip: { trigger: "item", valueFormatter: (v) => money(v) }, legend: { show: false },
    series: [{ type: "pie", radius: ["45%", "72%"], label: { formatter: "{b}\n{d}%", fontSize: 11, color: css("--ink-2") },
      itemStyle: { borderColor: css("--surface"), borderWidth: 2 },
      data: [...rows.filter((r) => isNum(r.market_value)).map((r, i) => ({ name: r.ticker, value: r.market_value, itemStyle: { color: palette()[i % 8] } })),
        ...(a.cash > 0 ? [{ name: "现金", value: a.cash, itemStyle: { color: OTHER_GRAY() } }] : [])] }] });
  const tk = Object.entries(byTheme).sort((x, y) => y[1] - x[1]);
  mkChart(byId("c-h-theme"), { tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => pct(v, 1) }, legend: { show: false },
    grid: { left: 110, right: 40, top: 10, bottom: 20 }, xAxis: { type: "value", axisLabel: { formatter: (v) => pct(v, 0) } },
    yAxis: { type: "category", inverse: true, data: [...tk.map(([k]) => themeLabel(k)), "现金"] },
    series: [{ type: "bar", barMaxWidth: 16, data: [...tk.map(([k, v]) => ({ value: v / total, itemStyle: { color: META.themes.some((x) => x.key === k) ? themeColor(k) : BENCH_GRAY(), borderRadius: 3 } })),
      { value: a.cash / total, itemStyle: { color: OTHER_GRAY(), borderRadius: 3 } }], label: { show: true, position: "right", formatter: (p) => pct(p.value, 1), fontSize: 11, color: css("--ink-2"), textBorderWidth: 0 } }] });
  bindSync(book);
}

function drawCurve(P, raw, book, mode, period) {
  const c = book.curve;
  const lastD = c.dates[c.dates.length - 1];
  const plusDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const from = period === "ALL" ? c.dates[0] : period === "YTD" ? `${lastD.slice(0, 4)}-01-01`
    : plusDays(lastD, -{ "1M": 30, "3M": 91, "1Y": 365 }[period]);
  let k0 = c.dates.findIndex((d) => d >= from);
  if (k0 < 0) k0 = 0;
  if (k0 > 0) k0 -= 1; // 以区间前一日为基点
  const dates = c.dates.slice(k0);
  let series;
  if (mode === "value") {
    series = [{ name: "账户价值", type: "line", showSymbol: false, lineStyle: { width: 2 }, color: palette()[0], data: c.value.slice(k0).map((v) => +v.toFixed(2)) }];
  } else {
    const base = c.twr[k0];
    const spy = P.C.SPY;
    const i0 = P.idx[dates[0]];
    series = [{ name: "你的账户（时间加权）", type: "line", showSymbol: false, lineStyle: { width: 2 }, color: palette()[0], data: c.twr.slice(k0).map((v) => +(v / base - 1).toFixed(6)) }];
    if (spy && i0 != null && isNum(spy[i0])) series.push({ name: "SPY（含分红）", type: "line", showSymbol: false, lineStyle: { width: 1.5 }, color: BENCH_GRAY(), data: dates.map((d) => { const v = spy[P.idx[d]]; return isNum(v) ? +(v / spy[i0] - 1).toFixed(6) : null; }) });
  }
  mkChart(byId("c-h-curve"), { tooltip: { trigger: "axis", valueFormatter: (v) => (mode === "value" ? money(v) : pct(v, 2, true)) },
    legend: { show: series.length > 1, top: 0 }, grid: { left: 70, right: 20, top: series.length > 1 ? 30 : 10, bottom: 30 },
    xAxis: { type: "category", data: dates, boundaryGap: false }, yAxis: { type: "value", scale: true, axisLabel: { formatter: (v) => (mode === "value" ? money(v) : pct(v, 0)) } },
    series });
}

// ---------------- 同步与备份 ----------------
function syncCard(book) {
  let token = ""; try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch { /* 忽略 */ }
  return `<section class="card"><h3>同步与备份</h3>
    <p class="muted">“同步到后台”把推算出的当前持仓（含买入计划）（${esc(book.snapshot.date)}：${Object.keys(book.snapshot.positions).length} 个标的、现金）连同账本加密保存到私有仓库；之后每日推送的“与你持仓相关”、周报的“建议 vs 实际”和实盘业绩都按它计算。每次录入新交易后同步一次。</p>
    <div class="row"><button type="button" class="primary" id="h-sync">同步到后台</button><button type="button" class="ghost" id="h-export">导出备份（JSON）</button>
      <button type="button" class="ghost" id="h-import-btn">导入备份</button><input type="file" id="h-import" accept="application/json,.json" hidden><span class="muted" id="h-msg"></span></div>
    <details class="howto"><summary>同步设置（首次使用需要一个 GitHub token）${token ? " · 已保存 token" : ""}</summary>
      <ol class="muted">
        <li>打开 GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。</li>
        <li>Repository access 选 “Only select repositories” → <b>${esc(META.github_repo || "")}</b>；Permissions → Repository permissions → <b>Actions: Read and write</b>（其他保持 No access）；有效期建议 90 天。</li>
        <li>生成后复制 token 粘贴到下面，点“保存 token”。token 只保存在这台设备的浏览器里；它只能触发这个仓库的 workflow，不能读取代码或持仓数据。</li>
      </ol>
      <div class="row"><input type="password" id="h-token" placeholder="github_pat_…" style="width:320px" autocomplete="off">
        <button type="button" class="ghost" id="h-token-save">保存 token</button><button type="button" class="ghost" id="h-token-del">删除 token</button>
        <span class="muted" id="h-token-msg">${token ? "已保存 token" : "尚未设置"}</span></div></details></section>`;
}
function bindSync(book) {
  const msg = (t) => { byId("h-msg").textContent = t; };
  byId("h-export").onclick = () => {
    const data = { kind: "invest-ledger", version: 1, exported_at: new Date().toISOString(), start: loadReconStart(), trades: loadTrades() };
    const el = document.createElement("a");
    el.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
    el.download = `ledger_${book.account.asof}.json`; el.click();
  };
  byId("h-import-btn").onclick = () => byId("h-import").click();
  byId("h-import").onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.kind !== "invest-ledger" || !d.start?.date) throw new Error("不是本页导出的备份文件");
      if (!confirm(`用备份覆盖本机账本？（起始持仓 ${d.start.date}，${(d.trades || []).length} 条记录）`)) return;
      saveReconStart(d.start); saveTrades(d.trades || []); route();
    } catch (x) { msg(`导入失败：${x.message}`); }
  };
  byId("h-token-save").onclick = () => {
    const v = byId("h-token").value.trim();
    if (!v) return;
    try { localStorage.setItem(TOKEN_KEY, v); byId("h-token").value = ""; byId("h-token-msg").textContent = "已保存 token"; } catch { byId("h-token-msg").textContent = "保存失败"; }
  };
  byId("h-token-del").onclick = () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* 忽略 */ } byId("h-token-msg").textContent = "已删除"; };
  byId("h-sync").onclick = () => syncBackend(book, msg);
}
/* 同步到后台：当前持仓快照 + 账本 + 买入计划（本机没有编辑过计划时不带 plans，后台保留已有计划） */
async function syncBackend(book, msg) {
  let token = ""; try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch { /* 忽略 */ }
  if (!token) { msg("请先在“我的持仓 → 持仓 → 同步与备份”中保存 GitHub token"); return; }
  const s = book.snapshot;
  if (!Object.keys(s.positions).length && !s.cash) { msg("持仓为空，未同步"); return; }
  const payload = { ...s, ledger: { start: loadReconStart(), trades: loadTrades() }, ...(plansEdited() ? { plans: loadPlans() } : {}) };
  msg("同步中…");
  try {
    const resp = await fetch(`https://api.github.com/repos/${META.github_repo}/actions/workflows/update-holdings.yml/dispatches`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ ref: "main", inputs: { holdings: JSON.stringify(payload) } }),
    });
    msg(resp.status === 204
      ? `已提交同步（${s.date}，${Object.keys(s.positions).length} 个标的${plansEdited() ? `，${loadPlans().length} 条买入计划` : ""}）；约 1 分钟后生效，可在仓库 Actions 页查看 update-holdings 运行结果`
      : `同步失败：HTTP ${resp.status}${resp.status === 401 || resp.status === 403 ? "（token 无效或缺少 Actions 写权限）" : resp.status === 404 ? "（token 没有该仓库的权限）" : resp.status === 422 ? "（内容过大或格式不符）" : ""}`);
  } catch (e) { msg(`同步失败：${e.message}`); }
}

// ---------------- 调仓建议（建议 vs 实际）----------------
async function renderPlanTab(book) {
  const sugg = await suggestedTarget();
  const sysSet = new Set(META.allocation_tickers_system || []);
  const s = book.snapshot;
  const price = Object.fromEntries(book.rows.map((r) => [r.ticker, r.price]));
  const { prices } = await latestPrices();
  const px = (t) => price[t] || prices[t];
  const tickers = [...new Set([...Object.keys(s.positions), ...Object.keys(sugg.target)])];
  const plan = HoldingsCalc.rebalancePlan(s.positions, s.cash, Object.fromEntries(tickers.map((t) => [t, px(t)]).filter(([, p]) => p > 0)), sugg.target, [...sysSet], 10);
  const trades = plan.rows.filter((r) => r.trade_shares !== 0);
  const ins = [];
  if (trades.length) ins.push({ level: "info", kind: "model", text: `按系统建议（${sugg.source}）需要 ${trades.length} 笔交易，合计买入 ${money(plan.total_buy)}、卖出 ${money(plan.total_sell)}，预估成本 ${money(plan.total_cost)}。` });
  byId("h-body").innerHTML = `${insightBox(ins)}
    <section class="card"><h3>建议 vs 实际（${esc(sugg.source)}）${badge("model")}${badge("derived")}</h3>
      <p class="muted">可调资金 ${money(plan.managed_value)}（系统范围内持仓 + 现金）；整股计算，零头留现金；成本按单边 0.1%。</p>
      <div class="table-wrap"><table><thead><tr><th>标的</th><th class="num">价格</th><th class="num">当前股数</th><th class="num">目标股数</th><th class="num">买卖</th><th class="num">金额</th><th class="num">成本</th><th class="num">当前</th><th class="num">调仓后</th><th class="num">建议</th></tr></thead>
      <tbody>${plan.rows.map((r) => `<tr><td><b>${esc(r.ticker)}</b> <span class="muted">${esc(META.names_zh?.[r.ticker] || "")}</span></td><td class="num">${num(r.price, 2)}</td>
        <td class="num">${shareFmt(r.current_shares)}</td><td class="num">${r.target_shares}</td>
        <td class="num ${r.trade_shares > 0 ? "pos" : r.trade_shares < 0 ? "neg" : ""}">${r.trade_shares ? (r.trade_shares > 0 ? "+" : "") + shareFmt(r.trade_shares) : "–"}</td>
        <td class="num">${r.trade_shares ? money(r.trade_value) : "–"}</td><td class="num">${num(r.cost, 2)}</td>
        <td class="num">${pct(r.current_weight, 1)}</td><td class="num">${pct(r.after_weight, 1)}</td><td class="num">${pct(r.target_weight, 1)}</td></tr>`).join("")}</tbody></table></div>
      <p>合计买入 ${money(plan.total_buy)}、卖出 ${money(plan.total_sell)}，预估成本 ${num(plan.total_cost, 2)}；调仓后现金 ${money(plan.cash_after)}（建议 ${pct(plan.target_cash_weight, 1)}），与建议的最大偏差 ${pct(plan.max_deviation, 1)}。</p>
      ${Object.keys(plan.unmanaged).length ? `<p class="muted">不参与调仓（系统范围外）：${Object.entries(plan.unmanaged).map(([t, v]) => `${esc(t)} ${money(v)}`).join("、")}</p>` : ""}
      ${plan.no_price.length ? `<p class="warn">缺少价格、未计算：${plan.no_price.join("、")}</p>` : ""}
      <p class="muted"><a href="#/sim?c=${simEncode({ ...SIM_DEFAULT, posMode: "weight", weights: Object.fromEntries(book.rows.filter((r) => r.has_data && isNum(r.weight)).map((r) => [r.ticker, r.weight])), initial: Math.round(book.account.total_value), strategy: "hold", start: "2019-01-01" })}">在模拟经营中回测“按当前比例持有”→</a></p></section>`;
}
async function latestPrices() {
  const raw = await load("sim/prices.json");
  const out = {};
  for (const a of raw.assets) {
    const c = raw.close[a.ticker];
    for (let i = c.length - 1; i >= 0; i--) if (c[i] != null) { out[a.ticker] = c[i]; break; }
  }
  return { prices: out, asof: raw.dates[raw.dates.length - 1] };
}

// ---------------- 交易记录（起始持仓 + 交易）----------------
function renderLedgerTab(P, raw) {
  let start = loadReconStart();
  let trades = loadTrades();
  byId("h-body").innerHTML = `
    <section class="card"><h3>起始持仓（过去某日收盘后）${badge("fact")}</h3>
      <div class="row"><label>日期 <input type="date" id="rs-date" min="${esc(P.dates[Math.max(P.backtestStart, 1)])}" max="${esc(P.dates[P.n - 1])}" value="${esc(start?.date || "")}"></label>
        <label>现金 <input type="number" id="rs-cash" min="0" step="100" value="${start?.cash ?? 0}" style="width:120px"></label></div>
      <div class="table-wrap"><table><thead><tr><th>代码</th><th>名称</th><th class="num">股数</th><th class="num" title="可选：券商显示的平均成本；不填按起始日收盘价估计">成本价（可选）</th><th></th></tr></thead><tbody id="rs-rows"></tbody></table></div>
      <div class="row"><input type="text" id="rs-new" placeholder="代码" style="width:100px"><input type="number" id="rs-new-n" placeholder="股数" min="0" step="any" style="width:90px">
        <input type="number" id="rs-new-c" placeholder="成本价（可选）" min="0" step="0.01" style="width:120px">
        <button type="button" class="ghost" id="rs-add">添加</button>
        <details class="howto" style="flex:1 1 300px"><summary>粘贴导入（每行“代码 股数 [成本价]”，现金写“现金 金额”）</summary>
          <textarea id="rs-paste" rows="4" style="width:100%" placeholder="NVDA 40 120.5\nSPY 30\n现金 8000"></textarea>
          <div class="row"><button type="button" class="ghost" id="rs-paste-btn">解析并覆盖</button></div></details></div>
      <div class="row"><button type="button" class="primary" id="rs-save">保存起始持仓</button><span class="muted" id="rs-msg"></span></div>
      <details class="howto"><summary>由券商当前持仓倒推起始持仓</summary>
        <p class="muted">填入券商里现在的持仓（每行“代码 股数”，现金写“现金 金额”），上方选好过去的起始日期，点“倒推”：系统撤销这段时间里录入的交易，算出那天收盘后的持仓。现金按成交额与费用反推（不含期间的分红与利息，请核对）。</p>
        <textarea id="rs-now" rows="4" style="width:100%" placeholder="NVDA 50\nSPY 25\n现金 3200"></textarea>
        <div class="row"><label>当前持仓日期 <input type="date" id="rs-now-d" value="${esc(new Date().toISOString().slice(0, 10))}"></label><button type="button" class="ghost" id="rs-reverse">倒推</button></div></details></section>
    <section class="card"><h3>交易记录 ${badge("fact")}</h3>
      <div class="table-wrap"><table><thead><tr id="rc-head"></tr></thead><tbody id="rc-rows"></tbody></table></div>
      <div class="row"><input type="date" id="rc-d" value="${esc(new Date().toISOString().slice(0, 10))}"><select id="rc-side"><option value="buy">买入</option><option value="sell">卖出</option><option value="deposit">存入现金</option><option value="withdraw">取出现金</option></select>
        <input type="text" id="rc-t" placeholder="代码" style="width:90px"><input type="number" id="rc-n" placeholder="股数" min="0" step="any" style="width:90px">
        <input type="number" id="rc-p" placeholder="成交价" min="0" step="0.01" style="width:100px"><input type="number" id="rc-f" placeholder="费用" min="0" step="0.01" style="width:80px">
        <button type="button" class="ghost" id="rc-add">添加</button><span class="muted" id="rc-msg"></span></div>
      <details class="howto"><summary>粘贴导入（每行“日期 买/卖 代码 股数 成交价 费用”；资金写“日期 存入/取出 金额”）</summary>
        <textarea id="rc-paste" rows="5" style="width:100%" placeholder="2026-09-29 买 NVDA 10 180.50 1.00\n2026-09-29 卖 SPY 5 700.20 0.50\n2026-10-01 存入 5000\n2026-10-15 取出 2000"></textarea>
        <div class="row"><button type="button" class="ghost" id="rc-paste-btn">解析并追加</button><span class="muted" id="rc-paste-msg"></span></div></details>
      <p class="muted" id="rc-summary"></p></section>`;
  const summary = () => {
    const st = loadReconStart();
    if (!st) { byId("rc-summary").textContent = "还没有起始持仓。"; return; }
    try {
      const b = Recon.ledgerBook(P, raw, st, trades, { cashInterest: HOLD_CFG.cashInterest });
      // 与持仓页同样的完整推算（拆股、平均成本）存为缓存：全站成本价、持仓股数立刻按新账本显示
      saveHoldings({ ...b.snapshot, sig: ledgerSig(localStorage.getItem(RECON_START_KEY), localStorage.getItem(TRADES_KEY)), cost_est: b.rows.filter((r) => r.est_cost).map((r) => r.ticker) });
      byId("rc-summary").innerHTML = `按当前账本推算：${b.rows.length} 个持仓，账户总值 ${money(b.account.total_value)}，现金 ${money(b.account.cash)}。<a href="#/holdings">查看持仓 →</a>${b.warnings.length ? `<br><span class="warn">${b.warnings.map(esc).join("；")}</span>` : ""}`;
    } catch (e) { byId("rc-summary").textContent = `推算失败：${e.message}`; }
  };
  const SIDE = { buy: ["买入", "pos"], sell: ["卖出", "neg"], deposit: ["存入现金", "pos"], withdraw: ["取出现金", "neg"] };
  const flowSide = (t) => t.side === "deposit" || t.side === "withdraw";
  let editing = -1; // 正在修改的记录（排序后的下标）
  const editRow = (t, i) => {
    const f = flowSide(t);
    return `<tr class="rc-edit"><td><input type="date" id="re-d" value="${esc(t.date)}"></td>
      <td><select id="re-side">${Object.entries(SIDE).map(([k, [n]]) => `<option value="${k}" ${k === t.side ? "selected" : ""}>${n}</option>`).join("")}</select></td>
      <td><input type="text" id="re-t" value="${f ? "" : esc(t.ticker)}" placeholder="${f ? "现金" : "代码"}" ${f ? "disabled" : ""} style="width:80px"></td>
      <td class="num"><input type="number" id="re-n" value="${t.shares}" min="0" step="any" style="width:90px"></td>
      <td class="num"><input type="number" id="re-p" value="${t.price > 0 ? t.price : ""}" placeholder="开盘价" min="0" step="0.01" ${f ? "disabled" : ""} style="width:90px"></td>
      <td class="num"><input type="number" id="re-f" value="${t.fee || ""}" min="0" step="0.01" ${f ? "disabled" : ""} style="width:70px"></td>
      <td class="nowrap"><button type="button" class="primary" id="re-save" data-i="${i}">保存</button> <button type="button" class="ghost" id="re-cancel">取消</button></td></tr>`;
  };
  // 排序：点表头切换（同一列再点一次反向）；存储顺序始终按日期，显示顺序单独计算；选择记在本机
  const SORT_KEY = "invest.trades.sort";
  let sort = { k: "date", d: 1 };
  try { sort = { ...sort, ...JSON.parse(localStorage.getItem(SORT_KEY) || "{}") }; } catch { /* 忽略 */ }
  const COLS = [["date", "日期", ""], ["side", "方向", ""], ["ticker", "代码", ""], ["shares", "股数 / 金额", "num"], ["price", "成交价", "num"], ["fee", "费用", "num"]];
  const SIDE_ORDER = { buy: 0, sell: 1, deposit: 2, withdraw: 3 };
  const sortVal = (t, k) => (k === "side" ? SIDE_ORDER[t.side] ?? 9 : k === "ticker" ? (flowSide(t) ? "~现金" : t.ticker) : k === "price" || k === "fee" ? (flowSide(t) || !(t[k] > 0) ? null : t[k]) : t[k]);
  const order = () => trades.map((_, i) => i).sort((a, b) => {
    const x = sortVal(trades[a], sort.k), y = sortVal(trades[b], sort.k);
    if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1; // 空值（开盘价 / 现金记录）总在最后
    const c = typeof x === "string" ? x.localeCompare(y) : x - y;
    return c * sort.d || trades[a].date.localeCompare(trades[b].date);
  });
  const drawHead = () => {
    byId("rc-head").innerHTML = COLS.map(([k, n, c]) => `<th class="${c} sortable${sort.k === k ? " on" : ""}" data-k="${k}" title="点击排序">${n}${sort.k === k ? (sort.d > 0 ? " ▲" : " ▼") : ""}</th>`).join("") + "<th></th>";
    byId("rc-head").querySelectorAll("[data-k]").forEach((th) => (th.onclick = () => {
      sort = sort.k === th.dataset.k ? { k: sort.k, d: -sort.d } : { k: th.dataset.k, d: th.dataset.k === "date" ? 1 : -1 };
      try { localStorage.setItem(SORT_KEY, JSON.stringify(sort)); } catch { /* 忽略 */ }
      draw();
    }));
  };
  const draw = () => {
    const cur = editing >= 0 ? trades[editing] : null;
    trades.sort((a, b) => a.date.localeCompare(b.date));
    editing = cur ? trades.indexOf(cur) : -1;
    drawHead();
    byId("rc-rows").innerHTML = order().map((i) => [trades[i], i]).map(([t, i]) => (i === editing ? editRow(t, i) : `<tr class="${start && t.date <= start.date ? "muted" : ""}"><td>${esc(t.date)}</td><td class="${SIDE[t.side]?.[1] || ""}">${SIDE[t.side]?.[0] || esc(t.side)}</td>
      <td><b>${flowSide(t) ? "现金" : esc(t.ticker)}</b></td><td class="num">${flowSide(t) ? money2(t.shares) : shareFmt(t.shares)}</td>
      <td class="num">${flowSide(t) ? "–" : t.price > 0 ? money2(t.price) : "开盘价"}</td><td class="num">${flowSide(t) ? "–" : money2(t.fee || 0)}</td>
      <td class="nowrap"><button type="button" class="ghost rc-edit-btn" data-i="${i}">修改</button> <button type="button" class="ghost rc-del" data-i="${i}">删除</button></td></tr>`)).join("") || `<tr><td colspan="7" class="muted">还没有交易记录</td></tr>`;
    document.querySelectorAll(".rc-del").forEach((b) => (b.onclick = () => {
      const t = trades[+b.dataset.i];
      if (!confirm(`删除这条记录？（${t.date} ${SIDE[t.side]?.[0] || t.side} ${flowSide(t) ? money2(t.shares) : `${t.ticker} ${shareFmt(t.shares)} 股`}）`)) return;
      trades.splice(+b.dataset.i, 1); editing = -1; saveTrades(trades); draw();
    }));
    document.querySelectorAll(".rc-edit-btn").forEach((b) => (b.onclick = () => { editing = +b.dataset.i; draw(); }));
    if (editing >= 0 && byId("re-save")) {
      const sideSync = () => {
        const f = ["deposit", "withdraw"].includes(byId("re-side").value);
        ["re-t", "re-p", "re-f"].forEach((k) => (byId(k).disabled = f));
        byId("re-t").placeholder = f ? "现金" : "代码";
      };
      byId("re-side").onchange = sideSync;
      byId("re-cancel").onclick = () => { editing = -1; draw(); };
      byId("re-save").onclick = () => {
        const side = byId("re-side").value, d = byId("re-d").value, n = +byId("re-n").value;
        if (!d) { byId("rc-msg").textContent = "请填写日期"; return; }
        if (!(n > 0)) { byId("rc-msg").textContent = side === "deposit" || side === "withdraw" ? "请填写金额" : "请填写股数"; return; }
        let rec;
        if (side === "deposit" || side === "withdraw") rec = { date: d, side, ticker: "CASH", shares: n, price: null, fee: 0 };
        else {
          const t = normTicker(byId("re-t").value);
          if (!TICKER_RE.test(t)) { byId("rc-msg").textContent = "请填写代码"; return; }
          rec = { date: d, side, ticker: t, shares: n, price: +byId("re-p").value || null, fee: +byId("re-f").value || 0 };
        }
        trades[editing] = { ...trades[editing], ...rec };
        editing = -1; saveTrades(trades); draw(); byId("rc-msg").textContent = "已修改";
      };
    }
    summary();
  };
  const syncSide = () => {
    const f = ["deposit", "withdraw"].includes(byId("rc-side").value);
    byId("rc-t").disabled = f; byId("rc-p").disabled = f; byId("rc-f").disabled = f;
    byId("rc-t").placeholder = f ? "现金" : "代码"; byId("rc-n").placeholder = f ? "金额" : "股数";
  };
  byId("rc-side").onchange = syncSide;
  byId("rc-add").onclick = () => {
    const side = byId("rc-side").value, d = byId("rc-d").value;
    if (!d) { byId("rc-msg").textContent = "请填写日期"; return; }
    if (side === "deposit" || side === "withdraw") {
      const amt = +byId("rc-n").value;
      if (!(amt > 0)) { byId("rc-msg").textContent = "请填写金额"; return; }
      trades.push({ date: d, side, ticker: "CASH", shares: amt, price: null, fee: 0 });
    } else {
      const t = normTicker(byId("rc-t").value), n = +byId("rc-n").value;
      if (!TICKER_RE.test(t) || !(n > 0)) { byId("rc-msg").textContent = "请填写代码与股数"; return; }
      trades.push({ date: d, side, ticker: t, shares: n, price: +byId("rc-p").value || null, fee: +byId("rc-f").value || 0 });
    }
    editing = -1; saveTrades(trades); draw(); byId("rc-msg").textContent = "已添加";
    ["rc-t", "rc-n", "rc-p", "rc-f"].forEach((k) => (byId(k).value = ""));
  };
  byId("rc-paste-btn").onclick = () => {
    const p = Recon.parseTrades(byId("rc-paste").value);
    trades.push(...p.trades); editing = -1; saveTrades(trades); draw();
    byId("rc-paste-msg").textContent = `追加 ${p.trades.length} 笔${p.errors.length ? `；${p.errors.length} 行无法识别：${p.errors.slice(0, 2).join("；")}` : ""}`;
  };
  // ---------- 起始持仓编辑器 ----------
  let sp = start ? { ...start.positions } : {};
  let sc = start ? { ...(start.cost || {}) } : {};
  const drawStart = () => {
    byId("rs-rows").innerHTML = Object.keys(sp).sort().map((t) => `<tr><td><b>${esc(t)}</b>${P.C[t] ? "" : ' <span class="chip">无行情</span>'}</td>
      <td>${esc(META.names_zh?.[t] || "")}</td><td class="num"><input type="number" class="rs-sh" data-t="${t}" min="0" step="any" value="${sp[t]}" style="width:100px"></td>
      <td class="num"><input type="number" class="rs-c" data-t="${t}" min="0" step="0.01" value="${sc[t] || ""}" placeholder="起始日收盘价" style="width:110px"></td>
      <td><button type="button" class="ghost rs-del" data-t="${t}">移除</button></td></tr>`).join("") || `<tr><td colspan="5" class="muted">尚未填写</td></tr>`;
    document.querySelectorAll(".rs-sh").forEach((el) => (el.onchange = () => { sp[el.dataset.t] = Math.max(0, +el.value || 0); }));
    document.querySelectorAll(".rs-c").forEach((el) => (el.onchange = () => { const v = +el.value; if (v > 0) sc[el.dataset.t] = v; else delete sc[el.dataset.t]; }));
    document.querySelectorAll(".rs-del").forEach((el) => (el.onclick = () => { delete sp[el.dataset.t]; delete sc[el.dataset.t]; drawStart(); }));
  };
  const commitStart = (msg) => {
    const d = byId("rs-date").value;
    if (!d) { byId("rs-msg").textContent = "请填写日期"; return false; }
    const positions = Object.fromEntries(Object.entries(sp).filter(([, v]) => v > 0));
    start = { date: d, positions, cash: Math.max(0, +byId("rs-cash").value || 0), cost: Object.fromEntries(Object.entries(sc).filter(([t, v]) => positions[t] && v > 0)) };
    saveReconStart(start);
    byId("rs-msg").textContent = msg || `已保存 ${d} 的起始持仓（${Object.keys(start.positions).length} 个标的）`;
    draw();
    return true;
  };
  byId("rs-add").onclick = () => {
    const t = normTicker(byId("rs-new").value), n = +byId("rs-new-n").value, c = +byId("rs-new-c").value;
    if (!TICKER_RE.test(t) || !(n > 0)) { byId("rs-msg").textContent = "请填写代码与股数"; return; }
    sp[t] = n; if (c > 0) sc[t] = c;
    ["rs-new", "rs-new-n", "rs-new-c"].forEach((k) => (byId(k).value = "")); drawStart();
  };
  byId("rs-paste-btn").onclick = () => {
    const p = HoldingsCalc.parsePasted(byId("rs-paste").value);
    sp = { ...p.positions }; sc = { ...p.prices }; if (p.cash != null) byId("rs-cash").value = p.cash;
    byId("rs-msg").textContent = `识别 ${Object.keys(sp).length} 个标的${p.errors.length ? `；${p.errors.length} 行无法识别` : ""}（记得点“保存起始持仓”）`;
    drawStart();
  };
  byId("rs-save").onclick = () => commitStart();
  byId("rs-reverse").onclick = () => {
    const now = HoldingsCalc.parsePasted(byId("rs-now").value), d = byId("rs-date").value, nd = byId("rs-now-d").value;
    if (!Object.keys(now.positions).length && now.cash == null) { byId("rs-msg").textContent = "请先填入券商当前持仓"; return; }
    if (!d || !nd || d >= nd) { byId("rs-msg").textContent = "请在上方选择早于“当前持仓日期”的起始日期"; return; }
    const r = Recon.reverseTrades(now.positions, now.cash || 0, trades, d, nd);
    sp = { ...r.positions }; byId("rs-cash").value = Math.max(0, Math.round(r.cash * 100) / 100); drawStart();
    const notes = [`已由 ${nd} 的持仓撤销 ${r.used} 笔记录，倒推出 ${d} 的持仓`];
    if (r.missingPrice.length) notes.push(`${r.missingPrice.length} 笔没有成交价，现金无法反推，请手动核对`);
    if (r.negative.length) notes.push(`${r.negative.join("、")} 倒推后为负，可能漏录了买入`);
    if (r.cash < 0) notes.push("倒推现金为负，可能漏录了卖出或期间有资金存入");
    commitStart(notes.join("；"));
  };
  drawStart(); draw(); syncSide();
}

// ---------------- 实盘对账 ----------------
function renderReconTab(P, raw, sys, start0) {
  byId("h-body").innerHTML = `<section class="card"><div class="row">
      <label title="模拟那条曲线每笔买卖按成交额扣除的成本比例，不是某一笔交易的费用">模拟成本假设 <input type="number" id="rc-cost" min="0" max="100" value="10" style="width:56px"> bps</label>
      <label><input type="checkbox" id="rc-int" ${HOLD_CFG.cashInterest ? "checked" : ""}> 现金计息（放在 SPAXX 等货币基金中）</label>
      <button type="button" class="primary" id="rc-run">运行对账</button><span class="muted" id="rc-msg"></span></div>
    <p class="muted"><b>模拟成本假设</b>：模拟曲线每笔买卖按成交额扣除的成本比例（1 bp = 0.01%，默认 10 bps = 0.1%，与策略回测相同）；你每笔的实际费用来自交易记录的“费用”栏，两者之差即结果中的“费用差”。
      填 10 看默认假设与你的实际差多少；填 0 只验证计算逻辑；调到“费用差”接近 0 的值，可作为你在策略回测中设置成本的参考。起始持仓与交易在“交易记录”标签中编辑。</p></section>
    <div id="rc-report"></div>`;
  byId("rc-run").onclick = () => {
    try {
      const { start, trades } = Recon.splitNormalize(P, raw, start0, loadTrades());
      const out = Recon.reconcile(P, raw, start, trades, { costBps: +byId("rc-cost").value || 0, cashInterest: byId("rc-int").checked });
      renderReconReport(out, money);
      if (out._ctx.decisions.length || out.flows.length) renderFollowCompare(P, raw, sys, out, money);
      renderDecisionEval(P, raw, sys, out, money);
    } catch (e) { console.error(e); byId("rc-msg").textContent = `对账失败：${e.message}`; }
  };
  byId("rc-run").click();
}

function renderReconReport(out, money) {
  const d = out.decomposition;
  const last = out.actual.length - 1;
  const rel = d.total / out.sim[last];
  const ins = [];
  if (out.flows.length) ins.push({ level: "info", kind: "fact", text: `期间资金净${out.flow_total >= 0 ? "存入" : "取出"} ${money(Math.abs(out.flow_total))}（${out.flows.map((f) => `${f.date} ${f.amount >= 0 ? "+" : ""}${money(f.amount)}`).join("，")}），实际与模拟两条曲线同时计入。` });
  ins.push({ level: Math.abs(rel) < 0.002 ? "good" : "info", kind: "derived",
    text: `实际期末资产 ${money(out.actual[last])}，模拟 ${money(out.sim[last])}，相差 ${money(d.total)}（${(rel * 100).toFixed(2)}%）。` });
  if (out.rows.length) {
    const parts = [["成交价差", d.fill], ["费用差", d.fee], ["现金利息差", d.interest], ["其他", d.other]].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    ins.push({ level: "info", kind: "derived", text: `差额主要来自「${parts[0][0]}」${money(parts[0][1])}；成交价差为正表示你的成交价比当天开盘价更有利。` });
    const slip = out.rows.filter((r) => isNum(r.slip_bps) && r.price_given);
    if (slip.length) {
      const avg = slip.reduce((a, r) => a + r.slip_bps * r.shares * r.open, 0) / slip.reduce((a, r) => a + r.shares * r.open, 0);
      ins.push({ level: Math.abs(avg) > 20 ? "medium" : "info", kind: "derived", text: `按成交额加权，你的成交价平均比开盘价${avg > 0 ? "差" : "好"} ${Math.abs(avg).toFixed(1)} 个基点（${avg > 0 ? "买得更贵 / 卖得更便宜" : "买得更便宜 / 卖得更贵"}）。` });
    }
    ins.push({ level: "info", kind: "derived", text: `实际费用 ${num(out.fees, 2)}，按模拟成本假设计 ${num(out.model_cost, 2)}${out.fees < out.model_cost ? "：该成本假设比你的实际费用偏保守" : out.fees > out.model_cost ? "：该成本假设低于你的实际费用" : ""}。` });
  } else ins.push({ level: "info", kind: "derived", text: "还没有起始日期之后的交易：两条曲线应一致（差额来自分红到账方式等细节）。" });
  byId("rc-report").innerHTML = `${insightBox(ins)}
    ${out.warnings.length ? `<section class="card"><p class="warn">${out.warnings.map(esc).join("<br>")}</p></section>` : ""}
    <section class="card"><h3>对账结果 ${badge("derived")}${badge("simulated")}</h3><div class="kpis">
      <div class="kpi"><span class="muted">实际期末资产</span><b>${money(out.actual[last])}</b></div>
      <div class="kpi"><span class="muted">模拟期末资产</span><b>${money(out.sim[last])}</b></div>
      <div class="kpi"><span class="muted">差额（实际 − 模拟）</span><b class="${cls(d.total)}">${money(d.total)}</b><span class="muted">${(rel * 100).toFixed(2)}%</span></div>
      <div class="kpi"><span class="muted">期间分红 / 利息</span><b>${money(out.dividends)} / ${money(out.interest)}</b></div>
      ${out.flows.length ? `<div class="kpi"><span class="muted">资金净存入（${out.flows.length} 笔）</span><b class="${cls(out.flow_total)}">${money(out.flow_total)}</b><span class="muted">两条曲线同时计入，不影响差额</span></div>` : ""}</div>
      <div class="grid two"><div>${chartDiv("c-rc-nav")}</div><div>${chartDiv("c-rc-dec")}</div></div></section>
    ${out.rows.length ? card("逐笔对比：你的成交 vs 模拟假设", `<div class="table-wrap"><table><thead><tr><th>日期</th><th>方向</th><th>代码</th><th class="num">股数</th><th class="num">成交价</th><th class="num">当天开盘价</th><th class="num">价差（bps）</th><th class="num">实际费用</th><th class="num">模拟成本</th></tr></thead>
      <tbody>${out.rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${r.side === "buy" ? "买入" : "卖出"}</td><td><b>${esc(r.ticker)}</b></td><td class="num">${r.shares}</td>
        <td class="num">${num(r.price, 2)}${r.price_given ? "" : " <span class=\"muted\">(开盘)</span>"}</td><td class="num">${num(r.open, 2)}</td>
        <td class="num ${cls(-r.slip_bps)}">${isNum(r.slip_bps) ? r.slip_bps.toFixed(1) : "–"}</td><td class="num">${num(r.fee, 2)}</td><td class="num">${num(r.model_cost, 2)}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted">价差 = 你的成交价相对开盘价的偏离（买入为正表示买贵了，卖出为正表示卖便宜了）。</p>`, "", ["fact", "derived"]) : ""}`;
  bindGoto();
  mkChart(byId("c-rc-nav"), {
    tooltip: { trigger: "axis", valueFormatter: (v) => money(v) }, legend: { top: 0 }, grid: { left: 70, right: 16, top: 36, bottom: 30 },
    xAxis: { type: "category", data: out.dates, boundaryGap: false }, yAxis: { type: "value", scale: true, axisLabel: { formatter: (v) => money(v) } },
    series: [{ name: "实际", type: "line", showSymbol: false, data: out.actual, color: palette()[0], lineStyle: { width: 2 } },
      { name: "模拟", type: "line", showSymbol: false, data: out.sim, color: BENCH_GRAY(), lineStyle: { type: "dashed" } }],
  });
  const items = [["成交价差", d.fill], ["费用差", d.fee], ["现金利息差", d.interest], ["其他", d.other], ["合计", d.total]];
  mkChart(byId("c-rc-dec"), {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => money(v) }, legend: { show: false }, grid: { left: 90, right: 60, top: 10, bottom: 20 },
    xAxis: { type: "value", axisLabel: { formatter: (v) => money(v) } }, yAxis: { type: "category", inverse: true, data: items.map(([n]) => n) },
    series: [{ type: "bar", barMaxWidth: 16, data: items.map(([n, v]) => ({ value: v, itemStyle: { color: n === "合计" ? palette()[0] : v >= 0 ? css("--pos") : css("--neg"), borderRadius: 3 } })),
      label: { show: true, position: "right", formatter: (p) => money(p.value), fontSize: 11, color: css("--ink-2") } }],
  });
}


// ---------------- 决策评估 ----------------
function renderFollowCompare(P, raw, sys, recon, money) {
  const host = document.createElement("div");
  byId("rc-report").appendChild(host);
  const cf = Recon.compareFollow(P, raw, recon, sys);
  const last = cf.dates.length - 1;
  const a = cf.actual[last], h = cf.hold[last], f = cf.follow ? cf.follow[last] : null;
  const ins = [{ level: a >= h ? "good" : "medium", kind: "derived", text: `你的实际账户 ${money(a)}，起始持仓一直不动 ${money(h)}：你的全部操作合计${a >= h ? "多赚" : "少赚"} ${money(Math.abs(a - h))}。` }];
  if (f != null) ins.push({ level: a >= f ? "good" : "medium", kind: "simulated",
    text: `若起始时一次性换成系统配置并每周跟随系统模型：${money(f)}（调仓 ${cf.followTrades} 次、成本 ${money(cf.followCost)}）；你${a >= f ? "多赚" : "少赚"} ${money(Math.abs(a - f))}。` });
  ins.push({ level: "info", kind: "derived", text: `对比期 ${cf.dates[0]} ~ ${cf.dates[last]}（${last} 个交易日）；期间的存取款三条曲线同时计入。时间越短，结论越受运气影响。` });
  host.innerHTML = `${insightBox(ins)}
    <section class="card"><h3>整体对比：你的账户 vs 一直跟随系统模型 vs 一直不动 ${badge("derived")}${badge("simulated")}</h3>
      <p class="muted">三条曲线都从对账起始持仓出发：<b>你的实际账户</b>（按你录入的交易与费用）；<b>跟随系统模型</b>（起始日后第一个交易日开盘一次性换成系统建议配置，之后每周按系统信号调仓，成本按模拟假设）；<b>一直不动</b>（起始持仓持有到底）。回答“系统模型值不值得跟随”。</p>
      ${chartDiv("c-fc")}</section>`;
  mkChart(byId("c-fc"), {
    tooltip: { trigger: "axis", valueFormatter: (v) => money(v) }, legend: { top: 0 }, grid: { left: 70, right: 20, top: 40, bottom: 30 },
    xAxis: { type: "category", data: cf.dates, boundaryGap: false }, yAxis: { type: "value", scale: true, axisLabel: { formatter: (v) => money(v) } },
    series: [{ name: "你的实际账户", type: "line", showSymbol: false, data: cf.actual, color: palette()[0], lineStyle: { width: 2 } },
      ...(cf.follow ? [{ name: "跟随系统模型", type: "line", showSymbol: false, data: cf.follow, color: palette()[6], lineStyle: { width: 1.5 } }] : []),
      { name: "一直不动", type: "line", showSymbol: false, data: cf.hold, color: BENCH_GRAY(), lineStyle: { type: "dashed" } }],
  });
}

function renderDecisionEval(P, raw, sys, recon, money) {
  const host = document.createElement("div");
  byId("rc-report").appendChild(host);
  if (!recon._ctx.decisions.length) {
    host.innerHTML = card("决策评估", `<p class="muted">还没有起始持仓之后的交易，暂无可评估的操作。</p>`, "", ["derived"]);
    return;
  }
  let horizon = "now", withSys = !!sys;
  const HZ = [["now", "持有至今"], ["252", "12 个月"], ["126", "6 个月"], ["63", "3 个月"], ["next", "到下一次操作"]]; // 数组保证顺序
  const draw = () => {
    const oldEl = byId("c-de");
    const old = oldEl && window.echarts?.getInstanceByDom(oldEl);
    if (old) { charts = charts.filter((x) => x !== old); old.dispose(); }
    const rows = Recon.evaluateDecisions(P, raw, recon, { horizon, sys: withSys ? sys : null });
    const n = rows.length;
    const sum = (f) => rows.reduce((a, r) => a + (isNum(r[f]) ? r[f] : 0), 0);
    const selRows = rows.filter((r) => isNum(r.selection) && r.legs.some((l) => l.ticker !== "SPY"));
    const selWin = selRows.filter((r) => r.selection > 0).length;
    const avgSelPct = selRows.length ? selRows.reduce((a, r) => a + (isNum(r.selection_pct) ? r.selection_pct : 0), 0) / selRows.length : NaN;
    const timRows = rows.filter((r) => isNum(r.timing) && Math.abs(r.net_buy) > 1);
    const timWin = timRows.filter((r) => r.timing > 0).length;
    const shortN = rows.filter((r) => !r.full).length;
    const vsRows = rows.filter((r) => r.vs_c != null);
    const vsTotal = vsRows.reduce((a, r) => a + r.vs_c, 0);
    const overlap = horizon !== "next";
    const ins = [];
    if (selRows.length) ins.push({ level: sum("selection") >= 0 ? "good" : "medium", kind: "derived",
      text: `选股：${selRows.length} 次换股中 ${selWin} 次跑赢大盘（换入的相对 SPY 更好 / 换出的更差）；平均超额 ${pct(avgSelPct, 1, true)}（占当次成交额）；合计 ${money(sum("selection"))}。` });
    if (timRows.length) ins.push({ level: sum("timing") >= 0 ? "good" : "medium", kind: "derived",
      text: `择时（加减仓）：${timRows.length} 次改变了股票总仓位，${timWin} 次时机有利；合计 ${money(sum("timing"))}（加仓后大盘上涨、减仓后大盘下跌为正）。` });
    ins.push({ level: "info", kind: "derived", text: `交易费用合计 ${money(sum("cost"))}；以上三项相加 = 全部操作相对“不操作”的增减 ${money(sum("added"))}${overlap ? "（窗口互相重叠，各次相加仅作汇总参考）" : ""}。` });
    if (vsRows.length) ins.push({ level: vsTotal >= 0 ? "good" : "medium", kind: "simulated",
      text: `与“同一天按系统建议清单操作”相比：${vsRows.length} 次中系统建议的操作在 ${vsRows.filter((r) => r.vs_c < 0).length} 次更好；合计你的操作${vsTotal >= 0 ? "多" : "少"}赚 ${money(Math.abs(vsTotal))}。` });
    if (n < 10) ins.push({ level: "medium", kind: "derived", text: `目前只有 ${n} 次操作：单次结果 = 判断 + 运气，看不出规律；建议积累 10 次以上，并主要看“选股跑赢次数占比”和长期窗口的结果。` });
    if (shortN) ins.push({ level: "info", kind: "derived", text: `${shortN} 次操作距今${horizon === "now" ? "不足 6 个月" : "未走完所选窗口"}（标注“时间太短 / 未完”），结果主要反映短期波动，会随时间变化。` });
    const tradeText = (r) => r.trades.map((t) => `${t.side === "buy" ? "买" : "卖"} ${t.ticker} ${+t.shares.toFixed(4)}`).join("；");
    const legText = (r) => r.legs.map((l) => `${l.ticker} ${pct(l.r, 1, true)}${isNum(l.excess) && l.ticker !== "SPY" ? `（超额 ${pct(l.excess, 1, true)}）` : ""}`).join("；");
    host.innerHTML = `${insightBox(ins)}
      <section class="card"><h3>决策评估：每次操作长期看对不对 ${badge("derived")}${withSys ? badge("simulated") : ""}</h3>
        <p class="muted">对每次操作，假设<b>只做这一次调整、之后什么都不做</b>，比较到窗口结束时 <b>A 你的操作</b> 与 <b>B 不操作</b> 的差（增减 = A − B），并拆成三部分：
          <b>择时</b> = 净买入金额 ×（SPY 收益 − 现金收益），衡量加减仓的时机；<b>选股</b> = 每笔成交额 ×（该股收益 − SPY 收益），衡量换入的是否跑赢大盘、换出的是否跑输大盘，与大盘涨跌无关；<b>成本</b> = 费用。
          ${withSys ? "C = 同一天改按系统建议清单调仓后持有。" : ""}</p>
        <div class="row"><span class="muted">窗口</span><div class="seg" id="de-h">${HZ.map(([k, t]) => `<button type="button" data-h="${k}" class="${k === horizon ? "on" : ""}">${t}</button>`).join("")}</div>
          ${sys ? `<label><input type="checkbox" id="de-sys" ${withSys ? "checked" : ""}> 对比“同一天按系统建议清单操作”</label>` : ""}</div>
        <div class="kpis">
          <div class="kpi"><span class="muted">选股合计</span><b class="${cls(sum("selection"))}">${money(sum("selection"))}</b><span class="muted">${selRows.length ? `跑赢 ${selWin}/${selRows.length} 次` : "无换股"}</span></div>
          <div class="kpi"><span class="muted">择时合计</span><b class="${cls(sum("timing"))}">${money(sum("timing"))}</b><span class="muted">${timRows.length ? `有利 ${timWin}/${timRows.length} 次` : "无加减仓"}</span></div>
          <div class="kpi"><span class="muted">费用合计</span><b>${money(sum("cost"))}</b></div>
          <div class="kpi"><span class="muted">增减合计（A − B）</span><b class="${cls(sum("added"))}">${money(sum("added"))}</b><span class="muted">${overlap ? "窗口重叠，仅供参考" : "= 主动操作总贡献"}</span></div></div>
        ${chartDiv("c-de")}
        <details class="howto"><summary>逐次明细（${n} 次操作）</summary>
        <div class="table-wrap"><table><thead><tr><th>操作日</th><th>操作内容</th><th>窗口</th><th class="num">增减 A−B</th><th class="num">择时</th><th class="num">选股</th><th class="num">费用</th><th>各笔收益（相对 SPY 超额）</th>${withSys ? '<th class="num">你 − 系统建议的操作</th>' : ""}</tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${esc(r.date)}</td><td class="wrap">${esc(tradeText(r))}</td>
          <td>至 ${esc(r.window_end)}（${r.sessions} 个交易日）${r.full ? "" : ` <span class="chip">${horizon === "now" ? "时间太短" : "未完"}</span>`}</td>
          <td class="num ${cls(r.added)}"><b>${money(r.added)}</b><br><span class="muted">${pct(r.added_pct, 2, true)}</span></td>
          <td class="num ${cls(r.timing)}">${isNum(r.timing) ? money(r.timing) : "–"}</td>
          <td class="num ${cls(r.selection)}">${isNum(r.selection) ? money(r.selection) : "–"}${isNum(r.selection_pct) ? `<br><span class="muted">${pct(r.selection_pct, 1, true)}</span>` : ""}</td>
          <td class="num">${num(r.cost, 2)}</td><td class="wrap muted">${esc(legText(r))}</td>
          ${withSys ? `<td class="num ${cls(r.vs_c)}">${r.vs_c == null ? "–" : money(r.vs_c)}</td>` : ""}</tr>`).join("")}</tbody></table></div>
        <p class="muted">SPY 同期收益为大盘基准；只买卖 SPY 的操作没有选股成分。“其他”（分红到账后的利息等）通常接近 0，未单列。</p></details>
      </section>`;
    const series = [
      { name: "择时", type: "bar", stack: "d", barMaxWidth: 26, color: palette()[0], data: rows.map((r) => (isNum(r.timing) ? r.timing : 0)) },
      { name: "选股", type: "bar", stack: "d", barMaxWidth: 26, color: palette()[2], data: rows.map((r) => (isNum(r.selection) ? r.selection : 0)) },
      { name: "费用", type: "bar", stack: "d", barMaxWidth: 26, color: palette()[7], data: rows.map((r) => -r.cost) },
      { name: "增减 A − B", type: "scatter", symbol: "diamond", symbolSize: 10, color: css("--ink"), data: rows.map((r) => r.added) },
    ];
    if (!overlap) { let cum = 0; series.push({ name: "累计增减", type: "line", symbolSize: 5, color: palette()[1], data: rows.map((r) => (cum += r.added)) }); }
    if (withSys && vsRows.length) series.push({ name: "你 − 系统建议的操作", type: "scatter", symbol: "triangle", symbolSize: 9, color: palette()[6], data: rows.map((r) => r.vs_c) });
    mkChart(byId("c-de"), {
      tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "–" : money(v)) }, legend: { top: 0 }, grid: { left: 70, right: 20, top: 40, bottom: 30 },
      xAxis: { type: "category", data: rows.map((r) => r.date) }, yAxis: { type: "value", axisLabel: { formatter: (v) => money(v) } },
      series,
    });
    document.querySelectorAll("#de-h button").forEach((b) => (b.onclick = () => { horizon = b.dataset.h; draw(); }));
    byId("de-sys")?.addEventListener("change", (e) => { withSys = e.target.checked; draw(); });
  };
  draw();
}
