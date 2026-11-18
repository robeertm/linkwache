// Warning page: amber = warn first, then allow (3 s countdown); red = blocked, only a deliberate second step opens it;
// offline = "could not be checked" with the local assessment. Never opens by itself.
import { api } from "./api.js";
import { getAll } from "./store.js";
import { t, pickLang, findingView, whyText } from "./i18n.js";
import { b64urlDecode, b64urlEncode, localAssess, COUNTDOWN_SECONDS } from "./logic.js";
import { TARGET } from "./platform.js";
import { hostInfo } from "../../src/util.js";
import { maskSecrets } from "../../src/redact.js";

const $ = (id) => document.getElementById(id);

async function load() {
  const h = location.hash;
  if (h.startsWith("#d=")) { try { return b64urlDecode(h.slice(3)); } catch { return null; } }
  if (h.startsWith("#r=")) {
    const url = h.slice(3);
    const r = await api.runtime.sendMessage({ t: "recheck", url });
    if (!r) return null;
    return { u: r.target, s: r.stufe === "gruen" ? "gelb" : r.stufe, f: r.findings, w: r.wrapped, m: "same", ...(r.why ? { e: r.why, h: r.host || "", c: r.status || 0 } : {}), ...(r.via ? { v: r.via } : {}) };
  }
  return null;
}

function defang(u) { return u.replace(/^http/i, "hxxp").replace(/\./g, "[.]"); }

/** Why the check did not finish, with what helps: check again, allow access (asks the browser), open the settings. */
function showWhy(lang, d) {
  const why = whyText(lang, d.e, d.c);
  if (why) {
    $("whyBox").hidden = false;
    $("why").textContent = why;
    if (d.h) $("whyServer").textContent = t(lang, "ext.w.server") + ": " + d.h; else $("whyServer").hidden = true;
  }
  $("offActions").hidden = false;
  $("retry").textContent = t(lang, "ext.w.retry");
  $("retry").addEventListener("click", async () => {
    $("retry").disabled = true;
    const r = await api.runtime.sendMessage({ t: "recheck", url: d.u }).catch(() => null);
    if (r && r.stufe === "gruen") { location.href = d.u; return; }
    const next = r ? { u: d.u, s: r.stufe, f: r.findings || [], w: d.w, m: d.m, ...(r.why ? { e: r.why, h: r.host || "", c: r.status || 0 } : {}), ...(r.via ? { v: r.via } : {}) } : d;
    location.hash = "#d=" + b64urlEncode(next);
    location.reload();
  });
  if (d.e === "access") {
    $("guide").hidden = false;
    $("guide").textContent = t(lang, TARGET === "safari" ? "ext.w.guide.safari" : "ext.w.guide.other");
    if (api.permissions && api.permissions.request && d.h) {
      $("grant").hidden = false;
      $("grant").textContent = t(lang, "ext.w.grant");
      // permissions.request must run in the click itself (user gesture), so no await before it.
      $("grant").addEventListener("click", () => {
        api.permissions.request({ origins: ["https://" + d.h + "/*"] }).then((ok) => { if (ok) $("retry").click(); }, () => {});
      });
    }
  }
  if (d.e === "noserver" || d.e === "access") {
    $("settings").hidden = false;
    $("settings").textContent = t(lang, "ext.w.settings");
    $("settings").addEventListener("click", () => api.runtime.openOptionsPage());
  }
}

async function main() {
  const st = await getAll();
  const lang = pickLang(st.settings.lang, (api.i18n && api.i18n.getUILanguage && api.i18n.getUILanguage()) || navigator.language);
  document.documentElement.lang = lang;
  const d = await load();
  if (!d || !/^https?:\/\//i.test(d.u || "")) { api.runtime.sendMessage({ t: "close" }); return; }
  const level = ["gelb", "rot", "off"].includes(d.s) ? d.s : "off";
  document.body.classList.add(level);
  const h = hostInfo(d.u);
  const domain = h.domain;

  if (level === "off") $("badge").hidden = true; else $("badge").textContent = t(lang, "stufe." + (level === "rot" ? "rot" : "gelb"));
  $("title").textContent = t(lang, "ext.w.title." + level);
  document.title = "Linkwache – " + t(lang, "ext.w.title." + level);
  $("lead").textContent = t(lang, "ext.w.lead." + level);
  $("targetLbl").textContent = t(lang, "ext.w.target");
  $("domain").textContent = h.isIdn ? h.unicodeHost + " (" + h.host + ")" : h.host;
  $("url").textContent = defang(maskSecrets(d.u));   // tokens and signatures in the query are shortened, never shown in full
  if (d.w) { $("wrapped").hidden = false; $("wrapped").textContent = t(lang, "ext.w.wrapped"); }
  if (level === "off") showWhy(lang, d);
  if (d.v === "reserve") { $("via").hidden = false; $("via").textContent = t(lang, "ext.w.via.reserve"); }

  let findings = (d.f || []).filter((f) => f.stufe !== "info" || level === "off");
  if (level === "off" && !findings.length) findings = localAssess(d.u).findings.filter((f) => f.stufe !== "info");
  $("findLbl").textContent = t(lang, level === "off" ? "ext.w.local" : "ext.w.findings");
  const ul = $("findings");
  for (const f of findings) {
    const v = findingView(lang, f);
    const li = document.createElement("li"); li.className = f.stufe;
    const dot = document.createElement("span"); dot.className = "dot";
    const box = document.createElement("div");
    const b = document.createElement("b"); b.textContent = v.titel;
    const s = document.createElement("span"); s.textContent = v.text;
    box.append(b, s); li.append(dot, box); ul.append(li);
  }
  if (!findings.length) { $("none").hidden = false; $("none").textContent = t(lang, "ext.w.nofinding"); }

  $("back").textContent = t(lang, "ext.w.back");
  $("back").addEventListener("click", () => {
    if (d.m === "same" && history.length > 1) { history.back(); setTimeout(() => api.runtime.sendMessage({ t: "close" }), 400); }
    else api.runtime.sendMessage({ t: "close" });
  });
  $("back").focus();

  const go = async () => {
    await api.runtime.sendMessage({ t: "proceed", domain, stufe: level, always: $("always").checked });
    location.href = d.u;
  };

  if (level === "rot") {
    $("open").hidden = true;
    $("step").hidden = false; $("step").textContent = t(lang, "ext.w.rot.step");
    $("step").addEventListener("click", () => { $("confirm").hidden = false; $("step").hidden = true; $("confNo").focus(); });
    $("confH").textContent = t(lang, "ext.w.rot.h"); $("confP").textContent = t(lang, "ext.w.rot.p");
    $("confNo").textContent = t(lang, "ext.w.rot.no"); $("confYes").textContent = t(lang, "ext.w.rot.yes");
    $("confNo").addEventListener("click", () => { $("confirm").hidden = true; $("step").hidden = false; });
    $("confYes").addEventListener("click", go);
  } else {
    $("alwaysRow").hidden = level === "off" ? true : false;
    $("alwaysLbl").textContent = t(lang, "ext.w.always") + " (" + domain + ")";
    let n = COUNTDOWN_SECONDS;
    const tick = () => {
      if (n > 0) { $("open").textContent = t(lang, "ext.w.open.wait", { n }); n--; setTimeout(tick, 1000); }
      else { $("open").textContent = t(lang, "ext.w.open"); $("open").disabled = false; }
    };
    tick();
    $("open").addEventListener("click", () => { if (!$("open").disabled) go(); });
  }
  $("app").hidden = false;
}
main();
