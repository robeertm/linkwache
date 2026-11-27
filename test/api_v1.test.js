// Client API v1: contract, translation, install id, limits, origin policy, privacy (nothing stored, no sandbox scan, no extra data forwarded).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { LITE_BUDGET } from "../src/check.js";
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

test("v1 never asks crt.sh (info only, often slow)", async () => {
  const res = await post(makeEnv(), { url: "https://no-ct.example.org/" });
  assert.equal(res.status, 200);
  assert.ok(!calls.some((c) => c.url.includes("crt.sh")), "crt.sh must not be called on v1");
});

test("a hanging provider cannot hold the v1 answer beyond the time budget", async () => {
  // RDAP never answers (and ignores abort): the answer must still come within the first-pass budget.
  // The mechanism is the same at any budget, so the test tightens it (LITE_BUDGET_MS, the reserve server's knob) instead of
  // waiting 2.5 s; the margin is generous so a loaded machine cannot turn timer lateness into a red result.
  // The hanging lookup is released after the answer (like a socket finally dying): otherwise fetchTimeout's 8 s timer
  // keeps the test process alive for 8 s after the last test.
  const hanging = [];
  router = (url, init) => (url.includes("rdap") ? new Promise((r) => hanging.push(r)) : calm(url, init));
  const budget = { unwrap: 200, first: 300, second: 200 };
  const t0 = Date.now();
  const res = await post(makeEnv({ LITE_BUDGET_MS: `${budget.unwrap},${budget.first},${budget.second}` }), { url: "https://hanging-rdap.example.org/" });
  const ms = Date.now() - t0;
  assert.ok(hanging.length > 0, "the RDAP lookup really hung");
  for (const release of hanging) release(jres({}, 404));
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.ok(["gruen", "gelb", "rot"].includes(j.stufe));
  assert.ok(ms >= budget.first - 50, `answered after ${ms} ms, before the hanging provider was given up on`);
  assert.ok(ms < budget.first + budget.second + 2500, `answered after ${ms} ms`);
});

test("the default budget leaves the apps' 6 s limit room for the answer", () => {
  assert.ok(LITE_BUDGET.unwrap + LITE_BUDGET.first + LITE_BUDGET.second < 6000);
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

// Safari applies CORS to the extension's background page when the server's host is not (yet) granted: without an
// answer to the preflight the request never leaves the browser (0.7.1, "could not be checked" on every click).
test("CORS: extension origins get a preflight answer and the allow-origin header, web pages never", async () => {
  const env = makeEnv();
  const pre = (origin) => worker.fetch(new Request("https://example.test/api/v1/check", { method: "OPTIONS", headers: {
    ...(origin ? { origin } : {}), "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-linkwache-install,x-linkwache-client" } }), env, ctxOf());
  for (const o of ["safari-web-extension://3F2504E0-4F89-11D3-9A0C-0305E82C3301", "chrome-extension://abcdefghijklmnopabcdefghijklmnop", "moz-extension://1b2c3d4e-0000-4000-8000-000000000000"]) {
    const r = await pre(o);
    assert.equal(r.status, 204, o);
    assert.equal(r.headers.get("access-control-allow-origin"), o);
    assert.match(r.headers.get("access-control-allow-headers"), /x-linkwache-install/);
    assert.match(r.headers.get("access-control-allow-headers"), /x-linkwache-client/);
    assert.match(r.headers.get("access-control-allow-headers"), /content-type/);
    assert.equal(r.headers.get("access-control-allow-methods"), "POST");
    const p = await post(env, { url: "https://a.example/" }, { origin: o });
    assert.equal(p.status, 200);
    assert.equal(p.headers.get("access-control-allow-origin"), o, "the answer itself is readable for the extension");
    const bad = await post(env, { url: "https://a.example/" }, { origin: o, "x-linkwache-install": "" });
    assert.equal(bad.status, 400);
    assert.equal(bad.headers.get("access-control-allow-origin"), o, "error answers are readable too (err.install, not a network error)");
  }
  for (const o of ["https://evil.example", "null", "", "safari-web-extension://x/../evil"]) {
    const r = await pre(o);
    assert.equal(r.status, 403, o || "(no origin)");
    assert.equal(r.headers.get("access-control-allow-origin"), null, o);
  }
  const web = await post(env, { url: "https://a.example/" }, { origin: "https://example.test", "sec-fetch-site": "same-origin" });
  assert.equal(web.headers.get("access-control-allow-origin"), null, "no CORS header for web pages");
});

test("privacy: tokens in the query never reach outside services (Safe Browsing, URLhaus, PhishTank, urlscan)", async () => {
  router = (url, init) => url.includes("urlscan.io/api/v1/scan/") ? jres({ uuid: "u-2" }) : calm(url, init);
  const env = makeEnv({ SAFE_BROWSING_KEY: "sb-key", URLHAUS_KEY: "uh-key" });
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const secret = [b64({ alg: "HS256" }), b64({ path: "/x.png" }), "c2lnbmF0dXJlc2lnbmF0dXJl"].join(".");   // a dummy JWT, built at runtime (leak scan)
  const res = await worker.fetch(new Request("https://example.test/api/check", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: `https://files.example.org/a/b.png?jwt=${secret}&X-Amz-Signature=0123456789abcdef0123456789abcdef&size=2` }) }), env, ctxOf());
  assert.equal(res.status, 200);
  const outside = calls.filter((c) => /safebrowsing|urlhaus|phishtank|urlscan\.io\/api\/v1\/scan/.test(c.url));
  assert.ok(outside.length >= 3, "the outside services were asked");
  for (const c of outside) {
    const sent = c.url + " " + String(c.init.body || "");
    assert.ok(!sent.includes(secret) && !sent.includes(encodeURIComponent(secret)), "no token at " + c.url.slice(0, 40));
    assert.ok(!sent.includes("0123456789abcdef0123456789abcdef"), "no signature at " + c.url.slice(0, 40));
  }
  const scan = calls.find((c) => c.url.includes("urlscan.io/api/v1/scan/"));
  assert.equal(JSON.parse(scan.init.body).url, "https://files.example.org/a/b.png?size=2", "harmless parameters stay");
});

test("watchdog probe: full request path, heuristics only, no outside lookup, not counted", async () => {
  const work = [];
  const env = makeEnv({ METRICS: { work: (w) => work.push(w) } });
  const r = await post(env, { url: "https://example.com/", probe: true });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.api, 1); assert.equal(d.probe, true); assert.ok(["gruen", "gelb", "rot"].includes(d.stufe));
  assert.equal(calls.length, 0, "no outside lookup");
  assert.equal(work.length, 0, "not counted as use");
  const bad = await post(env, { url: "https://example.com/", probe: true }, { "x-linkwache-install": "x" });
  assert.equal(bad.status, 400, "install id still required");
});
