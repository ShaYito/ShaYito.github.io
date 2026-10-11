/* AI 瓶颈 → 股价时滞（M45）：产业链栏目下两个子标签 + 个股页“相关瓶颈”卡片。数据：bottlenecks.json（每周 run_bottlenecks.py 生成）
   ① 瓶颈时间线：总览（每个瓶颈的首个公开信号、新闻起点、各公司上涨确认点）+ 单个瓶颈详情（相对走势对齐图、新闻量 / 申报提及、公司表）
   ② 说法检验：逐条检验“瓶颈 → 股价传导”的七条说法与五问框架，给出分组统计、结论与局限 */

const BN_POS = { leader: "龙头 / 终端", mid: "中游", upstream: "上游材料" };
const BN_PUR = { high: "高", medium: "中", low: "低" };
const BN_PRICE = { spot: "现货 / 短约", contract: "长约", backlog: "订单积压" };
const BN_SUPPLY = { single: "单一", few: "少数", many: "多家" };
const BN_MKT = { US: "美股", TW: "台股", JP: "日股", KR: "韩股", CN: "A 股", DE: "德股" };
const BN_KIND = { leader: ["龙头表态 / 指引", "diamond"], report: ["行业报道", "circle"], price: ["提价", "triangle"], capacity: ["抢产能 / 售罄 / 协议", "rect"], order: ["订单", "pin"], product: ["产品发布", "roundRect"] };
const BN_VERDICT = { "支持": "good", "方向一致，但差异不显著": "medium", "数据不支持": "high", "样本不足": "info" };
const bnName = (d, t) => d.names?.[t] || META.names_zh?.[t] || t;
const days = (v) => (isNum(v) ? `${v > 0 ? "+" : ""}${Math.round(v)} 天` : "–");
const months = (v) => (isNum(v) ? `${v > 0 ? "+" : ""}${(v / 30.4).toFixed(1)} 个月` : "–");
const UNIVERSE_ALIAS = { TSM: "2330.TW", ASX: "3711.TW" }; // 选股池代码 → 案例库中的本地上市代码

const BN_HOWTO = [
  "每个瓶颈有三个“被看见”的时间点：<b>首个公开信号</b>（案例库里最早的里程碑：龙头财报 / 指引、行业报道、提价、抢产能等，均附来源链接）、<b>新闻起点</b>（GDELT 全球新闻量首次放大到平时 3 倍以上的月份）、<b>申报起点</b>（美股公司 10-K / 10-Q / 8-K 中提到该词的文件数放大到平时 2 倍以上的季度）。",
  "<b>提前定价比例</b>：从信号前 12 个月的低点到信号后 24 个月的高点，信号日之前已经完成的部分占多少（0 = 全在信号之后，100% = 信号时已涨完）。<b>半程</b>：信号后多少天完成了“信号日 → 之后高点”的一半涨幅。",
  "每家公司用“相对本地大盘”的价格（美股 ÷ SPY、台股 ÷ 加权指数、日股 ÷ 日经、韩股 ÷ KOSPI、A 股 ÷ 沪深 300），剔除大盘涨跌。在首个信号前 12 个月到之后 24 个月里找出最大一段相对上涨：<b>上涨起点</b> = 开始上涨前最后一次处在低位的日子，<b>上涨确认</b> = 相对涨幅首次达到 30% 的日子。<b>时滞</b> = 上涨确认 − 首个公开信号；负数表示股价先于公开信号上涨。",
  "这些点都是事后识别的（知道后来涨了才找得到起点），用来总结历史规律，不能当作实时买卖信号。案例本身是因为“后来成了著名瓶颈”才被选进来的（幸存者偏差），结论只说明这些案例里的规律。",
];

async function bnData() {
  const d = await load("bottlenecks.json");
  return d?.cases ? d : null;
}

