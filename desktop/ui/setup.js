// Setup assistant: language, server, forward browser, make Linkwache the default,
// browser extension connection + autostart, done.
"use strict";
(async () => {
  const info = await LW.boot();
  const $ = (s) => document.getElementById(s);
  const STEPS = ["welcome", "server", "browser", "default", "extras", "done"];
  const DEFAULT_TEXT = { macos: "dt.setup.default.p.macos", windows: "dt.setup.default.p.windows", linux: "dt.setup.default.p.linux" };
  let step = Number(new URLSearchParams(location.search).get("step") || 0);
  let settings = await LW.invoke("get_settings").catch(() => ({ lang: LW.lang, server: "" }));
  let browsers = [];
  let chosen = null;
  let poll = null;

  function dots() {
    $("dots").textContent = "";
    STEPS.forEach((_, i) => $("dots").append(LW.el("span", { class: i <= step ? "on" : "" })));
    $("stepno").textContent = LW.t("dt.setup.step", { n: step + 1, total: STEPS.length });
  }

  function langs() {
    const box = $("langs");
    box.textContent = "";
    for (const l of window.LW_I18N.langs) {
      box.append(LW.el("button", { type: "button", class: l === LW.lang ? "on" : "", onclick: async () => {
        await LW.invoke("set_lang", { lang: l }).catch(() => {});
        LW.setLang(l);
        show();
      } }, window.LW_I18N.names[l]));
    }
  }

  function status(elId, cls, key, p) {
    const e = $(elId);
    e.hidden = false;
    e.className = "status " + cls;
    e.textContent = LW.t(key, p);
  }

  async function testServer() {
    status("serverstatus", "busy", "dt.setup.server.testing");
    try {
      const v = await LW.invoke("test_server", { url: $("server").value });
      status("serverstatus", "ok", "dt.setup.server.ok", { v });
      return true;
    } catch (e) {
      status("serverstatus", "bad", String(e) === "invalid" ? "dt.setup.server.invalid" : "dt.setup.server.fail");
      return String(e) !== "invalid";
    }
  }

  async function loadBrowsers() {
    try { browsers = await LW.invoke("list_browsers"); } catch { browsers = []; }
    const box = $("browsers");
    box.textContent = "";
    $("nobrowser").hidden = browsers.length > 0;
    if (!chosen) chosen = (browsers.find((b) => b.selected) || browsers.find((b) => b.previous) || browsers[0] || {}).target || null;
    for (const b of browsers) {
      const on = chosen && chosen.id === b.target.id && chosen.kind === b.target.kind;
      const input = LW.el("input", { type: "radio", name: "br", checked: on });
      const row = LW.el("label", { class: "choice" + (on ? " on" : "") }, input,
        LW.el("span", { class: "name" }, b.target.name),
        b.previous ? LW.el("span", { class: "pill" }, LW.t("dt.setup.browser.current")) : null);
      input.addEventListener("change", () => { chosen = b.target; loadBrowsers(); });
      box.append(row);
    }
  }

  async function checkDefault() {
    try {
      const s = await LW.invoke("handler_status");
      if (s.isDefault) { status("defaultstatus", "ok", "dt.setup.default.ok"); clearInterval(poll); poll = null; return true; }
    } catch { /* keep polling */ }
    return false;
  }

  async function makeDefault() {
    $("makedefault").disabled = true;
    let outcome = "failed";
    try { outcome = await LW.invoke("make_default"); } catch { outcome = "failed"; }
    $("makedefault").disabled = false;
    if (await checkDefault()) return;
    if (outcome === "failed") { status("defaultstatus", "bad", "dt.setup.default.fail"); return; }
    status("defaultstatus", "busy", "dt.setup.default.wait");
    clearInterval(poll);
    let n = 0;
    poll = setInterval(async () => {
      if (await checkDefault()) return;
      if (++n > 120) { clearInterval(poll); poll = null; status("defaultstatus", "bad", "dt.setup.default.fail"); }
    }, 1500);
  }

  function show() {
    document.querySelectorAll("section[data-step]").forEach((s) => { s.hidden = s.dataset.step !== STEPS[step]; });
    dots();
    $("back").style.visibility = step === 0 || step === STEPS.length - 1 ? "hidden" : "visible";
    $("next").textContent = LW.t(step === STEPS.length - 1 ? "dt.btn.finish" : "dt.btn.next");
    const name = STEPS[step];
    if (name === "welcome") langs();
    if (name === "server" && !$("server").value) $("server").value = settings.server || "";
    if (name === "browser") loadBrowsers();
    if (name === "default") { $("defaulttext").textContent = LW.t(DEFAULT_TEXT[info.platform] || DEFAULT_TEXT.linux); checkDefault(); }
  }

  $("test").addEventListener("click", testServer);
  $("makedefault").addEventListener("click", makeDefault);
  $("extguide").addEventListener("click", () => LW.invoke("open_guide", { which: "extension" }).catch(() => {}));
  $("back").addEventListener("click", () => { if (step > 0) { step--; show(); } });
  $("next").addEventListener("click", async () => {
    const name = STEPS[step];
    if (name === "server") {
      try { settings.server = await LW.invoke("set_server", { url: $("server").value }); }
      catch { status("serverstatus", "bad", "dt.setup.server.invalid"); return; }
    }
    if (name === "browser") {
      if (!chosen) return;
      try { await LW.invoke("set_forward", { target: chosen }); } catch { return; }
    }
    if (name === "extras") {
      if ($("nm").checked) await LW.invoke("install_nm").catch(() => {});
      await LW.invoke("set_autostart", { enabled: $("autostart").checked }).catch(() => {});
    }
    if (name === "done") { await LW.invoke("finish_setup").catch(() => {}); return; }
    clearInterval(poll);
    step++;
    show();
  });
  show();
  requestAnimationFrame(() => LW.invoke("window_ready").catch(() => {}));
})();
