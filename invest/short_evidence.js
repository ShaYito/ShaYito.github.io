/* 个股页“短期证据（已验证）”（P3；数据 short_evidence.json）：P1 大样本检验中按事先标准对未来 1–13 周
   相对表现有预测力的价格信号，这只股票的当前读数与全市场分位。只是倾向，不合成总分、不是买卖建议。
   另：个股页三层分组（短期证据 / 背景 / 证据弱默认收起）与各卡片“短期依据”标签（stockLayers）。 */

let SE_D = null;
async function seData() {
  if (!SE_D) SE_D = await load("short_evidence.json").catch(() => null);
  return SE_D;
}
// 读数的写法与“读数高 / 低时历史上之后怎样”（方向来自检验结果的 IC 符号）
const SE_FMT = {
  mom_12_1: (v) => `${pct(v, 0, true)}（相对 SPY）`,
  mom_6_1: (v) => `${pct(v, 0, true)}（相对 SPY）`,
  rev_1m: (v) => `${pct(v, 1, true)}（相对 SPY）`,
  rev_1w: (v) => `${pct(v, 1, true)}（相对 SPY）`,
  high52: (v) => (v >= 0.999 ? "在 52 周最高点" : `距 52 周最高 ${pct(v - 1, 0)}`),
  resid_1w_z: (v) => `${num(v, 1)} 倍正常波动`,
};
const SE_READ = {
  mom_12_1: ["过去一年明显强于大盘，历史上之后 1–13 周倾向略强", "过去一年明显弱于大盘，历史上之后倾向略弱"],
  mom_6_1: ["过去半年明显强于大盘，历史上之后 1–13 周倾向略强", "过去半年明显弱于大盘，历史上之后倾向略弱"],
  rev_1m: ["近 1 月跌得多，历史上之后 1–4 周倾向小幅反弹", "近 1 月涨得多，历史上之后 1–4 周倾向小幅回吐"],
  rev_1w: ["近 1 周跌得多，历史上之后 1–4 周倾向小幅反弹", "近 1 周涨得多，历史上之后 1–4 周倾向小幅回吐"],
  high52: ["接近 52 周高点，历史上之后 13 周倾向略强", "离 52 周高点较远，历史上之后 13 周倾向略弱"],
  resid_1w_z: ["近 1 周剔除大盘后明显下跌，历史上之后 1–4 周倾向部分回补", "近 1 周剔除大盘后明显上涨，历史上之后 1–4 周倾向部分回吐"],
};
function seTilt(sig, p) {
  if (!isNum(p)) return { cls: "", text: "无数据", fav: null };
  const fav = sig.sign > 0 ? p : 100 - p; // 有利分位：越高越有利
  const [good, bad] = SE_READ[sig.key] || ["", ""];
  if (fav >= 80) return { cls: "pos", text: "偏有利", fav, note: good };
  if (fav <= 20) return { cls: "neg", text: "偏不利", fav, note: bad };
  return { cls: "", text: "中性", fav, note: "处于全市场中间，没有明显倾向" };
}
function seBar(p) {
  if (!isNum(p)) return "–";
  return `<span class="se-bar" title="全市场第 ${num(p, 0)} 分位（0 = 最低，100 = 最高）"><span style="left:${Math.max(0, Math.min(100, p))}%"></span></span> <span class="small">${num(p, 0)}</span>`;
}
function seBasis(sig) {
  return sig.by_h.map((r) => `<div class="${r.verdict === "useful" ? "" : "muted"}" title="${r.verdict === "useful" ? "按事先标准有用" : r.verdict === "weak" ? "方向一致但不显著" : "无效"}">${r.h} 周 ${r.ic >= 0 ? "+" : ""}${num(r.ic, 3)}（t ${num(r.t, 1)}）${r.verdict === "useful" ? " ✓" : ""}</div>`).join("");
}

// “文献支持（本系统未检验）”（M87）：公开研究中对 1–3 个月有一定作用、本系统尚未检验（或在前瞻账本中积累）的证据
async function seLiterature(t, s) {
  if (!s) return "";
  const rows = [];
  const tr = s.earnings_q?.eps_trend?.["+1y"], rv = s.earnings_q?.eps_revisions?.["+1y"];
  if (tr && isNum(tr.current) && isNum(tr.d30) && tr.d30 !== 0) {
    const c = tr.current / Math.abs(tr.d30) - (tr.d30 > 0 ? 1 : -1);
    const up = rv?.up30 ?? 0, dn = rv?.down30 ?? 0;
    const lab = c >= 0.005 ? ["pos", "上调"] : c <= -0.005 ? ["neg", "下调"] : ["", "基本不变"];
    rows.push(["下财年 EPS 预期修正（30 天）", `<span class="${lab[0]}">${pct(c, 1, true)}（${lab[1]}）</span>${up + dn ? `；${up} 家上调 / ${dn} 家下调` : ""}`,
      "分析师上调盈利预测后 1–3 个月倾向延续（Chan, Jegadeesh & Lakonishok 1996 等）；本系统前瞻账本积累中"]);
  }
  const m = {};
  for (const g of s.metrics?.groups || []) for (const it of g.items) m[it.key] = it;
  const sp = m.short_pct_float?.value, dtc = m.days_to_cover?.value;
  if (isNum(sp) || isNum(dtc)) {
    const hi = (isNum(sp) && sp >= 0.1) || (isNum(dtc) && dtc >= 5);
    rows.push(["空头", `${isNum(sp) ? `占流通股 ${pct(sp, 1)}` : ""}${isNum(dtc) ? `，回补约 ${num(dtc, 1)} 天` : ""}${hi ? ' <span class="neg">（偏高）</span>' : ' <span class="muted">（不高）</span>'}`,
      "空头比例 / 回补天数很高的股票之后倾向偏弱（Asquith, Pathak & Ritter 2005；Hong et al. 2016），主要在空头极高时有意义"]);
  }
  const lo = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const buys = (s.insider || []).filter((x) => x.kind === "purchase" && x.date >= lo);
  const sum = buys.reduce((a, x) => a + (x.value || 0), 0);
  rows.push(["内部人公开市场买入（近 90 天）", buys.length ? `<span class="pos">${buys.length} 笔，合计 ${insiderMoney(sum)}</span>（${esc(buys.slice(0, 2).map((x) => x.position || x.insider).join("、"))}）` : '<span class="muted">没有</span>',
    "内部人主动买入之后倾向略强，信号主要来自小盘股与非例行买入（Lakonishok & Lee 2001；Cohen, Malloy & Pomorski 2012）；卖出多为例行，信息量低"]);
  const nx = s.earnings_q?.next?.datetime?.slice(0, 10);
  if (nx) {
    const days = Math.round((new Date(`${nx}T12:00:00Z`) - Date.now()) / 864e5);
    const ev = (await load("home.json").catch(() => null))?.schedule?.find((e) => e.kind === "earnings" && e.ticker === t)?.exp_move;
    rows.push(["下次财报", `${esc(nx)}（${days >= 0 ? `${days} 天后` : "已过"}）${ev ? `；期权预期到 ${esc(ev.expiry)} 波动约 <b>±${pct(ev.move, 1)}</b>` : ""}`,
      "财报前后是个股波动最大的时候；期权隐含波动对之后实际波动的预测较好（Christensen & Prabhala 1998）。只说明幅度，不说明方向"]);
  }
  if (!rows.length) return "";
  return `<h4 style="margin-top:12px">文献支持（本系统未检验） <span class="chip basis-chip evid-mid" title="公开研究中对 1–3 个月有一定作用；本系统尚未检验，EPS 修正等已进入前瞻账本">短期：文献支持</span></h4>
    <div class="table-wrap"><table class="tbl"><tbody>${rows.map(([a, b, c]) => `<tr><td style="width:24%">${a}</td><td style="width:36%">${b}</td><td class="muted small" style="white-space:normal">${c}</td></tr>`).join("")}</tbody></table></div>`;
}

