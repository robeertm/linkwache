// Selbst gehostete Fassung: derselbe Worker, betrieben von Node 22 statt von
// Cloudflare. Der Worker sieht nur `fetch(request, env, ctx)`; alles, was
// Cloudflare sonst bereitstellt (KV, Ratelimit, statische Dateien), gibt es
// hier als kleine Nachbildungen. Mail-Eingang gibt es in dieser Fassung nicht
// (Cloudflare Email Routing) — MAIL_IN bleibt "off".
//
// Betrieb: node server/index.js   (PORT, DATA_DIR, plus die Variablen aus wrangler.toml als Umgebung)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import zlib from "node:zlib";
import worker from "../src/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const DATA = process.env.DATA_DIR || path.join(ROOT, "data");
const PORT = Number(process.env.PORT || 8080);
fs.mkdirSync(path.join(DATA, "kv"), { recursive: true });

// ── KV-Nachbildung: eine JSON-Datei je Schlüssel, Ablauf im Inhalt ────────────
const kvFile = (k) => path.join(DATA, "kv", encodeURIComponent(k) + ".json");
const RESULTS = {
  async get(k) {
    try {
      const j = JSON.parse(fs.readFileSync(kvFile(k), "utf8"));
      if (j.exp && j.exp < Date.now()) { fs.rmSync(kvFile(k), { force: true }); return null; }
      return j.v;
    } catch { return null; }
  },
  async put(k, v, opts = {}) {
    const exp = opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null;
    fs.writeFileSync(kvFile(k), JSON.stringify({ v, exp }));
  },
};
// Abgelaufene Ergebnisse einmal am Tag wegräumen.
setInterval(() => {
  for (const f of fs.readdirSync(path.join(DATA, "kv"))) {
    try { const j = JSON.parse(fs.readFileSync(path.join(DATA, "kv", f), "utf8")); if (j.exp && j.exp < Date.now()) fs.rmSync(path.join(DATA, "kv", f)); } catch { /* egal */ }
  }
}, 86400 * 1000).unref();

// ── Ratelimit-Nachbildung: 20 je Minute je Schlüssel, im Speicher ────────────
const hits = new Map();
const CHECK_LIMIT = {
  async limit({ key }) {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < 60000);
    arr.push(now); hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k);
    return { success: arr.length <= 20 };
  },
};

// ── Statische Dateien ─────────────────────────────────────────────────────────
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".shortcut": "application/octet-stream" };
const ASSETS = {
  async fetch(req) {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      const nf = path.join(PUBLIC, "404.html");
      return new Response(fs.existsSync(nf) ? fs.readFileSync(nf) : "not found", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const ext = path.extname(file).toLowerCase();
    return new Response(fs.readFileSync(file), { headers: { "content-type": MIME[ext] || "application/octet-stream", "cache-control": ext === ".html" ? "no-cache" : "public, max-age=600" } });
  },
};

// Versionsstempel für style/app/theme: ändert sich mit dem Inhalt, damit kein Handy eine alte Fassung aus dem Cache zieht.
const ASSET_VER = crypto.createHash("sha1").update(["style.css","app.js","theme.js"].map((f) => { try { return fs.readFileSync(path.join(PUBLIC, f)); } catch { return ""; } }).join("")).digest("hex").slice(0, 8);
const env = {
  ASSET_VER,
  SITE_NAME: process.env.SITE_NAME || "Linkwache",
  SITE_URL: (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, ""),
  PAYPAL_ME: process.env.PAYPAL_ME || "",
  PAYPAL_MAIL: process.env.PAYPAL_MAIL || "",
  CONTACT_MAIL: process.env.CONTACT_MAIL || "",
  LEGAL_NAME: process.env.LEGAL_NAME || "", LEGAL_STREET: process.env.LEGAL_STREET || "", LEGAL_CITY: process.env.LEGAL_CITY || "", LEGAL_PLACE: process.env.LEGAL_PLACE || "",
  TELEGRAM_BOT: process.env.TELEGRAM_BOT || "",
  MAIL_IN: process.env.MAIL_IN || "off",
  SAFE_BROWSING_KEY: process.env.SAFE_BROWSING_KEY || "",
  URLSCAN_KEY: process.env.URLSCAN_KEY || "",
  URLHAUS_KEY: process.env.URLHAUS_KEY || "",
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || "",
  TELEGRAM_SECRET: process.env.TELEGRAM_SECRET || "",
  RESULTS, CHECK_LIMIT, ASSETS,
};

const SECURITY = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy": "default-src 'self'; img-src 'self' https://urlscan.io data:; style-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
};

