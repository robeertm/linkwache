// Desktop app strings: complete in all eight languages, every key the app uses exists,
// the generated bundle (desktop/ui/i18n.generated.*) is up to date, and the wording rule
// holds (never "safe" — only "no warning signs found").
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STRINGS, LANGS } from "../src/i18n.js";
import { DESKTOP } from "../src/i18n_desktop.js";
import { build, OUT_JSON, OUT_JS } from "../desktop/scripts/i18n.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DT_KEYS = Object.keys(DESKTOP.en);

function files(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p, exts));
    else if (exts.some((x) => e.name.endsWith(x)) && !e.name.startsWith("i18n.generated")) out.push(p);
  }
  return out;
}

const KEY_RE = /["'`]((?:dt|f|pat|v|stufe|age)\.[A-Za-z0-9][A-Za-z0-9._-]*)["'`]/g;
const ATTR_RE = /data-i18n(?:-ph|-title)?="([a-z]+\.[^"]+)"/g;

// Rust: only dt.* (other prefixes collide with domain names such as "v.gd").
const RUST_RE = /"(dt\.[A-Za-z0-9][A-Za-z0-9._-]*)"/g;

function usedKeys(fileList, res = [KEY_RE, ATTR_RE]) {
  const keys = new Map();
  for (const f of fileList) {
    const src = fs.readFileSync(f, "utf8");
    for (const re of res) for (const m of src.matchAll(re)) if (!keys.has(m[1])) keys.set(m[1], path.relative(root, f));
  }
  return keys;
}

test("every dt.* key exists, non-empty, in all eight languages", () => {
  assert.ok(DT_KEYS.length >= 100, "desktop strings present");
  for (const l of LANGS) {
    const d = DESKTOP[l] || {};
    const missing = DT_KEYS.filter((k) => typeof d[k] !== "string" || !d[k].trim());
    assert.deepEqual(missing, [], `${l}: missing desktop strings`);
    const extra = Object.keys(d).filter((k) => !DT_KEYS.includes(k));
    assert.deepEqual(extra, [], `${l}: keys not in en`);
    for (const k of DT_KEYS) {
      const want = (DESKTOP.en[k].match(/\{\w+\}/g) || []).sort().join();
      const got = (d[k].match(/\{\w+\}/g) || []).sort().join();
      assert.equal(got, want, `${l} ${k}: placeholders`);
    }
  }
});

test("every key used by the desktop UI and the Rust code exists", () => {
  const ui = usedKeys(files(path.join(root, "desktop/ui"), [".html", ".js"]));
  const rust = usedKeys([...files(path.join(root, "desktop/src-tauri/src"), [".rs"]), ...files(path.join(root, "desktop/core/src"), [".rs"])], [RUST_RE]);
  assert.ok(ui.size > 50, "UI keys found");
  assert.ok([...rust.keys()].some((k) => k.startsWith("dt.tray.")), "tray keys found in Rust");
  for (const [k, where] of [...ui, ...rust]) {
    for (const l of LANGS) assert.ok(STRINGS[l][k] !== undefined && String(STRINGS[l][k]).trim() !== "", `${k} (${where}) missing in ${l}`);
  }
});

test("generated desktop string bundle is up to date", () => {
  const { json, js } = build();
  assert.equal(fs.readFileSync(OUT_JSON, "utf8"), json, "run: node desktop/scripts/i18n.mjs");
  assert.equal(fs.readFileSync(OUT_JS, "utf8"), js, "run: node desktop/scripts/i18n.mjs");
});

test("desktop strings never call a link safe", () => {
  const forbidden = {
    en: /\bsafe(ly)?\b|\bsecure\b/i, de: /\bsicher\b|\bungefährlich\b/i, tr: /güvenli/i, pl: /(?<!nie)bezpieczn/i,
    ru: /(?<!не)безопасн/i, es: /\bsegur[oa]s?\b/i, fr: /\bsûrs?\b|\bsécurisé/i, it: /\bsicur[oa]\b/i,
  };
  for (const l of LANGS) {
    for (const k of DT_KEYS) assert.doesNotMatch(DESKTOP[l][k], forbidden[l], `${l} ${k}`);
  }
});
