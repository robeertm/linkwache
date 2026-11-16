// Linkwache extension: content script. Catches clicks on links to other sites (capture phase), shows a toast in a closed
// shadow root and asks the background script. The page can neither style nor read the toast.
import { api } from "./api.js";
import { sameSite, modeOf, normalizeHttp } from "./logic.js";

let state = { paused: false, strings: { checking: "Linkwache is checking …", ok: "No warning signs – opening" } };
const refresh = () => api.runtime.sendMessage({ t: "init" }).then((s) => { if (s) state = { ...state, ...s }; }).catch(() => {});
refresh();
if (api.storage && api.storage.onChanged) api.storage.onChanged.addListener((c, area) => { if (area === "local" && (c.settings || c.install)) refresh(); });

function anchorOf(e) {
  const path = e.composedPath ? e.composedPath() : [];
  for (const n of path) if (n && n.tagName === "A" && n.hasAttribute && n.hasAttribute("href")) return n;
  return e.target && e.target.closest ? e.target.closest("a[href]") : null;
}

function toast(domain) {
  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;top:16px;right:16px;z-index:2147483647";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    .t{all:initial;display:block;box-sizing:border-box;min-width:240px;max-width:min(360px,calc(100vw - 32px));padding:14px 18px;border-radius:14px;
      font:14px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;background:#241d45;color:#efedfa;border:1px solid rgba(167,139,250,.55);box-shadow:0 10px 30px rgba(0,0,0,.35)}
    .s{display:block;color:#c9bdfc;font-size:13px}
    .d{display:block;margin-top:4px;font-size:20px;font-weight:700;overflow-wrap:anywhere;color:#fff}
    .t.ok{border-color:rgba(52,211,153,.7)}.t.ok .s{color:#6ee7b7}
    @media (prefers-color-scheme:light){.t{background:#fff;color:#1d1838;border-color:rgba(109,79,214,.5)}.s{color:#6d4fd6}.d{color:#1d1838}.t.ok .s{color:#1f9e6a}}`;
  const box = document.createElement("div");
  box.className = "t"; box.setAttribute("role", "status");
  const s = document.createElement("span"); s.className = "s"; s.textContent = state.strings.checking;
  const d = document.createElement("span"); d.className = "d"; d.textContent = domain;
  box.append(s, d); root.append(style, box);
  (document.body || document.documentElement).append(host);
  return { ok() { box.classList.add("ok"); s.textContent = state.strings.ok; }, remove() { host.remove(); } };
}

async function handle(e, a, mode) {
  e.preventDefault(); e.stopImmediatePropagation();
  const url = a.href;
  let domain = ""; try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { /* shown empty */ }
  const tt = toast(domain);
  const frame = a.target && !/^_blank$/i.test(a.target) ? a.target : "_self";
  try {
    const r = await api.runtime.sendMessage({ t: "check", url, mode });
    if (r && r.act === "open") {
      tt.ok();
      await new Promise((res) => setTimeout(res, 800));
      tt.remove();
      if (mode === "same") window.open(url, frame); else await api.runtime.sendMessage({ t: "go", url, mode });
    } else if (r && r.act === "pass") {
      tt.remove();
      if (mode === "same") window.open(url, frame); else await api.runtime.sendMessage({ t: "go", url, mode });
    } else tt.remove();   // the warning page is already opening
  } catch { tt.remove(); }
}

function onClick(e) {
  if (e.isTrusted === false || state.paused) return;
  if (e.type === "auxclick" && e.button !== 1) return;
  if (e.type === "click" && e.button !== 0) return;
  const a = anchorOf(e);
  if (!a) return;
  const href = normalizeHttp(a.href);
  if (!href) return;
  let host; try { host = new URL(href).hostname; } catch { return; }
  if (location.hostname && sameSite(host, location.hostname)) return;
  handle(e, a, modeOf({ button: e.button, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, target: a.target }));
}
window.addEventListener("click", onClick, true);
window.addEventListener("auxclick", onClick, true);
