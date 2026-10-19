/* 瓶颈硬数据（M69；数据 hard_data.json，每周 run_bottlenecks.py 生成）：
   ① 各技术子页“财报硬数据”卡片：相关美股公司最新一季的紧缺迹象（订单快于收入、预付款增多、存货周转加快、毛利率上升）
      与背景指标（资本开支强度、利息覆盖），以及所选指标按申报日的走势（竖线 = 这项技术的瓶颈信号）
   ② 技术看板“财报硬数据回测”卡片：财报迹象 vs 新闻信号 vs 股价起点的时滞；迹象出现后 6 / 12 个月的相对表现
   全部为 SEC 首次披露口径（不使用事后重述），日期为申报日（市场能看到的日子）。 */

let HD_D = null;
const HD_PREF = "invest.tech.hard";
const HD_METRICS = [
  ["score", "紧缺迹象数", (v) => num(v, 0), "四项中满足的个数（有数据的项目）"],
  ["rev_yoy", "收入同比", (v) => pct(v, 0, true), "当季收入相对去年同季"],
  ["gm", "毛利率", (v) => pct(v, 1), "当季毛利 ÷ 收入"],
  ["rpo_excess", "订单增速 − 收入增速", (v) => pct(v, 0, true), "剩余履约义务（RPO）同比 − 收入同比：为正 = 订单增长快于收入"],
  ["cl_ratio", "合同负债 ÷ 收入", (v) => pct(v, 1), "客户预付款 / 递延收入 ÷ 近 4 季收入"],
  ["dio", "存货周转天数", (v) => num(v, 0), "季末存货 ÷ 当季销售成本 × 91：越低 = 货越快被拿走"],
  ["capex_int", "资本开支强度", (v) => pct(v, 1), "近 4 季资本支出 ÷ 收入：公司自己扩产的力度（扩产多 = 一两年后瓶颈可能缓解）"],
  ["int_cov", "利息覆盖倍数", (v) => num(v, 1), "近 4 季营业利润 ÷ 利息支出：低于 2–3 倍说明靠举债扩张、融资风险高"],
];

async function hardData() {
  if (!HD_D) HD_D = await load("hard_data.json").catch(() => ({ available: false }));
  return HD_D;
}
function hardView() {
  try { return { metric: "score", ...JSON.parse(localStorage.getItem(HD_PREF) || "{}") }; } catch { return { metric: "score" }; }
}
function saveHardView(v) { try { localStorage.setItem(HD_PREF, JSON.stringify(v)); } catch { /* 忽略 */ } }
const hdChg = (v, f) => (isNum(v) ? `<br><span class="muted small">同比 ${f(v)}</span>` : "");
const hdPP = (v) => `${v > 0 ? "+" : ""}${num(v * 100, 1)} 个百分点`;
function hdFlags(r, zh) {
  return Object.entries(r.flags).map(([k, v]) => (v === null ? `<span class="hd-flag na" title="没有数据">${esc(zh[k])}</span>`
    : `<span class="hd-flag ${v ? "on" : ""}">${v ? "✓ " : ""}${esc(zh[k])}</span>`)).join("");
}
function hdLink(t, name) {
  const inPool = META?.universe?.some((u) => u.ticker === t);
  const label = `${esc(name)} <span class="muted small">${esc(t)}</span>`;
  return inPool ? `<a href="#/stock/${esc(t)}">${label}</a>` : label;
}

