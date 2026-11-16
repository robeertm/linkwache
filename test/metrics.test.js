import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import { createMetrics, classify, percentile, privateSource, EDGES } from "../server/metrics.js";
import { v1Channel } from "../src/api_v1.js";

test("metrics: request groups follow the contract (first match wins)", () => {
  const ua = "Mozilla/5.0 (Windows NT 10.0) Firefox/140.0";
  const cases = [
    ["/api/health", "curl/8", 200, "health"],
    ["/admin", ua, 200, "admin"], ["/api/admin/status", ua, 401, "admin"], ["/api/stats", "", 200, "admin"],
    ["/telegram", "", 200, "telegram"],
    ["/api/check", ua, 200, "api"], ["/api/v1/check", "Linkwache-Android/0.5.0", 200, "api"], ["/api/v1/check", "", 200, "api"],
    ["/", "Googlebot/2.1", 200, "bot"], ["/", "", 200, "bot"], ["/style.css", "python-requests/2", 200, "bot"],
    ["/style.css", ua, 200, "static"], ["/.well-known/security.txt", ua, 200, "static"], ["/icon.svg", ua, 200, "static"],
    ["/wp-login.php", ua, 404, "notfound"],
    ["/", ua, 200, "page"], ["/r/abc123", ua, 200, "page"], ["/download", ua, 200, "page"],
  ];
  for (const [p, u, s, g] of cases) assert.equal(classify(p, u, s), g, `${p} ${u} ${s}`);
});

test("metrics: v1 channel only keeps the kind of client", () => {
  assert.equal(v1Channel("desktop/0.5.1"), "desktop");
  assert.equal(v1Channel("extension/0.6.0"), "extension");
  assert.equal(v1Channel("safari/0.6.0"), "extension");
  assert.equal(v1Channel("android/0.5.0"), "android");
  assert.equal(v1Channel(""), "v1_other");
  assert.equal(v1Channel("evil<script>"), "v1_other");
});

test("metrics: histogram percentiles use the upper bucket edge", () => {
  const h = EDGES.map(() => 0);
  assert.equal(percentile(h, 0.5), null);
  h[2] = 50; h[6] = 45; h[11] = 5;          // 50 ≤50 ms, 45 ≤1000 ms, 5 beyond 10 s
  assert.equal(percentile(h, 0.5), 50);
  assert.equal(percentile(h, 0.95), 1000);
  assert.equal(percentile(h, 0.99), 20000);
});

