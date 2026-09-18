// Kleine Helfer ohne Netz: Links aus Text fischen, normalisieren, Kennungen.
import { parse as parseHost } from "tldts";

// Bekannte Kurzlink-Dienste: nur diese werden per HEAD aufgelöst, nie das Ziel.
export const SHORTENERS = new Set([
  "bit.ly", "t.co", "tinyurl.com", "cutt.ly", "rb.gy", "is.gd", "goo.gl", "ow.ly",
  "buff.ly", "t.ly", "shorturl.at", "rebrand.ly", "s.id", "lnkd.in", "tiny.cc",
  "shorte.st", "adf.ly", "u.to", "v.gd", "qr.ae", "bl.ink", "short.io", "kurzelinks.de",
  "t1p.de", "ogy.de", "1url.de", "shorturl.com", "surl.li", "clck.ru", "vk.cc",
]);

const URL_RE = /\bhttps?:\/\/[^\s<>"'()\[\]{}]+|\bwww\.[^\s<>"'()\[\]{}]+/gi;

/** Alle Links aus einem freien Text (Nachricht, Mail). Ohne Schema wird https angenommen. */
export function extractUrls(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text || "").matchAll(URL_RE)) {
    let u = m[0].replace(/[.,;:!?…»)]+$/u, "");
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    try {
      const parsed = new URL(u);
      if (!parsed.hostname.includes(".")) continue;
      const key = parsed.href;
      if (!seen.has(key)) { seen.add(key); out.push(parsed.href); }
    } catch { /* kein Link */ }
  }
  return out;
}

/** Eine Eingabe des Nutzers → eine URL oder null. Nimmt auch "sparkasse-login.top". */
export function normalizeInput(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const found = extractUrls(s);
  if (found.length) return found[0];
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(s)) {
    try { return new URL("https://" + s).href; } catch { return null; }
  }
  return null;
}

/** Zerlegung des Hosts: registrierbare Domain, Endung, Subdomains, IDN. */
export function hostInfo(url) {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  const p = parseHost(host, { allowPrivateDomains: false });
  const isIp = !!p.isIp;
  const domain = p.domain || host;
  const tld = p.publicSuffix || host.split(".").pop();
  const sub = p.subdomain || "";
  const unicode = safeToUnicode(host);
  return {
    host, domain, tld, sub, isIp,
    subCount: sub ? sub.split(".").length : 0,
    isIdn: host.includes("xn--") || /[^\x00-\x7f]/.test(unicode),
    unicodeHost: unicode,
    port: u.port || "",
    path: u.pathname + u.search,
  };
}

function safeToUnicode(host) {
  try { return new URL("http://" + host).hostname; } catch { return host; }
}

/** Kurze, url-taugliche Kennung für Ergebnis-Links. */
export function shortId(len = 8) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

export async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const UA = "Linkwache/1.0 (+https://linkwache.de; Link-Pruefung ohne Aufruf der Zielseite)";

/** fetch mit Zeitlimit und Absenderkennung (rdap.org antwortet ohne User-Agent mit 403). */
export async function fetchTimeout(url, init = {}, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const headers = { "user-agent": UA, ...(init.headers || {}) };
  try {
    return await fetch(url, { ...init, headers, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Link so darstellen, dass niemand ihn versehentlich anklickt: hxxps://, Punkte in Klammern. */
export function defang(url) {
  return String(url).replace(/^http/i, "hxxp").replace(/\./g, "[.]");
}

export function daysBetween(a, b = new Date()) {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}
