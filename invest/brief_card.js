/* 个股页顶部“现状与展望”（M52）：AI 根据证据包归纳的现状 / 未来几周 / 未来几个月判断（stock_briefs.json，每周生成），
   合并原来的“本页重点”（规则提醒）与“个股体检”（逐项证据，可展开）。判断不是买卖建议；每个论点后的编号可悬停查看证据原文。 */

const BRIEF_VIEW_CLS = { 偏强: "pos", 中性偏强: "pos-soft", 中性: "neu", 中性偏弱: "neg-soft", 偏弱: "neg" };

function briefRefs(refs, evMap) {
  return refs.map((r) => `<span class="ev-ref" title="${esc(evMap[r] ? `${r}：${evMap[r]}` : r)}" data-ref="${esc(r)}">${esc(r)}</span>`).join("");
}
function briefList(points, evMap, mark) {
  return points.length ? `<ul class="brief-pts">${points.map((p) => `<li>${mark ? `<span class="brief-mark ${mark === "+" ? "pos" : "neg"}">${mark === "+" ? "▲" : "▼"}</span>` : ""}${esc(p.text)} ${briefRefs(p.evidence, evMap)}</li>`).join("")}</ul>` : "";
}
function briefHorizon(title, sub, h, evMap) {
  return `<div class="brief-col"><div class="brief-h"><b>${title}</b><span class="muted small">${sub}</span></div>
    <div><span class="brief-view ${BRIEF_VIEW_CLS[h.view] || "neu"}">${esc(h.view)}</span> <span class="muted small">把握度：${esc(h.confidence)}</span></div>
    <p>${esc(h.summary)}</p>
    ${h.drivers.length ? `<div class="muted small">支持</div>${briefList(h.drivers, evMap, "+")}` : ""}
    ${h.risks.length ? `<div class="muted small">风险</div>${briefList(h.risks, evMap, "-")}` : ""}</div>`;
}
// 详细报告（按用户要求生成，web_data/stock_reports/{代码}/{日期}.md）：简易 Markdown → HTML
// 支持：## / ### 标题、表格、无序 / 有序列表（缩进两格为子项）、> 引用、**粗体**、[文字](链接)、`代码`；其余按段落
function mdInline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
}
function mdToHtml(md) {
  const lines = md.replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const n = Math.min(4, h[1].length + 2); out.push(`<h${n}>${mdInline(h[2])}</h${n}>`); i++; continue; }
    if (isRow(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = cells(l);
      i += 2;
      const rows = [];
      while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${mdInline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td class="wrap">${mdInline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (/^>\s?/.test(l)) {
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote class="muted small">${mdInline(q.join(" "))}</blockquote>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      // 列表：按缩进（两格一级）嵌套；有序 / 无序以每级第一项为准
      let html = "", depth = -1;
      const tags = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        const d = Math.floor(m[1].length / 2), tag = /\d/.test(m[2]) ? "ol" : "ul";
        if (d > depth) { html += `<${tag}>`; tags.push(tag); depth = d; } else {
          while (depth > d) { html += `</li></${tags.pop()}>`; depth--; }
          html += "</li>";
        }
        html += `<li>${mdInline(m[3])}`;
        i++;
      }
      while (tags.length) html += `</li></${tags.pop()}>`;
      out.push(html);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|>|\s*([-*]|\d+\.)\s)/.test(lines[i]) && !isRow(lines[i])) para.push(lines[i++]);
    if (para.length) out.push(`<p>${mdInline(para.join(" "))}</p>`); else i++;
  }
  return out.join("\n");
}
function briefReports(reports) {
  return (reports || []).map((r) => `<details class="brief-report"><summary>${esc(r.title)}</summary><div class="md-report">${mdToHtml(r.md)}</div></details>`).join("");
}
// insights：规则提醒（原“本页重点”）；reports：详细报告（可无）；返回整张卡片 HTML
function briefCard(t, row, insights, reports = []) {
  const alerts = insightItems(insights, 8);
  const evMap = Object.fromEntries((row?.evidence || []).map((e) => [e.id, e.text]));
  const b = row?.brief;
  const top = b ? `<div class="brief-grid">
      <div class="brief-col"><div class="brief-h"><b>现状</b><span class="muted small">${esc(row.date)} · 收盘 ${num(row.price, 2)}</span></div>
        <p>${esc(b.now.summary)}</p>${briefList(b.now.points, evMap)}</div>
      ${briefHorizon("未来几周", "约 2–6 周", b.weeks, evMap)}
      ${briefHorizon("未来几个月", "约 3–6 个月", b.months, evMap)}
    </div>
    <div class="brief-watch"><b>什么情况会改变判断</b>${briefList(b.watch, evMap)}</div>`
    : `<p class="muted">暂无（每周日根据最新数据生成一次；新加入选股池的股票下次生成后才有）。</p>`;
  return `<section class="card" id="brief-card" data-nav="现状与展望"><h3>现状与展望 ${badge("model")}${b ? `<span class="muted" style="font-weight:400"> AI 根据下方证据归纳 · ${esc(row.provider || "")}</span>` : ""}</h3>
    ${top}
    ${briefReports(reports)}
    ${b ? `<p class="muted small">“偏强 / 中性 / 偏弱”描述证据整体的倾向，不是买卖建议；短期（几周）涨跌本质上很难预测，把握度通常为“低”。每个论点后的编号是所依据的证据（悬停查看原文，全部证据见下方“逐项证据”）；文中数字都经过校验，必须出现在证据里。判断每周存档，将来用于检验准确率。</p>` : ""}
    ${alerts ? `<h4>需要留意的数据 <span class="muted small" style="font-weight:400">按固定规则提取，🔍 = 读数提醒（单看数字容易读错的情形）</span></h4>${alerts}` : ""}
    <details class="brief-ev"><summary>逐项证据（个股体检${b ? ` + AI 使用的 ${row.evidence.length} 条证据` : ""}）</summary>
      <div id="health-card"></div>
      ${b ? `<h4>AI 使用的证据</h4><table class="brief-evt"><tbody>${row.evidence.map((e) => `<tr id="ev-${esc(e.id)}"><td class="muted small">${esc(e.id)}</td><td class="muted small">${esc(e.cat)}</td><td>${esc(e.text)}</td></tr>`).join("")}</tbody></table>` : ""}
    </details></section>`;
}
// 点击证据编号：展开“逐项证据”并高亮该行
function bindBriefRefs() {
  document.querySelectorAll("#brief-card .ev-ref").forEach((el) => (el.onclick = () => {
    const det = document.querySelector("#brief-card details.brief-ev");
    if (det) det.open = true;
    const row = byId(`ev-${el.dataset.ref}`);
    if (!row) return;
    document.querySelectorAll("#brief-card tr.hl").forEach((x) => x.classList.remove("hl"));
    row.classList.add("hl");
    row.scrollIntoView({ block: "center" });
  }));
}
