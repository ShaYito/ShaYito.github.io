/* AI 瓶颈 → 股价时滞（M45，M46 改为“波段 × 里程碑”）：产业链栏目下两个子标签 + 个股页“相关瓶颈”卡片。
   数据：bottlenecks.json（每周 run_bottlenecks.py 生成）
   ① 瓶颈时间线：总览（各瓶颈的里程碑、各公司被匹配到的上涨波段）+ 单个瓶颈详情（相对走势与波段、里程碑 × 公司结果矩阵、新闻量 / 申报提及）
   ② 说法检验：不同类型信号的反应、七条说法与五问框架的分组统计、结论与稳健性 */

const BN_POS = { leader: "龙头 / 终端", mid: "中游", upstream: "上游材料" };
const BN_PUR = { high: "高", medium: "中", low: "低" };
const BN_PRICE = { spot: "现货 / 短约", contract: "长约", backlog: "订单积压" };
const BN_SUPPLY = { single: "单一", few: "少数", many: "多家" };
const BN_MKT = { US: "美股", TW: "台股", JP: "日股", KR: "韩股", CN: "A 股", DE: "德股" };
const BN_KIND = { leader: ["龙头表态 / 指引", "diamond"], report: ["行业报道", "circle"], price: ["提价", "triangle"], capacity: ["抢产能 / 售罄 / 协议", "rect"], order: ["订单", "pin"], product: ["产品发布", "roundRect"] };
const BN_MATCH = { matched: "引发一波上涨", in_earlier_leg: "已在上涨中", no_leg: "没有引发新一波", listed_after: "当时未上市" };
const BN_VERDICT = { "支持": "good", "方向一致，但差异不显著": "medium", "数据不支持": "high", "样本不足": "info", "描述性统计": "info" };
const bnName = (d, t) => d.names?.[t] || META.names_zh?.[t] || t;
const days = (v) => (isNum(v) ? `${v > 0 ? "+" : ""}${Math.round(v)} 天` : "–");
const UNIVERSE_ALIAS = { TSM: "2330.TW", ASX: "3711.TW" }; // 选股池代码 → 案例库中的本地上市代码

const BN_HOWTO = [
  "每家公司用“相对本地大盘”的价格（美股 ÷ SPY、台股 ÷ 加权指数、日股 ÷ 日经、韩股 ÷ KOSPI、A 股 ÷ 沪深 300），剔除大盘涨跌。",
  "<b>波段</b>：把这条相对走势切成若干“波”——从高点回撤 25% 以上即一波结束，一波至少相对大盘涨 50% 才算。每波的<b>起点</b> = 开始上涨前最后一次处在低位的日子，<b>上涨确认</b> = 从起点相对涨 30% 的日子。",
  "<b>逐个里程碑匹配</b>：信号时正处在一波中——这波在信号前 6 个月内开始，就算这个信号的；开始得更早，标“已在上涨中”。否则找起点在信号前 6 个月到之后 12 个月内、离信号最近的一波；都没有，标“没有引发新一波”。<b>时滞</b> = 这一波的上涨确认日 − 信号日（负数 = 股价先动）。同一波被几个里程碑匹配时，只把最早的那个计入统计。",
  "<b>提前定价比例</b>：匹配到的那一波在信号日之前已经完成的涨幅占比；<b>半程</b>：信号后多少天完成剩余涨幅的一半。<b>信号后 12 个月相对涨幅</b>不依赖波段识别，用来比较“涨了多少”。",
  "这些都是事后识别的（知道后来涨了才找得到起点），用于总结历史规律，不能当作实时买卖信号。案例是因为“后来成了著名瓶颈”才被选进来的（幸存者偏差），结论只说明这些案例里的规律。",
];

async function bnData() {
  const d = await load("bottlenecks.json");
  return d?.cases ? d : null;
}
// 全部 公司 × 里程碑（附公司与瓶颈）
function bnRows(d) {
  return d.cases.flatMap((c) => c.companies.flatMap((p) => (p.matches || []).map((r) => ({ ...r, p, c, m: c.milestones[r.milestone] }))));
}