// ---------------- ① 瓶颈时间线 ----------------
PAGES.bottleneck = async (r) => {
  const d = await bnData();
  if (!d) { app().innerHTML = `<h2>AI 瓶颈时间线</h2>${card("瓶颈时间线", empty("数据尚未生成（每周运行 run_bottlenecks.py）"))}`; return; }
  const cases = [...d.cases].sort((a, b) => a.first_signal.localeCompare(b.first_signal));
  const sel = cases.find((c) => c.id === r.query.id) || null;
  const ev = cases.flatMap((c) => c.companies.filter((p) => p.status === "ok" && isNum(p.lag_confirm)).map((p) => ({ ...p, case: c })));
  const lags = ev.map((p) => p.lag_confirm).sort((a, b) => a - b);
  const med = lags.length ? lags[Math.floor(lags.length / 2)] : null;
  const lead = ev.filter((p) => p.lag_start < 0).length;
  const ins = [
    { level: "info", kind: "derived", text: `${cases.length} 个瓶颈、${cases.reduce((a, c) => a + c.companies.length, 0)} 个公司样本；其中 ${ev.length} 个有明显相对上涨且上市早于信号，计入时滞统计。` },
    { level: "info", kind: "derived", text: `上涨确认相对首个公开信号的时滞中位数 ${days(med)}（约 ${months(med)}）；${lead} / ${ev.length} 个样本的上涨起点早于首个公开信号（股价先动）。` },
  ];
  const noRise = cases.flatMap((c) => c.companies.filter((p) => p.status === "没有明显上涨").map((p) => p.ticker));
  if (noRise.length) ins.push({ level: "medium", kind: "derived", text: `同样身处瓶颈、但窗口内相对大盘没有明显上涨的：${noRise.map((t) => bnName(d, t)).join("、")}——受益于瓶颈不等于股价一定跑赢。` });
  app().innerHTML = `<h2>AI 瓶颈 → 股价时滞 <span class="muted">数据截至 ${esc(d.asof)}</span></h2>
    ${howto(BN_HOWTO)}${insightBox(ins)}
    ${card("总览：各瓶颈何时被看见、相关公司何时开始上涨（点击一行看详情）", chartDiv("c-bn-over", "tall"), "", ["fact", "derived"])}
    <section class="card"><h3>瓶颈列表 ${badge("fact")}${badge("derived")}</h3><div class="table-wrap"><table><thead><tr><th>瓶颈</th><th>环节</th><th>状态</th><th>首个公开信号</th><th>新闻起点</th><th>申报起点</th><th class="num">计入样本</th><th class="num">时滞中位数</th></tr></thead>
      <tbody>${cases.map((c) => `<tr class="${sel?.id === c.id ? "hl" : ""}"><td><a href="#/bottleneck?id=${c.id}">${esc(c.name)}</a></td><td>${esc(c.layer)}</td><td>${c.status === "ongoing" ? "仍紧缺" : "已缓解"}</td>
        <td>${esc(c.first_signal)}</td><td>${esc(c.news_onset || "–")}</td><td>${esc(c.filing_onset || "–")}</td><td class="num">${c.n_eval} / ${c.companies.length}</td><td class="num">${days(c.median_lag)}</td></tr>`).join("")}</tbody></table></div></section>
    <div id="bn-detail"></div>`;
  drawBnOverview(d, cases);
  if (sel) { renderBnDetail(d, sel); byId("bn-detail").scrollIntoView({ block: "start" }); }
  else byId("bn-detail").innerHTML = card("单个瓶颈详情", `<p class="muted">点击上表或总览图中的一行查看：里程碑与来源、相关公司相对走势（按首个信号对齐）、新闻量与申报提及、逐家公司的时滞与五问得分。</p>`);
};