// ── Zähler je Tag (keine Adressen, keine Links): Anfragen, Prüfungen, Abweisungen, Bytes ──
// Liegt in data/stats.json; die Antwort auf „wie viel läuft hier eigentlich?" ohne Zugriffslog.
const STATS_FILE = path.join(DATA, "stats.json");
let stats = {};
try { stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8")); } catch { /* frisch */ }
let statsDirty = false;
function count(kind, bytesIn, bytesOut) {
  const d = new Date().toISOString().slice(0, 10);
  const t = stats[d] || (stats[d] = { requests: 0, checks: 0, results: 0, rejected: 0, errors: 0, bytesIn: 0, bytesOut: 0 });
  t.requests++; t.bytesIn += bytesIn; t.bytesOut += bytesOut;
  if (kind) t[kind]++;
  statsDirty = true;
}
function flushStats() {
  if (!statsDirty) return;
  statsDirty = false;
  for (const d of Object.keys(stats)) if (Date.now() - Date.parse(d) > 400 * 86400 * 1000) delete stats[d];
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 1)); } catch (e) { console.error("stats", String(e).slice(0, 100)); }
}
setInterval(flushStats, 60 * 1000).unref();
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { flushStats(); process.exit(0); });

// Textantworten ab 1 KB gzip-komprimiert ausliefern (der DSM-Proxy komprimiert nicht).
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|manifest\+json)|image\/svg)/;

http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : null;
    if (body && body.length > 64 * 1024) { res.writeHead(413).end(); return; }
    // Hinter dem Reverse-Proxy: die echte Absenderadresse kommt per X-Forwarded-For.
    const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    headers.set("cf-connecting-ip", xff || req.socket.remoteAddress || "0");
    const proto = String(req.headers["x-forwarded-proto"] || "http");
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost");
    // Kommt jemand über http (Port 80 am Reverse-Proxy), schicken wir ihn auf die https-Adresse.
    if (req.headers["x-forwarded-proto"] === "http" && env.SITE_URL.startsWith("https://") && !req.url.startsWith("/api/health")) {
      res.writeHead(["GET", "HEAD"].includes(req.method) ? 301 : 308, { ...SECURITY, location: env.SITE_URL + req.url });
      res.end(); return;
    }
    const request = new Request(`${proto}://${host}${req.url}`, { method: req.method, headers, body: body && !["GET", "HEAD"].includes(req.method) ? body : undefined });
    const tasks = [];
    const ctx = { waitUntil: (p) => tasks.push(p), passThroughOnException() {} };
    const r = await worker.fetch(request, env, ctx);
    const out = Object.fromEntries(r.headers.entries());
    let buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 1024 && COMPRESSIBLE.test(out["content-type"] || "") && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""))) {
      buf = zlib.gzipSync(buf);
      out["content-encoding"] = "gzip";
      out["vary"] = [out["vary"], "accept-encoding"].filter(Boolean).join(", ");
      delete out["content-length"];
    }
    res.writeHead(r.status, { ...SECURITY, ...out });
    res.end(buf);
    const p = req.url.split("?")[0];
    count(r.status === 429 ? "rejected" : r.status >= 500 ? "errors" : p === "/api/check" ? "checks" : p.startsWith("/r/") ? "results" : "", body ? body.length : 0, buf.length);
    await Promise.allSettled(tasks);
  } catch (e) {
    console.error(new Date().toISOString(), "fehler", String(e).slice(0, 300));
    try { res.writeHead(500, { "content-type": "text/plain" }).end("Interner Fehler"); } catch { /* zu spät */ }
  }
}).listen(PORT, "0.0.0.0", () => console.log(`Linkwache (selbst gehostet) auf :${PORT}, Daten in ${DATA}, Seite ${env.SITE_URL}`));