const SE_H_KEY = "invest.se.h";
const SE_PARTS = [
  ["momentum", "中期动量", "过去 6–12 个月相对大盘的强弱（12-1、6-1 月动量）：强的之后倾向略强", "price"],
  ["reversal", "短期回吐", "近 1 周 / 1 月的涨跌：涨多的之后倾向小幅回吐、跌多的小幅反弹", "price"],
  ["eps", "EPS 预期修正", "下财年 EPS 一致预期 30 天变化与上调 / 下调家数（选股池内比较）", "lit"],
  ["short", "空头", "空头占流通股 5% 以下不计，越高扣得越多", "lit"],
  ["insider", "内部人买入", "近 90 天有金额 ≥ $100K 或高管的公开市场买入时加分（小额董事买入不计）", "lit"],
];
function seHorizon(d) {
  const hs = Object.keys(d.score_meta || {});
  let h = d.score_default_h;
  try { h = localStorage.getItem(SE_H_KEY) || h; } catch { /* 忽略 */ }
  return hs.includes(h) ? h : hs[0];
}
// 综合得分块（M88）：总分 = 预期相对全市场平均的表现；各分量按贡献大小画条形（长度可比），不等高
function seScoreBlock(d, t) {
  const h = seHorizon(d);
  const sc = d.scores?.[t]?.[h], m = d.score_meta?.[h];
  if (!sc || !m) return "";
  const parts = SE_PARTS.map(([k, n, tip, kind]) => ({ k, n, tip, kind, v: kind === "price" ? sc[k] : sc.lit?.[k] }));
  // M91：价格分量在中大盘股（≥ $2B）/ 大盘股（≥ $10B）参照池中的单项检验
  const SUBV = d.subsets?.signals || {};
  const grpKeys = { momentum: ["mom_12_1", "mom_6_1"], reversal: ["rev_1m", "rev_1w", "resid_1w_z"] };
  const subOk = (k, tag) => (grpKeys[k] || []).some((x) => SUBV[x]?.[tag]?.[h]?.verdict === "useful");
  const priceChip = (k) => subOk(k, "large") ? '<span class="chip basis-chip evid-strong" title="全市场与大盘股（≥ $10B）检验均有用">已验证（含大盘股）</span>'
    : subOk(k, "mid") ? '<span class="chip basis-chip evid-strong" title="全市场与中大盘股（≥ $2B）检验有用；大盘股（≥ $10B）中方向一致但不显著（样本少）">已验证（中大盘股）</span>'
      : '<span class="chip basis-chip evid-weak" title="全市场检验有用，但在中大盘股（≥ $2B）与大盘股（≥ $10B）中不显著：效果主要来自小盘股">全市场有效，大盘股不显著</span>';
  const mx = Math.max(0.002, ...parts.map((x) => Math.abs(x.v || 0)));
  const bar = (v) => { const w = Math.round((Math.abs(v || 0) / mx) * 50); return `<span class="se-cbar"><span class="${v >= 0 ? "pos-bg" : "neg-bg"}" style="${v >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`}"></span></span>`; };
  const q = m.oos_quintiles || [];
  const hs = Object.keys(d.score_meta);
  return `<div class="se-score">
    <div class="row"><b>短期综合得分</b>${hs.length > 1 ? `<div class="seg" id="se-h">${hs.map((x) => { const L = d.subsets?.score?.[x]?.large; return `<button type="button" data-h="${x}" class="${x === h ? "on" : ""}" title="${L ? (L.ok ? "大盘股样本外通过" : "大盘股样本外未通过") : ""}">${x} 周${L && !L.ok ? " ⚠" : ""}</button>`; }).join("")}</div>` : ""}</div>
    <p style="margin:6px 0">之后 ${h} 周预期相对全市场平均 <b class="${cls(sc.total)}" style="font-size:20px">${pct(sc.total, 2, true)}</b>
      <span class="muted small">（价格部分 ${pct(sc.price, 2, true)}，全市场第 ${num(sc.price_pct, 0)} 分位；文献部分 ${pct(sc.total - sc.price, 2, true)}）</span></p>
    <table class="tbl se-parts"><tbody>${parts.map((x) => `<tr title="${esc(x.tip)}"><td style="width:24%">${esc(x.n)} ${x.kind === "price" ? priceChip(x.k) : '<span class="chip basis-chip evid-mid">文献</span>'}</td>
      <td style="width:46%">${bar(x.v)}</td><td class="num ${cls(x.v)}" style="width:14%">${isNum(x.v) ? pct(x.v, 2, true) : '<span class="muted">无数据</span>'}</td><td class="muted small" style="white-space:normal">${esc(x.tip)}</td></tr>`).join("")}</tbody></table>
    ${(() => { const L = d.subsets?.score?.[h]?.large; if (!L) return "";
      return L.ok ? `<p class="small">✓ 大盘股检验：在当时市值 ≥ $10B 的股票中（与选股池相当），同样的权重 2019 年起样本外 IC ${num(L.ic, 3)}（t ${num(L.t, 1)}），通过。</p>`
        : `<p class="small warn">⚠ 大盘股检验未通过：在当时市值 ≥ $10B 的股票中（与选股池相当），2019 年起样本外 IC ${num(L.ic, 3)}（t ${num(L.t, 1)}），方向一致但不显著。对选股池这类大盘股，${h} 周得分的证据较弱，建议以 1 周得分为主。</p>`; })()}
    <p class="small">全市场样本外检验（2012–2018 年估计权重，2019 年起检验）：得分最高五分之一之后 ${h} 周平均相对 <span class="pos">${pct(q[4], 2, true)}</span>，最低五分之一 <span class="neg">${pct(q[0], 2, true)}</span>（IC ${num(m.oos.mean, 3)}，t ${num(m.oos.t, 1)}）。
      <b>但单只股票 ${h} 周实际表现的标准差约 ±${pct(m.xs_sd, 0)}</b>，得分只解释其中很小一部分：它是在很多只股票上平均才显现的倾向，不能单独决定买卖。</p>
  </div>`;
}

