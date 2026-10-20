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

/* ---------- 个股页三层分组与“短期依据”标签 ---------- */
// [标题开头, 标签类, 标签文字, 悬停说明]；按卡片标题（h3 文本）开头匹配
const EVIDENCE_BASIS = [
  ["短期证据", "evid-strong", "短期：已验证", "P1 大样本检验按事先标准有用"],
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
