// Fraud lists: red only for exactly the reported URL; the start page of a well-known site and entries that only name
// other pages under the same name are never red (0.5.3, false alarm on the real start page of a payment provider).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { clearV1Cache } from "../src/api_v1.js";
import { listFindings, listKey, sameListedUrl, isKnownStartPage, isWellKnown, softenHttp, RULES } from "../src/lists.js";
import { heuristics } from "../src/checks.js";
import { verdict } from "../src/verdict.js";

const PT = (url, extra = {}) => ({ ok: true, listed: true, valid: true, verified: true, url, ...extra });
const stufe = (url, domain, lists, heur = []) => verdict([...heur, ...listFindings({ url, domain, ...lists })], { url }).stufe;

test("URL keys: scheme and fragment ignored, host lower case, path and query kept", () => {
  assert.equal(listKey("http://WWW.Example.org:80/a?b=1#x"), "www.example.org/a?b=1");
  assert.ok(sameListedUrl("http://www.example.org/", "https://www.example.org/"));
  assert.ok(!sameListedUrl("https://www.example.org/", "https://www.example.org/login"));
  assert.ok(!sameListedUrl("https://www.example.org/a?x=1", "https://www.example.org/a?x=2"));
  assert.equal(listKey("javascript:alert(1)"), "");
});

test("well-known list covers global top sites, big German sites and brand homes; start page means the site itself", () => {
  for (const d of ["google.com", "paypal.de", "paypal.com", "heise.de", "sparkasse.de", "amazon.de"]) assert.ok(isWellKnown(d), d);
  assert.ok(!isWellKnown("paypa1-sicherheit.com"));
  assert.ok(isKnownStartPage("http://www.paypal.de/", "paypal.de"));
  assert.ok(isKnownStartPage("https://paypal.de", "paypal.de"));
  assert.ok(!isKnownStartPage("https://www.paypal.de/?x=1", "paypal.de"));
  assert.ok(!isKnownStartPage("https://evil.github.io/", "github.io"), "a subdomain on a platform is not the platform's start page");
  assert.ok(!isKnownStartPage("https://sites.google.com/view/x", "google.com"));
});

test("http://www.paypal.de/ listed at PhishTank (stale entry) → not red", () => {
  const url = "http://www.paypal.de/";
  const heur = softenHttp(heuristics(url).findings, "paypal.de", "www.paypal.de");
  assert.ok(heur.every((f) => f.stufe !== "gelb" && f.stufe !== "rot"), JSON.stringify(heur));
  const f = listFindings({ url, domain: "paypal.de", pt: PT(url) });
  assert.deepEqual(f.map((x) => [x.key, x.stufe]), [["list-known", "info"]]);
  assert.equal(stufe(url, "paypal.de", { pt: PT(url) }, heur), "gruen");
});

test("exactly the reported phishing URL → red, also on big platforms and on platform subdomains", () => {
  const u1 = "https://login-check.example-top.top/de/verify?id=7";
  assert.equal(stufe(u1, "example-top.top", { pt: PT(u1) }), "rot");
  const u2 = "https://sites.google.com/view/paypal-konto-sperre";
  assert.equal(stufe(u2, "google.com", { pt: PT(u2) }), "rot");
  const u3 = "https://paypal-secure.github.io/";
  assert.equal(stufe(u3, "github.io", { pt: PT(u3) }), "rot");
  assert.equal(stufe(u1, "example-top.top", { sb: { ok: true, matches: ["SOCIAL_ENGINEERING"] } }), "rot");
  assert.equal(stufe(u1, "example-top.top", { uhu: { ok: true, listed: true } }), "rot");
});

test("entries that name other pages under the host never make a link red", () => {
  const url = "https://www.example-shop.de/";
  const other = PT("https://www.example-shop.de/hacked/login.php");
  const f = listFindings({ url, domain: "example-shop.de", pt: other });
  assert.deepEqual(f.map((x) => [x.key, x.stufe]), [["list-host", "gelb"]]);
  assert.notEqual(stufe(url, "example-shop.de", { pt: other }), "rot");
  // URLhaus host lookup only counts other URLs under the host
  assert.deepEqual(listFindings({ url, domain: "example-shop.de", uh: { ok: true, listed: true, count: 3 } }).map((x) => [x.key, x.stufe]), [["list-host", "gelb"]]);
  // urlscan: a malicious scan of another page of the domain
  const us = { ok: true, hits: [{ url: "https://www.example-shop.de/x", malicious: true }] };
  assert.deepEqual(listFindings({ url, domain: "example-shop.de", us }).map((x) => [x.key, x.stufe]), [["list-host", "gelb"]]);
  // on the well-known site itself that is only a hint; on a subdomain (platforms!) it stays amber
  const big = listFindings({ url: "https://www.google.com/search?q=x", domain: "google.com", us: { ok: true, hits: [{ url: "https://www.google.com/url?q=evil", malicious: true }] } });
  assert.deepEqual(big.map((x) => [x.key, x.stufe]), [["list-host", "info"]]);
  const sub = listFindings({ url: "https://abc123.pages.dev/", domain: "pages.dev", us: { ok: true, hits: [{ url: "https://abc123.pages.dev/login", malicious: true }] } });
  assert.deepEqual(sub.map((x) => [x.key, x.stufe]), [["list-host", "gelb"]]);
});