function seSub(d, k, h) {
  const v = d.subsets?.signals?.[k] || {};
  const lab = { useful: "有用", weak: "方向一致但弱", none: "无效" };
  const one = (tag, n) => { const r = v[tag]?.[h]; return r ? `${n} ${lab[r.verdict] || r.verdict}（t ${num(r.t, 1)}）` : `${n} –`; };
  return `${one("mid", "≥$2B")}<br>${one("large", "≥$10B")}`;
}
async function fillShortEvidence(t, s) {
  const el = byId("se-card");
  const d = await seData();
  const r = d?.available ? d.stocks?.[t] : null;
  if (!el || !r) return;
  el.hidden = false;
  const h = seHorizon(d), m = d.score_meta?.[h];
  const w = m?.weights || {};
  const rows = d.signals.map((sig) => ({ sig, v: r[sig.key]?.v, p: r[sig.key]?.pct, tilt: seTilt(sig, r[sig.key]?.pct) }));
  const wCell = (k) => (w[k] ? `${w[k] > 0 ? "+" : "−"}${num(Math.abs(w[k]) * 100, 2)}%` : '<span class="muted" title="与其他信号重复或在该期限无效，不另计权重">不计</span>');
  el.innerHTML = `<h3>短期证据 ${badge("fact")}${badge("derived")}</h3>
    ${seScoreBlock(d, t)}
    <details class="small"><summary>各信号读数与权重（${rows.length} 项已验证价格信号）</summary>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>证据</th><th>当前读数</th><th>全市场分位</th><th>倾向</th><th title="每高 1 个标准差（正态分数），之后 ${h} 周预期相对表现变化多少；多元回归已扣除信号之间的重叠">权重（${h} 周）</th><th title="${(d.test.stocks || 0).toLocaleString()} 只美股，${esc(d.test.start?.slice(0, 4) || "")} 年起每周截面">全市场检验 IC（t）</th><th title="同样的事先标准，只用当时市值 ≥ $2B / ≥ $10B 的股票（M91）">中大盘 / 大盘股（${h} 周）</th></tr></thead>
    <tbody>${rows.map(({ sig, v, p, tilt }) => `<tr><td title="${esc(sig.name)}">${esc(sig.name.replace(/（[^）]*）/g, ""))}</td><td>${isNum(v) ? (SE_FMT[sig.key] || ((x) => num(x, 2)))(v) : "–"}</td><td>${seBar(p)}</td>
      <td><span class="${tilt.cls}"><b>${tilt.text}</b></span><div class="muted small">${esc(tilt.note || "")}</div></td><td class="num">${wCell(sig.key)}</td><td class="small">${seBasis(sig)}</td><td class="small">${seSub(d, sig.key, h)}</td></tr>`).join("")}</tbody></table></div>
    </details>
    ${await seLiterature(t, s)}
    <p class="small"><a href="#/evidence">全部证据的检验结果（含选股池前瞻账本） →</a></p>
    <details class="small"><summary>得分怎么算、局限</summary>
      <p><b>价格部分</b>（已验证）：每个信号先换算成在全市场的位置（正态分数），乘以权重后相加。权重来自 2,500+ 只美股、2012 年起每周的多元回归（Fama-MacBeth），同时放进所有信号，<b>自动扣除彼此重叠的部分</b>（例如近 1 周涨跌与剔除 β 的一周倍数几乎重复，只计一次）；只用该期限经事先检验有用的信号，方向与单项检验一致。13 周的综合得分未通过样本外检验，不显示。</p>
      <p><b>文献部分</b>（本系统未检验）：EPS 预期修正、空头、内部人买入的权重 = 假定 IC（取文献常见水平的约一半：${Object.entries(d.lit_ic || {}).map(([k, v]) => `${({ eps: "EPS 修正", short: "空头", insider: "内部人" })[k] || k} ${v}`).join("、")}）× 该期限单只股票表现的离散程度；EPS 修正只能在选股池内比较。这些项已进入证据前瞻账本，之后用实际数据检验、再调整权重。财报期权预期波动不分方向，不计入得分。</p>
      <p><b>局限</b>：股票池是现在仍上市的公司（幸存者偏差）；未扣交易成本；预测的是相对全市场平均，不预测大盘涨跌；“全市场分位”的分布每周更新（截至 ${esc(d.dist_asof)}），个股读数每天更新（截至 ${esc(d.asof)}）。</p>
    </details>`;
  byId("se-h")?.querySelectorAll("button").forEach((b) => (b.onclick = () => {
    try { localStorage.setItem(SE_H_KEY, b.dataset.h); } catch { /* 忽略 */ }
    fillShortEvidence(t, s);
  }));
}

// 总览“短期综合得分：最高 / 最低”（M88，替代 M87 的“极端名单”）：选股池按综合得分排序，各列前 6 只
async function fillShortExtremes(held) {
  const el = byId("se-home");
  const d = await seData();
  if (!el || !d?.available || !d.scores) return;
  const h = seHorizon(d), m = d.score_meta?.[h];
  if (!m) return;
  const rows = Object.entries(d.scores).filter(([, v]) => v[h]).map(([t, v]) => ({ t, ...v[h] }));
  rows.sort((a, b) => b.total - a.total);
  const main = (x) => { const ps = SE_PARTS.map(([k, n, , kind]) => [n, kind === "price" ? x[k] : x.lit?.[k]]).filter(([, v]) => isNum(v) && v !== 0);
    ps.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])); return ps.slice(0, 2).map(([n, v]) => `${n} ${pct(v, 2, true)}`).join("、"); };
  const li = (x) => `<li><a href="#/stock/${esc(x.t)}"><b>${esc(x.t)}</b></a> <span class="muted">${esc(META.names_zh?.[x.t] || "")}</span>${held.has(x.t) ? ' <span class="chip holding">持有</span>' : isPlanned(x.t) ? ' <span class="chip">计划</span>' : ""}
    <b class="${cls(x.total)}">${pct(x.total, 2, true)}</b> <span class="small muted">${esc(main(x))}</span></li>`;
  const n = 6;
  el.hidden = false;
  el.innerHTML = `<h3>短期综合得分：选股池最高 / 最低（之后 ${h} 周） ${badge("derived")} <span class="chip basis-chip evid-strong" title="价格部分经全市场样本外检验；文献部分为假定权重">短期：已验证 + 文献</span></h3>
    <div class="grid two"><div><h4 class="pos">最高</h4><ul class="plain">${rows.slice(0, n).map(li).join("")}</ul></div>
      <div><h4 class="neg">最低</h4><ul class="plain">${rows.slice(-n).reverse().map(li).join("")}</ul></div></div>
    <p class="muted small">得分 = 之后 ${h} 周预期相对全市场平均的表现（截至 ${esc(d.asof)}），后面列出贡献最大的两项。历史上全市场得分最高与最低五分之一相差约 ${pct((m.oos_quintiles[4] - m.oos_quintiles[0]), 1)}，而单只股票的实际结果标准差约 ±${pct(m.xs_sd, 0)}：只是倾向，不是买卖信号。<a href="#/evidence">检验结果 →</a></p>`;
}

