/* 新闻情绪的更多维度（M41）：个股页卡片 + “信号 × 新闻”页明细表。数据：sentiment_profile.json */
const SP_NOTE = "情绪为按来源标准化后的分数（0 = 该来源平常水平，约 ±0.15 已算明显）；只描述正在发生什么，不预测涨跌。";
const SP_COLS = [
  ["mean", "7 日情绪", (v) => num(v, 2, true), true],
  ["qmean", "质量加权", (v) => num(v, 2, true), true],
  ["dispersion", "分歧度", (v) => num(v, 2), false],
  ["change", "较前 4 周", (v) => num(v, 2, true), true],
  ["count", "新闻数", (v) => (isNum(v) ? v : "–"), false],
  ["volume_ratio", "新闻量 / 平时", (v) => (isNum(v) ? `${v.toFixed(1)}×` : "–"), false],
  ["ret", "7 日涨跌", (v) => pct(v, 1, true), true],
];

function spShare(x) {
  return isNum(x.pos_share) ? `<span class="pos">正面 ${pct(x.pos_share, 0)}</span> / <span class="neg">负面 ${pct(x.neg_share, 0)}</span>` : "–";
}

async function fillSentimentProfile(t) {
  const el = byId("sp-card");
  if (!el) return;
  let d;
  try { d = await load("sentiment_profile.json"); } catch { return; }
  const x = d.rows?.[t];
  if (!x || !x.count) return;
  el.hidden = false;
  el.innerHTML = `<h3>新闻情绪：更多维度（近 ${d.window_days} 天 vs 之前 ${d.baseline_days} 天）${badge("derived")}</h3>
    ${(x.flags || []).length ? `<p>${x.flags.map((f) => `<span class="chip warnchip">${esc(f)}</span>`).join(" ")}</p>` : ""}
    <div class="table-wrap"><table><tbody>
      <tr><td>平均情绪</td><td class="num ${cls(x.mean)}">${num(x.mean, 2, true)}</td><td class="muted">按发布方质量加权 ${num(x.qmean, 2, true)}（可信媒体权重更高）</td></tr>
      <tr><td>正面 / 负面篇数</td><td class="num">${x.count} 篇</td><td>${spShare(x)}</td></tr>
      <tr><td>分歧度</td><td class="num">${num(x.dispersion, 2)}</td><td class="muted">逐篇情绪的标准差；高 = 利好利空混杂，平均值会互相抵消（选股池通常 0.25–0.38）</td></tr>
      <tr><td>情绪变化</td><td class="num ${cls(x.change)}">${num(x.change, 2, true)}</td><td class="muted">之前 ${d.baseline_days} 天平均 ${num(x.base_mean, 2, true)}</td></tr>
      <tr><td>新闻量</td><td class="num">${isNum(x.volume_ratio) ? `${x.volume_ratio.toFixed(1)}×` : "–"}</td><td class="muted">平时同样天数约 ${num(x.base_count, 0)} 篇；突然被大量报道本身就是信号</td></tr>
      <tr><td>同期股价</td><td class="num ${cls(x.ret)}">${pct(x.ret, 1, true)}</td><td class="muted">新闻偏利好而股价下跌（或相反）常见于“消息已被消化”或有更强的力量</td></tr>
    </tbody></table></div><p class="muted">${esc(SP_NOTE)}</p>`;
}

// “信号 × 新闻”页：全部股票的多维情绪表（可按列排序，标出需要留意的情况）
async function fillSentimentTable(sortKey) {
  const el = byId("sp-table");
  if (!el) return;
  let d;
  try { d = await load("sentiment_profile.json"); } catch { return; }
  const key = SP_COLS.some(([k]) => k === sortKey) || sortKey === "flags" ? sortKey : "flags";
  const rows = Object.entries(d.rows || {}).map(([t, x]) => ({ t, ...x })).filter((x) => x.count);
  const v = (x) => (key === "flags" ? (x.flags || []).length * 10 + Math.abs(x.mean ?? 0) : key === "mean" || key === "change" || key === "qmean" || key === "ret" ? Math.abs(x[key] ?? 0) : x[key] ?? -1);
  rows.sort((a, b) => v(b) - v(a));
  const th = (k, label) => `<th class="num"><a href="#/signal-news?sp=${k}" class="${k === key ? "on" : ""}">${label}${k === key ? " ▼" : ""}</a></th>`;
  el.innerHTML = card(`新闻情绪：更多维度（近 ${d.window_days} 天 vs 之前 ${d.baseline_days} 天，截至 ${d.asof}）`, `
    <p class="muted">${esc(SP_NOTE)} 带符号的列按绝对值排序。</p>
    <div class="table-wrap"><table><thead><tr><th>股票</th>${SP_COLS.map(([k, label]) => th(k, label)).join("")}<th>正面 / 负面</th><th><a href="#/signal-news?sp=flags" class="${key === "flags" ? "on" : ""}">需要留意${key === "flags" ? " ▼" : ""}</a></th></tr></thead>
    <tbody>${rows.map((x) => `<tr><td><a href="#/stock/${x.t}">${esc(x.t)}</a></td>${SP_COLS.map(([k, , f, signed]) => `<td class="num ${signed ? cls(x[k]) : ""}">${f(x[k])}</td>`).join("")}
      <td>${spShare(x)}</td><td>${(x.flags || []).map((f) => `<span class="chip warnchip">${esc(f)}</span>`).join(" ")}</td></tr>`).join("")}</tbody></table></div>`, "", ["derived"]);
}
