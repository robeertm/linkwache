// Settings window: general (pause, language, server), browser, allowlist, history,
// updates, privacy.
"use strict";
(async () => {
  const info = await LW.boot();
  const $ = (s) => document.getElementById(s);
  const LEVEL = { gruen: "dt.lvl.gruen", gelb: "dt.lvl.gelb", rot: "dt.lvl.rot", offline: "dt.lvl.offline" };
  const ACTION = {
    opened: "dt.act.opened", blocked: "dt.act.blocked", "open-anyway": "dt.act.open-anyway",
    refused: "dt.act.refused", passthrough: "dt.act.passthrough", paused: "dt.act.paused",
  };
  let s = {};
  let tab = location.hash.slice(1) || "general";

  function flash() {
    $("saved").hidden = false;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => { $("saved").hidden = true; }, 1400);
  }

  function status(id, cls, text) { const e = $(id); e.hidden = false; e.className = "status " + cls; e.textContent = text; }

  function showTab(name) {
    tab = name;
    document.querySelectorAll(".side button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    document.querySelectorAll("section[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== name; });
    if (name === "history") history();
    if (name === "browser") browser();
    if (name === "updates") updates();
  }

  async function load() {
    s = await LW.invoke("get_settings");
    $("version").textContent = "v" + (info.version || "");
    // General
    status("pausestatus", s.paused ? "warn" : "ok", s.paused ? LW.t("dt.set.paused", { time: LW.fmtTime(s.pausedUntil) }) : LW.t("dt.set.active"));
    $("pausebtn").textContent = LW.t(s.paused ? "dt.tray.resume" : "dt.tray.pause");
    const sel = $("lang");
    sel.textContent = "";
    for (const l of window.LW_I18N.langs) sel.append(LW.el("option", { value: l, selected: l === s.lang }, window.LW_I18N.names[l]));
    if (document.activeElement !== $("server")) $("server").value = s.server || "";
    // Allowlist
    const ul = $("allowlist");
    ul.textContent = "";
    for (const d of s.allowlist) {
      ul.append(LW.el("li", {}, LW.el("span", {}, d), LW.el("button", { class: "btn ghost", type: "button", onclick: async () => { await LW.invoke("allow_remove", { domain: d }); flash(); load(); } }, LW.t("dt.btn.remove"))));
    }
    $("allowempty").hidden = s.allowlist.length > 0;
    // Privacy
    document.querySelectorAll("input[name=scope]").forEach((r) => { r.checked = r.value === s.scope; r.closest(".choice").classList.toggle("on", r.checked); });
    $("installid").textContent = s.installId;
    $("updauto").checked = !!s.updateCheck;
  }

  async function browser() {
    try {
      const h = await LW.invoke("handler_status");
      status("defstatus", h.isDefault ? "ok" : "bad", LW.t(h.isDefault ? "dt.set.default.yes" : "dt.set.default.no"));
      $("makedefault").hidden = !!h.isDefault;
    } catch { /* ignore */ }
    let list = [];
    try { list = await LW.invoke("list_browsers"); } catch { list = []; }
    const box = $("browsers");
    box.textContent = "";
    for (const b of list) {
      const on = !!b.selected;
      const input = LW.el("input", { type: "radio", name: "fw", checked: on });
      input.addEventListener("change", async () => { await LW.invoke("set_forward", { target: b.target }); flash(); browser(); });
      box.append(LW.el("label", { class: "choice" + (on ? " on" : "") }, input, LW.el("span", { class: "name" }, b.target.name),
        b.previous ? LW.el("span", { class: "pill" }, LW.t("dt.setup.browser.current")) : null));
    }
  }

  async function history() {
    let items = [];
    try { items = await LW.invoke("get_history"); } catch { items = []; }
    const tb = $("hist");
    tb.textContent = "";
    for (const it of items) {
      const lvl = it.stufe ? LW.el("span", { class: "pill " + it.stufe }, LW.t(LEVEL[it.stufe] || LEVEL.offline)) : "–";
      tb.append(LW.el("tr", {}, LW.el("td", { class: "t" }, LW.fmtTime(it.time, true)), LW.el("td", { class: "d" }, it.domain || "–"), LW.el("td", {}, lvl), LW.el("td", {}, LW.t(ACTION[it.action] || ACTION.opened))));
    }
    $("histempty").hidden = items.length > 0;
    $("hist").closest("table").hidden = items.length === 0;
  }

  function renderUpdate(u) {
    $("curversion").textContent = LW.t("dt.set.upd.version", { v: u.current || info.version });
    const map = {
      idle: ["", ""], checking: ["busy", "dt.set.upd.checking"], none: ["ok", "dt.set.upd.none"],
      available: ["warn", "dt.set.upd.avail"], installing: ["busy", "dt.set.upd.installing"], error: ["bad", "dt.set.upd.error"],
    };
    const [cls, key] = map[u.state] || map.idle;
    if (key) status("updstatus", cls, LW.t(key, { v: u.version || "" })); else $("updstatus").hidden = true;
    $("updinstall").hidden = !(u.state === "available");
    $("updinstall").disabled = !u.inapp;
    if (u.state === "available" && !u.inapp) status("updstatus", "warn", LW.t("dt.set.upd.avail", { v: u.version }) + " " + LW.t("dt.set.upd.pkg"));
    const b = u.backup;
    $("backupnote").hidden = !b;
    if (b) $("backupnote").textContent = LW.t("dt.set.upd.backup", { v: b.version, old: b.old, path: b.path });
  }

  async function updates() {
    try { renderUpdate(await LW.invoke("update_status")); } catch { /* ignore */ }
  }

  document.querySelectorAll(".side button").forEach((b) => b.addEventListener("click", () => { location.hash = b.dataset.tab; showTab(b.dataset.tab); }));
  $("pausebtn").addEventListener("click", async () => { await LW.invoke(s.paused ? "resume" : "pause", { minutes: 15 }); load(); });
  $("lang").addEventListener("change", async (e) => { await LW.invoke("set_lang", { lang: e.target.value }); LW.setLang(e.target.value); flash(); load(); showTab(tab); });
  $("server").addEventListener("change", async (e) => {
    try { await LW.invoke("set_server", { url: e.target.value }); $("serverstatus").hidden = true; flash(); }
    catch { status("serverstatus", "bad", LW.t("dt.setup.server.invalid")); }
  });
  $("servertest").addEventListener("click", async () => {
    status("serverstatus", "busy", LW.t("dt.setup.server.testing"));
    try { const v = await LW.invoke("test_server", { url: $("server").value }); status("serverstatus", "ok", LW.t("dt.setup.server.ok", { v })); }
    catch (e) { status("serverstatus", "bad", LW.t(String(e) === "invalid" ? "dt.setup.server.invalid" : "dt.setup.server.fail")); }
  });
  $("rerun").addEventListener("click", () => LW.invoke("open_window", { which: "setup" }));
  $("makedefault").addEventListener("click", async () => { await LW.invoke("make_default").catch(() => {}); setTimeout(browser, 1500); });
  $("allowadd").addEventListener("click", async () => {
    try { await LW.invoke("allow_add", { domain: $("allowinput").value }); $("allowinput").value = ""; $("allowerr").hidden = true; flash(); load(); }
    catch { $("allowerr").hidden = false; }
  });
  $("allowinput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("allowadd").click(); });
  $("histclear").addEventListener("click", async () => { await LW.invoke("clear_history"); history(); });
  $("updcheck").addEventListener("click", async () => { renderUpdate({ state: "checking", current: info.version }); try { renderUpdate(await LW.invoke("check_update")); } catch { renderUpdate({ state: "error", current: info.version }); } });
  $("updinstall").addEventListener("click", async () => { renderUpdate({ state: "installing", current: info.version }); try { await LW.invoke("install_update"); } catch { renderUpdate({ state: "error", current: info.version }); } });
  $("updauto").addEventListener("change", async (e) => { await LW.invoke("set_update_check", { enabled: e.target.checked }); flash(); });
  document.querySelectorAll("input[name=scope]").forEach((r) => r.addEventListener("change", async () => { await LW.invoke("set_scope", { scope: r.value }); flash(); load(); }));
  $("resetid").addEventListener("click", async () => { await LW.invoke("reset_install_id"); flash(); load(); });
  LW.listen("settings-changed", () => { load(); if (tab === "history") history(); });
  LW.listen("update-status", renderUpdate);
  LW.listen("show-tab", (name) => { location.hash = name; showTab(name); });

  await load();
  showTab(tab);
})();