// ---------- 个股页“价格风险”（M91；数据 risk_scores.json）：估计之后的波动与回撤幅度，用于仓位，不预测涨跌 ----------
const RISK_PARTS = [
  ["vol", "近 1 年波动（年化）", (v) => pct(v, 0)],
  ["mdd", "近 1 年最大回撤", (v) => `−${pct(v, 0)}`],
  ["dbeta", "下行 β（只看大盘下跌日）", (v) => num(v, 2)],
  ["vol3m", "近 3 个月波动（年化）", (v) => pct(v, 0)],
];
// 拥挤度（M92 / M95，描述性参考）：近期是否像“彩票股”一样被追捧、资金是否涌入；检验未达事先标准，只作参考
const CROWD_PARTS = [
  ["max5", "近 1 月最大 5 日涨幅均值", (v) => pct(v, 1, true)],
  ["ivol", "特质波动（日，剔除大盘）", (v) => pct(v, 1)],
  ["skew", "近 3 月收益偏度", (v) => num(v, 2)],
  ["ext", "偏离 200 日均线", (v) => pct(v, 0, true)],
  ["turn", "近 1 月日均换手率（成交额 ÷ 市值）", (v) => pct(Math.exp(v), 2)],
  ["abturn", "换手率相对此前一年", (v) => `${num(Math.exp(v), 2)} 倍`],
  ["comove", "与同行业同涨同跌（相对此前一年的变化）", (v) => num(v, 2, true)],
];
function crowdSection(d, r, s) {
  const c = r.crowd;
  const ev = d.crowd_evidence || {}, W = ev.weighted;
  const useW = W && isNum(c?.scorew_pct); // M98：按显著度加权（金融股不在参照池，仍用四项价格类第一版）
  const sp = useW ? c.scorew_pct : c?.score_pct;
  if (!c || !isNum(sp)) return "";
  const dd1 = (ev.tests?.crowd || {}).drawdown || ev.drawdown || {};
  const m = {};
  for (const g of s?.metrics?.groups || []) for (const it of g.items) m[it.key] = it.value;
  const top = sp >= 80;
  const wt = (k) => (useW ? W.weights?.[k] || 0 : null);
  const parts = CROWD_PARTS.filter(([k]) => isNum(c.raw?.[k])).sort((x, y) => (useW ? wt(y[0]) - wt(x[0]) : 0));
  const oo = W?.oos?.weighted || {};
  const chip = useW && W.oos_ok
    ? '<span class="chip basis-chip evid-strong">已验证（回撤风险）</span>'
    : `<span class="chip basis-chip evid-weak" title="样本外（2019 年起）最拥挤 20% 之后半年跌超 40% 的概率约为同等价格风险股票的 ${num(oo.ratio, 2)} 倍（t ${num(oo.t, 1)}），未达事先标准 1.5 倍">未达事先标准</span>`;
  const wcell = (k) => {
    if (!useW) return "";
    const it = W.items?.[k] || {};
    return `<td class="num small">${wt(k) > 0 ? `<b>${pct(wt(k), 0)}</b>` : '<span class="muted">0</span>'}</td><td class="muted small">t ${num(it.t, 1)}${(it.t || 0) < 0 ? "（方向相反）" : ""}</td>`;
  };
  return `<h4 style="margin-top:12px">拥挤度（参考） ${chip}</h4>
    <p class="small">在大盘股中排第 <b>${num(sp, 0)}</b> 分位${top ? '：<b class="neg">处于最拥挤的 20%</b>' : ""}。<span class="muted">${top ? `历史上这一组之后半年跌超 40% 的概率约为同等价格风险股票的 ${num(useW ? oo.ratio : dd1.ratio, 2)} 倍${useW ? "（2019 年起样本外）" : ""}。` : "不在最拥挤的 20%。"}</span></p>
    <div class="table-wrap"><table class="tbl small">${useW ? '<thead><tr><th>指标（按显著度排序）</th><th class="num">读数</th><th></th><th>大盘股中</th><th class="num">权重</th><th>显著度</th></tr></thead>' : ""}<tbody>${parts.map(([k, n, f]) => `<tr${useW && !wt(k) ? ' class="muted"' : ""}><td style="width:28%">${n}</td><td class="num" style="width:14%">${f(c.raw[k])}</td><td style="width:18%">${seBar(c.pct[k])}</td><td class="muted">${isNum(c.pct[k]) ? `第 ${num(c.pct[k], 0)} 分位` : "–"}</td>${wcell(k)}</tr>`).join("")}
      ${isNum(m.short_pct_float) ? `<tr><td>空头占流通股（无历史数据，未检验）</td><td class="num">${pct(m.short_pct_float, 1)}</td><td></td><td class="muted">10% 以上算偏高</td>${useW ? "<td></td><td></td>" : ""}</tr>` : ""}</tbody></table></div>
    <p class="muted small">${useW
      ? `拥挤度 = 各项在大盘股中的位置（正态分数）按显著度加权平均。显著度 = 该项最高 20% 的股票之后半年跌超 40% 的概率，比价格风险（四项）相同的股票高出多少的 t 值；t ≤ 0 的项权重为 0（偏度在控制波动后方向相反：右偏的股票反而更少大跌）。权重用 2012 年起全部数据估计、每周更新。检验：只用 2012–2018 年估计权重、2019 年起样本外，加权分最拥挤 20% 约为 ${num(oo.ratio, 2)} 倍（t ${num(oo.t, 1)}），等权约 ${num(W.oos?.equal?.ratio, 2)} 倍——加权更好，但未达事先定的 1.5 倍标准，所以仍只作参考、不计入任何分数。对之后 1–3 个月的收益没有预测力。换手率与同行业两项每周更新（截至 ${ev.dist_asof || "–"}）。`
      : `拥挤度 = 四项价格类在大盘股中的位置等权平均（MAX、特质波动、偏度、偏离均线）；金融股不在参照池，没有换手率与同行业两项，也不做加权。检验：对之后半年大幅回撤约 ${num(dd1.ratio, 2)} 倍的额外提示，未达 1.5 倍标准，只作参考。`}${srcNote(d.risk_source)}</p>`;
}
// M97：特质波动多出的回撤提示来自哪里（读数来自 risk_source_large.json）
function srcNote(rs) {
  const p = rs?.part1;
  if (!p?.v_mkt || !p?.v_ind) return "";
  return `<br>其中特质波动一项：在价格风险之外约 ${num(p.v_mkt.ratio, 2)} 倍，再控制近 3 个月总波动后约 ${num(p.v_mkt.ratio_vtot, 2)} 倍——有一部分只是“近期波动更大”（价格风险已加入近 3 个月波动）；再剔除同行业的共同波动后降到 ${num(p.v_ind.ratio_vtot, 2)} 倍——剩下的提示有相当一部分来自整个板块一起大起大落，而不是公司自身。`;
}

