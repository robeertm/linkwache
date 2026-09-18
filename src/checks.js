// Die eigentlichen Prüfungen. Jede liefert Befunde ({key, stufe, titel, text})
// und Fakten. Nichts hier ruft die geprüfte Seite selbst auf — das tut
// ausschließlich die urlscan-Sandbox (scan.js), nie der Worker, nie der Nutzer.
//
// Stufen: "rot" = klares Warnzeichen · "gelb" = auffällig · "info" = gut zu
// wissen · "gruen" = spricht für die Seite.
import { hostInfo, SHORTENERS, fetchTimeout, daysBetween } from "./util.js";

// Endungen, die in Betrugskampagnen weit überproportional vorkommen (Spamhaus/
// Cloudflare-Radar-Listen, Stand 2026) und praktisch nie bei deutschen Firmen.
const RISKY_TLDS = new Set([
  "zip", "mov", "top", "xyz", "icu", "cfd", "rest", "sbs", "cyou", "click", "gq", "ml",
  "cf", "ga", "tk", "buzz", "monster", "quest", "bond", "lat", "boats", "hair", "makeup",
  "skin", "beauty", "motorcycles", "autos", "cam", "surf", "fun", "life", "run", "live",
  "work", "world", "link", "site", "online", "website", "space", "store", "shop", "vip",
  "biz.id", "my.id", "web.id", "co.vu", "pw", "su", "ws", "cc", "asia", "bar", "best",
]);

// Marken, die Betrüger im Hostnamen nachahmen. Treffer in Subdomain oder mit
// Tippfehler in der Domain sind ein starkes Zeichen.
const BRANDS = [
  "paypal", "sparkasse", "volksbank", "postbank", "commerzbank", "deutschebank", "ing-diba",
  "dkb", "comdirect", "n26", "klarna", "amazon", "dhl", "dpd", "hermes", "ups", "fedex",
  "deutschepost", "whatsapp", "telegram", "signal", "instagram", "facebook", "microsoft",
  "office365", "outlook", "apple", "icloud", "google", "netflix", "disney", "spotify",
  "ebay", "kleinanzeigen", "vinted", "zalando", "otto", "lidl", "aldi", "rewe", "telekom",
  "vodafone", "o2", "1und1", "ionos", "strato", "gmx", "web.de", "bahn", "elster",
  "bundesagentur", "finanzamt", "polizei", "ikea", "steam", "playstation", "xbox", "coinbase",
  "binance", "bitpanda", "trade-republic", "scalable", "check24", "booking", "airbnb",
];

const LURE_WORDS = [
  "login", "signin", "anmelden", "verify", "verifizier", "bestaetig", "bestätig", "secure",
  "sicherheit", "konto", "account", "update", "aktualisier", "wallet", "sperr", "unlock",
  "freischalt", "vote", "voting", "abstimm", "gewinn", "prize", "bonus", "paket", "zustell",
  "delivery", "zoll", "customs", "gebuehr", "invoice", "rechnung", "mahnung", "steuer", "refund",
  "rueckerstatt", "support", "helpdesk", "2fa", "otp", "code", "webmail", "password", "passwort",
];

// ── Ohne Netz ─────────────────────────────────────────────────────────────────

