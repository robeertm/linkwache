import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { unwrap } from "../src/unwrap.js";
import { reduceForSend, sameSite, isAllowed, localAssess, prepare, decide, modeOf, ttlFor, cacheFresh, cacheKey, b64urlEncode, b64urlDecode, normalizeHttp } from "../src/logic.js";

const R = JSON.parse(fs.readFileSync(new URL("../../test/vectors/redirectors.json", import.meta.url), "utf8"));

test("unwrap: every shared redirector vector", () => {
  assert.ok(R.vectors.length >= 14);
  for (const v of R.vectors) assert.equal(unwrap(v.in), v.out, v.in);
});

test("unwrap: depth is limited to 3 levels", () => {
  let u = "https://example.org/end";
  for (let i = 0; i < 5; i++) u = "https://l.facebook.com/l.php?u=" + encodeURIComponent(u);
  const out = unwrap(u);
  assert.match(out, /^https:\/\/l\.facebook\.com\/l\.php/, "two wrappers remain after 3 levels");
});

test("privacy reduction: query, fragment and credentials never leave; domain scope sends host only", () => {
  assert.equal(reduceForSend("https://user:pw@shop.example.org:8443/a/b?token=SECRET&x=1#frag"), "https://shop.example.org:8443/a/b");
  assert.equal(reduceForSend("http://a.example/x?y=1", "domain"), "https://a.example/");
  assert.ok(!reduceForSend("https://a.example/p?mail=me@example.org#t").includes("mail"));
});

test("sameSite pre-filter", () => {
  assert.ok(sameSite("mail.example.org", "www.example.org"));
  assert.ok(sameSite("a.example.co.uk", "b.example.co.uk"));
  assert.ok(!sameSite("example.org", "example.net"));
  assert.ok(!sameSite("a.co.uk", "b.co.uk"));
  assert.ok(!sameSite("", "example.org"));
  assert.ok(!sameSite("127.0.0.1", "10.0.0.1"));
});

test("allowlist: registrable domain only, look-alikes never match", () => {
  assert.equal(isAllowed("https://accounts.google.com/x"), "builtin");
  assert.equal(isAllowed("https://de.wikipedia.org/wiki/X"), "builtin");
  assert.equal(isAllowed("https://wikipedia.org.evil-login.example/"), false);
  assert.equal(isAllowed("https://xn--wikipedia-x7a.org/"), false, "punycode");
  assert.equal(isAllowed("https://wikipedla.org/"), false);
  assert.equal(isAllowed("https://shop.example.org/", ["example.org"]), "user");
  assert.equal(isAllowed("https://example.org.evil.example/", ["example.org"]), false);
});

test("local assessment: red for brand-in-subdomain, amber for plain http", () => {
  assert.equal(localAssess("https://paypal.com.secure-login.example/").stufe, "rot");
  assert.ok(["gelb", "rot"].includes(localAssess("http://plain.example/").stufe));
  assert.equal(localAssess("https://www.example.org/").stufe, "gruen");
});

test("prepare: non-http refused, wrappers unwrapped", () => {
  assert.equal(prepare("javascript:alert(1)"), null);
  assert.equal(prepare("mailto:a@b.example"), null);
  assert.equal(prepare("data:text/html,x"), null);
  const p = prepare(R.vectors[0].in);
  assert.equal(p.target, R.vectors[0].out);
  assert.equal(p.wrapped, true);
  assert.equal(normalizeHttp("ftp://x.example/"), null);
});

test("decision: green opens, amber/red/offline warn, unknown never opens", () => {
  assert.deepEqual(decide("gruen"), { act: "open", level: "gruen" });
  for (const s of ["gelb", "rot", "off", "???", undefined]) assert.equal(decide(s).act, "warn");
});

test("click mode: same tab, background and foreground tab", () => {
  assert.equal(modeOf({}), "same");
  assert.equal(modeOf({ button: 1 }), "bg");
  assert.equal(modeOf({ ctrl: true }), "bg");
  assert.equal(modeOf({ meta: true }), "bg");
  assert.equal(modeOf({ shift: true }), "fg");
  assert.equal(modeOf({ target: "_blank" }), "fg");
  assert.equal(modeOf({ target: "_top" }), "same");
});

test("cache: ttl by level, freshness, key without query", () => {
  assert.equal(ttlFor("gruen"), 21600);
  assert.equal(ttlFor("rot"), 86400);
  assert.equal(ttlFor("gruen", 100), 100);
  assert.equal(ttlFor("rot", 10 ** 9), 86400);
  assert.ok(cacheFresh({ at: Date.now() - 1000, ttl: 10, r: 2 }));
  assert.ok(!cacheFresh({ at: Date.now() - 11000, ttl: 10, r: 2 }));
  assert.equal(cacheKey("https://a.example/p?q=1#f"), "a.example/p");
});

test("warning payload survives base64url, including non-ASCII", () => {
  const d = { u: "https://bücher.example/ä?x=1&y=2", s: "gelb", f: [{ key: "idn", stufe: "gelb", p: { host: "bücher.example" } }] };
  assert.deepEqual(b64urlDecode(b64urlEncode(d)), d);
});

test("cache: results of older rules are never fresh and are purged (0.5.3 false-alarm fix)", async () => {
  const { RULES, purgeOlderRules } = await import("../src/logic.js");
  const now = Date.now();
  const old = { st: "rot", f: [], at: now, ttl: 86400, d: "example.org" };            // cached by 0.5.1, no rules
  const cur = { st: "gruen", f: [], at: now, ttl: 21600, d: "example.net", r: RULES };
  assert.equal(cacheFresh(old, now), false);
  assert.equal(cacheFresh(cur, now), true);
  assert.equal(cacheFresh(cur, now, RULES + 1), false);
  const cache = { a: old, b: cur };
  const gone = purgeOlderRules(cache, RULES);
  assert.deepEqual(gone, [old]);
  assert.deepEqual(Object.keys(cache), ["b"]);
});