// ---------------- ① 瓶颈时间线 ----------------
PAGES.bottleneck = async (r) => {
  const d = await bnData();
  if (!d) { app().innerHTML = `<h2>AI 瓶颈时间线</h2>${card("瓶颈时间线", empty("数据尚未生成（每周运行 run_bottlenecks.py）"))}`; return; }
  const cases = [...d.cases].sort((a, b) => a.first_signal.localeCompare(b.first_signal));
  const sel = cases.find((c) => c.id === r.query.id) || null;
  const rows = bnRows(d).filter((x) => x.status !== "listed_after");
  const cnt = (s) => rows.filter((x) => x.status === s).length;
  const prim = rows.filter((x) => x.primary && isNum(x.lag_confirm));
  const lags = prim.map((x) => x.lag_confirm).sort((a, b) => a - b);
  const med = lags.length ? lags[Math.floor(lags.length / 2)] : null;
  const ins = [
    { level: "info", kind: "derived", text: `${cases.length} 个瓶颈、${rows.length} 个“公司 × 里程碑”样本：${cnt("matched")} 个之后（或之前不久）有一波上涨，${cnt("in_earlier_leg")} 个出现时公司已在半年多以前开始的一波上涨中，${cnt("no_leg")} 个没有引发新一波。` },
    { level: "info", kind: "derived", text: `计入统计的 ${prim.length} 个样本（每波只取最早的信号），上涨确认相对信号的时滞中位数 ${days(med)}；${prim.filter((x) => x.lag_start < 0).length} 个的起点早于信号。` },
  ];
  app().innerHTML = `<h2>AI 瓶颈 → 股价时滞 <span class="muted">数据截至 ${esc(d.asof)}</span></h2>
    ${howto(BN_HOWTO)}${insightBox(ins)}
    ${card("总览：各瓶颈的里程碑与相关公司被匹配到的上涨（点击一行看详情）", chartDiv("c-bn-over", "tall"), "", ["fact", "derived"])}
    <section class="card"><h3>瓶颈列表 ${badge("fact")}${badge("derived")}</h3><div class="table-wrap"><table><thead><tr><th>瓶颈</th><th>环节</th><th>状态</th><th>首个公开信号</th><th class="num">里程碑</th><th>新闻起点</th><th>申报起点</th><th class="num">计入样本</th><th class="num">时滞中位数</th></tr></thead>
      <tbody>${cases.map((c) => `<tr class="${sel?.id === c.id ? "hl" : ""}"><td><a href="#/bottleneck?id=${c.id}">${esc(c.name)}</a></td><td>${esc(c.layer)}</td><td>${c.status === "ongoing" ? "仍紧缺" : "已缓解"}</td>
        <td>${esc(c.first_signal)}</td><td class="num">${c.milestones.length}</td><td>${esc(c.news_onset || "–")}</td><td>${esc(c.filing_onset || "–")}</td><td class="num">${c.n_eval}</td><td class="num">${days(c.median_lag)}</td></tr>`).join("")}</tbody></table></div></section>
    <div id="bn-detail"></div>`;
  drawBnOverview(d, cases);
  if (sel) { renderBnDetail(d, sel); byId("bn-detail").scrollIntoView({ block: "start" }); }
  else byId("bn-detail").innerHTML = card("单个瓶颈详情", `<p class="muted">点击上表或总览图中的一行查看：里程碑与来源、相关公司相对走势与各波上涨、每个里程碑对每家公司的结果、新闻量与申报提及。</p>`);
};

