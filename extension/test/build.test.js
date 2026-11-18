// Build output: both targets, manifests, fixed ids, locales, zips, no hostname baked in, no inline script.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pkg from "../../package.json" with { type: "json" };

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(EXT, "dist");
const rd = (...p) => fs.readFileSync(path.join(DIST, ...p), "utf8");
before(() => { execFileSync(process.execPath, [path.join(EXT, "scripts", "build.mjs")], { env: { ...process.env, LINKWACHE_DEFAULT_SERVER: "", LINKWACHE_PRESET_MIGRATE_FROM: "" }, stdio: "pipe" }); });

test("chromium: fixed id from the manifest key, service worker, MV3", () => {
  const m = JSON.parse(rd("chromium", "manifest.json"));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.version, pkg.version);
  assert.equal(m.background.service_worker, "background.js");
  const id = [...crypto.createHash("sha256").update(Buffer.from(m.key, "base64")).digest().subarray(0, 16)].map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join("");
  assert.equal(id, "ldehleohedacddboipopkjkphjnphine");
  assert.ok(m.permissions.includes("nativeMessaging") && m.permissions.includes("declarativeNetRequest") && m.permissions.includes("webNavigation"));
});

test("firefox: gecko id, background scripts, no key", () => {
  const m = JSON.parse(rd("firefox", "manifest.json"));
  assert.equal(m.browser_specific_settings.gecko.id, "{ef1e5d25-3e24-4517-a534-dad3a936dcb3}");
  assert.deepEqual(m.background.scripts, ["background.js"]);
  assert.equal(m.key, undefined);
  assert.equal(m.background.service_worker, undefined);
});

test("every file the manifests and pages reference exists; one self-contained script each; all eight locales", () => {
  for (const t of ["chromium", "firefox", "safari"]) {
    const m = JSON.parse(rd(t, "manifest.json"));
    for (const f of [...Object.values(m.icons), ...m.content_scripts[0].js, m.options_ui.page]) assert.ok(fs.existsSync(path.join(DIST, t, f)), t + " " + f);
    for (const l of ["de", "en", "tr", "pl", "ru", "es", "fr", "it"]) {
      const j = JSON.parse(rd(t, "_locales", l, "messages.json"));
      assert.ok(j.extName.message && j.extDesc.message, l);
    }
    for (const js of ["background.js", "content.js", "warning.js", "options.js"]) assert.ok(!/^\s*(import|export)\s/m.test(rd(t, js)), js + " has no module syntax");
    for (const html of ["warning.html", "options.html"]) {
      const h = rd(t, html);
      assert.ok(!/<script(?![^>]*\bsrc=)/.test(h) && !/\son[a-z]+=/.test(h), html + " has no inline script");
    }
  }
});

test("no hostname baked into the build when LINKWACHE_DEFAULT_SERVER is empty; shared code is bundled verbatim", () => {
  const bg = rd("chromium", "background.js");
  assert.ok(!/https?:\/\/[a-z0-9.-]+\.(de|com|net|org)\b/i.test(bg.replace(/https?:\/\/(github|api\.github|urlscan|crt|rdap|1\.1\.1\.1|8\.8\.8\.8|developers|www\.w3)[^"'`\s]*/gi, "")), "no site hostname in background.js");
  assert.match(bg, /brand-sub/, "heuristics from src/checks.js are bundled");
  assert.match(bg, /v\.gruen/, "verdict texts bundled");
});

test("zips exist, are valid and carry the manifest at the root; Safari has none (loaded through its app)", () => {
  assert.ok(!fs.existsSync(path.join(DIST, `linkwache-extension-safari-${pkg.version}.zip`)), "no safari zip in a release");
  for (const t of ["chromium", "firefox"]) {
    const z = path.join(DIST, `linkwache-extension-${t}-${pkg.version}.zip`);
    assert.ok(fs.existsSync(z), z);
    const list = execFileSync("unzip", ["-Z1", z]).toString().split("\n");
    assert.ok(list.includes("manifest.json") && list.includes("background.js") && list.includes("_locales/de/messages.json"), t);
    execFileSync("unzip", ["-tq", z]);
  }
});

test("no reserve address baked into the build when LINKWACHE_FALLBACK_SERVER is empty", () => {
  for (const t of ["chromium", "firefox"]) {
    const bg = rd(t, "background.js");
    assert.ok(!/workers\.dev|reserve\.[a-z]+\.example/.test(bg), t + " has no reserve host");
    assert.match(bg, /primaryDown/, "failover logic is bundled");
    assert.ok(!/LW_FALLBACK_SERVER/.test(bg), "the define is replaced at build time");
  }
});
