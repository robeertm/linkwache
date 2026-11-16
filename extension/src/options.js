// Options page: server address, what is sent, language, allowlist, pause, desktop app status, local log.
import { api } from "./api.js";
import { getAll, set, validServer, randomHex, PRESET } from "./store.js";
import { presetMarkFor } from "./preset.js";
import { t, pickLang, LANGS } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const NAMES = { de: "Deutsch", en: "English", tr: "Türkçe", pl: "Polski", ru: "Русский", es: "Español", fr: "Français", it: "Italiano" };
let st, lang;

const flash = (msg) => { $("saved").textContent = msg; setTimeout(() => ($("saved").textContent = ""), 2000); };

function texts() {
  document.title = t(lang, "ext.o.title"); $("title").textContent = t(lang, "ext.o.title");
  $("pauseLbl").textContent = t(lang, "ext.o.pause"); $("pauseHint").textContent = t(lang, "ext.o.pause.hint");
  $("appLbl").textContent = t(lang, "ext.o.app");
  $("serverLbl").textContent = t(lang, "ext.o.server"); $("serverHint").textContent = t(lang, "ext.o.server.hint"); $("serverBad").textContent = t(lang, "ext.o.server.bad");
  $("scopeLbl").textContent = t(lang, "ext.o.scope"); $("scopeUrl").textContent = t(lang, "ext.o.scope.url"); $("scopeDomain").textContent = t(lang, "ext.o.scope.domain");
  $("langLbl").textContent = t(lang, "ext.o.lang");
  $("allowLbl").textContent = t(lang, "ext.o.allow"); $("allowEmpty").textContent = t(lang, "ext.o.allow.empty"); $("allowAdd").textContent = t(lang, "ext.o.allow.add");
  $("logLbl").textContent = t(lang, "ext.o.log"); $("logEmpty").textContent = t(lang, "ext.o.log.empty");
  $("privacy").textContent = t(lang, "ext.o.privacy"); $("clear").textContent = t(lang, "ext.o.clear"); $("reset").textContent = t(lang, "ext.o.reset");
  const sel = $("lang"); sel.textContent = "";
  const auto = document.createElement("option"); auto.value = "auto"; auto.textContent = t(lang, "ext.o.lang.auto"); sel.append(auto);
  for (const l of LANGS) { const o = document.createElement("option"); o.value = l; o.textContent = NAMES[l]; sel.append(o); }
  sel.value = st.settings.lang;
}

function lists() {
  const ul = $("allowList"); ul.textContent = "";
  for (const d of st.allow) {
    const li = document.createElement("li"); li.append(d);
    const b = document.createElement("button"); b.type = "button"; b.textContent = t(lang, "ext.o.allow.remove");
    b.addEventListener("click", async () => { st.allow = st.allow.filter((x) => x !== d); await set({ allow: st.allow }); lists(); });
    li.append(b); ul.append(li);
  }
  $("allowEmpty").hidden = st.allow.length > 0;
  const log = $("logList"); log.textContent = "";
  for (const e of st.log) { const li = document.createElement("li"); li.textContent = new Date(e.t).toLocaleString(lang) + " · " + e.d + " · " + t(lang, "stufe." + (e.st === "rot" ? "rot" : "gelb")); log.append(li); }
  $("logEmpty").hidden = st.log.length > 0;
}

async function saveSettings() {
  const server = $("server").value.trim();
  const ok = !server || validServer(server);
  $("serverBad").hidden = ok;
  if (!ok) return;
  st.settings = { ...st.settings, server, serverPreset: presetMarkFor(server, PRESET), scope: document.querySelector("input[name=scope]:checked").value, paused: $("paused").checked, lang: $("lang").value };
  await set({ settings: st.settings });
  lang = pickLang(st.settings.lang, (api.i18n && api.i18n.getUILanguage && api.i18n.getUILanguage()) || navigator.language);
  texts(); lists(); flash(t(lang, "ext.o.saved"));
}

async function main() {
  st = await getAll();
  lang = pickLang(st.settings.lang, (api.i18n && api.i18n.getUILanguage && api.i18n.getUILanguage()) || navigator.language);
  document.documentElement.lang = lang;
  texts(); lists();
  $("server").value = st.settings.server; $("paused").checked = st.settings.paused;
  document.querySelector(`input[name=scope][value=${st.settings.scope === "domain" ? "domain" : "url"}]`).checked = true;
  for (const el of [$("server"), $("paused"), $("lang"), ...document.querySelectorAll("input[name=scope]")]) el.addEventListener("change", saveSettings);
  $("allowForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = $("allowIn").value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (/^[a-z0-9.-]+\.[a-z0-9-]{2,}$/.test(v) && !st.allow.includes(v)) { st.allow = [...st.allow, v].sort(); await set({ allow: st.allow }); }
    $("allowIn").value = ""; lists();
  });
  $("clear").addEventListener("click", async () => { await api.runtime.sendMessage({ t: "clearCache" }); flash(t(lang, "ext.o.done")); });
  $("reset").addEventListener("click", async () => { await set({ install: randomHex(16) }); flash(t(lang, "ext.o.done")); });
  const app = await api.runtime.sendMessage({ t: "appStatus" }).catch(() => null);
  $("appState").textContent = app && app.unsupported ? t(lang, "ext.o.app.safari") : app && app.app ? t(lang, "ext.o.app.on", { v: app.app }) : t(lang, "ext.o.app.off");
}
main();
