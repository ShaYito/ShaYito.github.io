"use strict";
/* 个人数据包：data/personal.enc.json 是后台按你的实际持仓生成、用口令加密的内容（每天随网站更新一次）。
   只有在这台设备输入口令后才在浏览器内解密（WebCrypto：PBKDF2-SHA256 派生密钥 → AES-GCM）；口令本身不保存，
   勾选“记住这台设备”时只保存派生出的密钥（清除浏览器数据或点“锁定并忘记”即删除）。
   解密后：全站 ● 持仓标记、新闻的持仓标签与“与你持仓相关”、总览穿透暴露、个股页你的持仓等按实际持仓显示。 */

(function (root) {
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64e = (u) => btoa(String.fromCharCode(...u));
  const subtle = () => root.crypto.subtle;
  async function deriveRaw(pass, env) {
    const base = await subtle().importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
    const bits = await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: b64d(env.salt), iterations: env.iter }, base, 256);
    return new Uint8Array(bits);
  }
  async function decrypt(raw, env) {
    const key = await subtle().importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const pt = await subtle().decrypt({ name: "AES-GCM", iv: b64d(env.iv) }, key, b64d(env.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  const api = { deriveRaw, decrypt, b64d, b64e };
  root.PersonalCrypto = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

if (typeof window !== "undefined") {
  window.PERSONAL = null;
  const PKEY = "invest.personal.key.v1";
  let ENV = null;
  const keyId = (env) => `${env.salt}|${env.iter}`;
  const readKey = () => {
    for (const st of [sessionStorage, localStorage]) {
      try { const v = JSON.parse(st.getItem(PKEY) || "null"); if (v && ENV && v.id === keyId(ENV)) return PersonalCrypto.b64d(v.key); } catch { /* 忽略 */ }
    }
    return null;
  };
  const forget = () => { for (const st of [sessionStorage, localStorage]) { try { st.removeItem(PKEY); } catch { /* 忽略 */ } } };
  const rerender = () => { HOLD_MEMO = { key: null, val: null }; if (META) route(); };

  function button() {
    let b = document.getElementById("personal-btn");
    if (!b) {
      b = document.createElement("button");
      b.id = "personal-btn"; b.type = "button"; b.className = "ghost";
      const t = document.getElementById("theme-toggle");
      t.parentNode.insertBefore(b, t);
    }
    b.textContent = window.PERSONAL ? "🔓 个人版" : "🔒 个人版";
    b.title = window.PERSONAL ? `已解锁：按你的实际持仓显示（数据包生成于 ${window.PERSONAL.generated_at.replace("T", " ")} UTC）。点击锁定` : "输入口令，按你的实际持仓显示全站";
    b.onclick = () => (window.PERSONAL ? lock() : unlockDialog());
  }
  function lock() {
    if (!confirm("锁定个人版？这台设备记住的密钥也会删除，下次需要重新输入口令。")) return;
    forget(); window.PERSONAL = null; button(); rerender();
  }
  function unlockDialog() {
    let d = document.getElementById("personal-dlg");
    if (!d) {
      d = document.createElement("dialog");
      d.id = "personal-dlg";
      d.innerHTML = `<form method="dialog" class="card" style="margin:0;min-width:min(360px,80vw)">
        <h3>解锁个人版</h3>
        <p class="muted">输入个人数据包口令（与 GitHub Secret PERSONAL_PASSPHRASE 相同）。口令只在这台设备的浏览器里使用，不会发送到任何地方。</p>
        <input type="password" id="pd-pass" autocomplete="current-password" style="width:100%" placeholder="口令">
        <label class="muted"><input type="checkbox" id="pd-remember" checked> 记住这台设备（只保存派生密钥，不保存口令）</label>
        <p class="warn" id="pd-msg" hidden></p>
        <div class="row"><button type="submit" class="primary" id="pd-ok" value="ok">解锁</button><button type="submit" class="ghost" value="cancel" formnovalidate>取消</button></div></form>`;
      document.body.appendChild(d);
      d.querySelector("form").addEventListener("submit", async (e) => {
        if (e.submitter?.value !== "ok") return;
        e.preventDefault();
        const msg = d.querySelector("#pd-msg");
        msg.hidden = false; msg.className = "muted"; msg.textContent = "解密中…（首次约需 1 秒）";
        try {
          const raw = await PersonalCrypto.deriveRaw(d.querySelector("#pd-pass").value, ENV);
          window.PERSONAL = await PersonalCrypto.decrypt(raw, ENV);
          const st = d.querySelector("#pd-remember").checked ? localStorage : sessionStorage;
          forget();
          try { st.setItem(PKEY, JSON.stringify({ id: keyId(ENV), key: PersonalCrypto.b64e(raw) })); } catch { /* 忽略 */ }
          d.querySelector("#pd-pass").value = "";
          d.close(); button(); rerender();
        } catch { msg.className = "warn"; msg.textContent = "口令不正确"; }
      });
    }
    d.querySelector("#pd-msg").hidden = true;
    d.showModal();
    d.querySelector("#pd-pass").focus();
  }
  async function personalInit() {
    try {
      const r = await fetch("data/personal.enc.json", { cache: "no-cache" });
      if (!r.ok) return; // 没有个人数据包（未配置口令）
      ENV = await r.json();
    } catch { return; }
    const raw = readKey();
    if (raw) {
      try { window.PERSONAL = await PersonalCrypto.decrypt(raw, ENV); } catch { forget(); } // 口令已更换 → 需要重新输入
    }
    button();
    if (window.PERSONAL) rerender();
  }
  document.addEventListener("DOMContentLoaded", personalInit);
}

/* ---------- 供各页面使用 ---------- */
function personalOn() { return typeof window !== "undefined" && !!window.PERSONAL; }
function personalRelated() {
  const m = new Map();
  for (const r of (personalOn() && window.PERSONAL.related) || []) m.set(r.ticker, r.links);
  return m;
}
function isRelated(t) { return !isHeld(t) && personalRelated().has(t); }
function personalNews(dates) {
  if (!personalOn()) return [];
  const set = new Set(dates);
  return (window.PERSONAL.news || []).filter((n) => set.has(n.date));
}
function personalNewsCard(entries) {
  if (!entries.length) return "";
  return card("💼 与你持仓相关（AI 按你的实际持仓比例解读，只有你能看到）", entries.map((n) => `<p><span class="chip">${esc(n.date)}</span>${n.overall ? `<b>${esc(n.overall)}</b>` : ""}</p>
    <ul>${(n.lines || []).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`).join("") + `<p class="muted">${badge("model")} 由每日推送时的 AI 生成（持仓快照 ${esc(entries[entries.length - 1].holdings_date || "")}）。</p>`);
}
// 总览：个人版摘要（实际比例 vs 系统建议、最近一次持仓解读、与持仓相关的股票）
function personalOverview(o) {
  if (!personalOn()) return "";
  const P = window.PERSONAL;
  const sugg = Object.fromEntries((o.allocation || []).map((a) => [a.ticker, a.weight]));
  const w = P.weights || {};
  const tick = [...new Set([...Object.keys(w), ...Object.keys(sugg)])].filter((t) => t !== "CASH" && t !== "SPAXX")
    .sort((a, b) => (w[b] || 0) - (w[a] || 0) || (sugg[b] || 0) - (sugg[a] || 0));
  const cashW = w.CASH || 0, cashS = sugg.SPAXX || 0;
  const row = (t, a, b) => `<tr><td><a href="#/stock/${esc(t)}"><b>${esc(t)}</b></a> <span class="muted">${esc(META.names_zh?.[t] || "")}</span></td><td class="num">${a ? pct(a, 1) : "–"}</td><td class="num">${b ? pct(b, 1) : "–"}</td><td class="num ${cls(a - b)}">${a || b ? pct(a - b, 1, true) : ""}</td></tr>`;
  const last = (P.news || [])[P.news.length - 1];
  const rel = (P.related || []).slice(0, 10);
  return `<section class="card"><h3>你的持仓（个人版）${badge("fact")}${badge("derived")}<span class="muted" style="font-weight:400"> 持仓同步于 ${esc(P.snapshot.date)} · 价格 ${esc(P.price_asof)}</span></h3>
    <div class="grid two"><div><div class="table-wrap"><table><thead><tr><th>标的</th><th class="num">你的比例</th><th class="num">系统建议</th><th class="num">差</th></tr></thead><tbody>
      ${tick.map((t) => row(t, w[t] || 0, sugg[t] || 0)).join("")}${row("现金", cashW, cashS).replace(`href="#/stock/现金"`, `href="#/holdings"`)}</tbody></table></div>
      <p class="muted">差 = 你的比例 − 系统建议。调仓清单见 <a href="#/holdings?tab=plan">我的持仓 → 调仓建议</a>。</p></div>
    <div>${last ? `<h4>最近一次“与你持仓相关”（${esc(last.date)}）${badge("model")}</h4>${last.overall ? `<p><b>${esc(last.overall)}</b></p>` : ""}<ul>${(last.lines || []).slice(0, 5).map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p class="muted"><a href="#/news?date=${esc(last.date)}">查看当天新闻 →</a></p>` : `<p class="muted">还没有按你的持仓生成的每日解读（每日推送后生成）。</p>`}
      ${rel.length ? `<h4>与你持仓相关的股票（产业链直接相连）</h4><p>${rel.map((r) => `<a class="chip" href="#/stock/${esc(r.ticker)}" title="${esc(r.links.map((l) => `${l.via} 的${l.relation}`).join("；"))}">${esc(r.ticker)} ${esc(META.names_zh?.[r.ticker] || "")}</a>`).join("")}</p>` : ""}</div></div></section>`;
}
