#!/usr/bin/env python3
"""Safari build in WebKit (the engine of Safari) — what can be checked without a Mac.
Loads the pages of extension/dist/safari (warning page, options page) in Playwright's WebKit with a stubbed `browser.*`
API (storage in memory, the background script answering like Safari: no desktop app) and checks that the scripts run in
WebKit, the texts are there in several languages and nothing opens by itself. Real Safari with the extension enabled is
only available on a Mac (safari/scripts/build-local.sh); safaridriver cannot load extensions.
Run:  ~/.venvs/slk-pw1.49.1/bin/python extension/test/e2e/webkit.py [--shots DIR]   (after: node extension/scripts/build.mjs safari)"""
import base64, json, os, sys
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.abspath(os.path.join(HERE, "..", "..", "dist", "safari"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else None
FAIL = []

def ok(cond, what):
    print(("PASS " if cond else "FAIL ") + what)
    if not cond: FAIL.append(what)

STUB = """
(() => {
  const mem = { settings: { lang: %(lang)s, server: "https://lw.example", scope: "url", paused: false } };
  window.__sent = [];
  globalThis.browser = {
    runtime: {
      getManifest: () => ({ version: "test" }),
      getURL: (p) => location.href.replace(/[^/]*$/, "") + p,
      sendMessage: async (m) => { window.__sent.push(m); if (m.t === "appStatus") return { unsupported: true, target: "safari" };
        if (m.t === "testServer") return { ok: false, reason: "access", host: "lw.example" }; return { ok: true }; },
      openOptionsPage: () => { window.__sent.push({ t: "openOptions" }); },
    },
    permissions: { request: async (o) => { window.__sent.push({ t: "permRequest", o }); return false; }, contains: async () => false },
    storage: { local: { get: async (k) => { const o = {}; for (const x of [].concat(k || Object.keys(mem))) if (x in mem) o[x] = mem[x]; return o; }, set: async (o) => Object.assign(mem, o) },
               onChanged: { addListener: () => {} } },
    i18n: { getUILanguage: () => %(lang)s },
  };
})();
"""

def b64url(obj):
    return base64.urlsafe_b64encode(json.dumps(obj, ensure_ascii=False).encode()).decode().rstrip("=")

RED = {"u": "https://bank.secure-login.example/konto", "s": "rot", "w": False, "m": "new",
       "f": [{"key": "brand-sub", "stufe": "rot", "p": {"brand": "bank", "domain": "secure-login.example"}}, {"key": "http", "stufe": "gelb", "p": {}}]}
# Safari without site access to the check server (0.7.1): honest reason, the Safari steps, a button that asks Safari.
ACCESS = {"u": "https://files.example/a.png?jwt=" + ".".join(["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJ4In0", "c2lnbmF0dXJl"]),   # dummy JWT, joined at runtime (leak scan)
          "s": "off", "w": False, "m": "same", "f": [],
          "e": "access", "h": "lw.example", "c": 0}
AMBER = {"u": "http://offer-parcel.example/track", "s": "gelb", "w": True, "m": "new", "f": [{"key": "http", "stufe": "gelb", "p": {}}]}

def page(b, lang, look, w, h):
    ctx = b.new_context(viewport={"width": w, "height": h}, color_scheme=look, locale=lang)
    ctx.add_init_script(STUB % {"lang": json.dumps(lang)})
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    return ctx, pg, errs

def main():
    ok(os.path.isfile(os.path.join(DIST, "manifest.json")), "safari build exists")
    with sync_playwright() as p:
        b = p.webkit.launch()
        for lang, look in (("de", "light"), ("en", "dark"), ("fr", "light")):
            for name, data in (("red", RED), ("amber", AMBER)):
                ctx, pg, errs = page(b, lang, look, 1100, 720)
                pg.goto("file://" + os.path.join(DIST, "warning.html") + "#d=" + b64url(data))
                pg.wait_for_selector("#title:not(:empty)")
                title = pg.text_content("#title")
                ok(not errs, f"{lang} {name}: no script error in WebKit {errs[:1]}")
                ok(pg.evaluate("document.body.classList.contains(%s)" % json.dumps("rot" if name == "red" else "gelb")), f"{lang} {name}: level class set")
                ok(len(title) > 5 and "ext.w." not in title, f"{lang} {name}: translated title '{title}'")
                ok(pg.evaluate("document.documentElement.lang") == lang, f"{lang} {name}: page language")
                ok("secure-login" in pg.content() or "offer-parcel" in pg.content(), f"{lang} {name}: target shown")
                if SHOTS:
                    os.makedirs(SHOTS, exist_ok=True)
                    pg.screenshot(path=os.path.join(SHOTS, f"safari-webkit-warning-{name}-{lang}-{look}.png"), full_page=True)
                if name == "red" and lang == "de":
                    pg.wait_for_timeout(1500)
                    ok(not any(m.get("t") in ("go", "proceed") for m in pg.evaluate("window.__sent")), "red: nothing opened by itself")
                ctx.close()
        for lang, look, w, h in (("de", "light", 1100, 760), ("en", "dark", 390, 844)):
            ctx, pg, errs = page(b, lang, look, w, h)
            pg.goto("file://" + os.path.join(DIST, "warning.html") + "#d=" + b64url(ACCESS))
            pg.wait_for_selector("#title:not(:empty)")
            ok(not errs, f"access {lang}: no script error in WebKit {errs[:1]}")
            ok(pg.is_visible("#whyBox") and pg.is_visible("#guide") and "Safari" in pg.text_content("#guide"), f"access {lang}: reason and Safari steps shown")
            ok("lw.example" in pg.text_content("#whyServer"), f"access {lang}: check server named")
            ok(pg.is_visible("#grant") and pg.is_visible("#retry") and pg.is_visible("#settings"), f"access {lang}: allow / check again / settings buttons")
            url = pg.text_content("#url")
            ok("eyJh…" in url and "eyJzdWIi" not in url, f"access {lang}: token shortened: {url}")
            pg.click("#grant"); pg.wait_for_timeout(300)
            ok(any(m.get("t") == "permRequest" and m["o"]["origins"] == ["https://lw.example/*"] for m in pg.evaluate("window.__sent")), f"access {lang}: asks Safari for the server's site access")
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, f"safari-webkit-warning-access-{lang}-{look}.png"), full_page=True)
            ctx.close()
        for lang in ("de", "en"):
            ctx, pg, errs = page(b, lang, "light", 1000, 900)
            pg.goto("file://" + os.path.join(DIST, "options.html"))
            pg.wait_for_function("document.getElementById('appState').textContent.length > 10")
            st = pg.text_content("#appState")
            ok(not errs, f"options {lang}: no script error {errs[:1]}")
            ok("Safari" in st, f"options {lang}: desktop-app line explains the Safari limit: '{st}'")
            pg.click("#test"); pg.wait_for_timeout(400)
            ok("lw.example" in pg.text_content("#testOut") and pg.is_visible("#testOut"), f"options {lang}: test connection names reason and server: '{pg.text_content('#testOut')}'")
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, f"safari-webkit-options-{lang}.png"), full_page=True)
            ctx.close()
        b.close()
    if FAIL:
        print(f"{len(FAIL)} FAILED"); sys.exit(1)
    print("ALL PASSED")

main()