async function fillRiskCard(t, s) {
  const el = byId("risk-card");
  const d = await load("risk_scores.json").catch(() => null);
  const r = d?.available ? d.stocks?.[t] : null;
  if (!el || !r || !isNum(r.score_pct)) return;
  el.hidden = false;
  const p = r.score_pct;
  const lv = p >= 80 ? ["neg", "高"] : p >= 60 ? ["", "偏高"] : p >= 40 ? ["", "中等"] : p >= 20 ? ["", "偏低"] : ["pos", "低"];
  const ev = d.evidence || {};
  const four = (d.keys || []).includes("vol3m");
  const e1 = (four && ev["risk4:fvol"]) || ev["risk:fvol"], e2 = (four && ev["risk4:fdd"]) || ev["risk:fdd"];
  const parts = RISK_PARTS.filter(([k]) => k !== "vol3m" || four);
  el.innerHTML = `<h3>价格风险 ${badge("derived")}</h3>
    <p>在当前市值 ≥ $${num((d.min_cap || 1e10) / 1e9, 0)}B 的 ${(d.dist_n || 0).toLocaleString()} 只美股中排第 <b>${num(p, 0)}</b> 分位：风险<b class="${lv[0]}">${lv[1]}</b>
      <span class="muted small">（0 = 最稳，100 = 波动最大）</span> ${seBar(p)}</p>
    <div class="table-wrap"><table class="tbl"><tbody>${parts.map(([k, n, f]) => `<tr><td style="width:30%">${n}</td><td class="num" style="width:18%"><b>${isNum(r.raw[k]) ? f(r.raw[k]) : "–"}</b></td>
      <td style="width:22%">${seBar(r.pct[k])}</td><td class="muted small" style="white-space:normal">${isNum(r.pct[k]) ? `大盘股中第 ${num(r.pct[k], 0)} 分位` : "数据不足（上市不满约 2 年）"}</td></tr>`).join("")}</tbody></table></div>
    <p class="small">怎么用：<b>用来决定仓位大小和能承受的波动，不预测涨跌。</b>风险越高，同样金额的仓位带来的账户波动越大；按“近 1 年波动”粗略估计，正常情况下一个月的涨跌幅度约为 ±${isNum(r.raw.vol) ? pct(r.raw.vol / Math.sqrt(12), 0) : "–"}（一个标准差）。</p>
    ${crowdSection(d, r, s)}
    <details class="small"><summary>检验与读法</summary>
      <p>检验（当时市值 ≥ $10B 的美股，2012 年起每周）：综合分与之后 3 个月实际波动的排序相关 ${e1 ? `${num(e1.ic, 2)}（t ${num(e1.t, 0)}）` : "–"}、与之后半年最大回撤 ${e2 ? `${num(e2.ic, 2)}（t ${num(e2.t, 0)}）` : "–"}，2019 年前后都稳定——波动有很强的持续性，这是比预测涨跌可靠得多的事。单项中“近 1 年波动”最强。${four && ev["risk4:fvol"] ? `2026-10-20 起加入“近 3 个月波动”：两个排序相关分别从 ${num(ev["risk4:fvol"].ic3, 2)} / ${num(ev["risk4:fdd"]?.ic3, 2)} 提高到 ${num(ev["risk4:fvol"].ic, 2)} / ${num(ev["risk4:fdd"]?.ic, 2)}，前后两段都提高（事先标准：都提高 ≥ 0.02）——近期波动比一年平均更能反映接下来的风险。` : ""}</p>
      <p>综合分 = ${four ? "四" : "三"}项各自在参照池中的位置（正态分数）等权平均。下行 β = 只用大盘下跌的日子估计的 β，衡量大盘跌时它跌多少（Ang, Chen & Xing 2006）。分布每周更新（截至 ${esc(d.dist_asof)}），个股读数每天更新（截至 ${esc(d.asof)}）。</p>
      <p>局限：突发事件（财报、监管、并购）带来的跳跃无法从过去的波动里看出——财报前后的幅度见上方“财报”与“期权预期波动”。</p>
    </details>`;
}

// Nasdaq 板块名 → 中文（质量画像、股本变化等同板块比较的卡片用）
const SE_SECTOR_ZH = { Technology: "科技", "Consumer Discretionary": "可选消费", "Consumer Staples": "必需消费", Industrials: "工业",
  "Health Care": "医疗", Utilities: "公用事业", Energy: "能源", "Basic Materials": "原材料", Telecommunications: "电信",
  Finance: "金融", "Real Estate": "房地产" };
const sectorZh = (x) => (x ? `${SE_SECTOR_ZH[x] || x}板块` : "同板块");

// ---------- 个股页“质量画像”（M91；数据 quality_profile.json）：同板块大盘股中的位置，描述性（检验未通过，不给综合分）----------
const QP_ITEMS = {
  gpa: ["毛利 ÷ 总资产", (v) => pct(v, 0), "high", "每 1 美元资产带来多少毛利（Novy-Marx 2013）"],
  opa: ["营业利润 ÷ 总资产", (v) => pct(v, 0), "high", "近 4 季营业利润相对资产规模"],
  mstd: ["营业利润率波动", (v) => `${num(v * 100, 1)} 个百分点`, "low", "近 12 季营业利润率的标准差：越低越稳定"],
  accr: ["应计", (v) => pct(v, 1, true), "low", "（净利润 − 经营现金流）÷ 总资产：越高说明利润中没变成现金的部分越多（Sloan 1996）"],
  lev: ["负债 ÷ 总资产", (v) => pct(v, 0), "low", "大量回购也会推高账面负债率，不一定代表风险高"],
};
async function fillQualityCard(t) {
  const el = byId("qp-card");
  const d = await load("quality_profile.json").catch(() => null);
  const r = d?.available ? d.stocks?.[t] : null;
  if (!el || !r) return;
  el.hidden = false;
  const verdict = (k) => { const x = d.tests?.[k]?.["52"]; return x ? `12 个月 IC ${x.ic >= 0 ? "+" : ""}${num(x.ic, 3)}（t ${num(x.t, 1)}）` : "–"; };
  el.innerHTML = `<h3>质量画像（同板块比较） ${badge("derived")}</h3>
    <p class="small muted">在${esc(sectorZh(r.sector))}的大盘股（当时市值 ≥ $10B）中的位置。<b>这些指标对之后 6–12 个月相对收益的预测力很弱或不稳定</b>，目前只用来了解公司的盈利能力、稳定性与资产负债结构。</p>
    <div class="table-wrap"><table class="tbl"><tbody>${Object.entries(QP_ITEMS).map(([k, [n, f, good, tip]]) => { const it = r.items[k] || {};
      return `<tr title="${esc(tip)}"><td style="width:24%">${n} <span class="muted small">（${good === "high" ? "越高越好" : "越低越好"}）</span></td><td class="num" style="width:16%"><b>${isNum(it.raw) ? f(it.raw) : "–"}</b></td>
        <td style="width:22%">${seBar(it.pct)}</td><td class="muted small" style="white-space:normal">${isNum(it.pct) ? `同板块第 ${num(it.pct, 0)} 分位` : "无数据"} · 检验 ${verdict(k)}</td></tr>`; }).join("")}</tbody></table></div>
    <details class="small"><summary>检验与局限</summary>
      <p>检验（当时市值 ≥ $10B 的美股，2012 年起每周，同板块内比较；事先标准同短期证据）：2026-10-20 修复市值数据（此前约 3% 的大公司被错误排除在参照池外）后重测，毛利 ÷ 总资产（12 个月 t 2.1）与利润率稳定性（t 3.3）按事先标准达到“有用”，但五等分不单调、科技股中很弱，且 ≥ $2B 的股票中都不成立（修复前两项也都未通过），结论不稳定；应计无效；负债率方向与预期相反（负债高的之后反而更好）；质量综合未通过（t 1.8）。</p>
      <p>数据：资产负债表与年度毛利来自 SEC XBRL frames（返回最后申报值，可能经修订），一律按期末后 90 天才计入；利润与现金流为首次披露口径。约一半公司不披露毛利科目（用收入 − 营业成本补），外国公司与银行保险不计算。数据截至 ${esc(d.asof)}，每周日自动更新（SEC 财务数据约每月刷新一次）。</p>
    </details>`;
}