function drawBnOverview(d, cases) {
  const mk = [], onset = [], comp = [];
  cases.forEach((c, i) => {
    for (const m of c.milestones) mk.push({ value: [m.date, i], m, c, symbol: BN_KIND[m.kind][1] });
    if (c.news_onset) onset.push({ value: [c.news_onset, i], c });
    for (const p of c.companies) for (const r of p.matches || []) if (r.primary && r.leg_t1) comp.push({ value: [r.leg_t1, i], p, r, c });
  });
  const mcol = { US: palette()[0], TW: palette()[2], JP: palette()[3], KR: palette()[4], CN: palette()[5], DE: palette()[6] };
  const ch = mkChart(byId("c-bn-over"), {
    tooltip: { trigger: "item", formatter: (p) => {
      const x = p.data;
      if (x.m) return `<b>${esc(x.c.name)}</b><br>${esc(x.m.date)} · ${esc(BN_KIND[x.m.kind][0])}<br>${esc(x.m.text)}`;
      if (x.p) return `<b>${esc(bnName(d, x.p.ticker))}</b>（${esc(x.p.ticker)}，${BN_MKT[x.p.market]}）<br>对应信号 ${esc(x.r.date)}（${esc(BN_KIND[x.r.kind][0])}）<br>上涨确认 ${esc(x.r.leg_t1)} · 时滞 ${days(x.r.lag_confirm)}<br>这一波 ${esc(x.r.leg_t0)} → ${esc(x.r.leg_peak)}，相对涨 ${pct(x.r.gain, 0, true)}`;
      return `<b>${esc(x.c.name)}</b><br>新闻起点 ${esc(x.c.news_onset)}`;
    } },
    legend: { top: 0, data: ["里程碑", "新闻起点", ...Object.keys(mcol).map((k) => `上涨确认·${BN_MKT[k]}`)] },
    grid: { left: 150, right: 20, top: 50, bottom: 40 },
    xAxis: { type: "time", min: "2019-01-01" }, yAxis: { type: "category", data: cases.map((c) => c.name), inverse: true, axisLabel: { fontSize: 11 } },
    series: [
      { name: "里程碑", type: "scatter", data: mk, symbolSize: 11, color: css("--ink-2"), z: 5 },
      { name: "新闻起点", type: "scatter", data: onset, symbol: "path://M0,0 L2,0 L2,10 L0,10 Z", symbolSize: [3, 18], color: css("--warn") },
      ...Object.entries(mcol).map(([k, col]) => ({ name: `上涨确认·${BN_MKT[k]}`, type: "scatter", data: comp.filter((x) => x.p.market === k), symbolSize: 8, color: col, itemStyle: { opacity: 0.75 } })),
    ],
  });
  ch?.on("click", (p) => { const c = p.data?.c; if (c) location.hash = `#/bottleneck?id=${c.id}`; });
}

function bnScoreText(s) {
  if (!s) return "–";
  const q = [["visible", "①可见"], ["pricing", "②定价"], ["purity", "③纯度"], ["structural", "④结构"], ["listing", "⑤上市"]];
  return `<b>${num(s.total, 1)}</b> <span class="muted small">${q.map(([k, n]) => `${n}${s[k] === 1 ? "✓" : s[k] === 0.5 ? "½" : "✗"}`).join(" ")}</span>`;
}
// 矩阵单元格：一个里程碑对一家公司的结果
function matchCell(r) {
  if (!r) return "<td></td>";
  if (r.status === "matched") {
    return `<td class="num" title="${esc(`这一波 ${r.leg_t0} → ${r.leg_peak}，上涨确认 ${r.leg_t1 || "–"}；提前定价 ${pct(r.pre_share, 0)}${r.primary ? "" : "；与更早的信号是同一波，不重复计入统计"}`)}">
      <b class="${r.lag_confirm < 0 ? "warn-t" : ""}">${days(r.lag_confirm)}</b>${r.primary ? "" : '<sup class="muted">同</sup>'}<br><span class="muted small">波段 ${pct(r.gain, 0, true)}</span></td>`;
  }
  return `<td class="muted small">${esc(BN_MATCH[r.status] || r.status)}${isNum(r.ret_12m) ? `<br>12 月 ${pct(r.ret_12m, 0, true)}` : ""}</td>`;
}

