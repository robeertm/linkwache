// Safari: capability fallbacks (platform.js) and the Safari build output (manifest, no native messaging, container-app texts).
import { test, before, after } from "node:test";
import os from "node:os";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pkg from "../../package.json" with { type: "json" };
import { features, timeoutSignal, newTabOptions, createTab } from "../src/platform.js";

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Own output folder: build.test.js builds into extension/dist at the same time.
const DIST = fs.mkdtempSync(path.join(os.tmpdir(), "lw-safari-test-"));
after(() => fs.rmSync(DIST, { recursive: true, force: true }));
const rd = (...p) => fs.readFileSync(path.join(DIST, ...p), "utf8");
const LANGS = ["de", "en", "tr", "pl", "ru", "es", "fr", "it"];
before(() => { execFileSync(process.execPath, [path.join(EXT, "scripts", "build.mjs"), "safari"], { env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("LINKWACHE_"))), LINKWACHE_EXT_DIST: DIST }, stdio: "pipe" }); });

const fullApi = () => ({
  runtime: { connectNative() {} },
  declarativeNetRequest: { updateSessionRules() {} },
  webNavigation: { onBeforeNavigate: { addListener() {} } },
});

test("features: chromium and firefox use native messaging and DNR when the API is there", () => {
  for (const t of ["chromium", "firefox"]) {
    const f = features(t, fullApi());
    assert.equal(f.native, true, t); assert.equal(f.dnr, true, t); assert.equal(f.webNavigation, true, t); assert.equal(f.openerTab, true, t);
  }
});

test("features: safari never asks native messaging (only reaches the container app) and skips DNR, even if exposed", () => {
  const f = features("safari", fullApi());
  assert.equal(f.native, false);
  assert.equal(f.dnr, false);
  assert.equal(f.webNavigation, true, "the navigation fallback stays");
  assert.equal(f.openerTab, false);
});

test("features: missing APIs fall back everywhere (no crash on an empty API object)", () => {
  for (const t of ["chromium", "firefox", "safari"]) {
    const f = features(t, {});
    assert.deepEqual([f.native, f.dnr, f.webNavigation], [false, false, false], t);
  }
  assert.equal(features("safari", undefined).native, false);
});

test("timeoutSignal: uses AbortSignal.timeout when present, AbortController + timer otherwise", async () => {
  let asked = 0;
  const fake = { AbortSignal: { timeout: (ms) => { asked = ms; return "native-signal"; } } };
  assert.equal(timeoutSignal(6000, fake), "native-signal");
  assert.equal(asked, 6000);
  const old = { AbortSignal: {}, AbortController };
  const s = timeoutSignal(20, old);
  assert.equal(s.aborted, false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(s.aborted, true);
});

test("new tabs: opener fields only where the browser takes them; retry without them on rejection", async () => {
  const tab = { id: 7, index: 2 };
  assert.deepEqual(newTabOptions("https://a.example/", "new", tab, { openerTab: true }), { url: "https://a.example/", active: true, index: 3, openerTabId: 7 });
  assert.deepEqual(newTabOptions("https://a.example/", "bg", tab, { openerTab: false }), { url: "https://a.example/", active: false });
  const calls = [];
  const tabs = { create: async (o) => { calls.push(o); if ("openerTabId" in o) throw new Error("Unknown property openerTabId"); return { id: 9 }; } };
  assert.deepEqual(await createTab(tabs, "https://a.example/", "new", tab, { openerTab: true }), { id: 9 });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { url: "https://a.example/", active: true });
  const failing = { create: async () => { throw new Error("no"); } };
  await assert.rejects(createTab(failing, "https://a.example/", "new", null, { openerTab: false }));
});

test("safari manifest: MV3, non-persistent background script, no nativeMessaging/DNR, no Chromium key, minimum Safari", () => {
  const m = JSON.parse(rd("safari", "manifest.json"));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.version, pkg.version);
  assert.deepEqual(m.background, { scripts: ["background.js"], persistent: false });
  assert.deepEqual(m.permissions.sort(), ["storage", "webNavigation"]);
  assert.equal(m.key, undefined);
  assert.equal(m.browser_specific_settings.gecko, undefined);
  assert.equal(m.browser_specific_settings.safari.strict_min_version, "16.4");
  assert.ok(m.host_permissions.includes("https://*/*"));
});

test("safari build: target baked in, same warning page and texts as the other browsers", () => {
  const bg = rd("safari", "background.js");
  assert.match(bg, /"safari"/, "LW_TARGET is defined as safari");
  assert.ok(!/LW_TARGET/.test(bg), "no unresolved define");
  for (const f of ["warning.html", "options.html", "ui.css"]) assert.equal(rd("safari", f), fs.readFileSync(path.join(EXT, f), "utf8"), f);
  for (const l of LANGS) assert.ok(JSON.parse(rd("safari", "_locales", l, "messages.json")).extName.message, l);
  assert.match(rd("safari", "options.js"), /ext\.o\.app\.safari/);
});

test("container app texts: every key in all eight languages, placeholders kept", () => {
  const j = JSON.parse(rd("safari-app-strings.json"));
  assert.equal(j.version, pkg.version);
  assert.deepEqual(j.langs, LANGS);
  const keys = Object.keys(j.strings.en).sort();
  for (const k of ["title", "lead", "state.on", "state.off", "steps.h", "step1", "step2", "step3", "open", "update", "uptodate", "autocheck", "version"]) assert.ok(keys.includes(k), k);
  for (const l of LANGS) {
    assert.deepEqual(Object.keys(j.strings[l]).sort(), keys, l);
    assert.match(j.strings[l].update, /\{v\}/, l); assert.match(j.strings[l].update, /\{cur\}/, l);
    for (const v of Object.values(j.strings[l])) assert.ok(v.trim().length > 0, l);
  }
});
