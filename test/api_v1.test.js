// Client API v1: contract, translation, install id, limits, origin policy, privacy (nothing stored, no sandbox scan, no extra data forwarded).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { clearV1Cache, reduceUrl } from "../src/api_v1.js";
import { createLimiter } from "../server/ratelimit.js";
import { STRINGS, LANGS } from "../src/i18n.js";

const realFetch = globalThis.fetch;
let calls, router;
beforeEach(() => { clearV1Cache(); calls = []; router = calm; globalThis.fetch = async (url, init = {}) => { url = String(url); calls.push({ url, init }); return router(url, init); }; });
afterEach(() => { globalThis.fetch = realFetch; });

const jres = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
function calm(url) {
  if (url.includes("dns-query") || url.includes("/resolve?")) {
    const type = new URL(url).searchParams.get("type");
    return jres({ Answer: type === "A" ? [{ type: 1, data: "203.0.113.5" }] : [] });
  }
  if (url.includes("urlscan.io/api/v1/search")) return jres({ results: [], total: 0 });
  return jres({}, 404);
}
const ID = "0123456789abcdef0123456789abcdef";
function makeEnv(extra = {}) {
  const kv = new Map(); const puts = [];
  return {
    SITE_NAME: "Linkwache", SITE_URL: "https://example.test", ASSET_VER: "t", URLSCAN_KEY: "fake-key",
    RESULTS: { async get(k) { return kv.get(k) ?? null; }, async put(k, v) { puts.push(k); kv.set(k, v); } },
    ASSETS: { async fetch() { return new Response("nope", { status: 404 }); } },
    puts, ...extra,
  };
}
const ctxOf = () => ({ waitUntil() {}, passThroughOnException() {} });
const post = (env, body, headers = {}, raw) => worker.fetch(new Request("https://example.test/api/v1/check", {
  method: "POST", headers: { "content-type": "application/json", "x-linkwache-install": ID, "cf-connecting-ip": "198.51.100.7", ...headers },
  body: raw ?? JSON.stringify(body) }), env, ctxOf());

test("contract: all documented fields, translated, nothing stored, no sandbox scan", async () => {
  const env = makeEnv();
  const res = await post(env, { url: "https://www.example.org/path", lang: "de" }, { "x-linkwache-client": "extension/0.5.0" });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.api, 1);
  assert.equal(j.stufe, "gruen");
  assert.equal(typeof j.score, "number");
  assert.equal(j.kurzKey, "v.gruen");
  assert.equal(j.ratKey, "v.gruen.rat");
  assert.equal(j.kurz, STRINGS.de["v.gruen"]);
  assert.equal(j.rat, STRINGS.de["v.gruen.rat"]);
  assert.equal(j.url, "https://www.example.org/path");
  assert.deepEqual(j.host, { host: "www.example.org", domain: "example.org", unicodeHost: "www.example.org" });
  assert.deepEqual(j.chain, ["www.example.org"]);
  assert.ok(Array.isArray(j.findings));
  assert.equal(j.cacheTtl, 21600);
  assert.match(j.checked, /^\d{4}-\d\d-\d\dT/);
  assert.match(j.server, /^\d+\.\d+\.\d+/);
  assert.equal(j.id, undefined);
  assert.equal(j.html, undefined);
  assert.equal(env.puts.length, 0, "v1 results are not stored");
  assert.ok(!calls.some((c) => c.url.includes("urlscan.io/api/v1/scan")), "no sandbox scan");
  assert.ok(!calls.some((c) => c.url.includes("urlscan.io/api/v1/search")), "urlscan search only when not green");
});