function renderBnDetail(d, c) {
  const comps = c.companies;
  const ms = c.milestones;
  byId("bn-detail").innerHTML = `
    <section class="card" id="bn-sel"><h3>${esc(c.name)} <span class="muted">${esc(c.layer)} · ${c.status === "ongoing" ? "仍紧缺" : "已缓解"}</span> ${badge("fact")}</h3>
      <ol>${ms.map((m) => `<li><b>${esc(m.date)}${m.precision === "month" ? "（约）" : ""}</b> <span class="chip">${esc(BN_KIND[m.kind][0])}</span> ${esc(m.text)} <a href="${esc(m.url)}" target="_blank" rel="noopener">来源</a></li>`).join("")}</ol>
      <p class="muted">新闻起点（GDELT “${esc(c.gdelt)}”）：${esc(c.news_onset || "暂无（数据未取到或未见明显放大）")}；申报起点（SEC “${esc(c.edgar)}”）：${esc(c.filing_onset || "未识别到")}。</p></section>
    <section class="card"><h3>每个里程碑对每家公司的结果 ${badge("derived")}</h3>
      <div class="table-wrap"><table><thead><tr><th>公司</th>${ms.map((m, k) => `<th class="num">${k + 1}. ${esc(m.date)}<br><span class="muted small">${esc(BN_KIND[m.kind][0])}</span></th>`).join("")}</tr></thead>
      <tbody>${comps.map((p) => `<tr><td class="nowrap"><b>${esc(p.ticker)}</b> ${esc(bnName(d, p.ticker))}</td>${ms.map((_, k) => matchCell((p.matches || []).find((r) => r.milestone === k))).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="muted small">数字 = 对应那一波的上涨确认日 − 信号日（黄色 = 股价先动）；下方小字 = 那一波相对大盘的总涨幅。“同”= 与更早的里程碑匹配到同一波，不重复计入统计。没有匹配时显示信号后 12 个月相对大盘的涨跌供参考。悬停看波段起止。</p></section>
    <div class="grid two">
      ${card("相关公司相对本地大盘的走势（首个信号当周 = 1；▲ = 各波起点）", chartDiv("c-bn-rel", "tall"), "", ["fact", "derived"])}
      ${card("新闻量（GDELT，占全部报道 %，月）与美股申报提及（份，季）", chartDiv("c-bn-news", "tall"), "", ["fact"])}
    </div>
    <section class="card"><h3>逐家公司 ${badge("derived")}${badge("model")}</h3><div class="table-wrap"><table><thead><tr><th>公司</th><th>市场</th><th>位置</th><th>纯度</th><th>定价</th><th>供应</th><th>周期股</th><th>相对大盘的各波上涨（2021 年起）</th><th class="num">分析师</th><th>五问得分</th></tr></thead>
      <tbody>${comps.map((p) => `<tr><td class="nowrap"><b>${esc(p.ticker)}</b> ${esc(bnName(d, p.ticker))}<div class="muted small">${esc(p.note || "")}</div></td>
        <td>${BN_MKT[p.market] || ""}</td><td>${BN_POS[p.position] || ""}</td><td>${BN_PUR[p.purity] || ""}</td><td>${BN_PRICE[p.pricing] || ""}</td><td>${BN_SUPPLY[p.supply] || ""}</td><td>${p.cyclical ? "是" : "否"}</td>
        <td class="small">${(p.legs || []).filter((l) => l.peak >= "2021-01-01").map((l) => `${esc(l.t0)} → ${esc(l.peak)}${l.ongoing ? "（未结束）" : ""} <b class="pos">${pct(l.gain, 0, true)}</b>`).join("<br>") || "–"}</td>
        <td class="num">${p.analysts ?? "–"}</td><td class="nowrap">${bnScoreText(p.score)}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted small">纯度 / 定价 / 供应 / 周期股为人工整理的判断（依据见每家公司下方说明），五问得分按这些判断与当前分析师覆盖数计算：每问 1 分（✓）/ 0.5 分（½）/ 0 分（✗）。</p></section>`;
  // 相对走势（日期轴），标出各波起点与里程碑
  const series = comps.filter((p) => p.series).map((p, i) => {
    const at = (dt) => { const k = p.series.dates.findIndex((x) => x >= dt); return k >= 0 ? p.series.values[k] : null; };
    const lo = p.series.dates[0], hi = p.series.dates[p.series.dates.length - 1];
    return { name: `${p.ticker} ${bnName(d, p.ticker)}`, type: "line", showSymbol: false, color: palette()[i % 8], lineStyle: { width: 1.6 },
      data: p.series.dates.map((x, k) => [x, p.series.values[k]]),
      markPoint: { symbol: "triangle", symbolSize: 9, label: { show: false }, data: (p.legs || []).filter((l) => l.t0 >= lo && l.t0 <= hi).map((l) => ({ coord: [l.t0, at(l.t0)], name: `起点 ${l.t0}（这一波 ${pct(l.gain, 0, true)}）` })) } };
  });
  if (series.length) series[0].markLine = { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" },
    data: ms.map((m, k) => ({ xAxis: m.date, label: { formatter: `${k + 1}`, color: css("--muted") } })) };
  mkChart(byId("c-bn-rel"), {
    tooltip: { trigger: "axis", valueFormatter: (v) => num(v, 2) }, legend: { type: "scroll", top: 0 }, grid: { left: 44, right: 16, top: 40, bottom: 30 },
    xAxis: { type: "time" }, yAxis: { type: "log", logBase: 2, axisLabel: { formatter: (v) => `${num(v, 1)}×` } }, series,
  });
  const mls = ms.map((m) => ({ xAxis: m.date, label: { show: false }, lineStyle: { color: css("--axis"), type: "dotted" } }));
  mkChart(byId("c-bn-news"), {
    tooltip: { trigger: "axis" }, legend: { top: 0 }, grid: { left: 52, right: 48, top: 40, bottom: 30 },
    xAxis: { type: "time", min: "2018-01-01" },
    yAxis: [{ type: "value", name: "新闻量 %", axisLabel: { formatter: (v) => num(v * 100, 2) } }, { type: "value", name: "申报份数", splitLine: { show: false } }],
    series: [
      ...(c.news ? [{ name: "新闻量（GDELT）", type: "line", showSymbol: false, data: c.news.dates.map((x, k) => [x, c.news.values[k] / 100]), color: palette()[0], areaStyle: { opacity: 0.12 },
        markLine: { symbol: "none", silent: true, data: [...mls, ...(c.news_onset ? [{ xAxis: c.news_onset, label: { formatter: "新闻起点", color: css("--muted") }, lineStyle: { color: css("--warn") } }] : [])] } }] : []),
      ...(c.filings ? [{ name: "美股申报提及", type: "bar", yAxisIndex: 1, data: c.filings.dates.map((x, k) => [x, c.filings.values[k]]), color: palette()[2], barMaxWidth: 8,
        ...(c.news ? {} : { markLine: { symbol: "none", silent: true, data: mls } }) }] : []),
    ],
  });
}

// ---------------- ② 说法检验 ----------------
const CLAIM_NOTE = {
  signal_kind: "“引发一波”= 信号后（或之前半年内）开始了一波相对大盘涨 50% 以上的上涨；“已在上涨中”= 信号出现时，公司已在半年多以前开始的一波上涨中。",
  visibility: "时滞 = 匹配波段的上涨确认日 − 里程碑日。预期：龙头 / 终端最短，上游材料最长。",
  pricing: "预期：现货 / 短约定价的公司时滞更短；单一供应商的信号后涨幅更大。",
  purity: "同一瓶颈内两两比较能排除“不同瓶颈本身大小不同”的影响。",
  cyclical: "预期：被当作周期股的公司（存储、材料、电力设备）时滞更长。",
  backlog: "匹配波段起点 − 里程碑日；负数 = 股价先于信号开始上涨。预期：订单型公司更常为负。",
  listing: "分析师覆盖数只有当前值（不是当时的值），与时滞的相关仅作参考。",
  narrative: "负面冲击看各环节 2 个交易日内的涨跌与收复天数（收复 = 收盘价回到冲击前一天的水平）；正面公告看 2 个交易日与 20 个交易日的涨跌。",
  framework: "五问每问 0 / 0.5 / 1 分。预期：得分与时滞负相关（越有利越快），与涨幅负相关（越不利，一旦被发现涨得越多）。",
};
const metricFmt = (m, v) => (m === "gain" || m === "ret_12m" ? pct(v, 0, true) : m === "pre_share" ? pct(v, 0) : days(v));
const METRIC_ZH = { lag_confirm: "时滞", lag_start: "起点相对信号", ret_12m: "信号后 12 个月相对涨幅", pre_share: "提前定价比例", gain: "涨幅" };

function claimGroupTable(c, groups, metric) {
  const m = groups[0]?.metric || metric;
  return `<div class="table-wrap"><table><thead><tr><th>分组</th><th class="num">样本数</th><th class="num">${esc(METRIC_ZH[m] || "中位数")}（中位数）</th>${groups.some((g) => isNum(g.lead_share)) ? '<th class="num">股价先动的比例</th>' : ""}<th>样本</th></tr></thead>
    <tbody>${groups.map((g) => `<tr><td>${esc(g.label)}</td><td class="num">${g.n}</td><td class="num"><b>${metricFmt(g.metric || metric, g.median)}</b></td>${isNum(g.lead_share) ? `<td class="num">${pct(g.lead_share, 0)}</td>` : groups.some((x) => isNum(x.lead_share)) ? "<td></td>" : ""}
      <td class="muted small">${(g.tickers || []).slice(0, 12).map(esc).join("、")}${(g.tickers || []).length > 12 ? " …" : ""}</td></tr>`).join("")}</tbody></table></div>`;
}

PAGES.claims = async () => {
  const d = await bnData();
  if (!d) { app().innerHTML = `<h2>说法检验</h2>${card("说法检验", empty("数据尚未生成"))}`; return; }
  const cl = d.claims;
  const tested = cl.filter((c) => c.verdict !== "描述性统计");
  const sum = (v) => tested.filter((c) => c.verdict === v).length;
  app().innerHTML = `<h2>瓶颈传导的说法检验 <span class="muted">数据截至 ${esc(d.asof)}</span></h2>
    ${howto([...BN_HOWTO,
      "每条说法给出：怎么检验、分组统计、结论。结论分四档：<b>支持</b>（方向一致且置换 / 符号检验 p < 0.1）、<b>方向一致但差异不显著</b>、<b>数据不支持</b>（方向相反）、<b>样本不足</b>（某组少于 3 个）。另用三种匹配窗口重算，看结论是否改变。",
      "同一家公司可能出现在多个瓶颈里（例如美光同时在 HBM 和通用 DRAM），样本并不完全独立；样本量有限，结论只能说明“这些案例里大致如此”。"])}
    ${insightBox(claimsInsights(d))}
    <section class="card"><h3>结论一览</h3><p>支持 ${sum("支持")} 条 · 方向一致但不显著 ${sum("方向一致，但差异不显著")} 条 · 数据不支持 ${sum("数据不支持")} 条 · 样本不足 ${sum("样本不足")} 条</p>
      <div class="table-wrap"><table><thead><tr><th></th><th>说法</th><th>结论（默认窗口）</th><th>换窗口后</th></tr></thead><tbody>${cl.map((c, i) => `<tr><td>${i}</td><td><a href="#cl-${c.id}" class="goto" data-goto="cl-${c.id}">${esc(c.title)}</a></td><td><span class="vchip v-${BN_VERDICT[c.verdict] || "info"}">${esc(c.verdict)}</span></td><td>${c.robust_all ? "一致" : '<span class="muted">会变</span>'}</td></tr>`).join("")}</tbody></table></div></section>
    ${cl.map((c, i) => claimCard(d, c, i)).join("")}`;
  for (const c of cl) drawClaim(d, c);
  bindGoto();
};

function claimCard(d, c, i) {
  let body = "";
  if (c.hit) body += `<div class="table-wrap"><table><thead><tr><th>信号类型</th><th class="num">公司 × 信号样本</th><th class="num">引发一波上涨</th><th class="num">已在上涨中</th><th class="num">没有引发新一波</th></tr></thead>
    <tbody>${c.hit.map((h) => `<tr><td>${esc(h.label)}</td><td class="num">${h.n}</td><td class="num"><b>${pct(h.matched, 0)}</b></td><td class="num">${pct(h.in_leg, 0)}</td><td class="num">${pct(h.none, 0)}</td></tr>`).join("")}</tbody></table></div>`;
  if (c.groups) body += claimGroupTable(c, c.groups, c.metric);
  if (c.groups2) body += `<h4>补充分组</h4>${claimGroupTable(c, c.groups2, "lag_confirm")}`;
  if (c.groups3) body += `<h4>提前定价比例（信号前已完成的涨幅占比；越高 = 越早被定价）</h4>${claimGroupTable(c, c.groups3, "pre_share")}`;
  if (c.pairs) {
    const w = c.pairs.filter((p) => p.win).length;
    body += `<h4>同一瓶颈内：纯度高 vs 纯度低（${w} / ${c.pairs.length} 对中纯度高的涨得更多；涨幅 = 该瓶颈各里程碑信号后 12 个月相对涨幅的平均）</h4><div class="table-wrap"><table><thead><tr><th>瓶颈</th><th>纯度高</th><th class="num">涨幅</th><th>纯度低</th><th class="num">涨幅</th></tr></thead><tbody>
      ${c.pairs.map((p) => `<tr><td>${esc(p.bottleneck)}</td><td>${esc(bnName(d, p.high))}</td><td class="num ${p.win ? "pos" : ""}">${pct(p.high_gain, 0, true)}</td><td>${esc(bnName(d, p.low))}</td><td class="num">${pct(p.low_gain, 0, true)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  if (c.shocks) {
    body += c.shocks.map((s) => `<h4>${esc(s.date)} ${esc(s.name)} <a href="${esc(s.url)}" target="_blank" rel="noopener" class="small">来源</a></h4>
      <div class="table-wrap"><table><thead><tr><th>环节</th><th class="num">公司数</th><th class="num">2 个交易日涨跌（中位数）</th><th class="num">20 个交易日（中位数）</th>${s.kind === "negative" ? '<th class="num">收复天数（中位数）</th><th class="num">仍未收复</th>' : ""}<th>${s.kind === "negative" ? "跌得最多" : "涨得最多"}</th></tr></thead>
      <tbody>${s.groups.map((g) => `<tr><td>${esc(g.layer)}</td><td class="num">${g.n}</td><td class="num ${cls(g.day)}">${pct(g.day, 1, true)}</td><td class="num ${cls(g.d20)}">${pct(g.d20, 1, true)}</td>
        ${s.kind === "negative" ? `<td class="num">${isNum(g.recover_days) ? `${Math.round(g.recover_days)} 天` : "–"}</td><td class="num">${g.not_recovered ?? "–"}</td>` : ""}
        <td class="small">${g.worst.map((w) => `${esc(bnName(d, w.ticker))} ${pct(w.day, 1, true)}`).join("、")}</td></tr>`).join("")}</tbody></table></div>`).join("");
  }
  if (c.points) {
    body += `<p>五问得分与时滞的秩相关 <b>${num(c.rho_lag, 2, true)}</b>（负 = 越有利越快）；与信号后 12 个月相对涨幅的秩相关 <b>${num(c.rho_gain, 2, true)}</b>（负 = 越不利涨得越多）。
      得分 ≥ 3.5 的 ${c.n_high} 个样本中，时滞 ≤ 90 天的占 <b>${pct(c.high_within_q, 0)}</b>；得分 ≤ 2 的 ${c.n_low} 个样本中占 <b>${pct(c.low_within_q, 0)}</b>。</p>${chartDiv(`c-cl-${c.id}`, "tall")}`;
  } else if (c.groups && c.metric) body += chartDiv(`c-cl-${c.id}`, "short");
  if (isNum(c.rho_analysts)) body += `<p class="muted">分析师覆盖数与时滞的秩相关 ${num(c.rho_analysts, 2, true)}（负 = 覆盖越多越快）。</p>`;
  if (c.robust?.length && c.verdict !== "描述性统计") body += `<p class="muted small"><b>稳健性</b>（换匹配窗口重算）：${c.robust.map((r) => `${esc(r.window)} → <span class="vchip v-${BN_VERDICT[r.verdict] || "info"}">${esc(r.verdict || "–")}</span>`).join("　")}${c.robust_all ? "　<b>三种窗口结论一致</b>" : "　结论随窗口变化，说明证据不稳"}</p>`;
  return `<section class="card" id="cl-${c.id}"><h3>${i}. ${esc(c.title)} <span class="vchip v-${BN_VERDICT[c.verdict] || "info"}">${esc(c.verdict)}</span>${c.robust_all || c.verdict === "描述性统计" ? "" : ' <span class="chip">随窗口变化</span>'}</h3>
    <p class="muted"><b>怎么检验：</b>${esc(c.test)}。${esc(CLAIM_NOTE[c.id] || "")}${isNum(c.p) ? ` 置换 / 符号检验 p = ${num(c.p, 2)}。` : ""}</p>${body}</section>`;
}

function drawClaim(d, c) {
  const el = byId(`c-cl-${c.id}`);
  if (!el) return;
  if (c.points) {
    mkChart(el, {
      tooltip: { trigger: "item", formatter: (p) => `${esc(bnName(d, p.data.t))}（${esc(p.data.b)}，信号 ${esc(p.data.dt)}）<br>五问得分 ${num(p.data.s, 1)} · 时滞 ${days(p.data.value[1])}<br>信号后 12 个月相对涨幅 ${pct(p.data.g, 0, true)}` },
      legend: { show: false }, grid: { left: 60, right: 20, top: 20, bottom: 44 },
      xAxis: { type: "value", name: "五问得分", nameLocation: "middle", nameGap: 26, min: 0, max: 5 }, yAxis: { type: "value", name: "时滞（天）" },
      series: [{ type: "scatter", data: c.points.map((p, k) => ({ value: [p.score + ((k % 7) - 3) * 0.03, p.lag], s: p.score, t: p.ticker, b: p.bottleneck, dt: p.date, g: p.gain })), symbolSize: 8, color: palette()[0], itemStyle: { opacity: 0.6 },
        markLine: { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" }, label: { formatter: "一个季度", color: css("--muted") }, data: [{ yAxis: 90 }] } }],
    });
    return;
  }
  const gs = c.groups.filter((g) => g.n);
  const m = gs[0]?.metric || c.metric;
  mkChart(el, {
    tooltip: { trigger: "item", formatter: (p) => `${esc(p.seriesName)}：${metricFmt(m, p.value[1])}` }, legend: { show: false },
    grid: { left: 60, right: 20, top: 16, bottom: 30 }, xAxis: { type: "category", data: gs.map((g) => g.label) },
    yAxis: { type: "value", axisLabel: { formatter: (v) => (m === "ret_12m" || m === "gain" ? pct(v, 0) : `${v}`) } },
    series: [
      ...gs.map((g, i) => ({ name: g.label, type: "scatter", data: (g.values || []).map((v) => [i, v]), symbolSize: 7, color: palette()[i % 8], itemStyle: { opacity: 0.55 } })),
      { name: "中位数", type: "scatter", symbol: "rect", symbolSize: [26, 3], color: css("--ink"), data: gs.map((g, i) => [i, g.median]) },
    ],
  });
}

// 说法检验页顶部：最重要的几条发现（由数据算出）
function claimsInsights(d) {
  const rows = bnRows(d).filter((x) => x.status !== "listed_after");
  const inLeg = rows.filter((x) => x.status === "in_earlier_leg").length;
  const prim = rows.filter((x) => x.primary && isNum(x.lag_start));
  const lead = prim.filter((x) => x.lag_start < 0).length;
  const out = [{ level: "high", kind: "derived", text: `${inLeg} / ${rows.length} 个“公司 × 信号”出现时，公司已经在半年多以前开始的一波上涨中；匹配到一波的 ${prim.length} 个样本里，${lead} 个的起点早于信号。能查到的公开报道往往落后于股价——要么市场更早从别处看到，要么瓶颈的源头更早（例如 ChatGPT 发布、2022 年电网设备就已紧张）。` }];
  const robust = d.claims.filter((c) => c.robust_all && c.verdict !== "描述性统计").map((c) => `「${c.title}」${c.verdict}`);
  if (robust.length) out.push({ level: "info", kind: "derived", text: `三种匹配窗口下结论都不变的：${robust.join("；")}。其余说法的结论随窗口改变，证据不稳。` });
  return out;
}

// ---------------- 个股页：相关瓶颈 ----------------
async function fillBottleneckCard(t) {
  const el = byId("bn-card");
  if (!el) return;
  let d;
  try { d = await bnData(); } catch { return; }
  if (!d) return;
  const key = UNIVERSE_ALIAS[t] || t;
  const hits = d.cases.flatMap((c) => c.companies.filter((p) => p.ticker === key).map((p) => ({ c, p })));
  if (!hits.length) return;
  const legs = hits[0].p.legs || [];
  el.hidden = false;
  el.innerHTML = `<h3>相关瓶颈（瓶颈 → 股价时滞研究）${badge("derived")}${badge("model")}</h3>
    ${legs.length ? `<p>相对本地大盘的各波上涨：${legs.filter((l) => l.peak >= "2021-01-01").map((l) => `${esc(l.t0)} → ${esc(l.peak)} <b class="pos">${pct(l.gain, 0, true)}</b>${l.ongoing ? "（未结束）" : ""}`).join("；")}</p>` : ""}
    <div class="table-wrap"><table><thead><tr><th>瓶颈 / 信号</th><th>它的位置</th><th>结果</th><th class="num">时滞</th><th class="num">信号后 12 个月</th></tr></thead>
    <tbody>${hits.flatMap(({ c, p }) => (p.matches || []).map((r, k) => `<tr>${k === 0 ? `<td colspan="5"><a href="#/bottleneck?id=${c.id}"><b>${esc(c.name)}</b></a> <span class="muted">${c.status === "ongoing" ? "仍紧缺" : "已缓解"} · ${BN_POS[p.position]} · 纯度${BN_PUR[p.purity]} · ${BN_PRICE[p.pricing]} · 五问 ${bnScoreText(p.score)}</span></td></tr><tr>` : ""}
      <td class="small">${esc(r.date)} ${esc(BN_KIND[r.kind][0])}：${esc(c.milestones[r.milestone].text)}</td><td></td>
      <td>${esc(BN_MATCH[r.status] || r.status)}${r.status === "matched" ? `<br><span class="muted small">${esc(r.leg_t0)} → ${esc(r.leg_peak)}，${pct(r.gain, 0, true)}</span>` : ""}</td>
      <td class="num">${days(r.lag_confirm)}</td><td class="num ${cls(r.ret_12m)}">${pct(r.ret_12m, 0, true)}</td></tr>`)).join("")}</tbody></table></div>
    <p class="muted small">波段：相对大盘回撤 25% 以上即一波结束，每波至少涨 50%。时滞 = 那一波相对涨 30% 的日子 − 信号日；事后识别，只描述历史。<a href="#/claims">这些因素是否真的影响时滞 →</a></p>`;
}
