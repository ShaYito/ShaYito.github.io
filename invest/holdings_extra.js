/* 我的持仓 → 收益归因、持有期与税务（计算见 recon.js：attribution / fifoLots；只在本机计算） */

const ATTR_PERIODS = [["1M", "近 1 个月"], ["MTD", "本月"], ["YTD", "今年"], ["ALL", "全部（自起始持仓）"]];
function periodStart(P, period, startDate) {
  const last = P.dates[P.n - 1];
  const back = (n) => { const x = new Date(`${last}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
  // 区间基点 = 区间开始前最后一个交易日的收盘
  const prevDay = (d) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
  const from = period === "ALL" ? startDate : period === "YTD" ? prevDay(`${last.slice(0, 4)}-01-01`) : period === "MTD" ? prevDay(`${last.slice(0, 7)}-01`) : back(30);
  return from < startDate ? startDate : from;
}

function renderAttribTab(P, raw, start, trades) {
  const host = byId("h-body");
  const draw = (period) => {
    let a;
    try { a = Recon.attribution(P, raw, start, trades, periodStart(P, period, start.date), { cashInterest: HOLD_CFG.cashInterest }); }
    catch (e) { host.innerHTML = `<p class="warn">归因计算失败：${esc(e.message)}</p>`; return; }
    const base = a.start_value + Math.max(0, a.net_flows); // 收益率的分母：期初价值 + 期间净存入（近似）
    const rel = (v) => (base > 0 ? pct(v / base, 2, true) : "");
    const name = (t) => META.names_zh?.[t] || "";
    const rows = [...a.rows].sort((x, y) => y.pnl - x.pnl);
    const top = rows[0], bottom = rows[rows.length - 1];
    const bestEx = [...rows].sort((x, y) => y.excess - x.excess)[0], worstEx = [...rows].sort((x, y) => x.excess - y.excess)[0];
    const ins = [];
    ins.push({ level: a.excess >= 0 ? "good" : "medium", kind: "fact", text: `${a.from} 收盘至 ${a.to}：账户盈亏 ${signed(a.total_pnl)}；同样的资金一直放在 SPY 约为 ${signed(a.spy_pnl)}，${a.excess >= 0 ? "多赚" : "少赚"} ${money(Math.abs(a.excess))}。` });
    if (top && top.pnl > 0) ins.push({ level: "info", kind: "fact", text: `贡献最大：${top.ticker} ${name(top.ticker)} ${signed(top.pnl)}；${bottom && bottom.pnl < 0 ? `拖累最大：${bottom.ticker} ${signed(bottom.pnl)}。` : ""}` });
    if (bestEx && worstEx && bestEx !== worstEx) ins.push({ level: "info", kind: "fact", text: `相对 SPY：${bestEx.ticker} 多赚 ${money(Math.max(0, bestEx.excess))}，${worstEx.ticker} ${worstEx.excess < 0 ? `少赚 ${money(-worstEx.excess)}` : "也跑赢"}；现金相对 SPY ${signed(a.cash.excess)}。` });
    host.innerHTML = `${insightBox(ins)}
      <div class="seg" id="at-p" style="margin-bottom:10px">${ATTR_PERIODS.map(([k, n]) => `<button type="button" data-p="${k}" class="${k === period ? "on" : ""}">${n}</button>`).join("")}</div>
      <section class="card"><h3>各持仓的盈亏与相对 SPY ${badge("fact")}${badge("derived")}<span class="muted" style="font-weight:400"> ${esc(a.from)} 收盘 → ${esc(a.to)} 收盘 · ${a.days} 个交易日</span></h3>
        <div class="kpis">
          <div class="kpi"><span class="muted">账户盈亏</span><b class="${cls(a.total_pnl)}">${signed(a.total_pnl)}</b><span class="muted">约 ${rel(a.total_pnl)}</span></div>
          <div class="kpi"><span class="muted">同样资金放 SPY</span><b class="${cls(a.spy_pnl)}">${signed(a.spy_pnl)}</b><span class="muted">约 ${rel(a.spy_pnl)}</span></div>
          <div class="kpi"><span class="muted">相对 SPY</span><b class="${cls(a.excess)}">${signed(a.excess)}</b><span class="muted">约 ${rel(a.excess)}</span></div>
          <div class="kpi"><span class="muted">期间净存入</span><b>${signed(a.net_flows)}</b></div></div>
        ${chartDiv("c-attr", "tall")}
        <div class="table-wrap"><table><thead><tr><th>标的</th><th class="num">平均市值</th><th class="num">盈亏（含分红）</th><th class="num">相对 SPY</th><th class="num">占账户盈亏</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td><a href="#/stock/${esc(r.ticker)}"><b>${esc(r.ticker)}</b></a> <span class="muted">${esc(name(r.ticker))}${r.has_data ? "" : "（无行情，按成交价估值）"}</span></td>
            <td class="num">${money(r.avg_value)}</td><td class="num ${cls(r.pnl)}">${signed(r.pnl)}</td><td class="num ${cls(r.excess)}">${signed(r.excess)}</td>
            <td class="num">${a.total_pnl ? pct(r.pnl / a.total_pnl, 0) : "–"}</td></tr>`).join("")}
          <tr><td><b>现金</b> <span class="muted">利息</span></td><td></td><td class="num ${cls(a.cash.interest)}">${signed(a.cash.interest)}</td><td class="num ${cls(a.cash.excess)}">${signed(a.cash.excess)}</td><td></td></tr>
          <tr class="total"><td><b>合计</b></td><td></td><td class="num ${cls(a.total_pnl)}"><b>${signed(a.total_pnl)}</b></td><td class="num ${cls(a.excess)}"><b>${signed(a.excess)}</b></td><td></td></tr></tbody></table></div>
        <p class="muted">收益率按“期初价值 + 期间净存入”近似；精确的时间加权收益见“持仓”标签的收益率曲线。“相对 SPY”中当天买入的部分从买入价起算，忽略当天的机会成本。</p></section>`;
    const list = [...rows, { ticker: "现金", pnl: a.cash.interest, excess: a.cash.excess }];
    mkChart(byId("c-attr"), { tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => signed(v) }, legend: { top: 0 },
      grid: { left: 70, right: 30, top: 30, bottom: 30 }, xAxis: { type: "value", axisLabel: { formatter: (v) => money(v) } },
      yAxis: { type: "category", inverse: true, data: list.map((r) => r.ticker) },
      series: [{ name: "盈亏", type: "bar", barMaxWidth: 12, color: palette()[0], data: list.map((r) => +r.pnl.toFixed(2)) },
        { name: "相对 SPY", type: "bar", barMaxWidth: 12, color: palette()[1], data: list.map((r) => +r.excess.toFixed(2)) }] });
    document.querySelectorAll("#at-p button").forEach((b) => (b.onclick = () => draw(b.dataset.p)));
  };
  draw("YTD");
}