// ---------------- 技术子页：财报硬数据 ----------------
async function fillTechHard(t) {
  const el = byId("tk-hard");
  if (!el || t.history) return;
  const d = await hardData();
  const tks = (d?.techs?.[t.id] || []).filter((x) => d.companies[x]);
  if (!tks.length) return;
  const v = hardView();
  el.hidden = false;
  const rows = tks.map((x) => ({ t: x, c: d.companies[x], r: d.companies[x].rows.at(-1) })).sort((a, b) => (b.r.score ?? -1) - (a.r.score ?? -1));
  const p = d.params;
  el.innerHTML = `<h3>财报硬数据：瓶颈有没有出现在公司财报里 ${badge("fact")}${badge("derived")}</h3>
    <p class="muted small">这项技术相关的美股公司（${tks.length} 家，有季度 SEC 财报的）最近一季的四项紧缺迹象：订单快于收入（RPO 同比 − 收入同比 ≥ ${pct(p.rpo_excess, 0)}）、
      预付款增多（合同负债 ÷ 收入同比上升 ≥ ${pct(p.contract_ratio_growth, 0)}）、存货周转加快（周转天数同比下降 ≥ ${pct(p.dio_drop, 0)}）、毛利率上升（同比 ≥ ${num(p.gm_rise_pp * 100, 0)} 个百分点且收入增长）。
      数值按 SEC 首次披露口径，日期为申报日；灰色 = 公司没有在财报 XBRL 中披露该项（如 Vertiv 的积压订单只在新闻稿中）。外国公司（20-F）没有季度数据。</p>
    <div class="table-wrap"><table><thead><tr><th>公司</th><th>最新季度<br><span class="muted small">申报日</span></th><th class="num">收入同比</th><th class="num">毛利率</th>
      <th class="num">订单增速 −<br>收入增速</th><th class="num">合同负债<br>÷ 收入</th><th class="num">存货<br>周转天数</th><th class="num">资本开支<br>强度</th><th class="num">利息<br>覆盖</th><th>紧缺迹象</th></tr></thead><tbody>
    ${rows.map(({ t: x, c, r }) => `<tr><td>${hdLink(x, c.name)}</td><td class="small">${esc(r.end)}<br><span class="muted">${esc(r.filed)}</span></td>
      <td class="num ${cls(r.rev_yoy)}">${pct(r.rev_yoy, 0, true)}</td>
      <td class="num">${pct(r.gm, 1)}${isNum(r.gm_chg) ? `<br><span class="muted small">${hdPP(r.gm_chg)}</span>` : ""}</td>
      <td class="num ${cls(r.rpo_excess)}">${isNum(r.rpo_excess) ? pct(r.rpo_excess, 0, true) : `<span class="muted">未披露</span>`}</td>
      <td class="num">${pct(r.cl_ratio, 1)}${hdChg(r.cl_ratio_chg, (z) => pct(z, 0, true))}</td>
      <td class="num">${num(r.dio, 0)}${hdChg(r.dio_chg, (z) => pct(z, 0, true))}</td>
      <td class="num">${pct(r.capex_int, 1)}</td><td class="num ${isNum(r.int_cov) && r.int_cov < 2 ? "neg" : ""}">${isNum(r.int_cov) ? `${num(r.int_cov, 1)}×` : "–"}</td>
      <td><b>${r.score ?? "–"}</b><span class="muted small"> / ${r.n_flags}</span><br>${hdFlags(r, d.flag_zh)}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="row"><span class="muted">走势</span><div class="seg" id="hd-metric">${HD_METRICS.map(([k, n]) => `<button type="button" data-v="${k}" class="${k === v.metric ? "on" : ""}">${n}</button>`).join("")}</div></div>
    <p class="muted small" id="hd-tip"></p>
    ${chartDiv("c-hd")}
    <p class="muted small">折线图横轴为申报日（市场能看到这份财报的日子），竖线为这项技术各轮瓶颈的首个公开信号。看板上的“财报硬数据回测”说明这些迹象历史上是早于还是晚于新闻与股价。</p>`;
  drawHard(d, t, tks, v);
  el.querySelectorAll("#hd-metric button").forEach((b) => (b.onclick = () => {
    v.metric = b.dataset.v; saveHardView(v);
    el.querySelectorAll("#hd-metric button").forEach((x) => x.classList.toggle("on", x === b));
    disposeChart(byId("c-hd"));
    drawHard(d, t, tks, v);
  }));
}

// 紧缺迹象数：热力图（行 = 公司，列 = 日历季度，按季末归到所在季度），悬停看满足了哪几项
const hdQuarter = (end) => { const d = new Date(end); return `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`; };
function drawHardHeat(d, tks) {
  byId("hd-tip").textContent = "每格 = 一家公司一个季度满足的紧缺迹象个数（按季末所在的日历季度；悬停看具体是哪几项、申报日）。灰色 = 没有可判断的数据。";
  const qs = [...new Set(tks.flatMap((x) => d.companies[x].rows.map((r) => hdQuarter(r.end))))].sort();
  const cells = [];
  tks.forEach((x, i) => d.companies[x].rows.forEach((r) => {
    if (r.score === null) return;
    cells.push({ value: [qs.indexOf(hdQuarter(r.end)), i, r.score], r, x });
  }));
  const el = byId("c-hd");
  el.style.height = `${Math.max(220, 60 + tks.length * 26)}px`;
  mkChart(el, {
    grid: { left: 150, right: 20, top: 10, bottom: 60 },
    xAxis: { type: "category", data: qs, axisLabel: { rotate: 45, fontSize: 10 } },
    yAxis: { type: "category", data: tks.map((x) => `${d.companies[x].name} ${x}`), inverse: true, axisLabel: { fontSize: 11 } },
    visualMap: { min: 0, max: 4, calculable: false, orient: "horizontal", left: "center", bottom: 0, show: false,
      inRange: { color: [isDark() ? "#2c2c2a" : "#f0efec", "#7c5cff"] } },
    tooltip: { formatter: (p) => {
      const r = p.data.r, on = Object.entries(r.flags).filter(([, v]) => v).map(([k]) => d.flag_zh[k]);
      return `<b>${esc(d.companies[p.data.x].name)}</b> 季末 ${esc(r.end)}（申报 ${esc(r.filed)}）<br>紧缺迹象 ${r.score} / ${r.n_flags}${on.length ? `：${on.map(esc).join("、")}` : ""}`;
    } },
    series: [{ type: "heatmap", data: cells, label: { show: true, fontSize: 10, formatter: (p) => (p.data.value[2] ? p.data.value[2] : "") } }],
  });
}

function drawHard(d, t, tks, v) {
  const [key, label, fmt, tip] = HD_METRICS.find((m) => m[0] === v.metric) || HD_METRICS[0];
  byId("c-hd").style.height = "";
  if (key === "score") return drawHardHeat(d, tks);
  byId("hd-tip").textContent = tip;
  const pal = palette();
  const series = tks.map((x, i) => ({
    name: `${d.companies[x].name}（${x}）`, type: "line", showSymbol: true, symbolSize: 4, connectNulls: false, color: pal[i % pal.length],
    data: d.companies[x].rows.map((r) => [r.filed, isNum(r[key]) ? r[key] : null]),
  }));
  if (series.length) {
    series[0].markLine = { symbol: "none", silent: true, label: { formatter: (p) => p.data.name, fontSize: 10, position: "insideEndTop" },
      lineStyle: { type: "dashed", color: "#7c5cff", width: 1 }, data: (t.rounds || []).map((r) => ({ xAxis: r.first, name: r.name.length > 14 ? `${r.name.slice(0, 14)}…` : r.name })) };
  }
  mkChart(byId("c-hd"), {
    grid: { left: 56, right: 20, top: 50, bottom: 30 }, legend: { type: "scroll", top: 0 },
    xAxis: { type: "time" }, yAxis: { type: "value", scale: key !== "score", name: label },
    tooltip: { trigger: "axis", valueFormatter: (x) => (isNum(x) ? fmt(x) : "–") },
    series,
  });
}

// 大样本重测（M72）：全市场美股，事先确定的四条标准
const HB_CRIT = { n_ge_100: "事件 ≥ 100 次", significant: "显著且方向一致", same_sign_periods: "两个时间段方向相同", same_sign_sectors: "科技 / 非科技方向相同" };
async function hardLargeHtml() {
  const b = await load("hard_backtest.json").catch(() => null);
  if (!b?.patterns) return "";
  const h = String(b.horizon), base = b.baseline[h];
  const st = (x) => `${pct(x.mean, 0, true)} / ${pct(x.median, 0, true)}<br><span class="muted small">${x.n} 次 · 为正 ${pct(x.pos_share, 0)}</span>`;
  return `<h4>大样本重测（全市场 ${b.companies_with_prices} 家美股，SEC 首次披露口径）</h4>
    <p class="small">事先写下的标准（看结果前确定）：① 事件 ≥ 100 次；② 显著（符号检验 p &lt; 0.05 且按公司聚合 |t| ≥ 2，方向一致）；③ 2012–2018 与 2019 年起方向相同；④ 科技与非科技方向相同。<b>全部满足才做成个股页提醒。</b></p>
    <div class="table-wrap"><table><thead><tr><th>迹象出现，且申报前 6 个月股价相对 SPY 没涨</th><th class="num">之后 12 个月相对 SPY<br><span class="muted small">均值 / 中位数</span></th><th class="num">减去同公司平均<br><span class="muted small">按公司聚合 t</span></th><th>标准</th><th>结论</th></tr></thead><tbody>
    <tr class="muted"><td>参照：全部公司全部季度</td><td class="num">${st(base)}</td><td class="num">–</td><td></td><td></td></tr>
    ${Object.entries(b.patterns).map(([, p]) => { const nu = p.not_up; return `<tr><td>${esc(p.name)}</td><td class="num">${st(nu[`raw${h}`])}</td>
      <td class="num">${pct(nu[h].firm_mean, 1, true)}<br><span class="muted small">t = ${num(nu[h].firm_t, 2)}</span></td>
      <td class="small">${Object.entries(p.criteria).map(([k, v]) => `<span class="hd-flag ${v ? "on" : ""}">${v ? "✓" : "✗"} ${HB_CRIT[k]}</span>`).join("")}${p.untestable?.length ? `<br><span class="muted">无法检验：${p.untestable.map((k) => ({ early: "2012–2018", late: "2019 起", tech: "科技", non_tech: "非科技" })[k]).join("、")}（RPO 科目 2018 年才有）</span>` : ""}</td>
      <td>${p.passed ? "<b class=\"pos\">成立</b>" : "<span class=\"muted\">不成立</span>"}</td></tr>`; }).join("")}
    </tbody></table></div>
    <p class="muted small">读法：股票收益右偏（少数大涨拉高均值），所以“中位数为负、为正比例低于一半”是常态，要和第一行参照比。小样本（上方案例库）看到的“订单快于收入且没涨 +38%”“毛利率上升且没涨 −22%”在大样本中都没有复现。
      “预付款增多且没涨”在均值、中位数、为正比例上都好于参照、按公司 t 较高，但未通过事先的符号检验、也不是这次事先要检验的组合，只作探索性线索；要当规律用，需要用之后的新数据再检验。
      局限：股票池为现仍上市的公司（偏乐观）；同一公司事件重叠；符号检验以“减去公司平均”为基准，在收益右偏时偏向负方向（事先设计的不足，如实保留）。</p>`;
}

// ---------------- 技术看板：回测 ----------------
async function hardBacktestHtml() {
  const d = await hardData();
  const bt = d?.backtest;
  if (!bt) return "";
  const ls = bt.lead.summary, p = d.params;
  const h = String(p.horizons_days.at(-1)), h6 = String(p.horizons_days[0]);
  const ev = (x) => (x && x.n ? `${pct(x.mean_excess, 0, true)} / ${pct(x.median_excess, 0, true)}<br><span class="muted small">${x.n} 次 · 为正 ${pct(x.pos_share, 0)}${isNum(x.p_sign) ? ` · p ${x.p_sign < 0.01 ? "< 0.01" : num(x.p_sign, 2)}` : ""}</span>` : "–");
  const rowsFor = [["score", `紧缺迹象 ≥ ${p.score_threshold} 项`, bt.score], ...Object.entries(bt.flags).map(([k, x]) => [k, d.flag_zh[k], x])];
  const found = bt.lead.samples.filter((s) => s.status === "found").sort((a, b) => b.lead_news - a.lead_news);
  return `<section class="card"><h3>财报硬数据回测：财报里的紧缺迹象，早于新闻和股价吗？ ${badge("derived")}${badge("simulated")}</h3>
    <div class="kpis">
      <div class="kpi"><span class="muted">比首个公开信号更早</span><b>${ls.earlier_than_news} / ${ls.found}</b><span class="muted small">中位数早 ${num(ls.median_lead_news, 0)} 天</span></div>
      <div class="kpi"><span class="muted">比股价上涨起点更早</span><b>${ls.earlier_than_price} / ${ls.n_price}</b><span class="muted small">中位数早 ${num(ls.median_lead_price, 0)} 天</span></div>
      <div class="kpi"><span class="muted">窗口内财报没有紧缺迹象</span><b>${ls.none} / ${ls.n}</b><span class="muted small">另有 ${ls.no_data} 个无数据、${ls.already} 个已在紧缺中</span></div>
    </div>
    <p class="small">读法：财报迹象大多早于新闻（新闻本身就落后于股价），但和股价起点相比只是略早、分散很大；还有 ${pct(ls.none / Math.max(1, ls.n), 0)} 的样本在财报里看不出紧缺——瓶颈常常落在财报不单列的业务，或被公司其他业务稀释。</p>
    <h4>瓶颈案例库（小样本：案例库中的美股公司）</h4>
    <div class="table-wrap"><table><thead><tr><th>迹象出现（由不满足变为满足）</th><th class="num">之后 ${Math.round(+h6 / 21)} 个月超额<br><span class="muted small">均值 / 中位数</span></th><th class="num">之后 ${Math.round(+h / 21)} 个月超额<br><span class="muted small">均值 / 中位数</span></th>
      <th class="num">${Math.round(+h / 21)} 个月 · 出现时股价<b>还没涨</b></th><th class="num">${Math.round(+h / 21)} 个月 · 出现时股价<b>已涨</b></th></tr></thead><tbody>
    ${rowsFor.map(([k, n, x]) => `<tr><td>${esc(n)}</td><td class="num">${ev(x.horizons[h6])}</td><td class="num">${ev(x.horizons[h])}</td><td class="num">${ev(x.by_past?.[h]?.not_up)}</td><td class="num">${ev(x.by_past?.[h]?.up)}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="muted small">超额 = 申报后第一个交易日起相对 SPY 的涨跌 − 同一公司所有季度（同样从申报日起算）的平均值；“还没涨 / 已涨”= 申报前 6 个月相对 SPY 是否为正；p 为符号检验（双侧）。
      局限：案例库公司是事后挑选的（知道它们后来成了瓶颈）；同一公司的事件在时间上重叠；样本少的格子不要当成规律。阈值为事先固定的规则，没有按结果调参。</p>
    <details class="small"><summary>逐个样本（${found.length} 个找到迹象）</summary>
      <div class="table-wrap"><table><thead><tr><th>瓶颈</th><th>公司</th><th>财报申报日</th><th>首个公开信号</th><th>股价起点</th><th class="num">比新闻早（天）</th><th class="num">比股价早（天）</th><th>迹象</th></tr></thead><tbody>
      ${found.map((s) => `<tr><td>${esc(s.name)}</td><td>${hdLink(s.ticker, d.companies[s.ticker]?.name || s.ticker)}</td><td>${esc(s.filed)}</td><td>${esc(s.signal)}</td><td>${esc(s.price_start || "–")}</td>
        <td class="num ${cls(s.lead_news)}">${s.lead_news}</td><td class="num ${cls(s.lead_price)}">${s.lead_price ?? "–"}</td><td>${s.flags.map((f) => esc(d.flag_zh[f])).join("、")}</td></tr>`).join("")}
      </tbody></table></div></details>${await hardLargeHtml()}${await hardSearchHtml()}</section>`;
}

// ---------------- 个股页：财报规律提醒（M73；数据 hard_alerts.json，每周生成）----------------
const HD_FLAG_ZH = { rpo: "订单快于收入", contract: "预付款增多", dio: "存货周转加快", gm: "毛利率上升", score: "紧缺迹象 ≥ 2 项" };
function hardAlertCard(t, d) {
  const list = d?.alerts?.[t];
  if (!list?.length) return "";
  return list.map((a) => {
    const p = d.patterns[a.pattern];
    if (!p?.active) return "";
    const ds = p.disc || {}, vs = p.val || {}, fw = p.forward || {};
    const fwText = fw.status === "insufficient" ? `前瞻检验（${esc(fw.start)} 之后的新事件）样本还不够：已到期 ${fw.n || 0} 个、待到期 ${fw.pending || 0} 个`
      : `前瞻检验 ${fw.n} 个：中位数 ${pct(fw.median, 0, true)}（${fw.status === "consistent" ? "未与原结论矛盾" : "与原结论矛盾"}）`;
    return `<section class="card hd-alert"><h3>📌 财报规律提醒 <span class="rm-tag warn">${esc(p.evidence)}</span> ${badge("derived")}${badge("simulated")}</h3>
      <p><b>${esc(a.filed)}</b> 申报的季报（季末 ${esc(a.end)}）出现「${esc(HD_FLAG_ZH[p.flag] || p.flag)}」：合同负债 ÷ 近 4 季收入 ${pct(a.cl_ratio, 1)}，同比 ${pct(a.cl_ratio_chg, 0, true)}；收入同比 ${pct(a.rev_yoy, 0, true)}。
        提醒期至 ${esc(a.until)}${isNum(a.since_rel) ? `；触发后至今相对 SPY <b class="${cls(a.since_rel)}">${pct(a.since_rel, 0, true)}</b>` : ""}。</p>
      <p class="small">历史上（科技股 ${p.universe_n} 家，近 5 年）出现这一迹象后的 ${Math.round(p.horizon / 21)} 个月，股价相对同期同组股票中位数：
        2021-10 至 2023 年 中位数 ${pct(ds.median, 0, true)} / 均值 ${pct(ds.mean, 0, true)}（${ds.n} 次，为正 ${pct(ds.pos_share, 0)}）；
        2024 年起 中位数 ${pct(vs.median, 0, true)} / 均值 ${pct(vs.mean, 0, true)}（${vs.n} 次，为正 ${pct(vs.pos_share, 0)}）。${esc(p.note)}。${fwText}。</p>
      <p class="muted small">这是统计倾向，不是买入信号：同样条件下仍有约四成到一半的情况跑输同组股票；“科技股”按 Nasdaq 板块分类（与检验口径一致）。详见技术看板“财报硬数据回测”。</p></section>`;
  }).join("");
}

// ---------------- 技术看板：细分范围找规律（M73；数据 pattern_search.json）----------------
const PS_UNI = { tech: "科技股", ai: "AI 相关" };
async function hardSearchHtml() {
  const d = await load("pattern_search.json").catch(() => null);
  if (!d?.tests) return "";
  const uname = (k) => PS_UNI[k] || `走势聚类 ${k.split("_")[1]}`;
  const top = d.tests.filter((x) => x.disc?.p !== undefined && x.disc.n >= 30).sort((a, b) => a.disc.p - b.disc.p).slice(0, 10);
  const cell = (x) => (x?.n ? `${pct(x.median, 0, true)} / ${pct(x.mean, 0, true)}<br><span class="muted small">${x.n} 次 · t ${num(x.t, 2)}${isNum(x.q) ? ` · q ${num(x.q, 2)}` : ""}</span>` : "–");
  const clus = Object.entries(d.universes).filter(([k]) => k.startsWith("cluster"));
  return `<h4>细分范围找规律（科技股 / AI 相关 / 走势聚类，近 5 年）</h4>
    <p class="small">事先写下的范围：${Object.keys(d.universes).length} 个股票组 × 5 种迹象 × 3 种股价条件 × 2 个期限 = ${d.n_tests} 个检验（样本量合格 ${d.n_eligible} 个）。
      结果 = 相对同一股票组、同一季度申报的全部公司的中位数（扣除时期效应）。先在 2021-10 至 2023 年找（多重比较校正 FDR ≤ 10%），再用 2024 年起的数据验证。
      <b>按这个严格标准：0 条通过。</b>“科技股 · 预付款增多 · 12 个月”两段各自显著、方向一致，经用户确认按“中等证据”做成个股页提醒（每周前瞻检验，转弱即撤下）。</p>
    <div class="table-wrap"><table><thead><tr><th>股票组</th><th>迹象出现</th><th>股价条件</th><th>期限</th><th class="num">2021-10 至 2023<br><span class="muted small">中位数 / 均值</span></th><th class="num">2024 年起<br><span class="muted small">中位数 / 均值</span></th></tr></thead><tbody>
    ${top.map((x) => `<tr><td>${esc(uname(x.universe))}</td><td>${esc(x.flag_name)}</td><td class="small">${esc({ any: "不限", not_up: "之前没涨", up: "之前已涨" }[x.past])}</td><td>${Math.round(x.horizon / 21)} 个月</td><td class="num">${cell(x.disc)}</td><td class="num">${cell(x.val)}</td></tr>`).join("")}
    </tbody></table></div>
    <details class="small"><summary>走势聚类（2018-10 至 2021-10 的周收益相关性，Ward 层次聚类）</summary><ul>
      ${clus.map(([k, v]) => `<li><b>${esc(uname(k))}</b>（${v.n} 家，当时 3 年相对 SPY 中位数 ${pct(v.median_rel_3y, 0, true)}）：${(v.members || []).slice(0, 20).map(esc).join("、")}${v.n > 20 ? " …" : ""}</li>`).join("")}</ul></details>
    <p class="muted small">按发现期 p 值排列的前 10 个；t 为按公司聚合的 t 值，q 为多重比较校正后的值。聚类只用样本期之前的数据，避免前视。</p>`;
}