test("findings are translated per requested lang, amber/red get a one-day cacheTtl and a urlscan search", async () => {
  const env = makeEnv();
  const out = {};
  for (const lang of ["de", "en", "ru"]) {
    const j = await (await post(env, { url: "https://paypal.com.secure-login.example/", lang })).json();
    out[lang] = j;
    assert.equal(j.stufe, "rot");
    assert.equal(j.cacheTtl, 86400);
    const f = j.findings.find((x) => x.key === "brand-sub");
    assert.ok(f && f.titel && f.text && f.p.brand === "paypal");
    assert.equal(j.kurz, STRINGS[lang][j.kurzKey]);
    clearV1Cache();
  }
  assert.notEqual(out.de.kurz, out.en.kurz);
  assert.notEqual(out.en.findings[0].titel, out.ru.findings[0].titel);
  assert.ok(calls.some((c) => c.url.includes("urlscan.io/api/v1/search")));
  assert.ok(!calls.some((c) => c.url.includes("urlscan.io/api/v1/scan/")));
});

test("lang falls back to Accept-Language", async () => {
  const j = await (await post(makeEnv(), { url: "https://www.example.org/" }, { "accept-language": "fr-FR" })).json();
  assert.equal(j.kurz, STRINGS.fr["v.gruen"]);
});

test("install id: missing or malformed = 400 err.install in every language", async () => {
  const env = makeEnv();
  for (const bad of ["", "xyz", ID.toUpperCase(), ID + "0", ID.slice(1)]) {
    const res = await post(env, { url: "https://a.example/" }, { "x-linkwache-install": bad });
    assert.equal(res.status, 400, bad);
    assert.equal((await res.json()).error, "err.install");
  }
  for (const l of LANGS) assert.ok(STRINGS[l]["err.install"]?.length > 10, l);
  const r = await post(env, { url: "https://a.example/", lang: "tr" }, { "x-linkwache-install": "" });
  assert.equal((await r.json()).message, STRINGS.tr["err.install"]);
});

test("bad input: no link 400, wrong content type 415, huge body 413", async () => {
  const env = makeEnv();
  const nl = await post(env, { url: "kein link" });
  assert.equal(nl.status, 400);
  assert.equal((await nl.json()).error, "err.nolink");
  assert.equal((await post(env, {}, { "content-type": "text/plain" })).status, 415);
  assert.equal((await post(env, null, {}, JSON.stringify({ url: "https://a.example/" + "x".repeat(20000) }))).status, 413);
  assert.equal((await post(env, null, {}, "{not json")).status, 400);
});

test("per-installation limit, per-IP limit, both independent of the website limiter", async () => {
  const website = createLimiter({ perMinute: 1, perDay: 1 });
  const env = makeEnv({ CHECK_LIMIT: website, V1_LIMIT: createLimiter({ perMinute: 2, perDay: 100 }), V1_IP_LIMIT: createLimiter({ perMinute: 6, perDay: 100 }) });
  const s = [];
  for (let i = 0; i < 3; i++) s.push((await post(env, { url: "https://a.example/" })).status);
  assert.deepEqual(s, [200, 200, 429]);
  const denied = await post(env, { url: "https://a.example/" });
  const j = await denied.json();
  assert.equal(j.error, "err.rate");
  assert.ok(j.retryAfter >= 1 && j.retryAfter <= 60);
  assert.ok(denied.headers.get("retry-after"));
  // another installation behind the same address still works until the IP budget is gone
  const other = (n) => post(env, { url: "https://a.example/" }, { "x-linkwache-install": n.toString(16).padStart(32, "0") });
  assert.equal((await other(1)).status, 200);
  assert.equal((await other(2)).status, 200);
  assert.equal((await other(3)).status, 429, "per-IP budget (6) is spent by the four earlier requests plus two more");
  // the website limiter was never consulted by v1 (it would have refused the second request)
});

test("limiter keys are hashed and carry no raw install id or address", async () => {
  const keys = [];
  const rec = { limit: async ({ key }) => { keys.push(key); return { success: true }; } };
  await post(makeEnv({ V1_LIMIT: rec, V1_IP_LIMIT: rec }), { url: "https://a.example/" });
  assert.equal(keys.length, 2);
  for (const k of keys) { assert.ok(!k.includes(ID) && !k.includes("198.51.100.7")); assert.match(k, /^v1[ip]:[0-9a-f]{32}$/); }
});

