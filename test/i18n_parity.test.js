// One gate for all surfaces: the merged server/extension/desktop string table (src/i18n.js) has the
// same keys and the same {placeholders} in all eight languages; android/i18n/app.json and the
// extension's _locales texts follow in their own tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STRINGS, LANGS } from "../src/i18n.js";

const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();

test("all languages carry the same keys as en", () => {
  const keys = Object.keys(STRINGS.en);
  for (const l of LANGS) {
    const missing = keys.filter((k) => !(k in STRINGS[l]));
    const extra = Object.keys(STRINGS[l]).filter((k) => !(k in STRINGS.en));
    assert.deepEqual(missing, [], `${l}: missing keys`);
    assert.deepEqual(extra, [], `${l}: keys not in en`);
  }
});

test("no empty text and identical placeholders in every language (app surfaces)", () => {
  const SURFACE = /^(ext|dt|v|f|pat|stufe|age)\./;
  for (const k of Object.keys(STRINGS.en).filter((k) => SURFACE.test(k))) {
    for (const l of LANGS) {
      const v = STRINGS[l][k];
      assert.ok(typeof v === "string" && v.trim(), `${l} ${k} empty`);
      assert.equal(ph(v), ph(STRINGS.en[k]), `${l} ${k}: placeholders`);
    }
  }
});
