// Decision logic of the extension without any browser API, so it can be unit-tested in Node.
import { heuristics } from "../../src/checks.js";
import { verdict } from "../../src/verdict.js";
import { hostInfo } from "../../src/util.js";
import { unwrap } from "./unwrap.js";

export const GREEN_TTL = 6 * 3600, WARN_TTL = 24 * 3600;
export const COUNTDOWN_SECONDS = 3;

/** Very large sites that never need a lookup. Matched on the registrable domain only. */
export const BUILTIN_ALLOW = new Set([
  "google.com", "google.de", "bing.com", "duckduckgo.com", "wikipedia.org", "youtube.com", "microsoft.com", "office.com",
  "live.com", "outlook.com", "github.com", "apple.com", "icloud.com", "amazon.de", "amazon.com", "mozilla.org", "gmx.net", "web.de",
]);

export function normalizeHttp(input) {
  try {
    const u = new URL(String(input));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    return u.href;
  } catch { return null; }
}

/** Cheap "same site" test usable before any lookup: equal host, or one is a subdomain of the other, or equal last labels. */
export function sameSite(a, b) {
  a = String(a || "").toLowerCase(); b = String(b || "").toLowerCase();
  if (!a || !b) return false;
  if (a === b || a.endsWith("." + b) || b.endsWith("." + a)) return true;
  const la = a.split("."), lb = b.split(".");
  if (la.length < 2 || lb.length < 2 || /^\d+$/.test(la.at(-1)) || /^\d+$/.test(lb.at(-1))) return false;
  const secondLevel = (l) => l.at(-1).length === 2 && l.at(-2).length <= 3 && l.length >= 3;
  const n = secondLevel(la) || secondLevel(lb) ? 3 : 2;
  return la.slice(-n).join(".") === lb.slice(-n).join(".");
}

/** What may leave the device: scheme://host[:port]/path (no query, no fragment, no credentials), or https://host/ for domain scope. */
export function reduceForSend(url, scope = "url") {
  const u = new URL(url);
  if (scope === "domain") return `https://${u.host}/`;
  return `${u.protocol}//${u.host}${u.pathname}`;
}

export function domainOf(url) { return hostInfo(url).domain; }

/** Allowlist match on the registrable domain; look-alikes (IDN, digit swaps, hyphenated brands) never match. */
export function isAllowed(url, userAllow = []) {
  const h = hostInfo(url);
  if (h.isIdn || h.isIp || /xn--/.test(h.host)) return false;
  if (userAllow.includes(h.domain)) return "user";
  if (BUILTIN_ALLOW.has(h.domain)) {
    const { findings } = heuristics(url);
    if (!findings.some((f) => f.stufe === "rot")) return "builtin";
  }
  return false;
}

/** Local assessment with the server's own heuristics (shared code, shared vectors). */
export function localAssess(url) {
  const { findings } = heuristics(url);
  const v = verdict(findings, { url });
  return { stufe: v.stufe, findings: v.findings.map((f) => ({ key: f.key, stufe: f.stufe, p: f.p || {}, ...(f.muster ? { muster: true } : {}) })) };
}

/** Prepare a link click: unwrap, reduce nothing yet. Returns { target, wrapped } or null for non-http(s). */
export function prepare(raw) {
  const first = normalizeHttp(raw);
  if (!first) return null;
  const inner = unwrap(first);
  return { target: inner || first, wrapped: !!inner };
}

export function cacheKey(url) {
  const u = new URL(url);
  return u.host + u.pathname;
}
export function ttlFor(stufe, cacheTtl) {
  const d = stufe === "gruen" ? GREEN_TTL : WARN_TTL;
  return Math.min(Number(cacheTtl) > 0 ? Number(cacheTtl) : d, WARN_TTL);
}
export function cacheFresh(entry, now = Date.now()) { return !!entry && now - entry.at < entry.ttl * 1000; }

/** result { stufe: gruen|gelb|rot|off } -> what the click does. Offline never opens silently. */
export function decide(stufe) {
  if (stufe === "gruen") return { act: "open", level: "gruen" };
  if (stufe === "gelb" || stufe === "rot" || stufe === "off") return { act: "warn", level: stufe };
  return { act: "warn", level: "off" };
}

/** Navigation intended by a click: same tab, foreground tab, background tab. */
export function modeOf({ button = 0, ctrl = false, meta = false, shift = false, target = "" } = {}) {
  if (button === 1 || ctrl || meta) return "bg";
  if (shift) return "fg";
  if (target && !/^_(self|top|parent)$/i.test(target)) return "fg";
  return "same";
}

export function b64urlEncode(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlDecode(str) {
  const s = atob(String(str).replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(s, (c) => c.charCodeAt(0))));
}

/** Findings of a server answer reduced to what the warning page needs. */
export function slimFindings(list) {
  return (list || []).filter((f) => f.stufe === "rot" || f.stufe === "gelb" || f.stufe === "info").slice(0, 12)
    .map((f) => ({ key: f.key, stufe: f.stufe, p: f.p || {}, ...(f.muster ? { muster: true } : {}), ...(f.titel ? { titel: String(f.titel).slice(0, 200), text: String(f.text || "").slice(0, 500) } : {}) }));
}
