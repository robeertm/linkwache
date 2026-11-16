// Usage metrics of the self-hosted build (contract "dienst-stats/1"): aggregated counters only.
// Never stored: addresses, links, query strings, user agents, chat ids. The distinct-sender count per day
// is kept as a set of short keyed hashes in memory (random key per process and day, never written) and
// only the number reaches the disk. Hour buckets are kept 30 days, day buckets 2 years (data/metrics.json).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const EDGES = [10, 25, 50, 100, 250, 500, 1000, 1500, 2500, 5000, 10000, Infinity];
const HOUR_KEEP_MS = 30 * 86400000;
const DAY_KEEP_MS = 730 * 86400000;
const USERS_MAX = 200000;
const REAL = new Set(["page", "api", "telegram"]);

const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|monitor|uptime|curl|wget|python|httpx|aiohttp|go-http|java\/|libwww|headless|scan|zgrab|masscan|nmap|nuclei|censys|shodan|expanse|semrush|ahrefs|petal|bytespider|gptbot|claudebot|ccbot/i;
const STATIC_EXT = /\.(css|js|mjs|png|jpe?g|webp|gif|svg|ico|webmanifest|txt|xml|json|woff2?|map|shortcut)$/i;

/** Request group, first match wins (see the contract). */
export function classify(p, ua, status) {
  if (p === "/api/health") return "health";
  if (p === "/admin" || p === "/admin/" || p.startsWith("/api/admin/") || p === "/api/stats" || p === "/admin.js") return "admin";
  if (p === "/telegram") return "telegram";
  if (p.startsWith("/api/")) return "api";
  if (!ua || BOT_UA.test(ua)) return "bot";
  if (STATIC_EXT.test(p) || p.startsWith("/.well-known/")) return "static";
  if (status === 404) return "notfound";
  return "page";
}

const emptyHist = () => ({ n: 0, h: EDGES.map(() => 0) });
function histAdd(hist, ms) {
  let i = EDGES.findIndex((e) => ms <= e);
  if (i < 0) i = EDGES.length - 1;
  hist.h[i]++; hist.n++;
}
export function percentile(h, q) {
  const n = h.reduce((a, b) => a + b, 0);
  if (!n) return null;
  let cum = 0;
  for (let i = 0; i < h.length; i++) {
    cum += h[i];
    if (cum >= q * n) return EDGES[i] === Infinity ? 20000 : EDGES[i];
  }
  return 20000;
}
const emptyBucket = () => ({ req: {}, work: {}, cache: {}, res: { gruen: 0, gelb: 0, rot: 0 }, rl: 0, rl_by: {}, e5: 0, lat_work: emptyHist(), lat_all: emptyHist(), peak_min: 0, peak_min_real: 0, cpu_ms: 0, rss_max_mb: 0, bytes_in: 0, bytes_out: 0 });
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

function mergeInto(dst, src) {
  for (const f of ["req", "work", "cache", "res", "rl_by"]) for (const [k, v] of Object.entries(src[f] || {})) inc(dst[f], k, v);
  for (const f of ["rl", "e5", "cpu_ms", "bytes_in", "bytes_out"]) dst[f] += src[f] || 0;
  for (const f of ["peak_min", "peak_min_real", "rss_max_mb"]) dst[f] = Math.max(dst[f], src[f] || 0);
  for (const f of ["lat_work", "lat_all"]) { const s = src[f] || emptyHist(); dst[f].n += s.n || 0; s.h?.forEach((v, i) => { dst[f].h[i] += v; }); }
  return dst;
}
const showHist = (x) => ({ n: x.n, p50: percentile(x.h, 0.5), p95: percentile(x.h, 0.95), h: x.h });
const show = (b) => ({ ...b, cpu_ms: Math.round(b.cpu_ms), lat_work: showHist(b.lat_work), lat_all: showHist(b.lat_all) });

