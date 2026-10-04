"use strict";
/* 买入计划 / 计划持仓。
   计划只保存在本机浏览器（localStorage）；“同步到后台”时随持仓一起加密提交，之后每日 / 每周推送按计划持仓分析。
   计划持仓 = 当前持仓 + 尚未成交的计划买入：账本中计划创建日（含）之后同一标的的买入，按计划创建先后依次抵扣。
   本机没有编辑过计划时，使用个人数据包里后台最近一次同步的计划（其他设备上创建的）。 */

const PLANS_KEY = "invest.plans.v1";

function plansEdited() { try { return localStorage.getItem(PLANS_KEY) !== null; } catch { return false; } }
function loadPlans() {
  try { const v = localStorage.getItem(PLANS_KEY); if (v !== null) return JSON.parse(v) || []; } catch { /* 忽略 */ }
  return (typeof window !== "undefined" && window.PERSONAL?.plans) || [];
}
function savePlans(p) { try { localStorage.setItem(PLANS_KEY, JSON.stringify(p)); } catch { /* 忽略 */ } }

const PlanCalc = {
  /* 各计划的已成交 / 剩余（prices 只用于折算按金额的计划与剩余金额；判断是否完成只用账本里的成交价） */
  status(plans, trades, prices = {}) {
    const buys = {};
    for (const t of trades || []) if (t.side === "buy" && t.shares > 0) (buys[normTicker(t.ticker)] ||= []).push({ date: t.date, left: t.shares, price: t.price });
    Object.values(buys).forEach((b) => b.sort((x, y) => x.date.localeCompare(y.date)));
    return [...plans].sort((a, b) => `${a.created}${a.id}`.localeCompare(`${b.created}${b.id}`)).map((p) => {
      const price = prices[p.ticker] > 0 ? prices[p.ticker] : null;
      const s = { plan: p, price, filled_shares: 0, filled_value: 0 };
      for (const b of buys[p.ticker] || []) {
        if (b.date < p.created || b.left <= 1e-6) continue;
        const px = b.price || price || 0;
        const take = p.shares != null ? Math.min(b.left, p.shares - s.filled_shares) : px > 0 ? Math.min(b.left, (p.amount - s.filled_value) / px) : 0;
        if (take <= 1e-6) break;
        s.filled_shares += take; s.filled_value += take * px; b.left -= take;
      }
      if (p.shares != null) {
        s.remaining_shares = Math.max(0, p.shares - s.filled_shares);
        s.remaining_value = price ? s.remaining_shares * price : NaN;
        s.done = s.remaining_shares <= 1e-6;
      } else {
        s.remaining_value = Math.max(0, p.amount - s.filled_value);
        s.remaining_shares = price ? s.remaining_value / price : NaN;
        s.done = s.remaining_value <= Math.max(1, 0.01 * p.amount); // 剩余不足 1% 视为完成（整股零头）
      }
      s.since = p.created_price && price ? price / p.created_price - 1 : null;
      s.to_target = p.target_price && price ? p.target_price / price - 1 : null; // 负数 = 还需下跌的幅度
      return s;
    });
  },
  /* 计划持仓：总资产不变，计划买入的资金从现金中扣除（不足时记为资金缺口） */
  proForma(snap, statuses, prices) {
    const px = (t) => (prices[t] > 0 ? prices[t] : snap.prices?.[t] || snap.cost?.[t] || null);
    const pos = { ...snap.positions };
    let cash = snap.cash || 0;
    const unpriced = [];
    let total = cash;
    for (const [t, n] of Object.entries(snap.positions)) if (px(t)) total += n * px(t);
    for (const s of statuses) {
      if (s.done) continue;
      if (!s.price) { unpriced.push(s.plan.ticker); continue; }
      pos[s.plan.ticker] = (pos[s.plan.ticker] || 0) + s.remaining_shares;
      cash -= s.remaining_value;
    }
    const w = (p, c) => {
      const o = {};
      for (const [t, n] of Object.entries(p)) if (n > 0 && px(t)) o[t] = (n * px(t)) / total;
      if (c > 0) o.CASH = c / total;
      return o;
    };
    return { total, current: total > 0 ? w(snap.positions, snap.cash || 0) : {}, weights: total > 0 ? w(pos, cash) : {}, cash, gap: Math.max(0, -cash), unpriced };
  },
  /* 个股真实暴露 = 直接持有 + SPY 占比 × SPY 中的权重 */
  lookthrough(weights) {
    const L = META.plan_limits || {};
    const core = weights[L.core || "SPY"] || 0;
    const spy = L.spy_weights || {};
    const out = {};
    for (const t of new Set([...Object.keys(weights), ...Object.keys(spy)])) if (t !== "CASH" && t !== L.core) out[t] = (weights[t] || 0) + core * (spy[t] || 0);
    return out;
  },
  /* 风险检查：只针对与计划相关的标的 / 主题（与 portfolio/plans.py 的 risk_checks 一致） */
  checks(pf, planned, target) {
    const L = META.plan_limits || {};
    const out = [];
    const theme = (t) => META.universe.find((u) => u.ticker === t)?.theme;
    if (pf.gap > 0) out.push(`现金不足：全部按计划买入还差约 ${money(pf.gap)}（需先卖出或入金）`);
    const lt = this.lookthrough(pf.weights);
    for (const t of [...planned].sort()) {
      const w = pf.weights[t] || 0;
      if (L.max_single && w > L.max_single) out.push(`${t} 计划持仓占 ${pct(w)}，超过系统单股上限 ${pct(L.max_single, 0)}`);
      if (L.lookthrough_single && lt[t] > L.lookthrough_single) out.push(`${t} 计划持仓的真实暴露（直接 + 经 SPY）${pct(lt[t])}，超过阈值 ${pct(L.lookthrough_single, 0)}`);
    }
    const themes = {};
    for (const [t, w] of Object.entries(pf.weights)) { const th = theme(t); if (th) themes[th] = (themes[th] || 0) + w; }
    for (const th of new Set([...planned].map(theme).filter(Boolean))) {
      if (L.max_theme && themes[th] > L.max_theme) out.push(`主题「${themeName(th)}」计划持仓合计 ${pct(themes[th])}，超过系统上限 ${pct(L.max_theme, 0)}`);
    }
    if (target && Object.keys(target).length) {
      const outside = [...planned].filter((t) => theme(t) && !(target[t] > 0)).sort();
      if (outside.length) out.push(`${outside.join("、")} 不在系统最新建议的卫星持仓中（与系统建议不一致，仅供参考）`);
      for (const t of [...planned].sort()) if (target[t] > 0 && (pf.weights[t] || 0) > target[t] * 1.5 + 0.01) out.push(`${t} 计划持仓 ${pct(pf.weights[t])}，明显高于系统建议 ${pct(target[t])}`);
    }
    return { list: out, lookthrough: lt };
  },
};

