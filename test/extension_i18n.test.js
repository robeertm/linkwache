// Every ext.* key exists in all 8 languages (non-empty), every key the extension code uses exists, and the build bundle carries them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { STRINGS, LANGS } from "../src/i18n.js";
import { EXTENSION } from "../src/i18n_extension.js";
import { extensionStrings } from "../extension/scripts/build.mjs";

const SRC = new URL("../extension/src/", import.meta.url).pathname;
const code = fs.readdirSync(SRC).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(SRC, f), "utf8")).join("\n");

test("every ext.* key is present and non-empty in all eight languages", () => {
  const keys = Object.keys(EXTENSION.en);
  assert.ok(keys.length > 40);
  for (const l of LANGS) {
    assert.deepEqual(Object.keys(EXTENSION[l]).sort(), keys.slice().sort(), l + " has the same keys as en");
    for (const k of keys) assert.ok(EXTENSION[l][k] && EXTENSION[l][k].trim().length > 0, l + " " + k);
  }
});

test("placeholders survive translation ({n}, {v})", () => {
  for (const l of LANGS) {
    assert.match(EXTENSION[l]["ext.w.open.wait"], /\{n\}/, l);
    assert.match(EXTENSION[l]["ext.o.app.on"], /\{v\}/, l);
  }
});

test("every ext.* key used in the extension code exists", () => {
  const used = new Set([...code.matchAll(/["'`](ext\.[a-z0-9.]*[a-z0-9])["'`]/g)].map((m) => m[1]));
  for (const m of code.matchAll(/["'](ext\.[a-z0-9.]+\.)["']\s*\+\s*(\w+)/g)) for (const s of ["gelb", "rot", "off"]) used.add(m[1] + s);
  assert.ok(used.size > 25);
  for (const k of used) for (const l of LANGS) assert.ok(STRINGS[l][k], l + " " + k);
  const unused = Object.keys(EXTENSION.en).filter((k) => !used.has(k) && !k.startsWith("safari.") && !["ext.name", "ext.desc"].includes(k));
  assert.deepEqual(unused, [], "no orphaned texts");
});

test("build bundle carries ext.*, finding, pattern, verdict, level and age texts in every language", () => {
  const S = extensionStrings();
  for (const l of LANGS) {
    for (const k of ["ext.w.title.rot", "f.brand-sub", "f.brand-sub.t", "pat.bank", "v.gruen", "stufe.rot", "age.days"]) assert.ok(S[l][k], l + " " + k);
    assert.ok(!Object.keys(S[l]).some((k) => k.startsWith("dt.") || k.startsWith("home.")), "only what the extension needs");
  }
});

test("wording: never 'safe' for a link in extension texts", () => {
  const bad = /\b(safe|sicher|güvenli|bezpieczn\w*|безопасн\w*|seguro|sûr|sicuro)\b/i;
  for (const l of LANGS) for (const [k, v] of Object.entries(EXTENSION[l])) assert.ok(!bad.test(v), l + " " + k + ": " + v);
});

test("safari.app.* keys exist in all eight languages with their placeholders", () => {
  const keys = Object.keys(EXTENSION.en).filter((k) => k.startsWith("safari.app."));
  assert.equal(keys.length, 18);
  for (const l of LANGS) {
    for (const k of keys) assert.ok(STRINGS[l][k] && STRINGS[l][k].trim().length > 0, l + " " + k);
    assert.match(STRINGS[l]["safari.app.update"], /\{v\}.*\{cur\}/, l);
    for (const k of ["safari.app.uptodate", "safari.app.version"]) assert.match(STRINGS[l][k], /\{v\}/, l + " " + k);
  }
});
