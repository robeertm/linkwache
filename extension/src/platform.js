// What the browser running the extension can do, decided once from the build target and the API that is really there.
// Safari (Safari Web Extension inside a Mac app, docs/DESKTOP.md "Safari") differs from Chromium/Firefox in three places:
//  - native messaging only reaches the extension's own container app, never the desktop app's host
//    app.linkwache.desktop -> the Safari build talks to the server directly (POST /api/v1/check);
//  - declarativeNetRequest session rules with a regex redirect into the extension are not reliable -> not requested,
//    the webNavigation fallback (redirect known-red domains to the warning page) covers known-bad domains;
//  - tabs.create may reject openerTabId/index -> retried without them.
// Everything else (storage.local, webNavigation, tabs, runtime messaging, i18n) is used the same way everywhere.

/** Build target baked in by extension/scripts/build.mjs ("chromium" | "firefox" | "safari"). */
export const TARGET = typeof LW_TARGET === "string" ? LW_TARGET : "chromium";

/** Pure capability table, unit-tested: target + the API object present at runtime. */
export function features(target, api) {
  const a = api || {};
  const safari = target === "safari";
  return {
    target,
    // Safari routes connectNative() to the container app, whatever the host name: never ask it for the desktop app.
    native: !safari && !!(a.runtime && typeof a.runtime.connectNative === "function"),
    dnr: !safari && !!(a.declarativeNetRequest && typeof a.declarativeNetRequest.updateSessionRules === "function"),
    webNavigation: !!(a.webNavigation && a.webNavigation.onBeforeNavigate),
    openerTab: !safari,
  };
}

/** AbortSignal that fires after ms; AbortSignal.timeout where it exists, AbortController + timer otherwise. */
export function timeoutSignal(ms, g = globalThis) {
  if (g.AbortSignal && typeof g.AbortSignal.timeout === "function") return g.AbortSignal.timeout(ms);
  const c = new g.AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/** tabs.create options for a new tab next to the opener; without index/openerTabId where the browser rejects them. */
export function newTabOptions(url, mode, tab, f) {
  const o = { url, active: mode !== "bg" };
  if (tab && f.openerTab) { o.index = tab.index + 1; o.openerTabId = tab.id; }
  return o;
}

/** tabs.create with one retry without the opener fields (older Safari versions throw on unknown properties). */
export async function createTab(tabs, url, mode, tab, f) {
  try { return await tabs.create(newTabOptions(url, mode, tab, f)); } catch (e) {
    if (!tab || !f.openerTab) throw e;
    return tabs.create({ url, active: mode !== "bg" });
  }
}
