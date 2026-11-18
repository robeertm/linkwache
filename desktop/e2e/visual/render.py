#!/usr/bin/env python3
"""Render every UI state of the desktop app at real window size, light and dark, in several
languages, and report clipped text (elements whose content is wider than their box).

    python desktop/e2e/visual/render.py <output dir> [--langs de,en,ru,tr] [--all-langs]

Needs Python Playwright with Chromium. The app's commands are replaced by mock.js."""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
UI = HERE.parent.parent / "ui"
MOCK = (HERE / "mock.js").read_text()

TOAST = (440, 108)
WARN = (580, 680)
SETUP = (680, 640)
SETTINGS = (820, 620)

# name, page, size, extra query, action
STATES = [
    ("toast-checking", "toast.html", TOAST, "fixture=toast-checking", None),
    ("toast-green", "toast.html", TOAST, "fixture=toast-green", None),
    ("toast-allowlist", "toast.html", TOAST, "fixture=toast-allowlist", None),
    ("toast-refused", "toast.html", TOAST, "fixture=toast-refused", None),
    ("warning-amber", "warning.html", WARN, "fixture=amber", None),
    ("warning-amber-ready", "warning.html", WARN, "fixture=amber&wait=0", None),
    ("warning-amber-reserve", "warning.html", WARN, "fixture=amber-reserve&wait=0", None),
    ("warning-red", "warning.html", WARN, "fixture=red", None),
    ("warning-red-second-step", "warning.html", WARN, "fixture=red-step", "click:#know"),
    ("warning-offline", "warning.html", WARN, "fixture=offline", None),
    ("setup-1-welcome", "setup.html", SETUP, "step=0", None),
    ("setup-2-server", "setup.html", SETUP, "step=1", "click:#test"),
    ("setup-3-browser", "setup.html", SETUP, "step=2", None),
    ("setup-4-default", "setup.html", SETUP, "step=3", "click:#makedefault"),
    ("setup-5-extras", "setup.html", SETUP, "step=4", None),
    ("setup-6-done", "setup.html", SETUP, "step=5", None),
    ("settings-general", "settings.html", SETTINGS, "fixture=settings-general", "hash:general"),
    ("settings-general-paused", "settings.html", SETTINGS, "fixture=settings-general-paused", "hash:general"),
    ("settings-browser", "settings.html", SETTINGS, "fixture=settings-browser", "hash:browser"),
    ("settings-allowlist", "settings.html", SETTINGS, "fixture=x", "hash:allow"),
    ("settings-history", "settings.html", SETTINGS, "fixture=x", "hash:history"),
    ("settings-updates", "settings.html", SETTINGS, "fixture=settings-updates-backup", "hash:updates"),
    ("settings-privacy", "settings.html", SETTINGS, "fixture=x", "hash:privacy"),
    ("tray-menu", "../e2e/visual/tray-menu.html", (520, 380), "", None),
]

CLIP_JS = """
() => {
  const out = [];
  const vis = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !el.closest('[hidden]'); };
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || ['SCRIPT','STYLE','svg','path','circle','INPUT','SELECT','OPTION','MAIN','UL','TABLE','TBODY','TR'].includes(el.tagName)) continue;
    const s = getComputedStyle(el);
    if (s.overflowY === 'auto' || s.overflowY === 'scroll') continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    if (el.scrollWidth > el.clientWidth + 1) out.push({ tag: el.tagName, cls: el.className, id: el.id, text: el.textContent.trim().slice(0, 80), sw: el.scrollWidth, cw: el.clientWidth });
  }
  const doc = document.documentElement;
  if (doc.scrollWidth > innerWidth + 1) out.push({ page: 'horizontal overflow', sw: doc.scrollWidth, w: innerWidth });
  for (const w of document.querySelectorAll('.tablewrap')) if (vis(w) && w.scrollWidth > w.clientWidth + 1) out.push({ page: 'table wider than its card', sw: w.scrollWidth, cw: w.clientWidth });
  const t = document.querySelector('.t-card');
  if (t && t.scrollHeight > t.clientHeight + 1) out.push({ page: 'toast content taller than window', sh: t.scrollHeight, h: t.clientHeight });
  return out;
}
"""


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    langs = ["de", "en", "ru", "tr"]
    if "--langs" in sys.argv:
        langs = sys.argv[sys.argv.index("--langs") + 1].split(",")
    if "--all-langs" in sys.argv:
        langs = ["de", "en", "tr", "pl", "ru", "es", "fr", "it"]
    report = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for theme in ["dark", "light"]:
            for lang in langs:
                for name, page_file, (w, h), query, action in STATES:
                    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, color_scheme=theme)
                    ctx.add_init_script(MOCK)
                    page = ctx.new_page()
                    q = f"{query}&lang={lang}&theme={theme}".lstrip("&")
                    url = (UI / page_file).resolve().as_uri() + "?" + q
                    if action and action.startswith("hash:"):
                        url += "#" + action[5:]
                    page.goto(url)
                    page.wait_for_timeout(350)
                    if action and action.startswith("click:"):
                        page.click(action[6:])
                        page.wait_for_timeout(450)
                    clipped = page.evaluate(CLIP_JS)
                    if clipped:
                        report[f"{theme}/{lang}/{name}"] = clipped
                    d = out / theme / lang
                    d.mkdir(parents=True, exist_ok=True)
                    page.screenshot(path=str(d / f"{name}.png"))
                    ctx.close()
        browser.close()
    (out / "clip-report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
    print(f"rendered {len(STATES)} states x {len(langs)} languages x 2 themes into {out}")
    print(f"clipped: {len(report)} screens" + ("" if not report else " — see clip-report.json"))
    for k, v in list(report.items())[:40]:
        print(" ", k, json.dumps(v, ensure_ascii=False)[:300])


if __name__ == "__main__":
    main()
