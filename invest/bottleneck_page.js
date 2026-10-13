/* AI 瓶颈研究（M45–M47）在网页上的剩余部分：个股页 K 线叠加瓶颈信号与相对大盘上涨波段、个股页“相关瓶颈”卡片、
   侧栏紫色标出有瓶颈信号的股票。瓶颈时间线与详情已移到“技术”页面（tech_page.js，M48），“说法检验”已删除。
   数据：bottlenecks.json（每周 run_bottlenecks.py 生成）
   ① 瓶颈时间线：总览（各瓶颈的里程碑、各公司被匹配到的上涨波段）+ 单个瓶颈详情（相对走势与波段、里程碑 × 公司结果矩阵、新闻量 / 申报提及）
   ② 说法检验：不同类型信号的反应、七条说法与五问框架的分组统计、结论与稳健性 */

const BN_POS = { leader: "龙头 / 终端", mid: "中游", upstream: "上游材料" };
const BN_PUR = { high: "高", medium: "中", low: "低" };
const BN_PRICE = { spot: "现货 / 短约", contract: "长约", backlog: "订单积压" };
const BN_SUPPLY = { single: "单一", few: "少数", many: "多家" };
const BN_MKT = { US: "美股", TW: "台股", JP: "日股", KR: "韩股", CN: "A 股", DE: "德股", HK: "港股", NL: "荷兰", FR: "法国", IT: "意大利" };
const BN_KIND = { leader: ["龙头表态 / 指引", "diamond"], report: ["行业报道", "circle"], price: ["提价", "triangle"], capacity: ["抢产能 / 售罄 / 协议", "rect"], order: ["订单", "pin"], product: ["产品发布", "roundRect"] };
const BN_MATCH = { matched: "引发一波上涨", in_earlier_leg: "已在上涨中", no_leg: "没有引发新一波", listed_after: "当时未上市" };
const bnName = (d, t) => d.names?.[t] || META.names_zh?.[t] || t;
const days = (v) => (isNum(v) ? `${v > 0 ? "+" : ""}${Math.round(v)} 天` : "–");
const UNIVERSE_ALIAS = { TSM: "2330.TW", ASX: "3711.TW" }; // 选股池代码 → 案例库中的本地上市代码

let BN_COVER = new Set();
async function bnData() {
  const d = await load("bottlenecks.json");
  if (!d?.cases) return null;
  const back = Object.fromEntries(Object.entries(UNIVERSE_ALIAS).map(([u, k]) => [k, u]));
  BN_COVER = new Set(d.cases.filter((c) => c.ai !== false).flatMap((c) => c.companies.map((p) => back[p.ticker] || p.ticker)));
  return d;
}
// 全部 公司 × 里程碑（附公司与瓶颈）
function bnRows(d) {
  return d.cases.flatMap((c) => c.companies.flatMap((p) => (p.matches || []).map((r) => ({ ...r, p, c, m: c.milestones[r.milestone] }))));
}

// ---------------- ① 瓶颈时间线 ----------------
// 旧链接 #/bottleneck?id=… → 所属技术子页面（M48 起瓶颈时间线与详情移入“技术”页面）
PAGES.bottleneck = async (r) => {
  const d = await bnData().catch(() => null);
  const c = d?.cases?.find((x) => x.id === r.query.id);
  location.replace(`#/tech${c?.tech ? `/${c.tech}` : ""}`);
};
// 旧链接 #/claims（说法检验已删除）→ 技术看板
PAGES.claims = async () => { location.replace("#/tech"); };

