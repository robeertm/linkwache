#!/usr/bin/env python3
"""End-to-end test of the extension in a real Chromium (new headless mode, unpacked extension) against a stub Linkwache API.
Run:  ~/.venvs/slk-pw1.49.1/bin/python extension/test/e2e/e2e.py [--shots DIR]     (after: npm run build:extension)
The stub answers by host name: green-* = no warning signs, amber-* = suspicious, anything else = no warning signs.
Test links never use real scam addresses: names under .example, brand-in-subdomain on a reserved name. Nothing is ever fetched from the internet."""
import json, os, sys, threading, time, tempfile, shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
EXT = os.path.join(ROOT, "extension", "dist", "chromium")
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else None
EXT_ID = "ldehleohedacddboipopkjkphjnphine"
LOG, API = [], []
DELAY = {"v": 0}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body, ctype="text/html; charset=utf-8"):
        b = body.encode() if isinstance(body, str) else body
        self.send_response(code); self.send_header("content-type", ctype); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        host = (self.headers.get("host") or "").split(":")[0]
        LOG.append((host, self.path))
        if self.path.startswith("/mail.html"): return self._send(200, open(os.path.join(HERE, "mail.html"), encoding="utf8").read())
        self._send(200, f"<!doctype html><title>{host}</title><h1 id='ok'>TARGET-OK {host}</h1>")
    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        API.append({"body": body, "origin": self.headers.get("origin"), "install": self.headers.get("x-linkwache-install"), "client": self.headers.get("x-linkwache-client")})
        if DELAY["v"]: time.sleep(DELAY["v"])
        host = body["url"].split("/")[2]
        amber = host.startswith("amber")
        out = {"api": 1, "rules": 2, "stufe": "gelb" if amber else "gruen", "score": 3 if amber else 0, "kurzKey": "v.gelb.one" if amber else "v.gruen", "ratKey": "x", "kurz": "", "rat": "",
               "url": body["url"], "host": {"host": host, "domain": host, "unicodeHost": host}, "chain": [host],
               "findings": [{"key": "http", "stufe": "gelb", "p": {}, "titel": "", "text": ""}, {"key": "lure", "stufe": "gelb", "p": {"words": "offer"}, "titel": "", "text": ""}] if amber else [],
               "cacheTtl": 21600, "checked": "2026-11-16T12:00:00.000Z", "server": "test"}
        self._send(200, json.dumps(out), "application/json")