// ---------- 个股页“与你持仓的关系”（M92，分散度；在浏览器内按你的持仓计算，持仓不离开本机）----------
function seCorr(a, b) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < a.length; i++) {
    if (!isNum(a[i]) || !isNum(b[i])) continue;
    n++; sa += a[i]; sb += b[i]; saa += a[i] * a[i]; sbb += b[i] * b[i]; sab += a[i] * b[i];
  }
  if (n < 30) return null;
  const cov = sab / n - (sa / n) * (sb / n), va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
  return va > 0 && vb > 0 ? { corr: cov / Math.sqrt(va * vb), beta: cov / vb, n } : null;
}
async function fillDiversityCard(t) {
  const el = byId("dv-card");
  if (!el) return;
  const { raw } = await simData().catch(() => ({}));
  if (!raw?.close?.[t]) return;
  const N = 252, L = raw.dates.length, i0 = L - N;
  const ret = (tk) => { const c = raw.close[tk]; if (!c) return null; const out = []; for (let i = i0; i < L; i++) out.push(isNum(c[i]) && isNum(c[i - 1]) ? c[i] / c[i - 1] - 1 : null); return out; };
  const mine = typeof cmpMyWeights === "function" ? cmpMyWeights(raw) : null;
  const held = mine ? Object.entries(mine).filter(([tk, w]) => w > 0 && tk !== t && raw.close[tk]) : [];
  let weights, refName;
  if (held.length) { weights = Object.fromEntries(held); refName = "你的持仓（不含本股，按市值加权）"; }
  else {
    const ai = META.universe.filter((u) => ["semiconductors", "ai_infrastructure", "cloud_ai_platforms"].includes(u.theme) && u.ticker !== t && raw.close[u.ticker]).map((u) => u.ticker);
    weights = Object.fromEntries(ai.map((x) => [x, 1 / ai.length])); refName = "AI 股等权组合（未录入持仓时的参照）";
  }
  const rs = Object.fromEntries(Object.keys(weights).map((tk) => [tk, ret(tk)]));
  const wsum = Object.values(weights).reduce((a, b) => a + b, 0);
  const port = [];
  for (let k = 0; k < N; k++) { let s = 0, w = 0; for (const [tk, wt] of Object.entries(weights)) { const v = rs[tk]?.[k]; if (isNum(v)) { s += v * wt; w += wt; } } port.push(w > 0 ? (s / w) : null); }
  const me = ret(t);
  const all = seCorr(me, port);
  if (!all) return;
  const downIdx = port.map((v, k) => (isNum(v) && v < 0 ? k : -1)).filter((k) => k >= 0);
  const dn = seCorr(downIdx.map((k) => me[k]), downIdx.map((k) => port[k]));
  // 加入 5% 仓位后组合年化波动的变化（现有持仓按比例缩到 95%；未录入持仓时按参照组合计算）
  const sd = (xs) => { const v = xs.filter(isNum); const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) * Math.sqrt(252); };
  const cash = held.length ? 1 - wsum : 0;
  const pFull = port.map((v) => (isNum(v) ? v * (1 - cash) : null));
  const pNew = pFull.map((v, k) => (isNum(v) && isNum(me[k]) ? v * 0.95 + me[k] * 0.05 : null));
  const dVol = sd(pNew) - sd(pFull);
  const pairs = Object.keys(weights).map((tk) => [tk, seCorr(me, rs[tk])?.corr, weights[tk]]).filter(([, c]) => isNum(c)).sort((a, b) => b[1] - a[1]);
  const tags = (x) => META.universe.find((u) => u.ticker === x)?.tags || [];
  const myTag = tags(t)[0];
  const sameTag = held.length && myTag ? held.filter(([tk]) => tags(tk)[0] === myTag).reduce((a, [, w]) => a + w, 0) : null;
  const lv = (c) => (c >= 0.7 ? ["neg", "高度同涨同跌"] : c >= 0.4 ? ["", "中等相关"] : c >= 0 ? ["pos", "低相关"] : ["pos", "负相关（有对冲作用）"]);
  const [lc, lt] = lv(all.corr);
  const ev = (await load("risk_scores.json").catch(() => null))?.crowd_evidence?.persistence || {};
  el.hidden = false;
  el.innerHTML = `<h3>与你持仓的关系（分散度） ${badge("derived")} <span class="chip basis-chip evid-strong" title="过去一年的相关性对之后 3 个月相关性的预测：大盘股中排序相关 ${num(ev.corr?.mean, 2)}（t ${num(ev.corr?.t, 0)}）">相关性：已验证可持续</span></h3>
    <p>与${refName}近 1 年日收益相关 <b class="${lc}">${num(all.corr, 2)}</b>：${lt}；相对它的 β ${num(all.beta, 2)}。</p>
    <div class="kpis">
      <div class="kpi"><span class="muted">组合下跌日的相关</span><b>${dn ? num(dn.corr, 2) : "–"}</b><span class="muted small">只看组合下跌的 ${downIdx.length} 天（参考：可持续性较弱）</span></div>
      <div class="kpi"><span class="muted">加入 5% 仓位后组合波动</span><b class="${dVol > 0 ? "neg" : "pos"}">${dVol >= 0 ? "+" : "−"}${num(Math.abs(dVol) * 100, 2)} 个百分点</b><span class="muted small">年化，现有 ${num(sd(pFull) * 100, 1)}%</span></div>
      ${sameTag != null ? `<div class="kpi"><span class="muted">持仓中同一主要业务</span><b>${pct(sameTag, 0)}</b><span class="muted small">${esc(META.tags?.[myTag]?.name || myTag || "")}</span></div>` : ""}
    </div>
    <p class="small">相关最高的${held.length ? "持仓" : "参照股票"}：${pairs.slice(0, 4).map(([tk, c, w]) => `<a href="#/stock/${esc(tk)}">${esc(tk)}</a> ${num(c, 2)}${held.length ? `（占 ${pct(w, 0)}）` : ""}`).join("、")}</p>
    <details class="small"><summary>怎么读与依据</summary>
      <p>相关越高，这只股票和你已有的东西越容易同涨同跌，加仓带来的分散作用越小；“加入 5% 仓位后组合波动”直接回答“买它会让账户更稳还是更晃”（现有持仓按比例缩到 95% 后加入本股 5%，用近 1 年日收益计算）。</p>
      <p>依据：组合理论（Markowitz 1952）；下跌时相关性往往升高（Longin & Solnik 2001）——所以单独列出组合下跌日的相关。本系统检验（当时市值 ≥ $10B，2012 年起）：过去一年的相关对之后 3 个月相关的排序相关 ${num(ev.corr?.mean, 2)}（前后两段都约 0.6），可持续；下行相关 ${num(ev.down_corr?.mean, 2)}，可持续性较弱，只作参考。</p>
      <p>持仓只在你的浏览器里计算，不上传。${held.length ? "" : "录入持仓（我的持仓 → 交易记录）或解锁个人版后，这里会改为按你的实际持仓计算。"}</p>
    </details>`;
}

