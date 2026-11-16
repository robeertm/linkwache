// Fraud lists (PhishTank, URLhaus, urlscan verdicts, Google Safe Browsing) → findings.
// Rules (0.5.3): a list makes a link red only when it names exactly this URL (scheme ignored, host lower case,
// path and query as reported). Entries that only name other pages under the same host or domain are a hint, never
// red. The start page of a well-known site (src/wellknown.js) listed in a fraud list is a stale or wrong entry —
// at most info. Phishing pages hosted on big platforms keep being red, because they are exact URLs with a path.
import { WELL_KNOWN } from "./wellknown.js";
import { BRAND_HOMES } from "./checks.js";

/** Version of the rules that decide a result. Part of every cache key; clients drop older cached results. */
export const RULES = 2;

export function isWellKnown(domain) {
  const d = String(domain || "").toLowerCase();
  return WELL_KNOWN.has(d) || BRAND_HOMES.has(d);
}

/** "http://WWW.Example.org:80/a?b=1#x" → "www.example.org/a?b=1" (scheme and fragment ignored); "" if invalid. */
export function listKey(url) {
  try {
    const u = new URL(String(url));
    if (!/^https?:$/.test(u.protocol)) return "";
    const port = u.port && !["80", "443"].includes(u.port) ? ":" + u.port : "";
    return u.hostname.toLowerCase().replace(/\.$/, "") + port + (u.pathname || "/") + u.search;
  } catch { return ""; }
}

export const sameListedUrl = (a, b) => { const x = listKey(a); return !!x && x === listKey(b); };

/** The start page of a well-known site itself (example.org/ or www.example.org/, no query) — not a subdomain. */
export function isKnownStartPage(url, domain) {
  if (!isWellKnown(domain)) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/\.$/, "");
    const d = String(domain).toLowerCase();
    return (host === d || host === "www." + d) && (u.pathname === "/" || u.pathname === "") && !u.search;
  } catch { return false; }
}

/** One list hit → finding. exact = the list names exactly this URL. */
function hit(list, redKey, p, { exact, url, domain }) {
  if (exact) {
    if (isKnownStartPage(url, domain)) return { key: "list-known", stufe: "info", p: { list } };
    return { key: redKey, stufe: "rot", p };
  }
  return { key: "list-host", stufe: isWellKnown(domain) ? "info" : "gelb", p: { list } };
}

/**
 * sb  Safe Browsing { ok, matches }          (URL lookup with Google's own canonicalisation → exact)
 * uh  URLhaus host  { ok, listed, count }    (only other URLs under the host → never red)
 * uhu URLhaus URL   { ok, listed, status }   (exact URL)
 * pt  PhishTank     { ok, listed, valid, verified, url }
 * us  urlscan search { ok, hits:[{url, malicious}] }
 */
export function listFindings({ url, domain, sb, uh, uhu, pt, us }) {
  const ctx = { url, domain };
  const f = [];
  if (sb?.ok && sb.matches?.length) f.push(hit("Google Safe Browsing", "safebrowsing", { types: sb.matches.join(", ") }, { ...ctx, exact: true }));
  if (uhu?.ok && uhu.listed) f.push(hit("URLhaus", "urlhaus-url", {}, { ...ctx, exact: true }));
  else if (uh?.ok && uh.listed) f.push(hit("URLhaus", "urlhaus", { n: uh.count }, { ...ctx, exact: false }));
  if (pt?.ok && pt.listed && pt.valid) {
    const exact = !pt.url || sameListedUrl(pt.url, url);
    f.push(hit("PhishTank", "phishtank", { verified: !!pt.verified }, { ...ctx, exact }));
  }
  const bad = (us?.ok && us.hits || []).filter((h) => h.malicious);
  if (bad.length) {
    const exact = bad.some((h) => sameListedUrl(h.url, url));
    f.push(hit("urlscan.io", "urlscan-verdict", {}, { ...ctx, exact }));
  }
  // one hint per list is enough; a red finding of the same list wins
  const seen = new Set();
  const out = f.filter((x) => { const k = x.p?.list || x.key; if (seen.has(k)) return false; seen.add(k); return true; });
  const asked = [sb, uhu?.ok ? uhu : uh, pt].filter((x) => x?.ok).length;
  if (asked && !out.length) out.push({ key: "db-clean", stufe: "info", p: { n: asked } });
  return out;
}

/** http:// to a well-known site: these redirect to https; a hint, not a warning sign. */
export function softenHttp(findings, domain) {
  if (!isWellKnown(domain)) return findings;
  return findings.map((x) => (x.key === "http" && x.stufe === "gelb" ? { ...x, stufe: "info", p: { ...(x.p || {}), known: true } } : x));
}