/* 全站标注用：尚未完成的计划标的（同步调用；按本机计划 + 账本缓存） */
let PLAN_MEMO = { key: null, val: new Set() };
function plannedSet() {
  let a = null, b = null;
  try { a = localStorage.getItem(PLANS_KEY); b = localStorage.getItem(TRADES_KEY); } catch { /* 忽略 */ }
  const pv = typeof window !== "undefined" && window.PERSONAL ? window.PERSONAL.generated_at : "";
  const key = `${a}\u0000${b}\u0000${pv}`;
  if (PLAN_MEMO.key !== key) {
    let val = new Set();
    try { val = new Set(PlanCalc.status(loadPlans(), loadTrades()).filter((s) => !s.done).map((s) => s.plan.ticker)); } catch { /* 忽略 */ }
    PLAN_MEMO = { key, val };
  }
  return PLAN_MEMO.val;
}
function isPlanned(t) { return plannedSet().has(t); }
/* 列表里的标签：持有 > 计划 > 关注 */
function holdChip(t, held, watch, short = false) {
  if (held?.has(t)) return ' <span class="chip on">持有</span>';
  if (isPlanned(t)) return ' <span class="chip plan" title="在你的买入计划中">计划</span>';
  return watch?.has(t) ? ` <span class="chip">★${short ? "" : " 关注"}</span>` : "";
}

const PLAN_HOWTO = [
  "在这里列出打算买入的股票：按股数或按金额，可选填“目标买入价”。计划持仓 = 当前持仓 + 尚未成交的计划，用来在下单前检查买入后的单股 / 主题占比、经 SPY 的真实暴露、现金是否足够、与系统建议的差异。",
  "录入交易记录后，计划创建日之后的同一股票买入会自动从计划中扣减；全部成交后标“已完成”，可以删除。",
  "“同步到后台”后：每日推送的“与你持仓相关”也分析计划中的股票；收盘价跌到目标买入价时在每日推送里提醒一次；周末汇总与周报列出全部计划进度和风险检查。仅为提醒，不会自动下单。",
];