// ---------- 个股页“股本变化（回购 / 增发）”（M93）：大盘股中按事先标准通过的资本配置指标（期限 6–12 个月）----------
async function fillIssueCard(t) {
  const el = byId("iss-card");
  const d = await load("issuance.json").catch(() => null);
  const r = d?.available ? d.stocks?.[t] : null;
  if (!el || !r) return;
  el.hidden = false;
  const e26 = d.evidence?.["26"], q = e26?.quintiles || [];
  const p = r.buyback_pct;
  const lv = !isNum(p) ? "" : p >= 80 ? '<b class="pos">回购力度在同板块前 20%</b>' : p <= 20 ? '<b class="neg">增发 / 稀释在同板块前 20%</b>' : "处于同板块中间";
  el.innerHTML = `<h3>股本变化（回购 / 增发） ${badge("derived")}</h3>
    <p>近 1 年股本 <b class="${r.raw < 0 ? "pos" : r.raw > 0.01 ? "neg" : ""}">${pct(Math.expm1(r.raw), 1, true)}</b>（按拆股调整；负数 = 净回购）${isNum(p) ? `，回购程度在${esc(sectorZh(r.sector))}的大盘股中排第 <b>${num(p, 0)}</b> 分位 ${seBar(p)}` : ""}。${lv}。</p>
    <p class="small">检验（当时市值 ≥ $10B 的美股，2012 年起，同板块比较；事先标准同短期证据）：股本变化越少，之后 6 个月相对表现越好，IC ${e26 ? `${num(e26.ic, 3)}（t ${num(e26.t, 1)}）` : "–"}，按事先标准有用；≥ $2B 中 6 个月与 12 个月都有用。效应集中在回购最多的五分之一（之后 6 个月平均约 ${q.length ? pct(q[4], 1, true) : "+1.5%"}，其余各组差别小）。</p>
    <details class="small"><summary>依据与局限</summary>
      <p>依据：公司增发后股价往往偏弱、回购后偏强（Pontiff & Woodgate 2008；Daniel & Titman 2006；Ikenberry, Lakonishok & Vermaelen 1995）——管理层倾向在股价高估时增发、低估时回购。本系统检验了总资产增速、资本支出强度与资本配置综合，都未通过，只有这一项通过。</p>
      <p>局限：期限是 6–12 个月，不适合 1–4 周的判断；员工股票激励会持续增加股本（回购部分抵消）；并购换股会让股本突然增加；股本来自 SEC 申报（按拆股调整），外国公司与部分多类股公司没有数据。数据截至 ${esc(d.asof)}，每周日自动更新（SEC 财务数据约每月刷新一次）。</p>
    </details>`;
}

/* ---------- 个股页三层分组与“短期依据”标签 ---------- */
// [标题开头, 标签类, 标签文字, 悬停说明]；按卡片标题（h3 文本）开头匹配
const EVIDENCE_BASIS = [
  ["短期证据", "evid-strong", "短期：已验证", "P1 大样本检验按事先标准有用"],
  ["与你持仓的关系", "evid-strong", "组合：已验证", "过去一年的相关性对之后 3 个月相关性有较强预测力（大盘股 IC 约 0.6）；用于判断分散作用"],
  ["价格风险", "evid-strong", "风险：已验证", "与之后 3 个月实际波动的排序相关约 0.7、与之后半年最大回撤约 0.5（大盘股，2012 年起）；用于仓位，不预测涨跌"],
  ["相对大盘走势", "evid-strong", "短期：部分已验证", "近 1 周剔除 β 的明显异动之后 1–4 周倾向部分回吐（已验证，反向）；近 3 月剔除 β 累计经检验无效"],
  ["价格走势", "", "描述", "事实与标注，本身不是预测信号"],
  ["财报与预期", "evid-mid", "短期：事件风险", "财报日是 1 周 – 3 个月内最大的单一事件；EPS 意外后的漂移（PEAD）经检验 2019 年后已消失"],
  ["财报前后表现", "evid-mid", "短期：事件波动参考", "用来估计财报日可能的波动幅度；跳动之后是否继续同方向经检验无效（PEAD）"],
  ["分析师预期修正", "evid-mid", "短期：文献支持", "公开研究中 1–3 个月较稳健的信号之一；本系统 EPS 快照从 2026-10 开始积累，尚未检验"],
  ["同行财报追踪", "", "描述", "同行财报对本股的影响，需要结合判断"],
  ["现金跑道", "evid-mid", "风险参考", "再融资（增发）是小盘股真实的短期风险，但不是涨跌预测"],
  ["现状与展望", "", "AI 归纳", "AI 根据证据包整理的叙述，流畅不等于可靠；以证据编号核对"],
  ["最近", "", "描述（未检验）", "按本股走势切分的最近几轮，样本少，容易读出不存在的规律"],
  ["关键指标", "", "背景", "理解公司现状；对 1–3 个月涨跌没有直接预测力"],
  ["估值与利润率", "", "背景", "估值是年级别变量；低分位不代表短期会涨，强周期股方向相反"],
  ["质量画像", "evid-weak", "背景（已检验：不预测收益）", "大盘股中五项与综合都未通过收益预测检验，只作描述"],
  ["股本变化", "evid-strong", "已验证（6–12 个月）", "大盘股中股本变化（越少越好）6 个月按事先标准有用；期限长于 1–3 个月"],
  ["同行对比雷达", "", "背景", "选股池内相对排名，掩盖量级差异"],
  ["业务", "", "背景", ""],
  ["信息透明度", "", "背景", ""],
  ["AI 基础设施", "", "背景", ""],
  ["相关瓶颈", "evid-weak", "背景（案例事后挑选）", "公开报道整体落后于股价；买入回测的短期优势来自事后整理的案例库"],
  ["内部人", "evid-weak", "文献：弱", "大盘股样本很少，信息量有限"],
  ["散户热度", "evid-weak", "文献：弱、偏反向", "关注度突增后短期偏反转；数据含机器人帖"],
  ["转折点", "", "描述", "事后识别与归因，非因果证明"],
  ["分散作用", "evid-mid", "组合风险", "与 AI 股的相关性；抛售时相关性会升高"],
  ["📌", "evid-against", "未通过多重比较校正", "按事先标准不算规律（q 0.71），期限 12 个月，超出 1–3 个月"],
  ["FCF 收益率上升期", "evid-against", "短期：已检验很弱", "阶段标签 1 周近似抛硬币；仅 A−B 类 13 周约 +1.8%"],
  ["分析师目标价", "evid-against", "短期：已检验无效", "目标价变动 1 / 4 周 IC≈0；机构准确度无持续性"],
  ["新闻情绪", "evid-against", "短期：已检验无效", "与下周相对收益相关 0.004；情绪跟着股价走"],
  ["每日新闻情绪", "evid-against", "短期：已检验无效", "与下周相对收益相关 0.004；情绪跟着股价走"],
  ["相关事件", "", "描述", "近期新闻事件；“利好 / 利空”为 AI 判断"],
];
const FOLD_KEY = "invest.stock.foldWeak";
function foldWeakOn() { try { return localStorage.getItem(FOLD_KEY) !== "0"; } catch { return true; } }
function layerTitle(id, text, note, fold) {
  return `<h3 class="section-title" id="${id}">${text} <span class="muted small">${note}</span>${fold ? ` <button class="ghost sm" id="fold-weak-btn"></button>` : ""}</h3>`;
}
function basisChips(main) {
  main.querySelectorAll(":scope > section.card > h3, :scope > .grid > section.card > h3").forEach((h) => {
    if (h.querySelector(".basis-chip")) return;
    const text = h.textContent.trim();
    const m = EVIDENCE_BASIS.find(([p]) => text.startsWith(p));
    if (m) h.insertAdjacentHTML("beforeend", ` <span class="chip basis-chip ${m[1]}" title="${esc(m[3])}">${esc(m[2])}</span>`);
  });
}
// 渲染后调用：给弱证据层的卡片加 weak 类、绑定收起按钮；异步填充的卡片在填充后再补标签
function stockLayers() {
  const main = document.querySelector(".stock-main");
  if (!main) return;
  let weak = false;
  [...main.children].forEach((el) => {
    if (el.id === "layer-weak") weak = true;
    else if (weak && el.matches("section.card")) el.classList.add("weak");
  });
  const btn = byId("fold-weak-btn");
  const apply = () => {
    const on = foldWeakOn();
    main.classList.toggle("fold-weak", on);
    if (btn) btn.textContent = on ? "展开 ▾" : "收起 ▴";
    window.dispatchEvent(new Event("resize")); // 收起时初始化的图表宽度为 0，展开后重算
  };
  if (btn) btn.onclick = () => { try { localStorage.setItem(FOLD_KEY, foldWeakOn() ? "0" : "1"); } catch { /* 忽略 */ } apply(); buildSectionNav(); };
  apply();
  basisChips(main);
  if (!main._basisObs) { // 异步卡片（hidden → 显示、内容替换）填充后补标签
    main._basisObs = new MutationObserver(() => basisChips(main));
    main._basisObs.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  }
}

