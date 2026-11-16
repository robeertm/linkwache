// Public address: canonical/hreflang/og:url come from PUBLIC_URL (operator setting), visits of an earlier address
// (LEGACY_HOSTS) are moved for HTML pages only — the API, the Telegram webhook and files are never redirected,
// because installed apps keep talking to the address they were built with.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";

const NEW = "https://new-address.example.test";
const OLD_HOST = "old-address.example.test";
let proc, base, dataDir;
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

before(async () => {
  const port = await freePort();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-public-url-"));
  proc = spawn(process.execPath, ["server/index.js"], {
    env: { PATH: process.env.PATH, PORT: String(port), DATA_DIR: dataDir, UPDATE_CHECK: "off", PUBLIC_URL: NEW + "/", SITE_URL: "https://" + OLD_HOST, LEGACY_HOSTS: `${OLD_HOST.toUpperCase()}, other-old.example.test` },
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

const get = (p, host, init = {}) => fetch(base + p, { redirect: "manual", ...init, headers: { "x-forwarded-host": host, "x-forwarded-proto": "https", "x-real-ip": "192.0.2.50", ...(init.headers || {}) } });
const NEW_HOST = new URL(NEW).host;

test("pages name only the public address: canonical, hreflang, x-default, og:url", async () => {
  for (const p of ["/", "/download", "/kurzbefehl.html"]) {
    const r = await get(p + "?lang=de", NEW_HOST);
    assert.equal(r.status, 200, p);
    const h = await r.text();
    assert.ok(h.includes(`<link rel="canonical" href="${NEW}${p}?lang=de">`), p + " canonical");
    assert.ok(h.includes(`hreflang="en" href="${NEW}${p}?lang=en"`), p + " hreflang");
    assert.ok(h.includes(`hreflang="x-default" href="${NEW}${p}"`), p + " x-default");
    assert.ok(h.includes(`<meta property="og:url" content="${NEW}${p}">`), p + " og:url");
    assert.ok(!h.includes(OLD_HOST), p + " never mentions the old address");
  }
});

test("pages under the old address move to the public address (query kept, HEAD too)", async () => {
  for (const p of ["/?lang=fr", "/download", "/download/", "/impressum.html", "/datenschutz.html?lang=en", "/kurzbefehl.html", "/r/abc123XY", "/share?text=https%3A%2F%2Fexample.org"]) {
    const r = await get(p, OLD_HOST);
    assert.equal(r.status, 301, p);
    assert.equal(r.headers.get("location"), NEW + p, p);
  }
  const head = await get("/", "other-old.example.test:443", { method: "HEAD" });
  assert.equal(head.status, 301);
  assert.equal(head.headers.get("location"), NEW + "/");
});

test("the API, the Telegram webhook, files and the admin page are never redirected", async () => {
  const health = await get("/api/health", OLD_HOST);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  const v1 = await get("/api/v1/check", OLD_HOST, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.notEqual(v1.status, 301);
  assert.notEqual(v1.status, 308);
  const check = await get("/api/check", OLD_HOST, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(check.status, 400, "same-origin API call on the old address still works");
  const tg = await get("/telegram", OLD_HOST, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.ok(![301, 302, 307, 308].includes(tg.status), "telegram webhook " + tg.status);
  for (const f of ["/style.css", "/app.js", "/icon.svg", "/manifest.webmanifest", "/Linkwache.shortcut"]) {
    const r = await get(f, OLD_HOST);
    assert.equal(r.status, 200, f);
  }
  const adm = await get("/admin", OLD_HOST);
  assert.ok(![301, 308].includes(adm.status), "admin " + adm.status);
});

test("unknown hosts are left alone (no open redirect, no loop on the public address)", async () => {
  const r = await get("/", "somebody-else.example");
  assert.equal(r.status, 200);
  const n = await get("/download", NEW_HOST);
  assert.equal(n.status, 200);
});