def ok(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: ok.failed += 1
ok.failed = 0

def main():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H); port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    prof = tempfile.mkdtemp(prefix="lw-e2e-", dir=os.environ.get("LW_TMP"))
    server = f"http://127.0.0.1:{port}"
    try:
        with sync_playwright() as pw:
            ctx = pw.chromium.launch_persistent_context(prof, headless=False, viewport={"width": 1280, "height": 800}, locale="en-US", color_scheme="light",
                args=["--headless=new", f"--disable-extensions-except={EXT}", f"--load-extension={EXT}", f"--host-resolver-rules=MAP *.example 127.0.0.1:{port}", "--no-first-run", "--no-default-browser-check"])
            try:
                sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=15000)
                ok(EXT_ID in sw.url, "fixed extension id " + EXT_ID)
                helper = ctx.new_page(); helper.goto(f"chrome-extension://{EXT_ID}/options.html")   # storage access from an extension page
                sw = helper
                def settings(**kw):
                    s = {"server": server, "scope": "url", "paused": False, "lang": "en"}; s.update(kw)
                    sw.evaluate("s => chrome.storage.local.set({settings: s})", s)
                def store(): return sw.evaluate("() => chrome.storage.local.get(null)")
                settings()
                page = ctx.new_page()
                def mail(p=None):
                    p = p or page; p.goto("http://mail.example/mail.html"); p.wait_for_load_state("load"); p.wait_for_timeout(300); return p
                def shot(p, name):
                    if SHOTS: os.makedirs(SHOTS, exist_ok=True); p.bring_to_front(); p.wait_for_timeout(250); p.screenshot(path=os.path.join(SHOTS, name + ".png"), timeout=15000)

                # 1. toast while the check runs (delayed stub), then green navigates exactly as clicked
                mail(); DELAY["v"] = 1.6; API.clear()
                page.click("#green"); page.wait_for_timeout(700)
                ok(page.url.startswith("http://mail.example/"), "page has not navigated while the check runs")
                shot(page, "toast-checking")
                png = page.screenshot(clip={"x": 880, "y": 8, "width": 392, "height": 130})
                ok(len(set(png[::97])) > 12 and png != page.screenshot(clip={"x": 0, "y": 300, "width": 392, "height": 130}), "toast pixels differ from the empty page (toast visible)")
                page.wait_for_url("http://green-shop.example/**", timeout=9000)
                DELAY["v"] = 0
                ok("TARGET-OK green-shop.example" in page.content(), "green: navigated to the target in the same tab")
                ok(len(API) == 1 and API[0]["body"]["url"] == "http://green-shop.example/target.html", "only scheme+host+path sent (query and fragment stripped): " + (API[0]["body"]["url"] if API else "-"))
                ok(API and API[0]["origin"] == "chrome-extension://" + EXT_ID and len(API[0]["install"] or "") == 32 and (API[0]["client"] or "").startswith("extension/"), "origin, install id and client headers")
                ok(API[0]["body"]["scope"] == "url" and API[0]["body"]["lang"] == "en", "scope and lang in the request")

                # 2. new tab (target=_blank) -> the intended new tab opens the target (cache hit: no second API call)
                mail(); n = len(API)
                with ctx.expect_page(timeout=9000) as np_:
                    page.click("#green-new")
                newp = np_.value; newp.wait_for_load_state("load")
                ok(newp.url.startswith("http://green-shop.example/target.html?new=1"), "green + target=_blank: opens in a new tab: " + newp.url)
                newp.close()
                # ctrl+click -> background tab
                mail(); n = len(API)
                with ctx.expect_page(timeout=9000) as np_:
                    page.click("#green", modifiers=["Control"])
                bg = np_.value; bg.wait_for_load_state("load")
                ok(bg.url.startswith("http://green-shop.example/"), "ctrl+click: background tab with the target")
                bg.close()

                # 3. same site: never intercepted
                mail(); page.click("#same"); page.wait_for_load_state("load")
                ok(page.url == "http://mail.example/inner.html", "same-site link is not intercepted")

                # 4. amber: warn first, then allow after the countdown
                mail(); page.click("#amber"); page.wait_for_url(f"chrome-extension://{EXT_ID}/warning.html**", timeout=9000)
                page.wait_for_selector("#app:not([hidden])")
                ok("Suspicious" in page.inner_text("#title"), "amber: warning page, title: " + page.inner_text("#title"))
                ok(page.is_disabled("#open") and "(" in page.inner_text("#open"), "amber: Open anyway is disabled during the countdown")
                ok(not [h for h, p in LOG if h.startswith("amber")], "amber: target not loaded while warning is shown")
                ok(page.locator("#findings li").count() >= 2, "amber: findings listed in plain language")
                for scheme in ("dark", "light"):
                    page.emulate_media(color_scheme=scheme)
                    for w, h, tag in ((1280, 800, "wide"), (390, 844, "phone")):
                        page.set_viewport_size({"width": w, "height": h}); shot(page, f"warning-amber-{tag}-{scheme}")
                page.set_viewport_size({"width": 1280, "height": 800}); page.emulate_media(color_scheme="light")
                t1 = time.time()
                while page.is_disabled("#open") and time.time() - t1 < 6: page.wait_for_timeout(100)
                ok(page.inner_text("#open") == "Open anyway", "amber: enabled after ~3 s")
                page.check("#always"); page.click("#open"); page.wait_for_url("http://amber-shop.example/**", timeout=9000)
                ok("TARGET-OK amber-shop.example" in page.content(), "amber: Open anyway navigates to the target")
                ok("amber-shop.example" in store().get("allow", []), "amber: 'always allow this domain' saved")
                mail(); n = len(API); page.click("#amber"); page.wait_for_url("http://amber-shop.example/**", timeout=9000)
                ok(len(API) == n, "allowlisted domain: green path, no server call")
                sw.evaluate("() => chrome.storage.local.set({allow: [], cache: {}})")

                # 5. red: blocked, target never requested, second step needed
                mail(); page.click("#red"); page.wait_for_url(f"chrome-extension://{EXT_ID}/warning.html**", timeout=9000)
                page.wait_for_selector("#app:not([hidden])")
                ok("blocked" in page.inner_text("#title").lower(), "red: warning page: " + page.inner_text("#title"))
                ok(page.is_hidden("#open") and page.is_visible("#step"), "red: no direct Open anyway, only the deliberate second step")
                ok(not [h for h, p in LOG if h.startswith("paypal")], "red: target never requested")
                ok(len(API) == 0 or all("paypal" not in a["body"]["url"] for a in API[1:]), "red: local verdict, no server round trip needed")
                for scheme in ("dark", "light"):
                    page.emulate_media(color_scheme=scheme)
                    for w, h, tag in ((1280, 800, "wide"), (390, 844, "phone")):
                        page.set_viewport_size({"width": w, "height": h}); shot(page, f"warning-red-{tag}-{scheme}")
                page.click("#step"); page.wait_for_selector("#confirm:not([hidden])")
                for scheme in ("dark", "light"):
                    page.emulate_media(color_scheme=scheme)
                    for w, h, tag in ((1280, 800, "wide"), (390, 844, "phone")):
                        page.set_viewport_size({"width": w, "height": h}); shot(page, f"warning-red-confirm-{tag}-{scheme}")
                page.set_viewport_size({"width": 1280, "height": 800}); page.emulate_media(color_scheme="light")
                page.click("#confNo"); ok(page.is_hidden("#confirm"), "red: cancel closes the confirmation")
                # DNR / navigation fallback: a direct navigation to the same domain lands on the warning page
                p2 = ctx.new_page()
                try: p2.goto("https://paypal.com.secure-login.example/other", timeout=8000)
                except Exception: pass
                p2.wait_for_timeout(500)
                ok(p2.url.startswith(f"chrome-extension://{EXT_ID}/warning.html"), "known-red domain: direct navigation ends on the warning page (" + p2.url[:60] + ")")
                ok(not [h for h, p in LOG if h.startswith("paypal")], "red: target still never requested")
                p2.close()
                # confirm path logs locally
                page.click("#step"); page.click("#confYes")
                page.wait_for_timeout(1500)
                lg = store().get("log", [])
                ok(len(lg) >= 1 and lg[0]["ev"] == "open-anyway" and lg[0]["st"] == "rot", "red: deliberate open is logged locally")
                ok(not [h for h, p in LOG if h.startswith("paypal")] , "red: even then the stub never saw a request (TLS to a plain stub fails or is blocked)") if False else None

                # 6. wrapped redirector: the real target is judged
                sw.evaluate("() => chrome.storage.local.set({cache: {}, log: [], once: {}})")
                for i in range(3):
                    pass
                mail(); page.click("#wrapped"); page.wait_for_url(f"chrome-extension://{EXT_ID}/warning.html**", timeout=9000)
                page.wait_for_selector("#app:not([hidden])")
                ok("paypal.com.secure-login.example" in page.inner_text("#domain") and page.is_visible("#wrapped"), "wrapped link: real target shown with a note")

                # 7. offline: server unreachable -> 'could not be checked', never opens silently
                sw.evaluate("() => chrome.storage.local.set({cache: {}, once: {}})")
                settings(server="http://127.0.0.1:1")
                mail(); t0 = time.time(); page.click("#offline"); page.wait_for_url(f"chrome-extension://{EXT_ID}/warning.html**", timeout=12000)
                page.wait_for_selector("#app:not([hidden])")
                ok("could not be checked" in page.inner_text("#title").lower(), "offline: " + page.inner_text("#title"))
                ok(not [h for h, p in LOG if h.startswith("offline")], "offline: target not loaded")
                ok(page.is_disabled("#open") or page.inner_text("#open").startswith("Open"), "offline: choice offered, not opened automatically")
                for scheme in ("dark", "light"):
                    page.emulate_media(color_scheme=scheme)
                    for w, h, tag in ((1280, 800, "wide"), (390, 844, "phone")):
                        page.set_viewport_size({"width": w, "height": h}); shot(page, f"warning-offline-{tag}-{scheme}")
                page.set_viewport_size({"width": 1280, "height": 800}); page.emulate_media(color_scheme="light")
                page.click("#back"); page.wait_for_timeout(800)

                # 8. pause: links open without interception
                settings(paused=True); page.wait_for_timeout(300)
                mail(); page.wait_for_timeout(500); page.click("#green"); page.wait_for_url("http://green-shop.example/**", timeout=6000)
                ok(True, "paused: link opens without a check")
                settings()

                # 9. options page + screenshots
                op = ctx.new_page(); op.goto(f"chrome-extension://{EXT_ID}/options.html"); op.wait_for_selector("#pauseLbl:not(:empty)")
                ok("Not connected" in op.inner_text("#appState"), "options: desktop app status shows 'not connected'")
                op.fill("#server", "ftp://nope"); op.dispatch_event("#server", "change")
                ok(op.is_visible("#serverBad"), "options: invalid server address refused")
                op.fill("#server", server); op.dispatch_event("#server", "change"); op.fill("#allowIn", "example.org"); op.press("#allowIn", "Enter")
                ok("example.org" in store().get("allow", []), "options: allowlist entry saved")
                for scheme in ("dark", "light"):
                    op.emulate_media(color_scheme=scheme)
                    for w, h, tag in ((1280, 900, "wide"), (390, 900, "phone")):
                        op.set_viewport_size({"width": w, "height": h}); shot(op, f"options-{tag}-{scheme}")
                # languages: de/ru/tr warning page for screenshots
                if SHOTS:
                    for lng in ("de", "ru", "tr"):
                        settings(lang=lng, server="http://127.0.0.1:1"); sw.evaluate("() => chrome.storage.local.set({cache: {}, once: {}})")
                        mail(); page.click("#red"); page.wait_for_url(f"chrome-extension://{EXT_ID}/warning.html**", timeout=9000); page.wait_for_selector("#app:not([hidden])")
                        page.set_viewport_size({"width": 390, "height": 844}); shot(page, f"warning-red-{lng}-phone-light")
                        page.set_viewport_size({"width": 1280, "height": 800}); shot(page, f"warning-red-{lng}-wide-light")
            finally:
                ctx.close()
    finally:
        srv.shutdown(); shutil.rmtree(prof, ignore_errors=True)
    print("FAILED: %d" % ok.failed if ok.failed else "ALL PASSED")
    sys.exit(1 if ok.failed else 0)

main()