function renderLotsTab(P, raw, start, trades, book) {
  const host = byId("h-body");
  let res;
  try { res = Recon.fifoLots(P, raw, start, trades); } catch (e) { host.innerHTML = `<p class="warn">分批计算失败：${esc(e.message)}</p>`; return; }
  const today = P.dates[P.n - 1];
  const dayMs = 864e5;
  const days = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / dayMs);
  const ltDate = (d) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCFullYear(x.getUTCFullYear() + 1); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
  const price = Object.fromEntries(book.rows.map((r) => [r.ticker, r.price]));
  const lots = res.lots.map((l) => {
    const p = price[l.ticker];
    const lt = ltDate(l.date);
    return { ...l, held: days(l.date, today), lt_date: lt, to_lt: Math.max(0, days(today, lt)), long: today >= lt,
      gain: isNum(p) && isNum(l.cost) ? (p - l.cost) * l.shares : NaN, gain_pct: isNum(p) && l.cost > 0 ? p / l.cost - 1 : NaN };
  }).sort((a, b) => a.to_lt - b.to_lt || a.ticker.localeCompare(b.ticker));
  const year = today.slice(0, 4);
  const realized = res.realized.filter((r) => r.sell_date.startsWith(year)).map((r) => ({ ...r, long: r.sell_date >= ltDate(r.buy_date) }));
  const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
  const rs = sum(realized.filter((r) => !r.long), (r) => r.gain), rl = sum(realized.filter((r) => r.long), (r) => r.gain);
  const soon = lots.filter((l) => !l.long && l.to_lt <= 60 && l.gain > 0);
  const ins = [];
  for (const l of soon.slice(0, 3)) ins.push({ level: "medium", kind: "fact", text: `${l.ticker} ${l.date} 买入的 ${shareFmt(l.shares)} 股还有 ${l.to_lt} 天满 1 年（${l.lt_date} 起卖出按长期资本利得），当前浮盈 ${signed(l.gain)}。` });
  const losers = lots.filter((l) => l.gain < 0).sort((a, b) => a.gain - b.gain);
  if (losers.length) ins.push({ level: "info", kind: "fact", text: `浮亏批次合计 ${signed(sum(losers, (l) => l.gain))}（${[...new Set(losers.map((l) => l.ticker))].slice(0, 4).join("、")}）：卖出实现亏损可抵扣资本利得（注意 30 天洗售规则）。` });
  const row = (l) => `<tr><td><a href="#/stock/${esc(l.ticker)}"><b>${esc(l.ticker)}</b></a></td><td class="nowrap">${esc(l.date)}${l.from_start ? ' <span class="chip" title="起始持仓的实际买入日未知，按起始日计">起始</span>' : ""}</td>
    <td class="num">${shareFmt(l.shares)}</td><td class="num">${money2(l.cost)}</td><td class="num ${cls(l.gain)}">${signed(l.gain)}</td><td class="num ${cls(l.gain_pct)}">${pct(l.gain_pct, 1, true)}</td>
    <td class="num">${l.held} 天</td><td>${l.long ? '<span class="pos">长期</span>' : `短期 · 还有 <b>${l.to_lt}</b> 天（${esc(l.lt_date)}）`}</td></tr>`;
  host.innerHTML = `${insightBox(ins)}
    <section class="card"><h3>持仓批次（FIFO）${badge("fact")}${badge("derived")}<span class="muted" style="font-weight:400"> 价格截至 ${esc(today)}</span></h3>
      ${lots.length ? `<div class="table-wrap"><table><thead><tr><th>代码</th><th>买入日</th><th class="num">股数</th><th class="num">成本 / 股</th><th class="num">浮动盈亏</th><th class="num">浮动 %</th><th class="num">已持有</th><th>持有期</th></tr></thead>
        <tbody>${lots.map(row).join("")}</tbody></table></div>` : empty("没有持仓批次")}
      <p class="muted">按距满 1 年的天数排序。成本含买入费用；起始持仓未填成本价的按起始日收盘价估计。</p></section>
    <section class="card"><h3>${esc(year)} 年已实现盈亏（FIFO）${badge("fact")}${badge("derived")}</h3>
      <div class="kpis"><div class="kpi"><span class="muted">短期（持有 ≤ 1 年）</span><b class="${cls(rs)}">${signed(rs)}</b></div>
        <div class="kpi"><span class="muted">长期（持有 > 1 年）</span><b class="${cls(rl)}">${signed(rl)}</b></div></div>
      ${realized.length ? `<div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>代码</th><th>买入日</th><th>卖出日</th><th class="num">股数</th><th class="num">盈亏</th><th>类型</th></tr></thead><tbody>
        ${realized.map((r) => `<tr><td><b>${esc(r.ticker)}</b></td><td>${esc(r.buy_date)}${r.from_start ? ' <span class="chip">起始</span>' : ""}</td><td>${esc(r.sell_date)}</td><td class="num">${shareFmt(r.shares)}</td>
          <td class="num ${cls(r.gain)}">${signed(r.gain)}</td><td>${r.long ? "长期" : "短期"}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">今年还没有卖出记录。</p>`}
      <p class="muted">FIFO 匹配，可能与券商的成本计算方式不同；未计入洗售调整。分红在“持仓”标签中单独统计（合格分红与普通分红税率不同，以券商 1099 为准）。</p></section>`;
}
