// Reserve server (src/reserve.js, docs/FALLBACK.md): app API only, nothing stored, no sandbox scan, tighter budget.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import reserve, { reserveEnv } from "../src/reserve.js";
import { liteBudget, LITE_BUDGET } from "../src/check.js";
import { clearV1Cache } from "../src/api_v1.js";
import main from "../src/index.js";

const realFetch = globalThis.fetch;
let calls;
const jres = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
function calm(url) {
  if (url.includes("dns-query") || url.includes("/resolve?")) {
    const type = new URL(url).searchParams.get("type");
    return jres({ Answer: type === "A" ? [{ type: 1, data: "203.0.113.5" }] : [] });
  }
  if (url.includes("urlscan.io/api/v1/search")) return jres({ results: [], total: 0 });
  return jres({}, 404);
}
beforeEach(() => { clearV1Cache(); calls = []; globalThis.fetch = async (url, init = {}) => { url = String(url); calls.push({ url, init }); return calm(url); }; });
afterEach(() => { globalThis.fetch = realFetch; });

const ID = "0123456789abcdef0123456789abcdef";
const ctx = { waitUntil() {}, passThroughOnException() {} };
const env = () => ({ SITE_NAME: "Linkwache", URLSCAN_KEY: "would-be-used", RESULTS: { get() { throw new Error("KV read"); }, put() { throw new Error("KV write"); } } });
const req = (path, init = {}) => new Request("https://reserve.example.test" + path, init);
const check = (e, body, headers = {}) => reserve.fetch(req("/api/v1/check", { method: "POST",
  headers: { "content-type": "application/json", "x-linkwache-install": ID, "cf-connecting-ip": "198.51.100.7", ...headers }, body: JSON.stringify(body) }), e, ctx);

test("health says reserve", async () => {
  const r = await reserve.fetch(req("/api/health"), {}, ctx);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.role, "reserve"); assert.deepEqual(j.api, [1]);
});

test("same answer as the main server, nothing stored, no sandbox scan submitted", async () => {
  const e = env();
  const r = await check(e, { url: "https://shop.example.org/a?b=1#frag", lang: "en" });
  assert.equal(r.status, 200);
  const a = await r.json();
  clearV1Cache();
  const m = await main.fetch(new Request("https://main.example.test/api/v1/check", { method: "POST",
    headers: { "content-type": "application/json", "x-linkwache-install": ID, "cf-connecting-ip": "198.51.100.7" },
    body: JSON.stringify({ url: "https://shop.example.org/a?b=1#frag", lang: "en" }) }), { SITE_NAME: "Linkwache", RESULTS: { get: async () => null, put: async () => {} } }, ctx);
  const b = await m.json();
  for (const k of ["api", "stufe", "score", "kurzKey", "url", "rules"]) assert.deepEqual(a[k], b[k], k);
  assert.deepEqual(a.findings.map((f) => f.key), b.findings.map((f) => f.key));
  assert.ok(!calls.some((c) => c.url.includes("urlscan.io/api/v1/scan")), "never submits a scan");
});

test("install id, origin policy and CORS behave like the main server", async () => {
  const bad = await check(env(), { url: "https://example.org/" }, { "x-linkwache-install": "nope" });
  assert.equal(bad.status, 400); assert.equal((await bad.json()).error, "err.install");
  const foreign = await check(env(), { url: "https://example.org/" }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" });
  assert.equal(foreign.status, 403);
  const pre = await reserve.fetch(req("/api/v1/check", { method: "OPTIONS", headers: { origin: "safari-web-extension://ABC-123" } }), {}, ctx);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "safari-web-extension://ABC-123");
  const ext = await check(env(), { url: "https://example.org/" }, { origin: "chrome-extension://abcdef" });
  assert.equal(ext.headers.get("access-control-allow-origin"), "chrome-extension://abcdef");
});

test("rate limit bindings are used", async () => {
  const e = { ...env(), V1_LIMIT: { limit: async () => ({ success: false, retryAfter: 30 }) } };
  const r = await check(e, { url: "https://example.org/" });
  assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "30");
});

test("no website, no Telegram, no result pages", async () => {
  for (const [p, method] of [["/api/check", "POST"], ["/telegram", "POST"], ["/r/abcdef12", "GET"], ["/download", "GET"], ["/impressum.html", "GET"], ["/api/stats", "GET"], ["/admin", "GET"]]) {
    const r = await reserve.fetch(req(p, { method, ...(method === "POST" ? { body: "{}", headers: { "content-type": "application/json" } } : {}) }), env(), ctx);
    assert.equal(r.status, 404, p);
  }
  const home = await reserve.fetch(req("/"), {}, ctx);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("x-robots-tag"), /noindex/);
});

test("reserveEnv strips storage and the urlscan key", () => {
  const e = reserveEnv({ URLSCAN_KEY: "k", RESULTS: {}, SAFE_BROWSING_KEY: "s" });
  assert.equal(e.URLSCAN_KEY, ""); assert.equal(e.RESULTS, undefined); assert.equal(e.SCAN_BUDGET.take(), false);
  assert.equal(e.SAFE_BROWSING_KEY, "s");
});

test("LITE_BUDGET_MS tightens the lookup budget, bad values fall back", () => {
  assert.deepEqual(liteBudget({ LITE_BUDGET_MS: "1500,2000,800" }), { unwrap: 1500, first: 2000, second: 800 });
  assert.deepEqual(liteBudget({}), LITE_BUDGET);
  assert.deepEqual(liteBudget({ LITE_BUDGET_MS: "1,2" }), LITE_BUDGET);
  assert.deepEqual(liteBudget({ LITE_BUDGET_MS: "50,2000,800" }), LITE_BUDGET);
});

test("reserve wrangler config: app entry, no KV, no assets, no address, budget fits the apps' 6 s", () => {
  const t = fs.readFileSync(new URL("../deploy/cloudflare/wrangler.toml", import.meta.url), "utf8");
  assert.match(t, /^main = "..\/..\/src\/reserve.js"/m);
  assert.doesNotMatch(t, /kv_namespaces|\[assets\]|routes?\s*=/);
  assert.doesNotMatch(t, /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
  const m = /LITE_BUDGET_MS = "(\d+),(\d+),(\d+)"/.exec(t);
  assert.ok(m, "budget set");
  assert.ok(Number(m[1]) + Number(m[2]) + Number(m[3]) <= 5000, "reserve answers well within 6 s");
});