async function renderBuyPlanTab(book, query) {
  const { prices: lp, asof } = await latestPrices();
  const price = { ...lp, ...Object.fromEntries(book.rows.filter((r) => r.price > 0).map((r) => [r.ticker, r.price])) };
  const sugg = await suggestedTarget();
  const plans = loadPlans();
  const st = PlanCalc.status(plans, loadTrades(), price);
  const planned = new Set(st.filter((s) => !s.done).map((s) => s.plan.ticker));
  const pf = PlanCalc.proForma(book.snapshot, st, price);
  const chk = PlanCalc.checks(pf, planned, sugg.target);
  const ins = chk.list.map((c) => ({ level: c.startsWith("现金不足") ? "high" : "medium", kind: "derived", text: c }));
  for (const s of st.filter((x) => !x.done && x.to_target != null && x.to_target >= 0)) ins.unshift({ level: "medium", kind: "fact", text: `${s.plan.ticker} 最新收盘 ${num(s.price, 2)}，已在目标买入价 ${num(s.plan.target_price, 2)} 或以下。` });
  if (!ins.length && planned.size) ins.push({ level: "info", kind: "derived", text: "按计划全部买入后，没有超出系统单股 / 主题上限与穿透暴露阈值，现金足够。" });
  const tickers = [...new Set([...(META.universe || []).map((u) => u.ticker), ...(META.etfs || []).map((e) => e.ticker), ...(META.allocation_tickers || [])])];
  const sizeText = (p) => (p.shares != null ? `${shareFmt(p.shares)} 股` : `${money(p.amount)} 美元`);
  const rows = st.map((s) => {
    const p = s.plan;
    const tgt = p.target_price ? `${num(p.target_price, 2)}${s.to_target == null ? "" : s.to_target >= 0 ? ' <span class="chip on">已达到</span>' : ` <span class="muted">还需 ${pct(s.to_target, 1)}</span>`}` : "–";
    return `<tr class="${s.done ? "muted" : ""}"><td class="nowrap"><a href="#/stock/${esc(p.ticker)}"><b>${esc(p.ticker)}</b></a> <span class="muted">${esc(META.names_zh?.[p.ticker] || "")}</span>${p.note ? `<br><span class="muted">${esc(p.note)}</span>` : ""}</td>
      <td class="nowrap">${esc(p.created)}</td><td class="num">${sizeText(p)}</td>
      <td class="num">${s.filled_shares > 1e-6 ? `${shareFmt(+s.filled_shares.toFixed(4))} 股` : "–"}</td>
      <td class="num">${s.done ? '<span class="chip on">已完成</span>' : isNum(s.remaining_shares) ? `${shareFmt(+s.remaining_shares.toFixed(2))} 股 ≈ ${money(s.remaining_value)}` : "无价格"}</td>
      <td class="num">${num(s.price, 2)}</td><td class="num ${s.since > 0 ? "up" : s.since < 0 ? "down" : ""}">${s.since == null ? "–" : pct(s.since, 1, true)}</td>
      <td class="num">${tgt}</td>
      <td class="nowrap"><button type="button" class="ghost" data-plan-tp="${esc(p.id)}">目标价</button> <button type="button" class="ghost" data-plan-del="${esc(p.id)}">${s.done ? "移除" : "删除"}</button></td></tr>`;
  }).join("");
  const lt = chk.lookthrough;
  const show = [...new Set([...Object.keys(pf.weights), ...Object.keys(pf.current)])].filter((t) => t !== "CASH").sort((a, b) => (pf.weights[b] || 0) - (pf.weights[a] || 0));
  const L = META.plan_limits || {};
  const over = (t, w) => (META.universe.some((u) => u.ticker === t) && L.max_single && w > L.max_single ? ' class="num down"' : ' class="num"');
  const pfRows = show.map((t) => `<tr><td><b>${esc(t)}</b> <span class="muted">${esc(META.names_zh?.[t] || "")}</span>${planned.has(t) ? ' <span class="chip plan">计划</span>' : ""}</td>
      <td class="num">${pct(pf.current[t] || 0, 1)}</td><td${over(t, pf.weights[t] || 0)}>${pct(pf.weights[t] || 0, 1)}</td>
      <td class="num">${sugg.target[t] > 0 ? pct(sugg.target[t], 1) : "–"}</td><td class="num">${lt[t] != null && t !== L.core ? pct(lt[t], 1) : "–"}</td></tr>`).join("");
  const prefill = normTicker(query?.t || "");
  byId("h-body").innerHTML = `${insightBox(ins, 20)}
    <section class="card"><h3>添加买入计划</h3>
      <div class="row plan-form">
        <input id="pl-t" list="pl-tickers" placeholder="股票代码，如 NVDA" value="${esc(prefill)}" style="width:150px" autocomplete="off">
        <datalist id="pl-tickers">${tickers.map((t) => `<option value="${esc(t)}">${esc(META.names_zh?.[t] || "")}</option>`).join("")}</datalist>
        <select id="pl-mode"><option value="shares">按股数</option><option value="amount">按金额（美元）</option></select>
        <input id="pl-q" type="number" min="0" step="any" placeholder="数量" style="width:110px">
        <input id="pl-tp" type="number" min="0" step="any" placeholder="目标买入价（可选）" style="width:150px">
        <input id="pl-note" maxlength="200" placeholder="备注（可选）" style="width:200px">
        <button type="button" class="primary" id="pl-add">添加</button><span class="muted" id="pl-msg"></span>
      </div>
      <p class="muted">创建时记录当天的最新收盘价（${esc(asof)}），用于跟踪“自计划以来涨跌”。目标买入价：收盘价跌到这个价格或以下时，每日推送提醒一次。</p></section>
    <section class="card"><h3>计划进度 ${badge("fact")}</h3>
      ${st.length ? `<div class="table-wrap"><table><thead><tr><th>股票</th><th>创建</th><th class="num">计划</th><th class="num">已成交</th><th class="num">剩余</th><th class="num">最新价</th><th class="num">自计划以来</th><th class="num">目标买入价</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : empty("还没有买入计划")}
      ${plans.length && !plansEdited() ? '<p class="muted">以上计划来自个人数据包（后台最近一次同步）；在这里修改后会保存到这台设备。</p>' : ""}</section>
    <section class="card"><h3>计划持仓（按计划全部买入后）${badge("derived")}</h3>
      ${planned.size ? `<p class="muted">当前持仓 + 尚未成交的计划，按最新收盘价估值；总资产不变，计划买入的资金从现金中扣除。系统单股上限 ${pct(L.max_single || 0, 0)}、主题上限 ${pct(L.max_theme || 0, 0)}、真实暴露（直接 + 经 SPY）阈值 ${pct(L.lookthrough_single || 0, 0)}；系统建议来自${esc(sugg.source)}。</p>
      <div class="table-wrap"><table><thead><tr><th>标的</th><th class="num">当前</th><th class="num">计划持仓</th><th class="num">系统建议</th><th class="num">真实暴露</th></tr></thead><tbody>${pfRows}
        <tr><td><b>现金</b></td><td class="num">${pct(pf.current.CASH || 0, 1)}</td><td class="num ${pf.gap > 0 ? "down" : ""}">${pf.gap > 0 ? `缺 ${money(pf.gap)}` : pct(pf.weights.CASH || 0, 1)}</td><td class="num">${sugg.target.SPAXX > 0 ? pct(sugg.target.SPAXX, 1) : "–"}</td><td></td></tr></tbody></table></div>
      ${pf.unpriced.length ? `<p class="muted">没有价格数据、未计入：${esc(pf.unpriced.join("、"))}</p>` : ""}` : empty("没有尚未完成的计划")}</section>
    <section class="card"><h3>同步</h3><p class="muted">计划只保存在这台设备；“同步到后台”会把当前持仓、账本和买入计划一起加密提交，之后的每日 / 每周推送按计划持仓分析。修改计划后同步一次。</p>
      <div class="row"><button type="button" class="primary" id="pl-sync">同步到后台</button><span class="muted" id="h-msg"></span></div></section>`;
  const msg = (t) => { byId("pl-msg").textContent = t; };
  byId("pl-add").onclick = () => {
    const t = normTicker(byId("pl-t").value || "");
    const q = parseFloat(byId("pl-q").value), tp = parseFloat(byId("pl-tp").value);
    if (!TICKER_RE.test(t)) return msg("请填写有效的股票代码");
    if (!(q > 0)) return msg("请填写大于 0 的数量");
    const mode = byId("pl-mode").value;
    const p = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ticker: t, created: localISODate(),
      created_price: price[t] > 0 ? +price[t].toFixed(4) : null, target_price: tp > 0 ? tp : null, note: byId("pl-note").value.trim(),
      shares: mode === "shares" ? q : null, amount: mode === "amount" ? q : null };
    savePlans([...loadPlans(), p]);
    location.hash = "#/holdings?tab=buyplan"; route();
  };
  document.querySelectorAll("[data-plan-del]").forEach((b) => (b.onclick = () => {
    const p = loadPlans().find((x) => x.id === b.dataset.planDel);
    if (p && confirm(`删除 ${p.ticker} 的买入计划？`)) { savePlans(loadPlans().filter((x) => x.id !== p.id)); route(); }
  }));
  document.querySelectorAll("[data-plan-tp]").forEach((b) => (b.onclick = () => {
    const ps = loadPlans(), p = ps.find((x) => x.id === b.dataset.planTp);
    if (!p) return;
    const v = prompt(`${p.ticker} 的目标买入价（留空 = 不设）`, p.target_price ?? "");
    if (v === null) return;
    p.target_price = parseFloat(v) > 0 ? parseFloat(v) : null;
    savePlans(ps); route();
  }));
  byId("pl-sync").onclick = () => syncBackend(book, (t) => { byId("h-msg").textContent = t; });
}
function localISODate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