test("metrics: hour and day buckets, peaks, cache, verdicts, users without addresses", () => {
  let t = Date.parse("2026-11-16T10:00:05Z"), c = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-metrics-"));
  const m = createMetrics({ dataDir: dir, now: () => t, cpu: () => c, rss: () => 50 });
  const ua = "Mozilla/5.0 Firefox/140";
  for (let i = 0; i < 5; i++) m.request({ path: "/", ua, status: 200, ms: 20, addr: "203.0.113.7" });
  m.request({ path: "/", ua, status: 200, ms: 20, addr: "203.0.113.8" });
  for (let i = 0; i < 3; i++) m.request({ path: "/api/health", ua: "curl/8", status: 200, ms: 1, addr: "10.0.0.1" });
  m.request({ path: "/api/v1/check", ua: "x", status: 200, ms: 800, addr: "198.51.100.1" });
  m.request({ path: "/api/v1/check", ua: "x", status: 429, ms: 2, addr: "198.51.100.1" });
  m.request({ path: "/x", ua, status: 500, ms: 3, addr: "198.51.100.1" });
  m.work({ channel: "desktop", verdict: "gruen" }); m.work({ channel: "desktop", verdict: "gelb", cached: true });
  m.work({ channel: "telegram", verdict: "rot" });
  c = 1500; t += 2000;
  m.request({ path: "/", ua, status: 200, ms: 20, addr: "203.0.113.7" });
  t = Date.parse("2026-11-16T11:30:00Z");
  m.request({ path: "/", ua, status: 200, ms: 20, addr: "203.0.113.9" });
  m.flush();
  const s = m.snapshot({ hours: 48 });
  assert.equal(s.hours.length, 2);
  const h = s.hours[0];
  assert.equal(h.t, "2026-11-16T10");
  assert.equal(h.req.page, 8, "/x answered 500 is a page"); assert.equal(h.req.health, 3); assert.equal(h.req.api, 2); assert.equal(h.req.notfound, undefined);
  assert.equal(h.rl, 1); assert.equal(h.rl_by.api, 1); assert.equal(h.e5, 1);
  assert.deepEqual(h.work, { desktop: 2, telegram: 1 }); assert.deepEqual(h.cache, { desktop: 1 });
  assert.deepEqual(h.res, { gruen: 1, gelb: 1, rot: 1 });
  assert.equal(h.lat_work.n, 2); assert.equal(h.lat_all.n, 10);
  assert.equal(h.peak_min, 13); assert.equal(h.peak_min_real, 10);
  assert.equal(h.cpu_ms, 1500); assert.equal(h.rss_max_mb, 50);
  const d = s.days.at(-1);
  assert.equal(d.d, "2026-11-16"); assert.equal(d.req.page, 9); assert.equal(d.users, 4, "distinct senders of page/api only");
  assert.equal(d.peak_min, 13);
  const raw = fs.readFileSync(path.join(dir, "metrics.json"), "utf8");
  assert.ok(!/\d+\.\d+\.\d+\.\d+/.test(raw), "no address in the file");
  assert.ok(!raw.includes("Firefox") && !raw.includes("curl"), "no user agent in the file");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("metrics: retention 30 days for hours, 2 years for days, days survive pruned hours", () => {
  let t = Date.parse("2026-01-01T12:00:00Z");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-metrics-"));
  const m = createMetrics({ dataDir: dir, now: () => t, cpu: () => 0, rss: () => 1 });
  m.request({ path: "/", ua: "Mozilla/5.0", status: 200, ms: 5, addr: "a" });
  m.flush();
  t = Date.parse("2026-02-15T12:00:00Z");
  m.request({ path: "/", ua: "Mozilla/5.0", status: 200, ms: 5, addr: "a" });
  m.flush();
  const s = m.snapshot({ hours: 720, days: 730 });
  assert.equal(s.hours.length, 1, "the January hour is gone");
  assert.deepEqual(s.days.map((d) => [d.d, d.req.page]), [["2026-01-01", 1], ["2026-02-15", 1]]);
  t = Date.parse("2028-03-01T12:00:00Z");
  m.flush(); m.request({ path: "/", ua: "Mozilla/5.0", status: 200, ms: 5, addr: "a" });
  assert.deepEqual(m.snapshot({ days: 730 }).days.map((d) => d.d), ["2028-03-01"]);
  // a restart reads the file back
  m.flush();
  const m2 = createMetrics({ dataDir: dir, now: () => t, cpu: () => 0, rss: () => 1 });
  assert.equal(m2.snapshot().days.at(-1).req.page, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("metrics: private source check of /api/stats", () => {
  for (const ip of ["", "10.1.2.3", "172.20.0.1", "192.168.2.5", "127.0.0.1", "100.83.1.2", "::1", "fd7a:115c:a1e0::1", "fe80::1"]) assert.equal(privateSource(ip), true, ip);
  for (const ip of ["203.0.113.7", "8.8.8.8", "100.128.0.1", "172.32.0.1", "2a02:8100::/64", "2001:db8::1"]) assert.equal(privateSource(ip), false, ip);
});

// ── the real server ──
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
async function start(extra) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-stats-srv-"));
  const proc = spawn(process.execPath, ["server/index.js"], { env: { PATH: process.env.PATH, PORT: String(port), DATA_DIR: dataDir, UPDATE_CHECK: "off", SITE_URL: `http://localhost:${port}`, ...extra }, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 100)); }
  return { base, dataDir, stop: async () => { const done = new Promise((r) => proc.once("exit", r)); proc.kill(); await done; fs.rmSync(dataDir, { recursive: true, force: true }); } };
}
const TOKEN = "t".repeat(32);

test("server: /api/stats is off without a token", async () => {
  const s = await start({});
  try { assert.equal((await fetch(s.base + "/api/stats")).status, 404); } finally { await s.stop(); }
});

test("server: /api/stats auth matrix and contract fields", async () => {
  const s = await start({ STATS_TOKEN: TOKEN });
  try {
    const get = (h = {}) => fetch(s.base + "/api/stats?hours=24", { headers: h });
    assert.equal((await get()).status, 401);
    assert.equal((await get({ authorization: "Bearer wrong-token-wrong-token" })).status, 401);
    assert.equal((await get({ authorization: "Bearer " + TOKEN, "x-real-ip": "203.0.113.7" })).status, 403, "public sender through the proxy");
    assert.equal((await get({ authorization: "Bearer " + TOKEN, "x-real-ip": "192.168.2.10" })).status, 200);
    await fetch(s.base + "/", { headers: { "user-agent": "Mozilla/5.0 Firefox/140", "x-real-ip": "203.0.113.7" } });
    await fetch(s.base + "/style.css", { headers: { "user-agent": "Mozilla/5.0 Firefox/140" } });
    const r = await get({ authorization: "Bearer " + TOKEN });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const j = await r.json();
    for (const k of ["schema", "service", "version", "generated", "bucket_tz", "work_unit", "process", "limits", "hours", "days", "legacy_days"]) assert.ok(k in j, k);
    assert.equal(j.schema, "dienst-stats/1"); assert.equal(j.service, "linkwache"); assert.equal(j.work_unit, "check");
    assert.ok(j.limits.scan_budget_per_day > 0);
    const h = j.hours.at(-1);
    assert.ok(h.req.page >= 1 && h.req.static >= 1 && h.req.health >= 1);
    assert.ok(!JSON.stringify(j).includes("203.0.113.7"));
  } finally { await s.stop(); }
});

test("server: STATS_PUBLIC=on lifts only the address check; ADMIN_TOKEN works too", async () => {
  const s = await start({ ADMIN_TOKEN: TOKEN, STATS_PUBLIC: "on" });
  try {
    assert.equal((await fetch(s.base + "/api/stats", { headers: { authorization: "Bearer " + TOKEN, "x-real-ip": "203.0.113.7" } })).status, 200);
    assert.equal((await fetch(s.base + "/api/stats", { headers: { "x-real-ip": "203.0.113.7" } })).status, 401);
  } finally { await s.stop(); }
});
