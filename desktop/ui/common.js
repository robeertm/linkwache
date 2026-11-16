// Shared helpers of all Linkwache windows: strings, theme, calls into the app.
// Plain script (no bundler). Strings come from i18n.generated.js (window.LW_I18N).
"use strict";

const LW = (() => {
  const B = window.LW_I18N;
  let lang = "en";

  function t(key, p = {}) {
    const d = B.strings[lang] || {};
    let s = d[key] ?? B.strings.de[key] ?? key;
    for (const [k, v] of Object.entries(p || {})) s = s.split("{" + k + "}").join(String(v));
    return s;
  }

  // Same rules as findingText() in src/i18n.js; server findings bring their own texts.
  function findingText(f) {
    if (f.titel) return { titel: f.titel, text: f.text || "" };
    const k = f.muster ? "pat." + f.key : "f." + f.key;
    const p = f.p || {};
    let text;
    if (f.key === "phishtank") text = t(p.verified ? "f.phishtank.t.v" : "f.phishtank.t.u");
    else if (f.key === "urlscan-verdict") text = p.brands ? t("f.urlscan-verdict.b", p) : t("f.urlscan-verdict.t");
    else if (f.key === "age-fresh") text = t("f.age-fresh.t");
    else text = t(k + ".t", p);
    const titel = f.key === "age-fresh"
      ? t("f.age-fresh", { age: p.days === 0 ? t("age.hours") : t("age.days", { n: p.days }) })
      : t(k, p);
    return { titel, text };
  }

  function setLang(l) {
    lang = B.langs.includes(l) ? l : "en";
    document.documentElement.lang = lang;
    apply(document);
  }

  // data-i18n="key" → textContent; data-i18n-ph="key" → placeholder; data-i18n-title → title.
  function apply(root) {
    root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    root.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  }

  function theme() {
    const q = new URLSearchParams(location.search).get("theme");
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const set = () => { document.documentElement.dataset.theme = q || (mq.matches ? "light" : "dark"); };
    set();
    if (!q) mq.addEventListener("change", set);
  }

  function invoke(cmd, args = {}) {
    if (window.__TAURI__) return window.__TAURI__.core.invoke(cmd, args);
    if (window.LW_MOCK) return Promise.resolve().then(() => window.LW_MOCK.invoke(cmd, args));
    return Promise.reject(new Error("no app"));
  }

  function listen(event, cb) {
    if (window.__TAURI__) return window.__TAURI__.event.listen(event, (e) => cb(e.payload));
    if (window.LW_MOCK && window.LW_MOCK.listen) window.LW_MOCK.listen(event, cb);
    return Promise.resolve(() => {});
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, "");
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  }

  function fmtTime(sec, withDate = false) {
    const d = new Date(sec * 1000);
    const o = withDate ? { dateStyle: "short", timeStyle: "short" } : { timeStyle: "short" };
    try { return new Intl.DateTimeFormat(lang, o).format(d); } catch { return d.toLocaleString(); }
  }

  const LOGO = '<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#a78bfa"/><path d="M32 10 14 17v14c0 11 7.6 19.6 18 23 10.4-3.4 18-12 18-23V17L32 10z" fill="#1c1038" opacity=".95"/><path d="M23 33.5l6 6 12-13" fill="none" stroke="#a78bfa" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // Disable the webview's own context menu and reload shortcuts: these are app windows.
  document.addEventListener("contextmenu", (e) => { if (!e.target.closest("input")) e.preventDefault(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "R"))) e.preventDefault();
  });

  async function boot() {
    theme();
    let info = { lang: "en", platform: "linux", version: "" };
    try { info = await invoke("bootstrap"); } catch { /* preview without the app */ }
    setLang(info.lang);
    document.querySelectorAll("[data-logo]").forEach((x) => { x.innerHTML = LOGO; });
    return info;
  }

  return { t, findingText, setLang, apply, invoke, listen, esc, el, fmtTime, boot, LOGO, get lang() { return lang; } };
})();
