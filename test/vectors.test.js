// The offline heuristics are ported to the desktop app (Rust) and used by the browser extension.
// These vectors pin the server's behaviour; the ports run the same file in their own tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { heuristics } from "../src/checks.js";
import { verdict } from "../src/verdict.js";

const H = JSON.parse(fs.readFileSync(new URL("./vectors/heuristics.json", import.meta.url), "utf8"));
const R = JSON.parse(fs.readFileSync(new URL("./vectors/redirectors.json", import.meta.url), "utf8"));

test("heuristics vectors match the server code", () => {
  assert.ok(H.vectors.length >= 30);
  for (const v of H.vectors) {
    const { findings } = heuristics(v.url);
    assert.deepEqual(findings.map((f) => ({ key: f.key, stufe: f.stufe })), v.findings, v.url);
    assert.equal(verdict(findings, { url: v.url }).stufe, v.stufe, v.url);
  }
});

test("brand owners' own domains are not imitations", () => {
  for (const u of ["https://outlook.office.com/mail/", "https://login.microsoftonline.com/x", "https://outlook.live.com/"]) {
    assert.equal(heuristics(u).findings.filter((f) => f.stufe === "rot").length, 0, u);
  }
  assert.ok(heuristics("https://paypal.com.office.com.example/").findings.some((f) => f.key === "brand-sub"));
});

test("redirector vectors are well formed", () => {
  for (const v of R.vectors) {
    assert.match(v.in, /^https:\/\//);
    if (v.out !== null) assert.match(v.out, /^https?:\/\//);
  }
});
