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

async function fillShortEvidence(t) {
  const el = byId("se-card");
  const d = await seData();
  const r = d?.available ? d.stocks?.[t] : null;
  if (!el || !r) return;
  el.hidden = false;
  const rows = d.signals.map((sig) => ({ sig, v: r[sig.key]?.v, p: r[sig.key]?.pct, tilt: seTilt(sig, r[sig.key]?.pct) }));
  const fav = rows.filter((x) => x.tilt.text === "偏有利"), bad = rows.filter((x) => x.tilt.text === "偏不利");
  const names = (xs) => xs.map((x) => esc(x.sig.name.replace(/（[^）]*）/g, ""))).join("、");
  const summary = !fav.length && !bad.length ? "各项都在全市场中间，没有明显倾向"
    : [fav.length ? `<span class="pos">偏有利 ${fav.length} 项</span>（${names(fav)}）` : "", bad.length ? `<span class="neg">偏不利 ${bad.length} 项</span>（${names(bad)}）` : ""].filter(Boolean).join("；");
  el.innerHTML = `<h3>短期证据（已验证） ${badge("fact")}${badge("derived")}</h3>
    <p>${summary}。<span class="muted small">动量两项、近期涨跌两项高度相关，不能当成独立的几票相加。</span></p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>证据</th><th>当前读数</th><th>全市场分位</th><th>倾向</th><th title="${(d.test.stocks || 0).toLocaleString()} 只美股，${esc(d.test.start?.slice(0, 4) || "")} 年起每周截面">检验 IC（t）</th></tr></thead>
    <tbody>${rows.map(({ sig, v, p, tilt }) => `<tr><td title="${esc(sig.name)}">${esc(sig.name.replace(/（[^）]*）/g, ""))}</td><td>${isNum(v) ? (SE_FMT[sig.key] || ((x) => num(x, 2)))(v) : "–"}</td><td>${seBar(p)}</td>
      <td><span class="${tilt.cls}"><b>${tilt.text}</b></span><div class="muted small">${esc(tilt.note || "")}</div></td><td class="small">${seBasis(sig)}</td></tr>`).join("")}</tbody></table></div>
    <p class="small"><a href="#/evidence">全部证据的检验结果（含选股池前瞻账本） →</a></p>
    <details class="small"><summary>怎么读、量级与局限</summary>
      <p><b>只是倾向。</b>这些信号的 IC 只有 0.01–0.03：在全市场几千只股票里平均来看站得住（按事先写下的标准：全样本 |t| ≥ 2 且多重比较校正后显著、2019 年前后两段同向、科技股子样本同向、五等分最高减最低与 IC 同号），但对单只股票的解释力很小，不能单独决定买卖。量级参考：动量最高与最低五分之一之后 13 周平均相差约 1.7–1.9%；近 1 周涨跌最高与最低五分之一之后 1 周相差约 0.2%。</p>
      <p><b>“偏有利 / 偏不利”</b>：按检验得到的方向换算，处于全市场最有利 / 最不利的 20% 时标出；其余为中性。动量与近期涨跌方向相反（中期延续、短期回吐），同一只股票常常同时出现两种倾向，按你的持有期限看对应的行。</p>
      <p><b>读数口径</b>：与检验相同的公式，用网站行情（复权收盘，截至 ${esc(d.asof)}）计算；动量与近期涨跌已减去 SPY 同期涨跌，再与全市场 ${(d.dist_n || 0).toLocaleString()} 只股票（截至 ${esc(d.dist_asof)}，每周更新）比较。剔除大盘的一周倍数 = 近 5 日剔除 β 后的累计 ÷（此前一年剔除 β 后的日波动 × √5），与多股对比页的倍数同一思路。</p>
      <p><b>局限</b>：股票池是现在仍上市的公司（退市的输家不在其中）；未扣交易成本；检验的是“同一周所有股票相互比较”，不预测大盘涨跌。财报反应后漂移（PEAD）、近 3 月剔除 β 累计、回调期间抗跌程度经检验无效或方向相反，未列入。详见 docs/SYSTEM_REVIEW.md 第四节。</p>
    </details>`;
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
