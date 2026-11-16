// Linkwache extension: service worker (Chromium) / background script (Firefox).
// Decides for every intercepted link: allowlist -> cache -> local heuristics -> desktop app or server. Never opens silently
// when the check fails. Docs: docs/DESKTOP.md sections 4-6, docs/API.md.
import { api } from "./api.js";
import { getAll, set, installId, validServer, DEFAULTS } from "./store.js";
import { t, pickLang } from "./i18n.js";
import * as native from "./native.js";
import { hostInfo } from "../../src/util.js";
import { prepare, isAllowed, localAssess, reduceForSend, cacheKey, cacheFresh, ttlFor, decide, b64urlEncode, slimFindings, normalizeHttp, RULES, purgeOlderRules } from "./logic.js";

const TIMEOUT_MS = 6000;
const CACHE_MAX = 400;
const VERSION = api.runtime.getManifest().version;
const DNR = api.declarativeNetRequest;
const warningBase = () => api.runtime.getURL("warning.html");

const langOf = (settings) => pickLang(settings.lang, api.i18n?.getUILanguage?.() || "en");

// ── Check pipeline ───────────────────────────────────────────────────────────
async function serverCheck(target, st, lang) {
  if (!validServer(st.settings.server)) return null;
  const body = JSON.stringify({ url: reduceForSend(target, st.settings.scope), lang, scope: st.settings.scope });
  try {
    const r = await fetch(st.settings.server.replace(/\/$/, "") + "/api/v1/check", {
      method: "POST",
      headers: { "content-type": "application/json", "x-linkwache-install": await installId(), "x-linkwache-client": "extension/" + VERSION },
      body, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.api === 1 && ["gruen", "gelb", "rot"].includes(j.stufe) ? j : null;
  } catch { return null; }
}

/** Returns { stufe: gruen|gelb|rot|off, findings, target, wrapped, domain, source } or null when the link is not http(s). */
export async function evaluate(raw) {
  const prep = prepare(raw);
  if (!prep) return null;
  const { target, wrapped } = prep;
  const st = await getAll();
  const lang = langOf(st.settings);
  const domain = hostInfo(target).domain;
  const base = { target, wrapped, domain };

  const allowed = isAllowed(target, st.allow);
  if (allowed) return { ...base, stufe: "gruen", findings: [], source: "allowlist" };

  const key = cacheKey(target);
  const hit = st.cache[key];
  if (cacheFresh(hit)) return { ...base, stufe: hit.st, findings: hit.f, source: "cache" };

  const local = localAssess(target);
  if (local.stufe === "rot") {
    await remember(key, domain, "rot", local.findings, 86400, RULES);
    return { ...base, stufe: "rot", findings: local.findings, source: "local" };
  }

  let res = null;
  if (native.appInfo() || (await native.hello(VERSION))) res = await native.check(reduceForSend(target, st.settings.scope), lang);
  const fromApp = !!res;
  if (res && res.offline) return { ...base, stufe: "off", findings: slimFindings(res.local && res.local.findings), source: "app" };
  if (!res) res = await serverCheck(target, st, lang);
  if (!res) return { ...base, stufe: "off", findings: local.findings.filter((f) => f.stufe !== "info"), source: "local" };

  const findings = slimFindings(res.findings);
  const rules = Number(res.rules) || (fromApp ? RULES : 1);
  if (rules > RULES) await newerRules(rules);
  await remember(key, domain, res.stufe, findings, ttlFor(res.stufe, res.cacheTtl), rules);
  return { ...base, stufe: res.stufe, findings, source: res.source || "server" };
}

async function remember(key, domain, stufe, findings, ttl, rules) {
  const { cache } = await getAll();
  cache[key] = { st: stufe, f: findings, at: Date.now(), ttl, d: domain, r: rules };
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX) for (const k of keys.sort((a, b) => cache[a].at - cache[b].at).slice(0, keys.length - CACHE_MAX)) delete cache[k];
  await set({ cache });
  if (stufe === "rot") await blockDomain(domain);
}

// ── Known-red domains: declarativeNetRequest session rules (Chromium) + webNavigation fallback ──
const ruleId = (domain) => { let h = 7; for (const c of domain) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 1 + (h % 2000000000); };

async function blockDomain(domain) {
  if (!DNR || !DNR.updateSessionRules || !domain) return;
  try {
    await DNR.updateSessionRules({
      removeRuleIds: [ruleId(domain)],
      addRules: [{ id: ruleId(domain), priority: 1, action: { type: "redirect", redirect: { regexSubstitution: warningBase() + "#r=\\1" } },
        condition: { regexFilter: "^(https?://.*)$", requestDomains: [domain], resourceTypes: ["main_frame"] } }],
    });
  } catch { /* the navigation fallback still covers it */ }
}
async function unblockDomain(domain) {
  try { if (DNR && DNR.updateSessionRules) await DNR.updateSessionRules({ removeRuleIds: [ruleId(domain)] }); } catch { /* none */ }
}
/** Drop cached results of older rules and the domain blocks built from them (after an update or when the
 * server answers with newer rules) — a fixed false alarm must not live on in the cache. */
async function dropOlderRules(minRules) {
  const { cache } = await getAll();
  const gone = purgeOlderRules(cache, minRules);
  if (!gone.length) return;
  await set({ cache });
  try { const rules = await DNR.getSessionRules(); await DNR.updateSessionRules({ removeRuleIds: rules.map((x) => x.id) }); } catch { /* none */ }
  await rebuildRules();
}
async function newerRules(r) {
  const seen = Number((await api.storage.local.get("rulesSeen")).rulesSeen) || RULES;
  if (r <= seen) return;
  await api.storage.local.set({ rulesSeen: r });
  await dropOlderRules(r);
}

async function rebuildRules() {
  const { cache, allow } = await getAll();
  const once = (await api.storage.local.get("once")).once || {};
  for (const e of Object.values(cache)) if (e.st === "rot" && cacheFresh(e) && !allow.includes(e.d) && !(once[e.d] > Date.now())) await blockDomain(e.d);
}

async function redCached(url) {
  const { cache, allow } = await getAll();
  let domain; try { domain = hostInfo(url).domain; } catch { return false; }
  if (allow.includes(domain)) return false;
  const once = (await api.storage.local.get("once")).once || {};
  if (once[domain] > Date.now()) return false;
  const e = cache[cacheKey(url)];
  if (cacheFresh(e) && e.st === "rot") return true;
  return Object.values(cache).some((x) => x.d === domain && x.st === "rot" && cacheFresh(x));
}

if (api.webNavigation && api.webNavigation.onBeforeNavigate) {
  api.webNavigation.onBeforeNavigate.addListener(async (d) => {
    if (d.frameId !== 0 || !normalizeHttp(d.url)) return;
    if (await redCached(d.url)) api.tabs.update(d.tabId, { url: warningBase() + "#r=" + d.url }).catch(() => {});
  });
}

// ── Opening ──────────────────────────────────────────────────────────────────
function warnUrl(r, mode) {
  return warningBase() + "#d=" + b64urlEncode({ u: r.target, s: r.stufe, f: r.findings.slice(0, 10), w: r.wrapped, m: mode === "same" ? "same" : "new" });
}
async function openIn(sender, url, mode) {
  const tab = sender.tab;
  if (mode === "same" && tab) return api.tabs.update(tab.id, { url });
  return api.tabs.create({ url, active: mode !== "bg", ...(tab ? { index: tab.index + 1, openerTabId: tab.id } : {}) });
}

async function logEvent(ev, stufe, domain) {
  const { log } = await getAll();
  log.unshift({ t: Date.now(), ev, st: stufe, d: domain });
  await set({ log: log.slice(0, 50) });
  native.notify({ type: "log", event: ev, stufe, domain });
}

async function proceed({ domain, always, stufe }) {
  const st = await getAll();
  const once = (await api.storage.local.get("once")).once || {};
  once[domain] = Date.now() + 120000;
  for (const [k, v] of Object.entries(once)) if (v < Date.now()) delete once[k];
  await set({ once });
  await unblockDomain(domain);
  if (always && stufe !== "rot" && !st.allow.includes(domain)) { await set({ allow: [...st.allow, domain].sort() }); native.notify({ type: "allow", domain }); }
  await logEvent("open-anyway", stufe, domain);
  return { ok: true };
}

// ── Messages from content scripts and extension pages ────────────────────────
api.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    switch (m && m.t) {
      case "init": {
        const st = await getAll();
        const lang = langOf(st.settings);
        const app = native.appInfo();
        return { paused: !!(st.settings.paused || (app && app.paused)), strings: { checking: t(lang, "ext.toast.checking"), ok: t(lang, "ext.toast.ok") } };
      }
      case "check": {
        const st = await getAll();
        const app = native.appInfo();
        if (st.settings.paused || (app && app.paused)) return { act: "pass" };
        const r = await evaluate(m.url);
        if (!r) return { act: "pass" };
        const d = decide(r.stufe);
        if (d.act === "open") return { act: "open", source: r.source };
        await openIn(sender, warnUrl(r, m.mode), m.mode);
        return { act: "warn", level: d.level };
      }
      case "go": if (normalizeHttp(m.url)) await openIn(sender, m.url, m.mode); return { ok: true };
      case "proceed": return proceed(m);
      case "close": if (sender.tab) await api.tabs.remove(sender.tab.id); return { ok: true };
      case "recheck": {
        const r = await evaluate(m.url);
        return r ? { ...r, level: decide(r.stufe).level } : null;
      }
      case "appStatus": return (await native.hello(VERSION)) || null;
      case "clearCache": {
        await set({ cache: {} });
        try { const rules = await DNR.getSessionRules(); await DNR.updateSessionRules({ removeRuleIds: rules.map((x) => x.id) }); } catch { /* none */ }
        return { ok: true };
      }
      default: return undefined;
    }
  })().then(reply, () => reply(undefined));
  return true;
});

if (api.action && api.action.onClicked) api.action.onClicked.addListener(() => api.runtime.openOptionsPage());
if (api.runtime.onInstalled) api.runtime.onInstalled.addListener(async () => { await installId(); await set({ settings: (await getAll()).settings }); await dropOlderRules(RULES); });
if (api.runtime.onStartup) api.runtime.onStartup.addListener(() => { rebuildRules(); });
rebuildRules();
native.hello(VERSION);