test("a real phishing domain stays red, a lookalike keeps its warning", () => {
  const url = "https://paypa1-sicherheit.com/login";
  assert.equal(stufe(url, "paypa1-sicherheit.com", { pt: PT(url) }), "rot");
  const local = verdict(heuristics("http://paypa1-sicherheit.com/konto/login").findings, { url: "http://paypa1-sicherheit.com/konto/login" });
  assert.notEqual(local.stufe, "gruen");
  // http on a subdomain of a hosting platform stays amber (the suffix list here has no private platforms)
  assert.ok(softenHttp(heuristics("http://xqvmt82n.pages.dev/").findings, "pages.dev", "xqvmt82n.pages.dev").some((f) => f.key === "http" && f.stufe === "gelb"));
  assert.ok(softenHttp(heuristics("http://www.paypal.de/").findings, "paypal.de", "www.paypal.de").every((f) => f.stufe !== "gelb"));
  // softenHttp leaves unknown domains alone
  assert.ok(softenHttp(heuristics("http://paypa1-sicherheit.com/").findings, "paypa1-sicherheit.com").some((f) => f.key === "http" && f.stufe === "gelb"));
});

test("not listed anywhere → db-clean; unconfirmed PhishTank entry ignored", () => {
  const url = "https://www.example.org/";
  assert.deepEqual(listFindings({ url, domain: "example.org", pt: { ok: true, listed: false }, sb: { ok: true, matches: [] } }).map((x) => x.key), ["db-clean"]);
  assert.deepEqual(listFindings({ url, domain: "example.org", pt: PT(url, { valid: false }) }).map((x) => x.key), ["db-clean"]);
});

// ── through the API ──────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
let phishtankAnswer = null;
const jres = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
beforeEach(() => {
  clearV1Cache();
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    if (url.includes("dns-query") || url.includes("/resolve?")) {
      const type = new URL(url).searchParams.get("type");
      return jres({ Answer: type === "A" ? [{ type: 1, data: "203.0.113.5" }] : [] });
    }
    if (url.includes("checkurl.phishtank.com")) {
      const asked = decodeURIComponent(String(init.body).match(/url=([^&]*)/)[1]);
      return jres({ results: phishtankAnswer ? phishtankAnswer(asked) : { url: asked, in_database: false } });
    }
    if (url.includes("urlscan.io/api/v1/search")) return jres({ results: [], total: 0 });
    return jres({}, 404);
  };
});
afterEach(() => { globalThis.fetch = realFetch; phishtankAnswer = null; });
const env = { SITE_NAME: "Linkwache", SITE_URL: "https://example.test", ASSET_VER: "t", ASSETS: { async fetch() { return new Response("", { status: 404 }); } } };
const post = (url) => worker.fetch(new Request("https://example.test/api/v1/check", {
  method: "POST", headers: { "content-type": "application/json", "x-linkwache-install": "0123456789abcdef0123456789abcdef", "cf-connecting-ip": "198.51.100.70" },
  body: JSON.stringify({ url, lang: "de" }) }), env, { waitUntil() {}, passThroughOnException() {} });

test("API: the stale PhishTank entry for the start page is no longer red; the answer carries the rules version", async () => {
  phishtankAnswer = (asked) => ({ url: asked, in_database: true, phish_id: 1, verified: true, valid: true });
  const j = await (await post("http://www.paypal.de/")).json();
  assert.notEqual(j.stufe, "rot");
  assert.equal(j.rules, RULES);
  assert.ok(j.findings.some((f) => f.key === "list-known" && f.stufe === "info" && f.titel.includes("PhishTank")));
  const h = await (await worker.fetch(new Request("https://example.test/api/health"), env, {})).json();
  assert.equal(h.rules, RULES);
});

test("API: a reported phishing URL stays red", async () => {
  phishtankAnswer = (asked) => ({ url: asked, in_database: asked.includes("/verify"), verified: true, valid: true });
  const j = await (await post("https://konto-pruefung.example-top.top/verify")).json();
  assert.equal(j.stufe, "rot");
  assert.ok(j.findings.some((f) => f.key === "phishtank" && f.stufe === "rot"));
});