function drawBnOverview(d, cases) {
  const y = cases.map((c) => c.name);
  const mk = [], onset = [], comp = [];
  cases.forEach((c, i) => {
    for (const m of c.milestones) mk.push({ value: [m.date, i], m, c, symbol: BN_KIND[m.kind][1] });
    if (c.news_onset) onset.push({ value: [c.news_onset, i], c });
    for (const p of c.companies) if (p.t1 && p.status === "ok") comp.push({ value: [p.t1, i], p, c });
  });
  const mcol = { US: palette()[0], TW: palette()[2], JP: palette()[3], KR: palette()[4], CN: palette()[5], DE: palette()[6] };
  const ch = mkChart(byId("c-bn-over"), {
    tooltip: { trigger: "item", formatter: (p) => {
      const x = p.data;
      if (x.m) return `<b>${esc(x.c.name)}</b><br>${esc(x.m.date)} · ${esc(BN_KIND[x.m.kind][0])}<br>${esc(x.m.text)}`;
      if (x.p) return `<b>${esc(bnName(d, x.p.ticker))}</b>（${esc(x.p.ticker)}，${BN_MKT[x.p.market]}）<br>上涨确认 ${esc(x.p.t1)} · 时滞 ${days(x.p.lag_confirm)}<br>窗口内最大相对涨幅 ${pct(x.p.gain, 0, true)}`;
      return `<b>${esc(x.c.name)}</b><br>新闻起点 ${esc(x.c.news_onset)}`;
    } },
    legend: { top: 0, data: ["里程碑", "新闻起点", ...Object.keys(mcol).map((k) => `上涨确认·${BN_MKT[k]}`)] },
    grid: { left: 150, right: 20, top: 50, bottom: 40 },
    xAxis: { type: "time", min: "2019-01-01" }, yAxis: { type: "category", data: y, inverse: true, axisLabel: { fontSize: 11 } },
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

function renderBnDetail(d, c) {
  const comps = c.companies;
  const statusTxt = (p) => (p.status === "ok" ? "" : `<span class="chip">${esc(p.status)}</span>`);
  byId("bn-detail").innerHTML = `
    <section class="card" id="bn-sel"><h3>${esc(c.name)} <span class="muted">${esc(c.layer)} · ${c.status === "ongoing" ? "仍紧缺" : "已缓解"}</span> ${badge("fact")}</h3>
      <ul>${c.milestones.map((m) => `<li><b>${esc(m.date)}${m.precision === "month" ? "（约）" : ""}</b> <span class="chip">${esc(BN_KIND[m.kind][0])}</span> ${esc(m.text)} <a href="${esc(m.url)}" target="_blank" rel="noopener">来源</a></li>`).join("")}</ul>
      <p class="muted">新闻起点（GDELT “${esc(c.gdelt)}”）：${esc(c.news_onset || "未识别到明显放大")}；申报起点（SEC “${esc(c.edgar)}”）：${esc(c.filing_onset || "未识别到")}。</p></section>
    <div class="grid two">
      ${card("相关公司相对本地大盘的走势（首个信号当周 = 1，横轴 = 距首个信号的天数）", chartDiv("c-bn-rel", "tall"), "", ["fact", "derived"])}
      ${card("新闻量（GDELT，占全部报道 %，月）与美股申报提及（份，季）", chartDiv("c-bn-news", "tall"), "", ["fact"])}
    </div>
    <section class="card"><h3>逐家公司 ${badge("derived")}${badge("model")}</h3><div class="table-wrap"><table><thead><tr><th>公司</th><th>市场</th><th>位置</th><th>纯度</th><th>定价</th><th>供应</th><th>周期股</th><th>上涨起点</th><th>上涨确认</th><th class="num">时滞（vs 首个信号）</th><th class="num">时滞（vs 新闻起点）</th><th class="num">最大相对涨幅</th><th class="num">提前定价</th><th class="num">半程</th><th class="num">信号后 6 / 12 月</th><th class="num">分析师</th><th>五问得分</th></tr></thead>
      <tbody>${comps.map((p) => `<tr><td class="nowrap"><b>${esc(p.ticker)}</b> ${esc(bnName(d, p.ticker))} ${statusTxt(p)}<div class="muted small">${esc(p.note || "")}</div></td>
        <td>${BN_MKT[p.market] || ""}</td><td>${BN_POS[p.position] || ""}</td><td>${BN_PUR[p.purity] || ""}</td><td>${BN_PRICE[p.pricing] || ""}</td><td>${BN_SUPPLY[p.supply] || ""}</td><td>${p.cyclical ? "是" : "否"}</td>
        <td>${esc(p.t0 || "–")}</td><td>${esc(p.t1 || "–")}</td><td class="num ${cls(-p.lag_confirm)}">${days(p.lag_confirm)}</td><td class="num">${days(p.lag_news)}</td>
        <td class="num ${cls(p.gain)}">${pct(p.gain, 0, true)}</td><td class="num">${pct(p.pre_share, 0)}</td><td class="num">${days(p.half_days)}</td><td class="num">${pct(p.ret_6m, 0, true)} / ${pct(p.ret_12m, 0, true)}</td><td class="num">${p.analysts ?? "–"}</td><td class="nowrap">${bnScoreText(p.score)}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted small">纯度 / 定价 / 供应 / 周期股为人工整理的判断（依据见每家公司下方说明），五问得分按这些判断与当前分析师覆盖数计算：每问 1 分（✓）/ 0.5 分（½）/ 0 分（✗）。“上市晚于信号”的公司看不到信号前后的完整过程，不计入时滞统计。</p></section>`;
  // 相对走势：横轴 = 距首个信号的天数
  const f0 = new Date(`${c.first_signal}T12:00:00Z`);
  const off = (s) => Math.round((new Date(`${s}T12:00:00Z`) - f0) / 864e5);
  const series = comps.filter((p) => p.series).map((p, i) => ({ name: `${p.ticker} ${bnName(d, p.ticker)}`, type: "line", showSymbol: false, color: palette()[i % 8],
    data: p.series.dates.map((x, k) => [off(x), p.series.values[k]]), lineStyle: { width: 1.6 },
    markPoint: p.t1 ? { symbol: "circle", symbolSize: 8, label: { show: false }, data: [{ coord: [off(p.t1), p.series.values[p.series.dates.findIndex((x) => x >= p.t1)] ?? null], name: "上涨确认" }] } : undefined }));
  const ml = [{ xAxis: 0, label: { formatter: "首个信号", color: css("--muted") } }];
  if (c.news_onset) ml.push({ xAxis: off(c.news_onset), label: { formatter: "新闻起点", color: css("--muted") }, lineStyle: { color: css("--warn") } });
  if (series.length) series[0].markLine = { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" }, data: ml };
  mkChart(byId("c-bn-rel"), {
    tooltip: { trigger: "axis", valueFormatter: (v) => num(v, 2) }, legend: { type: "scroll", top: 0 }, grid: { left: 44, right: 16, top: 40, bottom: 40 },
    xAxis: { type: "value", name: "距首个信号（天）", nameLocation: "middle", nameGap: 26 }, yAxis: { type: "log", logBase: 2, axisLabel: { formatter: (v) => `${num(v, 1)}×` } }, series,
  });
  // 新闻量 + 申报提及
  const ms = c.milestones.map((m) => ({ xAxis: m.date, label: { show: false }, lineStyle: { color: css("--axis"), type: "dotted" } }));
  mkChart(byId("c-bn-news"), {
    tooltip: { trigger: "axis" }, legend: { top: 0 }, grid: { left: 52, right: 48, top: 40, bottom: 30 },
    xAxis: { type: "time", min: "2018-01-01" },
    yAxis: [{ type: "value", name: "新闻量 %", axisLabel: { formatter: (v) => num(v * 100, 2) } }, { type: "value", name: "申报份数", splitLine: { show: false } }],
    series: [
      ...(c.news ? [{ name: "新闻量（GDELT）", type: "line", showSymbol: false, data: c.news.dates.map((x, k) => [x, c.news.values[k] / 100]), color: palette()[0], areaStyle: { opacity: 0.12 },
        markLine: { symbol: "none", silent: true, data: [...ms, ...(c.news_onset ? [{ xAxis: c.news_onset, label: { formatter: "新闻起点", color: css("--muted") }, lineStyle: { color: css("--warn") } }] : [])] } }] : []),
      ...(c.filings ? [{ name: "美股申报提及", type: "bar", yAxisIndex: 1, data: c.filings.dates.map((x, k) => [x, c.filings.values[k]]), color: palette()[2], barMaxWidth: 8 }] : []),
    ],
  });
}

// ---------------- ② 说法检验 ----------------
const CLAIM_NOTE = {
  visibility: "时滞 = 上涨确认 − 首个公开信号。预期：龙头 / 终端最短，上游材料最长。",
  pricing: "预期：现货 / 短约定价的公司时滞更短；单一供应商的最大相对涨幅更大。",
  purity: "同一瓶颈内两两比较能排除“不同瓶颈本身大小不同”的影响。",
  cyclical: "预期：被当作周期股的公司（存储、材料、电力设备）时滞更长。",
  backlog: "上涨起点 − 首个公开信号；负数 = 股价先于公开信号开始上涨。预期：订单型公司更常为负。",
  listing: "分析师覆盖数只有当前值（不是当时的值），与时滞的相关仅作参考。",
  narrative: "负面冲击看各环节当天涨跌与收复天数（收复 = 收盘价回到冲击前一天的水平）；正面公告看当天涨跌。",
  framework: "五问每问 0 / 0.5 / 1 分。预期：得分与时滞负相关（越有利越快），与涨幅负相关（越不利，一旦被发现涨得越多）。",
};
const metricFmt = (m, v) => (m === "gain" ? pct(v, 0, true) : m === "pre_share" ? pct(v, 0) : days(v));

function claimGroupTable(c, groups, metric) {
  return `<div class="table-wrap"><table><thead><tr><th>分组</th><th class="num">样本数</th><th class="num">中位数</th>${groups.some((g) => isNum(g.lead_share)) ? '<th class="num">股价先动的比例</th>' : ""}<th>样本</th></tr></thead>
    <tbody>${groups.map((g) => `<tr><td>${esc(g.label)}</td><td class="num">${g.n}</td><td class="num"><b>${metricFmt(g.metric || metric, g.median)}</b></td>${isNum(g.lead_share) ? `<td class="num">${pct(g.lead_share, 0)}</td>` : groups.some((x) => isNum(x.lead_share)) ? "<td></td>" : ""}
      <td class="muted small">${(g.tickers || []).slice(0, 14).map(esc).join("、")}${(g.tickers || []).length > 14 ? " …" : ""}</td></tr>`).join("")}</tbody></table></div>`;
}

PAGES.claims = async () => {
  const d = await bnData();
  if (!d) { app().innerHTML = `<h2>说法检验</h2>${card("说法检验", empty("数据尚未生成"))}`; return; }
  const cl = d.claims;
  const sum = (v) => cl.filter((c) => c.verdict === v).length;
  app().innerHTML = `<h2>瓶颈传导的说法检验 <span class="muted">数据截至 ${esc(d.asof)}</span></h2>
    ${howto([...BN_HOWTO.slice(1),
      "每条说法给出：怎么检验、分组统计、结论。结论分四档：<b>支持</b>（方向一致且置换检验 p < 0.1）、<b>方向一致但差异不显著</b>、<b>数据不支持</b>（方向相反）、<b>样本不足</b>（某组少于 3 个）。",
      "同一家公司可能出现在多个瓶颈里（例如美光同时在 HBM 和通用 DRAM），样本并不完全独立；样本量只有几十个，结论只能说明“这些案例里大致如此”。"])}
    ${insightBox(claimsInsights(d))}
    <section class="card"><h3>结论一览</h3><p>支持 ${sum("支持")} 条 · 方向一致但不显著 ${sum("方向一致，但差异不显著")} 条 · 数据不支持 ${sum("数据不支持")} 条 · 样本不足 ${sum("样本不足")} 条</p>
      <div class="table-wrap"><table><thead><tr><th></th><th>说法</th><th>结论（默认窗口）</th><th>换窗口后</th></tr></thead><tbody>${cl.map((c, i) => `<tr><td>${i + 1}</td><td><a href="#cl-${c.id}" class="goto" data-goto="cl-${c.id}">${esc(c.title)}</a></td><td><span class="vchip v-${BN_VERDICT[c.verdict] || "info"}">${esc(c.verdict)}</span></td><td>${c.robust_all ? "一致" : '<span class="muted">会变</span>'}</td></tr>`).join("")}</tbody></table></div></section>
    ${cl.map((c, i) => claimCard(d, c, i)).join("")}`;
  for (const c of cl) drawClaim(d, c);
  bindGoto();
};

function claimCard(d, c, i) {
  let body = "";
  if (c.groups) body += claimGroupTable(c, c.groups, c.metric);
  if (c.groups2) body += `<h4>补充分组</h4>${claimGroupTable(c, c.groups2, "lag_confirm")}`;
  if (c.groups3) body += `<h4>提前定价比例（信号前已完成的涨幅占比；越高 = 越早被定价）</h4>${claimGroupTable(c, c.groups3, "pre_share")}`;
  if (c.pairs) {
    const w = c.pairs.filter((p) => p.win).length;
    body += `<h4>同一瓶颈内：纯度高 vs 纯度低（${w} / ${c.pairs.length} 对中纯度高的涨得更多）</h4><div class="table-wrap"><table><thead><tr><th>瓶颈</th><th>纯度高</th><th class="num">涨幅</th><th>纯度低</th><th class="num">涨幅</th></tr></thead><tbody>
      ${c.pairs.map((p) => `<tr><td>${esc(p.bottleneck)}</td><td>${esc(bnName(d, p.high))}</td><td class="num ${p.win ? "pos" : ""}">${pct(p.high_gain, 0, true)}</td><td>${esc(bnName(d, p.low))}</td><td class="num">${pct(p.low_gain, 0, true)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  if (c.shocks) {
    body += c.shocks.map((s) => `<h4>${esc(s.date)} ${esc(s.name)} <a href="${esc(s.url)}" target="_blank" rel="noopener" class="small">来源</a></h4>
      <div class="table-wrap"><table><thead><tr><th>环节</th><th class="num">公司数</th><th class="num">当天涨跌（中位数）</th><th class="num">之后 20 个交易日（中位数）</th>${s.kind === "negative" ? '<th class="num">收复天数（中位数）</th><th class="num">仍未收复</th>' : ""}<th>${s.kind === "negative" ? "跌得最多" : "涨得最多"}</th></tr></thead>
      <tbody>${s.groups.map((g) => `<tr><td>${esc(g.layer)}</td><td class="num">${g.n}</td><td class="num ${cls(g.day)}">${pct(g.day, 1, true)}</td><td class="num ${cls(g.d20)}">${pct(g.d20, 1, true)}</td>
        ${s.kind === "negative" ? `<td class="num">${isNum(g.recover_days) ? `${Math.round(g.recover_days)} 天` : "–"}</td><td class="num">${g.not_recovered ?? "–"}</td>` : ""}
        <td class="small">${g.worst.map((w) => `${esc(bnName(d, w.ticker))} ${pct(w.day, 1, true)}`).join("、")}</td></tr>`).join("")}</tbody></table></div>`).join("");
  }
  if (c.points) {
    body += `<p>五问得分与时滞的秩相关 <b>${num(c.rho_lag, 2, true)}</b>（负 = 越有利越快）；与最大相对涨幅的秩相关 <b>${num(c.rho_gain, 2, true)}</b>（负 = 越不利涨得越多）。
      得分 ≥ 3.5 的 ${c.n_high} 个样本中，时滞 ≤ 90 天的占 <b>${pct(c.high_within_q, 0)}</b>；得分 ≤ 2 的 ${c.n_low} 个样本中占 <b>${pct(c.low_within_q, 0)}</b>。</p>${chartDiv(`c-cl-${c.id}`, "tall")}`;
  } else if (c.groups && c.metric) body += chartDiv(`c-cl-${c.id}`, "short");
  if (isNum(c.rho_analysts)) body += `<p class="muted">分析师覆盖数与时滞的秩相关 ${num(c.rho_analysts, 2, true)}（负 = 覆盖越多越快）。</p>`;
  if (c.robust?.length) body += `<p class="muted small"><b>稳健性</b>（换观察窗口重算）：${c.robust.map((r) => `${esc(r.window)} → <span class="vchip v-${BN_VERDICT[r.verdict] || "info"}">${esc(r.verdict || "–")}</span>`).join("　")}${c.robust_all ? "　<b>三种窗口结论一致</b>" : "　结论随窗口变化，说明证据不稳"}</p>`;
  return `<section class="card" id="cl-${c.id}"><h3>${i + 1}. ${esc(c.title)} <span class="vchip v-${BN_VERDICT[c.verdict] || "info"}">${esc(c.verdict)}</span>${c.robust_all ? "" : ' <span class="chip">随窗口变化</span>'}</h3>
    <p class="muted"><b>怎么检验：</b>${esc(c.test)}。${esc(CLAIM_NOTE[c.id] || "")}${isNum(c.p) ? ` 置换 / 符号检验 p = ${num(c.p, 2)}。` : ""}</p>${body}</section>`;
}

function drawClaim(d, c) {
  const el = byId(`c-cl-${c.id}`);
  if (!el) return;
  if (c.points) {
    mkChart(el, {
      tooltip: { trigger: "item", formatter: (p) => `${esc(bnName(d, p.data.t))}（${esc(p.data.b)}）<br>五问得分 ${p.data.value[0]} · 时滞 ${days(p.data.value[1])}<br>最大相对涨幅 ${pct(p.data.g, 0, true)}` },
      legend: { show: false }, grid: { left: 60, right: 20, top: 20, bottom: 44 },
      xAxis: { type: "value", name: "五问得分", nameLocation: "middle", nameGap: 26, min: 0, max: 5 }, yAxis: { type: "value", name: "时滞（天）" },
      series: [{ type: "scatter", data: c.points.map((p) => ({ value: [p.score + (Math.random() - 0.5) * 0.15, p.lag], t: p.ticker, b: p.bottleneck, g: p.gain })), symbolSize: (v, p) => 6 + Math.min(20, Math.sqrt(Math.max(0, p.data.g)) * 6), color: palette()[0], itemStyle: { opacity: 0.7 },
        markLine: { symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed" }, label: { formatter: "一个季度", color: css("--muted") }, data: [{ yAxis: 90 }] } }],
    });
    return;
  }
  const gs = c.groups.filter((g) => g.n);
  mkChart(el, {
    tooltip: { trigger: "item", formatter: (p) => `${esc(p.seriesName)}：${metricFmt(c.metric, p.value[1])}` }, legend: { show: false },
    grid: { left: 60, right: 20, top: 16, bottom: 30 }, xAxis: { type: "category", data: gs.map((g) => g.label) },
    yAxis: { type: "value", axisLabel: { formatter: (v) => (c.metric === "gain" ? pct(v, 0) : `${v}`) } },
    series: [
      ...gs.map((g, i) => ({ name: g.label, type: "scatter", data: (g.values || []).map((v) => [i, v]), symbolSize: 7, color: palette()[i % 8], itemStyle: { opacity: 0.55 } })),
      { name: "中位数", type: "scatter", symbol: "rect", symbolSize: [26, 3], color: css("--ink"), data: gs.map((g, i) => [i, g.median]) },
    ],
  });
}

// ---------------- 个股页：相关瓶颈 ----------------
async function fillBottleneckCard(t) {
  const el = byId("bn-card");
  if (!el) return;
  let d;
  try { d = await bnData(); } catch { return; }
  const key = UNIVERSE_ALIAS[t] || t;
  const hits = (d?.cases || []).flatMap((c) => c.companies.filter((p) => p.ticker === key).map((p) => ({ c, p })));
  if (!hits.length) return;
  el.hidden = false;
  el.innerHTML = `<h3>相关瓶颈（瓶颈 → 股价时滞研究）${badge("derived")}${badge("model")}</h3>
    <div class="table-wrap"><table><thead><tr><th>瓶颈</th><th>首个公开信号</th><th>它的位置</th><th>上涨确认</th><th class="num">时滞</th><th class="num">最大相对涨幅</th><th>五问得分</th></tr></thead>
    <tbody>${hits.map(({ c, p }) => `<tr><td><a href="#/bottleneck?id=${c.id}">${esc(c.name)}</a> <span class="muted">${c.status === "ongoing" ? "仍紧缺" : "已缓解"}</span></td><td>${esc(c.first_signal)}</td>
      <td>${BN_POS[p.position]} · 纯度${BN_PUR[p.purity]} · ${BN_PRICE[p.pricing]}</td><td>${esc(p.t1 || p.status || "–")}</td><td class="num">${days(p.lag_confirm)}</td><td class="num ${cls(p.gain)}">${pct(p.gain, 0, true)}</td><td class="nowrap">${bnScoreText(p.score)}</td></tr>`).join("")}</tbody></table></div>
    <p class="muted small">时滞 = 相对本地大盘涨 30% 的日子 − 瓶颈首个公开信号；事后识别，只描述历史。五问：①瓶颈是否已出现在龙头财报 ②能否提价 ③业务纯度 ④市场视为结构性还是周期性 ⑤上市地与覆盖。<a href="#/claims">这些因素是否真的影响时滞 →</a></p>`;
}

// 说法检验页顶部：最重要的几条发现（由数据算出）
function claimsInsights(d) {
  const ev = d.cases.flatMap((c) => c.companies.filter((p) => p.status === "ok" && isNum(p.lag_start)));
  const lead = ev.filter((p) => p.lag_start < 0).length;
  const pre = d.cases.flatMap((c) => c.companies.map((p) => p.pre_share)).filter(isNum).sort((a, b) => a - b);
  const preMed = pre.length ? pre[Math.floor(pre.length / 2)] : null;
  const out = [{ level: "high", kind: "derived", text: `${lead} / ${ev.length} 个样本的上涨起点早于案例库里能找到的首个公开信号；信号日时，整段相对涨幅（中位数）已完成 ${pct(preMed, 0)}。能查到的公开报道往往落后于股价——要么市场更早从别处看到，要么瓶颈的源头更早（例如 ChatGPT 发布、2022 年电网设备就已紧张）。` }];
  const robust = d.claims.filter((c) => c.robust_all).map((c) => `「${c.title}」${c.verdict}`);
  if (robust.length) out.push({ level: "info", kind: "derived", text: `三种观察窗口下结论都不变的：${robust.join("；")}。其余说法的结论随窗口改变，证据不稳。` });
  return out;
}