// ---------- 个股页“机构持仓（13F）”（M99，描述性；数据 inst13f.json）----------
async function fillInstCard(t) {
  const el = byId("inst-card");
  const d = await load("inst13f.json").catch(() => null);
  const r = d?.available ? d.stocks?.[t] : null;
  if (!el || !r) return;
  el.hidden = false;
  const tt = d.test || {}, dd = tt.drawdown || {}, st = tt.stress || {}, mid = tt.mid || {};
  const pp = (v) => (isNum(v) ? `${v >= 0 ? "+" : "−"}${num(Math.abs(v) * 100, 1)} 个百分点` : "–");
  const kind = (x) => (x.short === true ? '<span class="neg">短线</span>' : x.short === false ? "其他" : '<span class="muted">未分类</span>');
  const chg = (x) => (x.new ? '<span class="pos">新进</span>' : isNum(x.chg) ? pct(x.chg, 1, true) : "–");
  el.innerHTML = `<h3>机构持仓（13F） ${badge("derived")} <span class="chip basis-chip evid-weak" title="短线主动资金持股最高 20% 之后半年大跌的概率，在价格风险与拥挤度之外约为 ${num(dd.ratio, 2)} 倍，未达事先 1.5 倍标准">只作描述</span></h3>
    <p>截至 <b>${esc(r.period)}</b>（季末后约 45 天才公开，有延迟）：<b>${(r.holders || 0).toLocaleString()}</b> 家机构持有（较上季 ${isNum(r.d_holders) ? pct(Math.exp(r.d_holders) - 1, 1, true) : "–"}），合计持股 <b>${pct(r.io, 0)}</b>；
      其中短线主动资金持股 <b>${pct(r.sto, 1)}</b>（占机构持股 ${pct(r.sto_share, 0)}，较上季 ${pp(r.d_sto)}）。</p>
    <div class="table-wrap"><table class="tbl small"><thead><tr><th>持仓最大的机构</th><th class="num">持仓市值</th><th class="num">股数较上季</th><th>类型</th></tr></thead>
      <tbody>${(r.top || []).map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${usdAmt(x.value)}</td><td class="num">${chg(x)}</td><td>${kind(x)}</td></tr>`).join("")}</tbody></table></div>
    <details class="small"><summary>指标定义、检验与局限</summary>
      <p><b>短线主动资金</b> = 近 4 个季度换手率（Gaspar, Massa & Matos 2005：买入与卖出中较小者 ÷ 平均持仓，剔除资金进出）在全部 13F 申报机构中最高的三分之一（Yan & Zhang 2009）。这一类既有对冲基金、量化基金，也有换手较高的主动型共同基金（如 T. Rowe Price、Wellington），不等同于“对冲基金”；指数基金换手低，归入“其他”；新出现的申报实体满一年前“未分类”（如 2026 年起 Vanguard 改由子公司申报）。全市场短线资金约占机构持仓的 ${pct(d.short_value_share, 0)}。</p>
      <p>检验（当时市值 ≥ $10B 的美股，${esc(d.start || "")} 起每周，事先写下标准）：短线主动资金持股比例最高 20% 的股票，在价格风险与拥挤度之外，之后半年跌超 40% 的概率约为其他股票的 ${num(dd.ratio, 2)} 倍（t ${num(dd.t, 1)}；2019 年前 ${num(dd.early, 2)} / 后 ${num(dd.late, 2)}），≥ $2B 中 ${num(mid.ratio, 2)} 倍，大盘回调时 ${num(st.ratio, 2)} 倍——都未达 1.5 倍标准；对之后 1–3 个月的收益也没有预测力。机构家数变化、持股比例等其他指标同样未通过。所以这里只作描述：了解谁在持有、是否有大机构明显加减仓。</p>
      <p>局限：只含管理资产 ≥ $100M 机构的美股多头持仓，看不到空头、期权与散户；持股比例按市值估算，被借出卖空的股票会被双方都计入（超过 100% 时截断，超过 120% 视为数据错误不显示）；ADR 与金融股不显示。数据来自 SEC Form 13F Data Sets。</p>
    </details>`;
}
