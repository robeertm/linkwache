// Operator page + update script: real server process with an operator key, and the script run against a
// local git repository with a stand-in for ssh (no host, no network).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import pkg from "../package.json" with { type: "json" };

const KEY = "test-key-" + Math.random().toString(16).slice(2);
let proc, base, dataDir;
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const auth = (k = KEY) => ({ authorization: "Bearer " + k });

before(async () => {
  const port = await freePort();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-adm-"));
  proc = spawn(process.execPath, ["server/index.js"], {
    env: { PATH: process.env.PATH, PORT: String(port), DATA_DIR: dataDir, ADMIN_TOKEN: KEY, UPDATE_CHECK: "off", SITE_URL: `http://localhost:${port}` },
    stdio: "ignore",
  });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + "/api/health")).ok) return; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("server did not start");
});
after(async () => {
  if (proc) { const done = new Promise((r) => proc.once("exit", r)); proc.kill(); await done; }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("admin: page renders in every language and carries no key; API refuses without or with a wrong key", async () => {
  for (const l of ["de", "en", "tr", "pl", "ru", "es", "fr", "it"]) {
    const r = await fetch(`${base}/admin?lang=${l}`);
    assert.equal(r.status, 200, l);
    const h = await r.text();
    assert.match(h, /noindex/);
    assert.ok(h.includes(`lang="${l}"`));
    assert.ok(!h.includes(KEY));
  }
  assert.equal((await fetch(base + "/api/admin/status")).status, 401);
  assert.equal((await fetch(base + "/api/admin/status", { headers: auth("wrong") })).status, 401);
  assert.equal((await fetch(base + "/api/admin/update-request", { method: "POST", headers: auth("wrong") })).status, 401);
});

test("admin: status with the right key; request is refused while nothing newer exists (update check off)", async () => {
  const r = await fetch(base + "/api/admin/status", { headers: auth() });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.version, pkg.version);
  assert.equal(j.latest, null);
  assert.equal(j.checkEnabled, false);
  assert.equal(j.pending, null);
  const p = await fetch(base + "/api/admin/update-request", { method: "POST", headers: auth() });
  assert.equal(p.status, 409);
  assert.equal(fs.existsSync(path.join(dataDir, "update-request.json")), false);
  assert.equal((await fetch(base + "/api/admin/status", { method: "POST", headers: auth() })).status, 405);
});

test("admin: guessing the key is rate limited", async () => {
  const codes = [];
  for (let i = 0; i < 14; i++) codes.push((await fetch(base + "/api/admin/status", { headers: { ...auth("guess" + i), "x-real-ip": "203.0.113.99" } })).status);
  assert.ok(codes.includes(429));
  assert.ok(codes.slice(0, 5).every((c) => c === 401));
});

test("admin: without ADMIN_TOKEN the page and API do not exist", async () => {
  const port = await freePort();
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lw-adm2-"));
  const p = spawn(process.execPath, ["server/index.js"], { env: { PATH: process.env.PATH, PORT: String(port), DATA_DIR: d, UPDATE_CHECK: "off" }, stdio: "ignore" });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 100)); }
    assert.equal((await fetch(`http://127.0.0.1:${port}/admin`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/status`, { headers: auth() })).status, 404);
  } finally { const done = new Promise((r) => p.once("exit", r)); p.kill(); await done; fs.rmSync(d, { recursive: true, force: true }); }
});

test("admin: a newer release unlocks the request, which lands as a 0600 file and shows up as pending", async () => {
  // Stand-in "GitHub": server fed with a release newer than the running one.
  const http = await import("node:http");
  const gh = http.createServer((q, s) => s.end(JSON.stringify({ tag_name: "v99.0.0" })));
  await new Promise((r) => gh.listen(0, "127.0.0.1", r));
  const port = await freePort();
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lw-adm3-"));
  // The update module reads the real GitHub URL; give it a fetch that answers locally via a preload.
  const pre = path.join(d, "pre.mjs");
  fs.writeFileSync(pre, `const real = globalThis.fetch; globalThis.fetch = (u, i) => String(u).startsWith("https://api.github.com/") ? real("http://127.0.0.1:${gh.address().port}/", i) : real(u, i);`);
  const p = spawn(process.execPath, ["--import", pre, "server/index.js"], { env: { PATH: process.env.PATH, PORT: String(port), DATA_DIR: d, ADMIN_TOKEN: KEY, SITE_URL: `http://localhost:${port}` }, stdio: "ignore" });
  const b = `http://127.0.0.1:${port}`;
  try {
    let st;
    for (let i = 0; i < 60; i++) { try { st = await (await fetch(b + "/api/admin/status", { headers: auth() })).json(); if (st.latest) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(st.latest, "99.0.0");
    assert.ok(st.checkedAt);
    assert.equal((await (await fetch(b + "/api/health")).json()).update, "99.0.0");
    const r = await fetch(b + "/api/admin/update-request", { method: "POST", headers: auth() });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).pending, "99.0.0");
    const f = path.join(d, "update-request.json");
    assert.equal(JSON.parse(fs.readFileSync(f, "utf8")).version, "99.0.0");
    assert.equal(fs.statSync(f).mode & 0o777, 0o600);
    const cross = await fetch(b + "/api/admin/update-request", { method: "POST", headers: { ...auth(), "sec-fetch-site": "cross-site" } });
    assert.equal(cross.status, 403);
  } finally { const done = new Promise((r) => p.once("exit", r)); p.kill(); await done; gh.close(); fs.rmSync(d, { recursive: true, force: true }); }
});

// ── scripts/aktualisieren.sh against a local repository and a stand-in for ssh ───────────────
function sh(cmd, args, opts = {}) { return spawnSync(cmd, args, { encoding: "utf8", ...opts }); }
function makeWorld(tagVersion, pkgVersion, withRequest) {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), "lw-upd-"));
  const repo = path.join(w, "repo");
  fs.mkdirSync(repo);
  sh("git", ["init", "-q", "-b", "main"], { cwd: repo });
  for (const f of ["scripts", "package-lock.json", "src", "public", "server", "package.json"]) fs.cpSync(path.join(process.cwd(), f), path.join(repo, f), { recursive: true });
  const j = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")); j.version = pkgVersion; fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify(j));
  // The release carries a trivial test of its own: running this very file again would recurse forever.
  fs.mkdirSync(path.join(repo, "test")); fs.writeFileSync(path.join(repo, "test", "ok.test.js"), "import {test} from 'node:test'; test('ok', () => {});");
  sh("git", ["add", "-A"], { cwd: repo });
  sh("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "x"], { cwd: repo });
  sh("git", ["tag", "v" + tagVersion], { cwd: repo });
  fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(repo, "node_modules"));
  const bin = path.join(w, "bin"); fs.mkdirSync(bin);
  const log = path.join(w, "ssh.log");
  // Stand-in for ssh: answers the health query and the request file, logs everything else.
  fs.writeFileSync(path.join(bin, "ssh"), `#!/bin/bash
cmd="\${@: -1}"
echo "$cmd" >> ${log}
case "$cmd" in
  *api/health*) echo '{"ok":true,"version":"0.4.0"}';;
  cat*update-request*) ${withRequest ? `echo '{"version":"${tagVersion}","at":"x"}'` : "true"};;
esac
`, { mode: 0o755 });
  return { w, repo, bin, log };
}
const run = (world, args, extra = {}) => sh("bash", ["scripts/aktualisieren.sh", ...args], { env: { PATH: world.bin + ":" + process.env.PATH, HOME: process.env.HOME, LINKWACHE_NAS: "u@h", LINKWACHE_GIT: world.repo, LINKWACHE_REPO: "o/r", DRY_RUN: "1", SKIP_INSTALL: "1", ...extra } });