test("origin policy: web pages of other sites refused, extensions and no-Origin clients allowed", async () => {
  const env = makeEnv();
  assert.equal((await post(env, { url: "https://a.example/" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await post(env, { url: "https://a.example/" }, { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await post(env, { url: "https://a.example/" }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" })).status, 403);
  for (const o of ["chrome-extension://ldehleohedacddboipopkjkphjnphine", "moz-extension://1234-abcd", "safari-web-extension://x"]) {
    assert.equal((await post(env, { url: "https://a.example/" }, { origin: o })).status, 200, o);
    assert.equal((await post(env, { url: "https://a.example/" }, { origin: o, "sec-fetch-site": "cross-site" })).status, 200, o + " cross-site");
    assert.equal((await post(env, { url: "https://a.example/" }, { origin: o, "sec-fetch-site": "none" })).status, 200, o + " none");
  }
  assert.equal((await post(env, { url: "https://a.example/" })).status, 200, "no Origin");
  assert.equal((await post(env, { url: "https://a.example/" }, { origin: "https://example.test", "sec-fetch-site": "same-origin" })).status, 200);
});

test("scope=domain reduces to https://host/; fragments are dropped; the query is only used when sent", async () => {
  const env = makeEnv();
  const d = await (await post(env, { url: "http://user:pw@shop.example.org:8443/a/b?token=SECRET#frag", scope: "domain" })).json();
  assert.equal(d.url, "https://shop.example.org:8443/");
  assert.equal(reduceUrl("https://a.example/x?q=1#f", "url"), "https://a.example/x?q=1");
  assert.equal(reduceUrl("https://a.example/x#f", "url"), "https://a.example/x");
  const u = await (await post(env, { url: "https://a.example/x/y#secret-fragment" })).json();
  assert.equal(u.url, "https://a.example/x/y");
  assert.ok(calls.every((c) => !c.url.includes("secret-fragment") && !String(c.init.body || "").includes("secret-fragment") && !c.url.includes("SECRET")));
});

test("in-memory cache: a repeated URL does not repeat the lookups; different URLs do", async () => {
  const env = makeEnv();
  await post(env, { url: "https://cached.example.org/a" });
  const n = calls.length;
  assert.ok(n > 0);
  await post(env, { url: "https://cached.example.org/a", lang: "en" });
  assert.equal(calls.length, n, "second answer comes from the cache");
  await post(env, { url: "https://cached.example.org/b" });
  assert.ok(calls.length > n);
});

test("crt.sh gets a short timeout on v1", async () => {
  let aborted = null;
  router = (url, init) => {
    if (url.includes("crt.sh")) return new Promise((_, rej) => init.signal.addEventListener("abort", () => { aborted = Date.now(); rej(new DOMException("aborted", "AbortError")); }));
    return calm(url);
  };
  const t0 = Date.now();
  const res = await post(makeEnv(), { url: "https://slow-ct.example.org/" });
  assert.equal(res.status, 200);
  assert.ok(aborted && aborted - t0 < 3000, "aborted at ~1.5 s, not 8 s");
});

test("health reports the supported API versions; the website check still stores and scans", async () => {
  const h = await (await worker.fetch(new Request("https://example.test/api/health"), makeEnv(), ctxOf())).json();
  assert.deepEqual(h.api, [1]);
  router = (url, init) => url.includes("urlscan.io/api/v1/scan/") ? jres({ uuid: "u-1" }) : calm(url, init);
  const env = makeEnv();
  const res = await worker.fetch(new Request("https://example.test/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://www.example.org/" }) }), env, ctxOf());
  const j = await res.json();
  assert.equal(res.status, 200);
  assert.ok(j.id);
  assert.equal(j.scan.status, "pending");
  assert.ok(calls.some((c) => c.url.includes("urlscan.io/api/v1/search")), "website still searches urlscan on every check");
});