export function createMetrics({ dataDir, now = () => Date.now(), cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; }, rss = () => process.memoryUsage().rss / 1048576 } = {}) {
  const file = dataDir ? path.join(dataDir, "metrics.json") : null;
  let state = { v: 1, hours: {}, days: {} };
  if (file) try { const j = JSON.parse(fs.readFileSync(file, "utf8")); if (j && j.hours && j.days) state = j; } catch { /* fresh */ }
  const started = now();
  let lastCpu = cpu();
  let lastCpuAt = 0;
  let minuteKey = "", minuteAll = 0, minuteReal = 0;
  let usersDay = "", usersKey = null, usersSet = new Set(), usersBase = 0;
  let dirty = false;

  const hourKey = (t) => new Date(t).toISOString().slice(0, 13);
  const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
  const hour = (t = now()) => state.hours[hourKey(t)] || (state.hours[hourKey(t)] = emptyBucket());

  function sampleCpu(t = now(), force = false) {
    if (!force && t - lastCpuAt < 1000) return;
    lastCpuAt = t;
    const c = cpu();
    const b = hour(t);
    b.cpu_ms += Math.max(0, c - lastCpu);
    b.rss_max_mb = Math.max(b.rss_max_mb, Math.round(rss()));
    lastCpu = c;
    dirty = true;
  }

  function user(t, addr) {
    const d = dayKey(t);
    if (d !== usersDay) {
      usersDay = d; usersKey = crypto.randomBytes(32); usersSet = new Set();
      usersBase = state.days[d]?.users || 0;            // continues after a restart (may over-count slightly)
    }
    if (usersSet.size < USERS_MAX) usersSet.add(crypto.createHmac("sha256", usersKey).update(String(addr)).digest("base64").slice(0, 11));
    const day = state.days[d] || (state.days[d] = { users: 0 });
    day.users = usersBase + usersSet.size;
  }

  /** One finished HTTP request. */
  function request({ path: p, ua, status, ms, bytesIn = 0, bytesOut = 0, addr }) {
    const t = now();
    const g = classify(p, ua, status);
    const b = hour(t);
    inc(b.req, g);
    if (status === 429) { b.rl++; inc(b.rl_by, g); }
    if (status >= 500) b.e5++;
    if (g !== "health") histAdd(b.lat_all, ms);
    if (p === "/api/check" || p === "/api/v1/check") histAdd(b.lat_work, ms);
    b.bytes_in += bytesIn; b.bytes_out += bytesOut;
    const mk = new Date(t).toISOString().slice(0, 16);
    if (mk !== minuteKey) { minuteKey = mk; minuteAll = 0; minuteReal = 0; }
    minuteAll++;
    if (REAL.has(g)) { minuteReal++; if (addr && g !== "telegram") user(t, addr); }   // the webhook sender is Telegram itself
    b.peak_min = Math.max(b.peak_min, minuteAll);
    b.peak_min_real = Math.max(b.peak_min_real, minuteReal);
    sampleCpu(t);
    dirty = true;
    return g;
  }

  /** One finished check (any channel). verdict: gruen|gelb|rot, cached: answered from a cache. */
  function work({ channel, verdict, cached = false }) {
    const b = hour();
    inc(b.work, channel);
    if (cached) inc(b.cache, channel);
    if (verdict && verdict in b.res) b.res[verdict]++;
    dirty = true;
  }

  // Day buckets are recomputed from their hours (hours are pruned by whole days, so a day is either complete or
  // keeps its last stored figures), then old buckets go.
  function rollup(t = now()) {
    const dayMap = {};
    for (const [k, v] of Object.entries(state.hours)) mergeInto(dayMap[k.slice(0, 10)] || (dayMap[k.slice(0, 10)] = emptyBucket()), v);
    for (const [d, v] of Object.entries(dayMap)) state.days[d] = { ...v, users: state.days[d]?.users || 0 };
    const hourLimit = dayKey(t - HOUR_KEEP_MS), dayLimit = dayKey(t - DAY_KEEP_MS);
    for (const k of Object.keys(state.hours)) if (k.slice(0, 10) < hourLimit) delete state.hours[k];
    for (const k of Object.keys(state.days)) if (k < dayLimit) delete state.days[k];
  }

  function flush() {
    sampleCpu(now(), true);
    if (!dirty || !file) return;
    dirty = false;
    rollup();
    try {
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, file);
    } catch (e) { console.error("metrics", String(e).slice(0, 100)); }
  }

  /** The /api/stats answer (without service/version/limits, the caller adds them). */
  function snapshot({ hours = 168, days = 730 } = {}) {
    const t = now();
    sampleCpu(t, true);
    rollup(t);
    hours = Math.max(1, Math.min(720, Number(hours) || 168));
    days = Math.max(1, Math.min(730, Number(days) || 730));
    const hk = Object.keys(state.hours).sort();
    const fromH = hourKey(t - (hours - 1) * 3600000);
    const fromD = dayKey(t - (days - 1) * 86400000);
    return {
      generated: new Date(t).toISOString().replace(/\.\d+Z$/, "Z"),
      bucket_tz: "UTC",
      process: { started: new Date(started).toISOString(), uptime_s: Math.round((t - started) / 1000), cpu_ms: Math.round(cpu()), rss_mb: Math.round(rss()) },
      hours: hk.filter((k) => k >= fromH).map((k) => ({ t: k, ...show(state.hours[k]) })),
      days: Object.keys(state.days).sort().filter((d) => d >= fromD && state.days[d].req).map((d) => ({ d, users: state.days[d].users || 0, ...show(mergeInto(emptyBucket(), state.days[d])) })),
    };
  }

  return { request, work, flush, snapshot, classify, rollup, _state: () => state };
}

const PRIVATE = [/^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^127\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd][0-9a-f]{2}:/i, /^fe[89ab][0-9a-f]:/i, /^::ffff:(10|127|192\.168)\./i];
/** Address check of the contract: no X-Real-IP (direct call) or a private/Tailscale address. */
export function privateSource(realIp) {
  const ip = String(realIp || "").trim();
  if (!ip) return true;
  return PRIVATE.some((r) => r.test(ip));
}
