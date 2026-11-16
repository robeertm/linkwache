// Built-in server address: installations that follow the preset move to a new one, an own address stays.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normServer, parsePresetList, followsPreset, applyPreset, presetMarkFor } from "../src/preset.js";

const OLD = "https://old-preset.example";
const NEW = "https://new-preset.example";

test("normalization and the build-time list", () => {
  assert.equal(normServer(" https://a.example/ "), "https://a.example");
  assert.equal(normServer("https://a.example/sub/"), "https://a.example/sub");
  assert.equal(normServer("https://a.example/?x=1"), "");
  assert.equal(normServer(""), "");
  assert.equal(normServer(undefined), "");
  assert.deepEqual(parsePresetList(`${OLD}/, https://older.example;bogus ${NEW}`, NEW), [OLD, "https://older.example"]);
  assert.deepEqual(parsePresetList("", NEW), []);
});

test("old preset (0.5.0/0.5.1 storage without marker) moves to the new one", () => {
  const s = { server: OLD, scope: "domain", paused: false, lang: "de" };
  assert.equal(applyPreset(s, NEW, [OLD]), true);
  assert.equal(s.server, NEW);
  assert.equal(s.serverPreset, NEW);
  assert.equal(s.scope, "domain", "other settings stay");
  // a later release with another preset follows via the marker alone
  assert.equal(applyPreset(s, "https://third.example", []), true);
  assert.equal(s.server, "https://third.example");
  // stable once moved
  assert.equal(applyPreset(s, "https://third.example", []), false);
});

test("own address stays, also when it was saved in the options after a preset", () => {
  const s = { server: "https://my-own.example", lang: "auto" };
  assert.equal(applyPreset(s, NEW, [OLD]), true, "marker written once");
  assert.equal(s.server, "https://my-own.example");
  assert.equal(s.serverPreset, null);
  assert.equal(applyPreset(s, NEW, [OLD]), false);
  const saved = { server: "https://mine.example", serverPreset: presetMarkFor("https://mine.example", OLD) };
  assert.equal(saved.serverPreset, null);
  applyPreset(saved, NEW, [OLD]);
  assert.equal(saved.server, "https://mine.example");
  // the user typed the current preset: keeps following it
  const typed = { server: OLD + "/", serverPreset: presetMarkFor(OLD + "/", OLD) };
  assert.equal(typed.serverPreset, OLD);
  applyPreset(typed, NEW, []);
  assert.equal(typed.server, NEW);
});

test("0.5.0/0.5.1 packages had no preset: an unmarked empty address gets the new one", () => {
  const legacy = { server: "", scope: "url", paused: false, lang: "auto" };
  assert.equal(applyPreset(legacy, NEW, [OLD]), true);
  assert.equal(legacy.server, NEW);
  assert.equal(legacy.serverPreset, NEW);
});

test("an address emptied by the user (0.5.2 options) stays empty", () => {
  const saved = { server: "", serverPreset: presetMarkFor("", NEW) };
  applyPreset(saved, NEW, [OLD]);
  assert.equal(saved.server, "");
});

test("fresh installation gets the new preset", () => {
  const s = { scope: "url", paused: false, lang: "auto" };
  assert.equal(applyPreset(s, NEW, [OLD]), false, "nothing to persist, defaults only");
  assert.equal(s.server, NEW);
  assert.equal(s.serverPreset, NEW);
  assert.ok(followsPreset(s, NEW, []));
});

test("empty preset breaks nothing", () => {
  const legacy = { server: OLD };
  assert.equal(applyPreset(legacy, "", [OLD]), false);
  assert.equal(legacy.server, OLD, "a working address is never emptied");
  const own = { server: "https://my-own.example", serverPreset: null };
  assert.equal(applyPreset(own, "", []), false);
  assert.equal(own.server, "https://my-own.example");
  const fresh = {};
  applyPreset(fresh, "", []);
  assert.equal(fresh.server, "");
  // fresh install of a build without preset is filled once a release has one
  assert.equal(applyPreset(fresh, NEW, []), true);
  assert.equal(fresh.server, NEW);
});

test("store.getAll moves stored 0.5.1 settings and writes them back once", async () => {
  const data = { settings: { server: OLD + "/", scope: "url", paused: false, lang: "auto" }, install: "0123456789abcdef0123456789abcdef" };
  let writes = 0;
  globalThis.LW_DEFAULT_SERVER = NEW;
  globalThis.LW_PRESET_MIGRATE_FROM = `${OLD} https://older.example`;
  globalThis.chrome = { storage: { local: {
    async get(keys) { const out = {}; for (const k of [].concat(keys)) if (k in data) out[k] = structuredClone(data[k]); return out; },
    async set(o) { writes++; Object.assign(data, structuredClone(o)); },
  } } };
  try {
    const store = await import("../src/store.js?case=" + Date.now());
    assert.equal(store.PRESET, NEW);
    const a = await store.getAll();
    assert.equal(a.settings.server, NEW);
    assert.equal(data.settings.server, NEW, "persisted");
    assert.equal(writes, 1);
    await store.getAll();
    assert.equal(writes, 1, "no further writes");
  } finally {
    delete globalThis.LW_DEFAULT_SERVER; delete globalThis.LW_PRESET_MIGRATE_FROM; delete globalThis.chrome;
  }
});
