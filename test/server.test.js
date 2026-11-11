import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createLimiter } from "../server/ratelimit.js";
import { isNewer, parseVersion, startUpdateCheck } from "../server/update.js";
import pkg from "../package.json" with { type: "json" };

test("limiter: per-minute limit, then recovers", async () => {
  let t = 0;
  const l = createLimiter({ perMinute: 3, perDay: 100, now: () => t });
  for (let i = 0; i < 3; i++) assert.equal((await l.limit({ key: "a" })).success, true);
  assert.equal((await l.limit({ key: "a" })).success, false);
  assert.equal((await l.limit({ key: "b" })).success, true, "other keys are independent");
  t = 61000;
  assert.equal((await l.limit({ key: "a" })).success, true);
});

test("limiter: per-day limit holds even when the minute window is free", async () => {
  let t = 0;
  const l = createLimiter({ perMinute: 5, perDay: 8, now: () => t });
  let ok = 0;
  for (let i = 0; i < 20; i++) { t += 61000; if ((await l.limit({ key: "a" })).success) ok++; }
  assert.equal(ok, 8);
  t += 86400000 + 1;
  assert.equal((await l.limit({ key: "a" })).success, true);
});

test("limiter: stale keys are dropped when the table grows", async () => {
  let t = 0;
  const l = createLimiter({ perMinute: 5, perDay: 5, now: () => t, maxKeys: 10 });
  for (let i = 0; i < 10; i++) await l.limit({ key: "k" + i });
  t = 2 * 86400000;
  await l.limit({ key: "new" });
  assert.ok(l.size() <= 2);
});

test("version compare", () => {
  assert.deepEqual(parseVersion("v1.2.3"), [1, 2, 3]);
  assert.equal(parseVersion("junk"), null);
  assert.equal(isNewer("0.3.1", "0.3.0"), true);
  assert.equal(isNewer("0.10.0", "0.9.9"), true);
  assert.equal(isNewer("0.3.0", "0.3.0"), false);
  assert.equal(isNewer("0.2.9", "0.3.0"), false);
  assert.equal(isNewer("x", "0.3.0"), false);
});

test("update check: newer release is reported, same or failing is silent, off does nothing", async () => {
  const mk = (tag, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ tag_name: tag }) });
  const run = async (opts) => {
    const info = {}, logs = [];
    const timer = startUpdateCheck(info, { current: "0.3.0", repo: "x/y", log: (m) => logs.push(m), every: 3600000, ...opts });
    await new Promise((r) => setTimeout(r, 20));
    if (timer) clearInterval(timer);
    return { info, logs, timer };
  };
  const newer = await run({ fetchFn: mk("v0.4.0") });
  assert.equal(newer.info.latest, "0.4.0");
  assert.equal(newer.logs.length, 1);
  assert.equal((await run({ fetchFn: mk("v0.3.0") })).info.latest, undefined);
  assert.equal((await run({ fetchFn: mk("v0.4.0", false) })).info.latest, undefined);
  assert.equal((await run({ fetchFn: async () => { throw new Error("offline"); } })).info.latest, undefined);
  assert.equal((await run({ fetchFn: mk("v9.0.0"), enabled: false })).timer, null);
});

// ── the real server process ──────────────────────────────────────────────────
let proc, base, dataDir;
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

before(async () => {
  const port = await freePort();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-test-"));
  proc = spawn(process.execPath, ["server/index.js"], {
    env: { PATH: process.env.PATH, PORT: String(port), DATA_DIR: dataDir, UPDATE_CHECK: "off", PER_MINUTE: "3", PER_DAY: "150", SITE_URL: `http://localhost:${port}` },
    stdio: "ignore",
  });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + "/api/health")).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
});
after(async () => {
  if (proc) { const done = new Promise((r) => proc.once("exit", r)); proc.kill(); await done; }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (ip, body = "{}") => fetch(base + "/api/check", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body });

test("server: /api/health reports the package version and no update when the check is off", async () => {
  const j = await (await fetch(base + "/api/health")).json();
  assert.equal(j.ok, true);
  assert.equal(j.version, pkg.version);
  assert.equal(j.update, undefined);
});

test("server: rate limit answers 429 per sender, other senders unaffected", async () => {
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await post("203.0.113.7")).status);
  assert.deepEqual(codes.slice(0, 3), [400, 400, 400], "empty input is rejected before any network access");
  assert.deepEqual(codes.slice(3), [429, 429]);
  assert.equal((await post("203.0.113.8")).status, 400);
});

test("server: a forged X-Forwarded-For does not bypass the limit", async () => {
  const send = (xff) => fetch(base + "/api/check", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "198.51.100.9", "x-forwarded-for": xff }, body: "{}" });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await send("10.0.0." + i)).status);
  assert.equal(codes.filter((c) => c === 429).length, 2);
});

test("server: foreign origin and non-JSON are refused, oversized body is cut", async () => {
  const f = await fetch(base + "/api/check", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", "x-real-ip": "192.0.2.1" }, body: "{}" });
  assert.equal(f.status, 403);
  const t = await fetch(base + "/api/check", { method: "POST", headers: { "content-type": "text/plain", "x-real-ip": "192.0.2.2" }, body: "x" });
  assert.equal(t.status, 415);
  const big = await fetch(base + "/api/check", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "192.0.2.3" }, body: "x".repeat(70000) }).catch(() => ({ status: 413 }));
  assert.equal(big.status, 413);
});