function bnScoreText(s) {
  if (!s) return "–";
  const q = [["visible", "①可见"], ["pricing", "②定价"], ["purity", "③纯度"], ["structural", "④结构"], ["listing", "⑤上市"]];
  return `<b>${num(s.total, 1)}</b> <span class="muted small">${q.map(([k, n]) => `${n}${s[k] === 1 ? "✓" : s[k] === 0.5 ? "½" : "✗"}`).join(" ")}</span>`;
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
    <tbody>${hits.flatMap(({ c, p }) => (p.matches || []).map((r, k) => `<tr>${k === 0 ? `<td colspan="5"><a href="#/tech/${c.tech || ""}"><b>${esc(c.name)}</b></a> <span class="muted">${c.status === "ongoing" ? "仍紧缺" : "已缓解"} · ${BN_POS[p.position]} · 纯度${BN_PUR[p.purity]} · ${BN_PRICE[p.pricing]} · 五问 ${bnScoreText(p.score)}</span></td></tr><tr>` : ""}
      <td class="small">${esc(r.date)} ${esc(BN_KIND[r.kind][0])}：${esc(c.milestones[r.milestone].text)}</td><td></td>
      <td>${esc(BN_MATCH[r.status] || r.status)}${r.status === "matched" ? `<br><span class="muted small">${esc(r.leg_t0)} → ${esc(r.leg_peak)}，${pct(r.gain, 0, true)}</span>` : ""}</td>
      <td class="num">${days(r.lag_confirm)}</td><td class="num ${cls(r.ret_12m)}">${pct(r.ret_12m, 0, true)}</td></tr>`)).join("")}</tbody></table></div>
    <p class="muted small">波段：相对大盘回撤 25% 以上即一波结束，每波至少涨 50%。时滞 = 那一波相对涨 30% 的日子 − 信号日；事后识别，只描述历史。<a href="#/tech">技术看板 →</a></p>`;
}

// ---------------- 个股价格图叠加：瓶颈信号 + 相对大盘上涨波段（app.js 个股 K 线调用） ----------------
// 返回 { signals: K 线 markPoint 数据, areas: markArea 数据 }；该股票不在案例库时返回 null
function bnStockOverlay(d, t, s, nearest) {
  if (!d || !s.dates.length) return null;
  const key = UNIVERSE_ALIAS[t] || t;
  const hits = d.cases.flatMap((c) => c.companies.filter((p) => p.ticker === key).map((p) => ({ c, p })));
  if (!hits.length) return null;
  const d0 = s.dates[0], d1 = s.dates[s.dates.length - 1];
  const lowOn = Object.fromEntries(s.dates.map((x, i) => [x, s.ohlc[i]?.[2]]));
  const byDate = {};
  for (const { c, p } of hits) {
    for (const r of p.matches || []) {
      if (r.date < d0 || r.date > d1) continue;
      (byDate[r.date] ||= []).push({ c, r, m: c.milestones[r.milestone] });
    }
  }
  const signals = Object.entries(byDate).map(([date, items]) => {
    const x = nearest(date);
    return { kind: "bn", coord: [x, lowOn[x]], symbol: BN_KIND[items[0].m.kind][1], symbolSize: 13, symbolOffset: [0, 18], items, date,
      itemStyle: { color: "#7c5cff", borderColor: css("--surface"), borderWidth: 1 } };
  });
  const legs = hits[0].p.legs || [];
  const areas = legs.filter((l) => l.peak >= d0 && l.t0 <= d1).map((l) => [
    { xAxis: nearest(l.t0 < d0 ? d0 : l.t0), name: `相对大盘 ${pct(l.gain, 0, true)}${l.ongoing ? "（未结束）" : ""}`, itemStyle: { color: "rgba(124, 92, 255, 0.07)" } },
    { xAxis: nearest(l.peak > d1 ? d1 : l.peak) },
  ]);
  return { signals, areas, cases: [...new Set(hits.map((h) => h.c.id))] };
}
function bnSignalTooltip(x) {
  return x.items.map(({ c, r, m }) => `<b>${esc(c.name)}</b> · ${esc(m.date)} ${esc(BN_KIND[m.kind][0])}：${esc(m.text)} <a href="${esc(m.url)}" target="_blank" rel="noopener">来源</a><br><span style="opacity:.75">对这只股票：${esc(BN_MATCH[r.status] || r.status)}${r.status === "matched" ? `（上涨确认 ${esc(r.leg_t1 || "–")}，时滞 ${days(r.lag_confirm)}；这一波 ${esc(r.leg_t0)} → ${esc(r.leg_peak)} 相对大盘 ${pct(r.gain, 0, true)}）` : ""}${isNum(r.ret_12m) ? `；信号后 12 个月相对大盘 ${pct(r.ret_12m, 0, true)}` : ""}</span>`).join("<hr>");
}