test("aktualisieren.sh: verified newer tag passes every check and stops at the dry run", () => {
  const w = makeWorld("0.9.0", "0.9.0", false);
  try { const r = run(w, ["v0.9.0"]); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /release v0\.9\.0 verified/); assert.match(r.stdout, /dry run/); }
  finally { fs.rmSync(w.w, { recursive: true, force: true }); }
});

test("aktualisieren.sh: tag whose package.json disagrees is refused", () => {
  const w = makeWorld("0.9.0", "0.8.5", false);
  try { const r = run(w, ["v0.9.0"]); assert.notEqual(r.status, 0); assert.match(r.stdout, /refusing/); }
  finally { fs.rmSync(w.w, { recursive: true, force: true }); }
});

test("aktualisieren.sh: same or older version = nothing to do; unknown tag fails; junk arguments are rejected", () => {
  const w = makeWorld("0.4.0", "0.4.0", false);
  try {
    assert.match(run(w, ["v0.4.0"]).stdout, /already up to date/);
    assert.notEqual(run(w, ["v7.7.7"]).status, 0);
    assert.equal(run(w, ["--evil"]).status, 2);
    assert.equal(run(w, ["v1.0.0; rm -rf /"]).status, 2);
  } finally { fs.rmSync(w.w, { recursive: true, force: true }); }
});

test("aktualisieren.sh --if-requested: no request = no work; a request names the version", () => {
  const none = makeWorld("0.9.0", "0.9.0", false);
  try { assert.match(run(none, ["--if-requested"]).stdout, /no update request/); } finally { fs.rmSync(none.w, { recursive: true, force: true }); }
  const req = makeWorld("0.9.0", "0.9.0", true);
  try { const r = run(req, ["--if-requested"]); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /operator requested v0\.9\.0/); assert.match(r.stdout, /verified/); }
  finally { fs.rmSync(req.w, { recursive: true, force: true }); }
});
