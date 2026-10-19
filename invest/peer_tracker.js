/* 同行财报追踪（M77；数据 peer_tracker.json，每日流程生成）：目标公司财报前，逐家同行业绩公告中与目标公司相关的要点
   （AI 提取，每条附原文逐字引用，可展开）、对目标公司的含义（AI 推断）与公告后股价反应；未公布的显示预计日期。 */

const PT_STANCE = { 偏有利: "pos", 中性: "neu", 偏不利: "neg", 不确定: "neu" };

async function fillPeerTracker(t) {
  const el = byId("pt-card");
  const d = await load("peer_tracker.json").catch(() => null);
  if (!el || !d?.target || d.target !== t) return;
  el.hidden = false;
  const done = new Map((d.entries || []).map((e) => [e.ticker, e]));
  const rows = [...(d.entries || []).map((e) => ({ date: e.filed, e })),
    ...d.peers.filter((p) => !(d.entries || []).some((e) => e.ticker === p.ticker && e.filed >= d.start)).map((p) => ({ date: p.next_date || "9999", p }))]
    .sort((a, b) => a.date.localeCompare(b.date));
  const react = (r) => (r?.day ? `反应日 ${esc(r.day.slice(5))}：<b class="${cls(r.ret)}">${pct(r.ret, 1, true)}</b>${isNum(r.rel) ? `（相对 SPY ${pct(r.rel, 1, true)}）` : ""}<br><span class="muted small">至今相对 SPY ${pct(r.since_rel, 1, true)}</span>` : `<span class="muted small">待开盘</span>`);
  el.innerHTML = `<h3>同行财报追踪（至 ${esc(d.until)} ${esc(t)} 财报）${badge("fact")}${badge("model")}</h3>
    <p class="muted small">每天检查同行的业绩公告（SEC 8-K）。要点由 AI 从新闻稿原文提取，每条附英文原文引用（点开查看；引用不在原文中的会被删除，金额换算经过校验）；“对 ${esc(t)} 的含义”是 AI 推断。围绕的问题：${d.questions.map(esc).join("；")}。</p>
    <div class="pt-list">${rows.map(({ e, p }) => (e ? `<details class="pt-row"><summary><span class="muted small">${esc(e.filed)}</span> <b>${esc(e.ticker)}</b> <span class="muted small">${esc(e.role)}</span>
        <span class="brief-view ${PT_STANCE[e.read.stance] || "neu"}">${esc(e.read.stance)}</span> ${esc(e.read.headline)}<span class="pt-react">${react(e.reaction)}</span></summary>
        <ul class="brief-pts">${e.read.points.map((x) => `<li><span class="chip">${esc(x.topic)}</span> ${esc(x.text)}<details class="small muted"><summary>原文</summary>“${esc(x.quote)}”</details></li>`).join("")}</ul>
        <p class="small"><b>对 ${esc(t)} 的含义（AI 推断）</b>：${esc(e.read.implication)}</p>
        <p class="muted small"><a href="${esc(e.url)}" target="_blank" rel="noopener">SEC 公告原文</a> · ${esc(e.provider || "")}</p></details>`
      : `<div class="pt-row pending"><span class="muted small">${p.next_date ? `预计 ${esc(p.next_date)}` : "日期未定"}</span> <b>${esc(p.ticker)}</b> <span class="muted small">${esc(p.role)}</span> <span class="muted small">· 待公布</span></div>`)).join("")}</div>
    <p class="muted small">日期来自行情源的财报日历，个别可能与公司正式公告不同。股价反应：美东 16:00 后公告看次一交易日，之前公告看当天。</p>`;
}
