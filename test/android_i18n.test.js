// Android app strings (android/i18n/app.json): same keys, non-empty and the same placeholders in all
// eight languages, every string the Kotlin code uses exists, nothing orphaned, and the generated
// resources (res/values*/strings_lw.xml) are up to date.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { LANGS } from "../src/i18n.js";
import { STRINGS } from "../src/i18n.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const app = JSON.parse(fs.readFileSync(path.join(root, "android/i18n/app.json"), "utf8"));
const KEYS = Object.keys(app.en || {});

function walk(dir, exts, out = []) {
  for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}
const ph = (s) => (String(s).match(/\{\w+\}|%\d*\$?[sd]/g) || []).sort().join();

test("android app.json has exactly the languages of the server", () => {
  assert.deepEqual(Object.keys(app).sort(), LANGS.slice().sort());
  assert.ok(KEYS.length >= 50, "app strings present");
});

test("every android key is present, non-empty, same placeholders in all eight languages", () => {
  for (const l of LANGS) {
    assert.deepEqual(Object.keys(app[l]).sort(), KEYS.slice().sort(), `${l}: same keys as en`);
    for (const k of KEYS) {
      assert.ok(typeof app[l][k] === "string" && app[l][k].trim(), `${l} ${k} empty`);
      assert.equal(ph(app[l][k]), ph(app.en[k]), `${l} ${k}: placeholders`);
    }
  }
});

test("every R.string.lw_* used by the Kotlin code exists", () => {
  const have = new Set([...KEYS, ...Object.keys(STRINGS.en).filter((k) => /^(v|f|pat)\./.test(k))].map((k) => "lw_" + k.replace(/[.\-]/g, "_")));
  const files = walk(path.join(root, "android/app/src"), [".kt", ".java", ".xml"]).filter((f) => !/strings_lw\.xml$/.test(f));
  const used = new Map();
  for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(/(?:R\.string\.|@string\/)(lw_[A-Za-z0-9_]+)/g)) used.set(m[1], path.relative(root, f));
  for (const [k, where] of used) assert.ok(have.has(k), `${k} (${where}) is not defined`);
});

test("generated android resources are up to date", () => {
  execFileSync(process.execPath, [path.join(root, "android/scripts/gen-strings.mjs"), "--check"], { cwd: root, stdio: "pipe" });
});