export function heuristics(url) {
  const f = [];
  const h = hostInfo(url);
  const u = new URL(url);

  if (h.isIp) f.push({ key: "ip-host", stufe: "rot", p: {} });

  if (u.username || u.password || url.includes("@")) f.push({ key: "at-sign", stufe: "rot", p: {} });

  if (h.isIdn) f.push({ key: "idn", stufe: "gelb", p: { host: h.unicodeHost } });

  if (u.protocol === "http:") f.push({ key: "http", stufe: "gelb", p: {} });

  if (h.port && !["80", "443"].includes(h.port)) f.push({ key: "port", stufe: "gelb", p: { port: h.port } });

  const tldKey = h.tld.toLowerCase();
  const tldTail = tldKey.split(".").pop();
  if (RISKY_TLDS.has(tldKey) || RISKY_TLDS.has(tldTail)) f.push({ key: "tld", stufe: "gelb", p: { tld: h.tld } });

  const lowerHost = h.host.replace(/-/g, "");
  const domLower = h.domain.toLowerCase();
  for (const b of BRANDS) {
    const bb = b.replace(/[-.]/g, "");
    const inSub = h.sub && h.sub.replace(/[-.]/g, "").includes(bb);
    const inDomain = domLower.replace(/[-.]/g, "").includes(bb);
    const isBrandDomain = domLower === b + "." + h.tld || domLower.startsWith(b + ".");
    if (inSub && !isBrandDomain) {
      f.push({ key: "brand-sub", stufe: "rot", p: { brand: b, domain: h.domain } });
      break;
    }
    if (inDomain && !isBrandDomain && domLower.split(".")[0] !== b) {
      f.push({ key: "brand-typo", stufe: "rot", p: { brand: b, domain: h.domain } });
      break;
    }
    void lowerHost;
  }

  if (h.subCount >= 3) f.push({ key: "subdomains", stufe: "gelb", p: {} });

  const pathLow = decodeURIComponent(h.path).toLowerCase();
  const hits = LURE_WORDS.filter((w) => pathLow.includes(w) || domLower.includes(w));
  if (hits.length) f.push({ key: "lure", stufe: hits.length >= 2 ? "gelb" : "info", p: { words: [...new Set(hits)].slice(0, 4).join(", ") } });

  if (SHORTENERS.has(h.domain)) f.push({ key: "shortener", stufe: "info", p: {} });

  if (url.length > 120) f.push({ key: "long", stufe: "info", p: {} });

  return { findings: f, host: h };
}

// ── Mit Netz (jede Prüfung fällt einzeln aus, nie alle) ──────────────────────

/** Kurzlink auflösen: nur HEAD auf Kurzlink-Dienste, höchstens 5 Sprünge, das Ziel wird NICHT angefragt. */
export async function unwrapShortener(url) {
  const chain = [url];
  let cur = url;
  for (let i = 0; i < 5; i++) {
    const h = hostInfo(cur);
    if (!SHORTENERS.has(h.domain)) break;
    try {
      const r = await fetchTimeout(cur, { method: "HEAD", redirect: "manual", headers: { "user-agent": "Linkwache/1.0 (+https://linkwache.de)" } }, 5000);
      const loc = r.headers.get("location");
      if (!loc) break;
      cur = new URL(loc, cur).href;
      chain.push(cur);
    } catch { break; }
  }
  return { finalUrl: cur, chain };
}

// DNS über HTTPS, per IP angesprochen: Namen wie dns.google werden von manchen
// Filtern (NextDNS „Umgehungen blockieren“) auf 0.0.0.0 umgebogen. Erst 1.1.1.1, dann 8.8.8.8.
async function doh(name, type) {
  const q = `name=${encodeURIComponent(name)}&type=${type}`;
  let j;
  try {
    const r = await fetchTimeout(`https://1.1.1.1/dns-query?${q}`, { headers: { accept: "application/dns-json" } }, 4000);
    j = await r.json();
  } catch {
    const r = await fetchTimeout(`https://8.8.8.8/resolve?${q}`, {}, 4000);
    j = await r.json();
  }
  return (j.Answer || []).map((a) => ({ type: a.type, data: String(a.data).replace(/\.$/, "") }));
}

export async function dnsFacts(host, domain) {
  const [a, aaaa, ns, mx] = await Promise.all([doh(host, "A"), doh(host, "AAAA"), doh(domain, "NS"), doh(domain, "MX")]);
  const ips = [...a, ...aaaa].filter((x) => x.type === 1 || x.type === 28).map((x) => x.data);
  const nsList = ns.filter((x) => x.type === 2).map((x) => x.data.toLowerCase());
  const mxList = mx.filter((x) => x.type === 15).map((x) => x.data);
  const cloudflare = nsList.some((n) => n.endsWith("ns.cloudflare.com")) || ips.some((ip) => /^(104\.1[6-9]|104\.2[0-7]|172\.6[4-9]|172\.7[01]|162\.15[89]|2606:4700)/.test(ip));
  return { ips, ns: nsList, mx: mxList, cloudflare, resolves: ips.length > 0 };
}

