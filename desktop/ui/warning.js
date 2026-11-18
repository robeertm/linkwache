// Warning window: amber (open anyway after a short countdown), red (blocked; opening only
// through a deliberate second step), offline (local assessment, the user chooses).
"use strict";
(async () => {
  await LW.boot();
  const id = Number(new URLSearchParams(location.search).get("id") || 0);
  const $ = (s) => document.getElementById(s);
  const TITLE = { gelb: "dt.warn.title.gelb", rot: "dt.warn.title.rot", offline: "dt.warn.title.offline" };
  const LEAD = { gelb: "dt.warn.lead.gelb", rot: "dt.warn.lead.rot", offline: "dt.warn.lead.offline" };
  const LEVEL = { gruen: "dt.lvl.gruen", gelb: "dt.lvl.gelb", rot: "dt.lvl.rot", offline: "dt.lvl.offline" };
  const REASON = {
    timeout: "dt.warn.reason.timeout", network: "dt.warn.reason.network", server: "dt.warn.reason.server",
    rate: "dt.warn.reason.rate", noserver: "dt.warn.reason.noserver",
  };
  const SOURCE = {
    server: "dt.warn.source.server", cache: "dt.warn.source.cache", local: "dt.warn.source.local",
    allowlist: "dt.warn.source.allowlist",
  };
  let data = null;
  let timer = null;
  let redStep = false;

  function isRed(r) { return r.stufe === "rot" || (r.stufe === "offline" && r.local.stufe === "rot"); }

  function render(d) {
    data = d;
    const r = d.result;
    const st = r.stufe;
    document.body.dataset.stufe = st;
    document.title = LW.t(TITLE[st] || TITLE.gelb);
    $("pill").className = "pill " + st;
    $("pill").textContent = LW.t(LEVEL[st] || LEVEL.gelb);
    $("title").textContent = LW.t(TITLE[st] || TITLE.gelb);
    $("domain").textContent = r.unicodeHost || r.host;
    $("url").textContent = r.url;
    $("targetbox").hidden = !r.unwrapped;
    $("target").textContent = r.unwrapped ? r.target : "";
    $("lead").textContent = LW.t(LEAD[st] || LEAD.gelb);
    $("rat").textContent = st === "offline" ? "" : (r.rat || LW.t(r.ratKey));
    $("reason").hidden = st !== "offline";
    $("reason").textContent = st === "offline" ? LW.t(REASON[r.reason] || REASON.network) : "";
    $("localhead").hidden = st !== "offline";
    $("localpill").className = "pill " + r.local.stufe;
    $("localpill").textContent = LW.t(LEVEL[r.local.stufe] || LEVEL.gruen);
    const list = $("findings");
    list.textContent = "";
    const shown = (r.findings || []).filter((f) => f.stufe !== "gruen" || st === "offline");
    for (const f of shown) {
      const { titel, text } = LW.findingText(f);
      list.append(LW.el("li", { class: f.stufe }, LW.el("span", { class: "dot" }), LW.el("div", {}, LW.el("b", {}, titel), LW.el("span", {}, text))));
    }
    $("findingshead").hidden = shown.length === 0;
    $("nofindings").hidden = shown.length > 0;
    $("nofindings").textContent = st === "offline" ? LW.t("dt.warn.local.none") : LW.t("dt.warn.nofindings");
    $("source").textContent = st === "offline" ? "" : LW.t(SOURCE[r.source] || SOURCE.server);
    $("via").hidden = r.via !== "reserve" || st === "offline";
    $("via").textContent = r.via === "reserve" ? LW.t("dt.warn.via.reserve") : "";
    // Actions
    const red = isRed(r);
    $("know").hidden = !red || redStep;
    $("open").hidden = red;
    $("retry").hidden = st !== "offline";
    $("actions").hidden = redStep;
    $("confirm").hidden = !redStep;
    if (!red) countdown(d.waitMs);
  }

  function countdown(ms) {
    clearInterval(timer);
    const b = $("open");
    const end = Date.now() + Math.max(0, ms);
    const tick = () => {
      const left = Math.ceil((end - Date.now()) / 1000);
      if (left > 0) { b.disabled = true; b.textContent = LW.t("dt.btn.openin", { n: left }); }
      else { b.disabled = false; b.textContent = LW.t("dt.btn.openanyway"); clearInterval(timer); }
    };
    tick();
    timer = setInterval(tick, 200);
  }

  async function decide(action) {
    try { await LW.invoke("decide", { id, action }); } catch (e) { console.error(e); }
  }

  $("close").addEventListener("click", () => decide("close"));
  $("open").addEventListener("click", () => decide("open"));
  $("retry").addEventListener("click", () => decide("retry"));
  $("know").addEventListener("click", async () => {
    redStep = true;
    await decide("red-step");
    render(data);
    const b = $("openred");
    b.disabled = true;
    setTimeout(() => { b.disabled = false; }, 1500);
    $("cancelred").focus();
  });
  $("cancelred").addEventListener("click", () => { redStep = false; render(data); $("close").focus(); });
  $("openred").addEventListener("click", () => decide("open-red"));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") decide("close"); });

  LW.listen("result", (p) => { if (p && p.id === id) render(p); });
  try { render(await LW.invoke("get_result", { id })); } catch (e) { console.error(e); }
  requestAnimationFrame(() => LW.invoke("window_ready").catch(() => {}));
})();
