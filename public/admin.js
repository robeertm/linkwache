// Operator page: sign in with the access key (kept only in this tab), show update state, file the request.
(function () {
  let LW = { s: {} };
  try { LW = JSON.parse(document.getElementById("lw").textContent); } catch { /* defaults */ }
  const S = LW.adm || {};
  const $ = (id) => document.getElementById(id);
  const fill = (s, p) => Object.keys(p).reduce((a, k) => a.split("{" + k + "}").join(p[k]), s);
  let key = "";
  const call = (path, method) => fetch(path, { method, headers: { authorization: "Bearer " + key } });
  function err(m) { const e = $("adm-msg"); e.textContent = m || ""; e.hidden = !m; }
  function show(st) {
    $("adm-login").hidden = true; $("adm-box").hidden = false; err("");
    $("adm-ver").textContent = fill(S.version, { v: st.version });
    let line = S.uptodate;
    if (!st.checkEnabled) line = S.off;
    else if (st.latest) line = fill(S.avail, { v: st.latest });
    $("adm-state").textContent = line;
    $("adm-req").hidden = !st.latest || !!st.pending;
    $("adm-meta").textContent = st.pending ? fill(S.pending, { v: st.pending }) : (st.checkedAt ? fill(S.checked, { t: new Date(st.checkedAt).toLocaleString(LW.lang) }) : (st.checkEnabled ? S.never : ""));
  }
  // ── usage figures (/api/stats, same key); built with DOM methods only, never from HTML strings ──
  const el = (tag, attrs = {}, text) => { const e = tag.startsWith("svg:") ? document.createElementNS("http://www.w3.org/2000/svg", tag.slice(4)) : document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
  const sum = (o, keys) => keys.reduce((a, k) => a + ((o || {})[k] || 0), 0);
  const REAL = ["page", "api", "telegram"], BG = ["health", "bot", "static", "notfound", "admin", "other"];
  const num = (n) => n == null ? "—" : Number(n).toLocaleString(LW.lang);
  function stats(j) {
    $("adm-stats").hidden = false;
    const tb = $("adm-days"); tb.replaceChildren();
    const hr = el("tr"); ["st.day", "st.real", "st.bg", "st.checks", "st.users", "st.p95", "st.peak", "st.rl", "st.cpu"].forEach((k) => hr.append(el("th", {}, S[k]))); tb.append(hr);
    const days = (j.days || []).slice(-14).reverse();
    if (!days.length) { const tr = el("tr"); tr.append(el("td", { colspan: "9" }, S["st.none"])); tb.append(tr); }
    for (const d of days) {
      const tr = el("tr");
      [d.d, num(sum(d.req, REAL)), num(sum(d.req, BG)), num(sum(d.work, Object.keys(d.work || {}))), num(d.users), d.lat_all?.p95 == null ? "—" : d.lat_all.p95 + " ms", num(d.peak_min_real), num(d.rl), num(Math.round((d.cpu_ms || 0) / 1000))].forEach((v) => tr.append(el("td", {}, String(v))));
      tb.append(tr);
    }
    // 48 hours: real requests (accent) over background (muted), one bar pair per hour
    const W = 600, H = 124, B = 2, hours = [], now = Date.now();
    const byT = Object.fromEntries((j.hours || []).map((h) => [h.t, h]));
    for (let i = 47; i >= 0; i--) { const t = new Date(now - i * 3600000).toISOString().slice(0, 13); hours.push(byT[t] || { t, req: {} }); }
    const max = Math.max(1, ...hours.map((h) => sum(h.req, REAL)));   // background has its own column in the table; here only real use
    const svg = el("svg:svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img", "aria-label": S["st.chart"] });
    const bw = W / 48;
    hours.forEach((h, i) => {
      const r = sum(h.req, REAL), b = sum(h.req, BG);
      const hr_ = (r / max) * (H - B - 16);
      const rr = el("svg:rect", { class: "r", x: (i * bw + 1).toFixed(1), y: (H - B - hr_).toFixed(1), width: (bw - 2).toFixed(1), height: Math.max(0, hr_).toFixed(1) });
      rr.append(el("svg:title", {}, `${h.t}:00 UTC · ${S["st.real"]} ${r} · ${S["st.bg"]} ${b}`)); svg.append(rr);
    });
    svg.append(el("svg:line", { class: "ax", x1: 0, x2: W, y1: H - B, y2: H - B }));
    // labels outside the stretched SVG, so they keep their size on narrow screens
    const lab = el("div", { class: "adm-lab" });
    lab.append(el("span", {}, hours[0].t.slice(5).replace("T", " ") + ":00"), el("span", {}, "max " + max + "/h"), el("span", {}, hours[47].t.slice(5).replace("T", " ") + ":00"));
    $("adm-chart").replaceChildren(svg, lab);
    // channels over 14 days
    const ch = {}; for (const d of (j.days || []).slice(-14)) for (const [k, v] of Object.entries(d.work || {})) ch[k] = (ch[k] || 0) + v;
    const total = Math.max(1, ...Object.values(ch));
    const box = $("adm-ch"); box.replaceChildren();
    const keys = ["web", "desktop", "extension", "android", "telegram", "mail", "v1_other"];
    for (const k of keys.concat(Object.keys(ch).filter((x) => !keys.includes(x)))) {
      if (!(k in ch) && !["web", "desktop", "extension", "android", "telegram"].includes(k)) continue;
      const row = el("div"); row.append(el("span", {}, S["ch." + k] || k), el("b", {}, num(ch[k] || 0)));
      const bar = el("i"); bar.style.setProperty("--w", Math.max(1, Math.round(((ch[k] || 0) / total) * 100)) + "%"); row.append(bar);
      box.append(row);
    }
  }
  async function loadStats() { try { const r = await call("/api/stats?hours=48&days=14", "GET"); if (r.ok) stats(await r.json()); } catch { /* the update part still works */ } }
  $("adm-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    key = $("adm-token").value; $("adm-token").value = "";
    try { const r = await call("/api/admin/status", "GET"); if (!r.ok) throw 0; show(await r.json()); loadStats(); } catch { key = ""; err(S.bad); }
  });
  $("adm-req").addEventListener("click", async () => {
    try { const r = await call("/api/admin/update-request", "POST"); if (!r.ok) throw 0; show(await r.json()); err(""); $("adm-meta").textContent = S.requested; } catch { err(S.bad); }
  });
})();
