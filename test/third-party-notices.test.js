// THIRD-PARTY-NOTICES.md must list every production npm package, every registry crate of the desktop
// app and every direct Android library, and the packages must carry LICENSE + notices.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const notices = read("THIRD-PARTY-NOTICES.md");

test("every production npm package is listed with its version", () => {
  const lock = JSON.parse(read("package-lock.json"));
  const missing = [];
  for (const [key, meta] of Object.entries(lock.packages)) {
    if (!key || meta.dev) continue;
    const name = key.split("node_modules/").pop();
    if (!notices.includes(`- \`${name}\` ${meta.version} - `)) missing.push(`${name} ${meta.version}`);
  }
  assert.deepEqual(missing, [], "run scripts/drittlizenzen.py (see its header)");
});

test("every registry crate of desktop/Cargo.lock is listed with its version", () => {
  const text = read("desktop/Cargo.lock");
  const missing = [];
  for (const block of text.split("[[package]]").slice(1)) {
    const name = /^name = "(.+)"$/m.exec(block)?.[1];
    const version = /^version = "(.+)"$/m.exec(block)?.[1];
    if (!/^source = "registry\+/m.test(block)) continue;
    if (!notices.includes(`- \`${name}\` ${version} - `)) missing.push(`${name} ${version}`);
  }
  assert.deepEqual(missing, [], "run scripts/drittlizenzen.py (see its header)");
});

test("every direct Android library is listed", () => {
  const missing = [];
  for (const f of ["android/app/build.gradle.kts", "android/core/build.gradle.kts"]) {
    for (const m of read(f).matchAll(/^\s*(?:implementation|api)\((?:platform\()?"([^":]+:[^":]+)(?::[^"]+)?"/gm)) {
      if (!notices.includes(`- \`${m[1]}\` `)) missing.push(m[1]);
    }
  }
  assert.deepEqual(missing, [], "run scripts/drittlizenzen.py (see its header)");
});

test("the packages carry LICENSE and the notices", () => {
  const docker = read("Dockerfile");
  assert.match(docker, /COPY LICENSE THIRD-PARTY-NOTICES\.md/);
  const tauri = JSON.parse(read("desktop/src-tauri/tauri.conf.json"));
  assert.ok(Object.keys(tauri.bundle.resources).some((k) => k.endsWith("THIRD-PARTY-NOTICES.md")));
  assert.ok(Object.keys(tauri.bundle.resources).some((k) => k.endsWith("LICENSE")));
  assert.match(read("android/app/build.gradle.kts"), /THIRD-PARTY-NOTICES\.md/);
  assert.match(read("extension/scripts/build.mjs"), /"LICENSE"/);
  for (const ignore of [".dockerignore"]) {
    if (fs.existsSync(path.join(ROOT, ignore))) assert.doesNotMatch(read(ignore), /^(LICENSE|THIRD-PARTY-NOTICES\.md)$/m);
  }
});