export function dnsFindings(d, host) {
  const f = [];
  if (d.error) return [{ key: "dns-error", stufe: "info", p: {} }];
  if (!d.resolves) f.push({ key: "nxdomain", stufe: "info", p: {} });
  if (d.cloudflare) f.push({ key: "cloudflare", stufe: "info", p: {} });
  if (d.resolves && d.mx.length === 0) f.push({ key: "no-mx", stufe: "info", p: {} });
  void host;
  return f;
}

/** RDAP (der Whois-Nachfolger, als JSON): Alter, Registrar, Status. */
export async function rdapFacts(domain) {
  const r = await fetchTimeout(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { headers: { accept: "application/rdap+json" }, redirect: "follow" }, 8000);
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json();
  const ev = Object.fromEntries((j.events || []).map((e) => [e.eventAction, e.eventDate]));
  let registrar = "";
  for (const ent of j.entities || []) {
    if ((ent.roles || []).includes("registrar")) {
      const v = ent.vcardArray?.[1] || [];
      const fn = v.find((x) => x[0] === "fn");
      registrar = fn ? fn[3] : (ent.handle || "");
    }
  }
  return { ok: true, created: ev.registration || ev["registration"] || null, updated: ev["last changed"] || null,
    expires: ev.expiration || null, registrar, status: j.status || [] };
}

export function rdapFindings(rd) {
  const f = [];
  if (!rd.ok) {
    f.push({ key: "rdap-none", stufe: "info", p: {} });
    return f;
  }
  if (rd.created) {
    const age = daysBetween(new Date(rd.created));
    if (age <= 30) f.push({ key: "age-fresh", stufe: "rot", p: { days: age } });
    else if (age <= 180) f.push({ key: "age-young", stufe: "gelb", p: { age } });
    else if (age >= 365 * 3) f.push({ key: "age-old", stufe: "gruen", p: { years: Math.floor(age / 365) } });
  }
  return f;
}

/** Zertifikatslisten (crt.sh): wann tauchte der Name zum ersten Mal auf? */
export async function ctFacts(domain) {
  const r = await fetchTimeout(`https://crt.sh/?q=${encodeURIComponent("%." + domain)}&output=json`, {}, 8000);
  if (!r.ok) return { ok: false };
  const j = await r.json();
  if (!Array.isArray(j) || !j.length) return { ok: true, count: 0, first: null };
  const first = j.map((e) => e.not_before).sort()[0];
  return { ok: true, count: j.length, first };
}

/** Google Safe Browsing v4 — die Liste hinter Chrome/Firefox-Warnungen. */
export async function safeBrowsing(url, key) {
  if (!key) return { ok: false, skipped: true };
  const body = {
    client: { clientId: "linkwache", clientVersion: "1.0" },
    threatInfo: {
      threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
      platformTypes: ["ANY_PLATFORM"], threatEntryTypes: ["URL"], threatEntries: [{ url }],
    },
  };
  const r = await fetchTimeout(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${key}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, 6000);
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json();
  return { ok: true, matches: (j.matches || []).map((m) => m.threatType) };
}

/** URLhaus (abuse.ch) — Schadsoftware-Verteiler. */
export async function urlhaus(host, key) {
  const headers = { "content-type": "application/x-www-form-urlencoded" };
  if (key) headers["Auth-Key"] = key;
  const r = await fetchTimeout("https://urlhaus-api.abuse.ch/v1/host/", { method: "POST", headers, body: "host=" + encodeURIComponent(host) }, 6000);
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json();
  return { ok: true, listed: j.query_status === "ok", count: Number(j.url_count || 0) };
}

/** PhishTank — gemeldete Phishing-Seiten (ohne Schlüssel, begrenzt). */
export async function phishtank(url) {
  const r = await fetchTimeout("https://checkurl.phishtank.com/checkurl/", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "phishtank/linkwache" },
    body: "url=" + encodeURIComponent(url) + "&format=json",
  }, 6000);
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json();
  const res = j.results || {};
  return { ok: true, listed: !!res.in_database, valid: !!res.valid, verified: !!res.verified };
}

export function dbFindings({ sb, uh, pt, us }) {
  const f = [];
  if (sb?.ok && sb.matches?.length) f.push({ key: "safebrowsing", stufe: "rot", p: { types: sb.matches.join(", ") } });
  if (uh?.ok && uh.listed) f.push({ key: "urlhaus", stufe: "rot", p: { n: uh.count } });
  if (pt?.ok && pt.listed && pt.valid) f.push({ key: "phishtank", stufe: "rot", p: { verified: !!pt.verified } });
  if (us?.ok && us.malicious) f.push({ key: "urlscan-verdict", stufe: "rot", p: {} });
  const none = [sb, uh, pt].filter((x) => x?.ok).length;
  if (none && !f.length) f.push({ key: "db-clean", stufe: "info", p: { n: none } });
  return f;
}

// ── urlscan.io: vorhandene Scans suchen, neuen Scan anstoßen, Ergebnis holen ──

export async function urlscanSearch(domain) {
  const r = await fetchTimeout(`https://urlscan.io/api/v1/search/?q=domain:${encodeURIComponent(domain)}&size=3`, {}, 6000);
  if (!r.ok) return { ok: false };
  const j = await r.json();
  const hits = (j.results || []).map((x) => ({ time: x.task?.time, url: x.task?.url, malicious: !!x.verdicts?.overall?.malicious, uuid: x.task?.uuid }));
  return { ok: true, total: j.total || 0, hits, malicious: hits.some((h) => h.malicious) };
}

export async function urlscanSubmit(url, key) {
  if (!key) return { ok: false, skipped: true };
  const r = await fetchTimeout("https://urlscan.io/api/v1/scan/", {
    method: "POST", headers: { "content-type": "application/json", "API-Key": key },
    body: JSON.stringify({ url, visibility: "unlisted", tags: ["linkwache"] }),
  }, 8000);
  if (!r.ok) return { ok: false, status: r.status, text: (await r.text()).slice(0, 200) };
  const j = await r.json();
  return { ok: true, uuid: j.uuid, api: j.api, result: j.result, status: "pending" };
}

export async function urlscanResult(uuid, key) {
  const headers = key ? { "API-Key": key } : {};
  const r = await fetchTimeout(`https://urlscan.io/api/v1/result/${uuid}/`, { headers }, 8000);
  if (r.status === 404) return { ok: true, status: "pending" };
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json();
  const page = j.page || {};
  const v = j.verdicts?.overall || {};
  // Sandbox konnte die Seite gar nicht laden (z. B. Name nicht auflösbar) → urlscan liefert
  // unter der Screenshot-URL nur ein 404-Platzhalterbild. Das darf nicht als "so sieht die Seite aus" erscheinen.
  const failed = (j.data?.requests || []).map((x) => x.response?.failed).find((f) => f && f.type === "Document");
  let screenshot = `https://urlscan.io/screenshots/${uuid}.png`;
  try { const h = await fetchTimeout(screenshot, { method: "HEAD" }, 5000); if (!h.ok) screenshot = null; } catch { /* im Zweifel Bild lassen */ }
  return {
    ok: true, status: "done",
    screenshot, loadError: failed?.errorText || "",
    reportUrl: `https://urlscan.io/result/${uuid}/`,
    title: page.title || "", finalUrl: page.url || "", ip: page.ip || "", country: page.country || "",
    server: page.server || "", asn: page.asnname || "",
    malicious: !!v.malicious, score: v.score ?? null, categories: v.categories || [], brands: (v.brands || []).map((b) => b.name || b),
    requests: j.stats?.requests ?? null, forms: (j.data?.requests || []).length,
  };
}
