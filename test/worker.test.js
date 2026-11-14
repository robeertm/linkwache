// Worker logic without real network or credentials: global fetch is replaced by a router,
// storage and rate limit are in-memory, the mailbox and bot parts get hand-made fakes.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import worker from "../src/index.js";
import { fetchTimeout, extractUrls } from "../src/util.js";
import { unwrapShortener } from "../src/checks.js";
import { runCheck } from "../src/check.js";

// "cloudflare:email" only exists inside Cloudflare: stand in with a tiny class so email.js can be loaded.
register("data:text/javascript," + encodeURIComponent(
  "export async function resolve(s,c,n){if(s==='cloudflare:email')return{url:'data:text/javascript,export class EmailMessage{constructor(f,t,r){this.from=f;this.to=t;this.raw=r}}',shortCircuit:true};return n(s,c)}"));
const { handleEmail } = await import("../src/email.js");

const BOT_API = "https://api." + "telegram.org/";
const realFetch = globalThis.fetch;
let calls;
let router;
beforeEach(() => { calls = []; router = () => new Response("{}", { status: 404 }); globalThis.fetch = async (url, init = {}) => { url = String(url); calls.push({ url, init }); return router(url, init); }; });
afterEach(() => { globalThis.fetch = realFetch; });

const jres = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });
// A resolvable, harmless world: DNS answers, everything else empty.
const calmWorld = (url) => {
  if (url.includes("dns-query") || url.includes("/resolve?")) {
    const type = new URL(url).searchParams.get("type");
    return jres({ Answer: type === "A" ? [{ type: 1, data: "203.0.113.5" }] : [] });
  }
  if (url.includes("urlscan.io/api/v1/search")) return jres({ results: [], total: 0 });
  return jres({}, 404);
};

function makeEnv(extra = {}) {
  const kv = new Map();
  return {
    SITE_NAME: "Linkwache", SITE_URL: "https://example.test", ASSET_VER: "t",
    RESULTS: { async get(k) { return kv.get(k) ?? null; }, async put(k, v) { kv.set(k, v); } },
    ASSETS: { async fetch() { return new Response("nope", { status: 404 }); } },
    kv, ...extra,
  };
}
const ctxOf = () => { const tasks = []; return { tasks, waitUntil: (p) => tasks.push(p), passThroughOnException() {} }; };
const postCheck = (env, ctx, body, headers = {}) => worker.fetch(new Request("https://example.test/api/check", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.1", ...headers }, body: JSON.stringify(body) }), env, ctx);

// ── error cases of the network layer ─────────────────────────────────────────
test("timeout: a hanging request is aborted at the limit", async () => {
  router = (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
  const t0 = Date.now();
  await assert.rejects(fetchTimeout("https://slow.example/x", {}, 60), /abort/i);
  assert.ok(Date.now() - t0 < 1000);
});

test("redirect loop: a shortener that points at itself stops after 5 hops and never touches the target", async () => {
  router = () => new Response(null, { status: 302, headers: { location: "https://bit.ly/again" } });
  const r = await unwrapShortener("https://bit.ly/start");
  assert.equal(r.chain.length, 6);
  assert.equal(calls.length, 5);
  assert.ok(calls.every((c) => c.init.method === "HEAD" && c.init.redirect === "manual"));
});

test("redirect chain ends at a non-shortener: that target is not requested", async () => {
  router = (u) => u.startsWith("https://bit.ly/") ? new Response(null, { status: 301, headers: { location: "https://evil.example/login" } }) : jres({});
  const r = await unwrapShortener("https://bit.ly/x");
  assert.equal(r.finalUrl, "https://evil.example/login");
  assert.deepEqual(calls.map((c) => c.url), ["https://bit.ly/x"]);
});

test("invalid certificate: a failing TLS handshake of the shortener ends the chain quietly", async () => {
  router = () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "CERT_HAS_EXPIRED" } }); };
  const r = await unwrapShortener("https://bit.ly/x");
  assert.deepEqual(r.chain, ["https://bit.ly/x"]);
});

test("every single check may fail without killing the verdict (timeouts, TLS errors, 500s)", async () => {
  router = (url) => {
    if (url.includes("dns-query")) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "CERT_HAS_EXPIRED" } });
    if (url.includes("/resolve?")) return new Response("boom", { status: 500 });
    return new Response("boom", { status: 503 });
  };
  const r = await runCheck("https://star-voted.biz.id/home/votedb", {}, { withScan: false });
  assert.ok(r.verdict.stufe);
  assert.ok(r.findings.some((f) => f.key === "lure"), "heuristics still ran");
  assert.ok(r.facts.dns.error, "the DNS failure is recorded, not thrown");
});

// ── API endpoints ────────────────────────────────────────────────────────────
test("POST /api/check: result is stored and can be fetched by id (JSON and page)", async () => {
  router = calmWorld;
  const env = makeEnv(), ctx = ctxOf();
  const res = await postCheck(env, ctx, { url: "https://www.example.org/" });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.match(j.id, /^[a-z0-9]{6,12}$/);
  assert.ok(j.verdict.stufe && j.html.includes("verdict"));
  await Promise.all(ctx.tasks);
  const got = await worker.fetch(new Request("https://example.test/api/result/" + j.id), env, ctxOf());
  assert.equal(got.status, 200);
  assert.equal((await got.json()).id, j.id);
  const pageRes = await worker.fetch(new Request("https://example.test/r/" + j.id + "?lang=en"), env, ctxOf());
  assert.equal(pageRes.status, 200);
  assert.match(pageRes.headers.get("content-language"), /en/);
  assert.match(await pageRes.text(), /noindex/);
});

test("POST /api/check: bad input, wrong type, foreign origin, rate limit", async () => {
  router = calmWorld;
  const env = makeEnv();
  assert.equal((await postCheck(env, ctxOf(), { url: "kein link" })).status, 400);
  assert.equal((await postCheck(env, ctxOf(), {}, { "content-type": "text/plain" })).status, 415);
  assert.equal((await postCheck(env, ctxOf(), { url: "https://a.example" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await postCheck(env, ctxOf(), { url: "https://a.example" }, { "sec-fetch-site": "cross-site" })).status, 403);
  const denied = makeEnv({ CHECK_LIMIT: { limit: async () => ({ success: false }) } });
  const r = await postCheck(denied, ctxOf(), { url: "https://a.example" }, { "accept-language": "fr" });
  assert.equal(r.status, 429);
  assert.match((await r.json()).error, /\S/);
});

test("GET result: unknown or malformed ids are 404, never a crash", async () => {
  const env = makeEnv();
  for (const id of ["nope1234", "..%2F..%2Fetc", "x", "A".repeat(40)]) {
    const r = await worker.fetch(new Request("https://example.test/api/result/" + id), env, ctxOf());
    assert.equal(r.status, 404, id);
  }
  const p = await worker.fetch(new Request("https://example.test/r/unknownid"), env, ctxOf());
  assert.equal(p.status, 404);
});

test("pages, share target, health and 404 page", async () => {
  const env = makeEnv({ UPDATE_INFO: { latest: "9.9.9" } });
  for (const p of ["/", "/impressum.html", "/datenschutz.html", "/kurzbefehl.html"]) {
    const r = await worker.fetch(new Request("https://example.test" + p), env, ctxOf());
    assert.equal(r.status, 200, p);
  }
  const s = await worker.fetch(new Request("https://example.test/share?text=" + encodeURIComponent("schau https://x.example/a bitte")), env, ctxOf());
  assert.equal(s.status, 303);
  assert.equal(new URL(s.headers.get("location")).searchParams.get("u"), "https://x.example/a");
  const h = await (await worker.fetch(new Request("https://example.test/api/health"), env, ctxOf())).json();
  assert.equal(h.update, "9.9.9");
  const nf = await worker.fetch(new Request("https://example.test/gibt-es-nicht"), env, ctxOf());
  assert.equal(nf.status, 404);
});

test("extractUrls: de-duplicates and ignores plain words", () => {
  assert.deepEqual(extractUrls("a https://x.example/a b https://x.example/a"), ["https://x.example/a"]);
});

// ── chat bot: fake bot API, no token of any kind ─────────────────────────────
const hook = (env, body, secret = "s3cret", ctx = ctxOf()) => worker.fetch(new Request("https://example.test/telegram", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret }, body: typeof body === "string" ? body : JSON.stringify(body) }), env, ctx);
const botEnv = (extra = {}) => makeEnv({ TELEGRAM_TOKEN: "fake-token", TELEGRAM_SECRET: "s3cret", ...extra });
const sentTexts = () => calls.filter((c) => c.url.startsWith(BOT_API)).map((c) => JSON.parse(c.init.body));

test("bot: not configured = 404, wrong or missing secret = 403, junk body = 400", async () => {
  assert.equal((await hook(makeEnv(), {})).status, 404);
  assert.equal((await hook(botEnv(), {}, "wrong")).status, 403);
  assert.equal((await hook(botEnv({ TELEGRAM_SECRET: "" }), {}, "")).status, 403);
  assert.equal((await hook(botEnv(), "{")).status, 400);
});

test("bot: /start and link-less messages get an answer in the user's language", async () => {
  router = (u) => u.startsWith(BOT_API) ? jres({ ok: true }) : jres({}, 404);
  await hook(botEnv(), { message: { chat: { id: 42 }, from: { language_code: "tr" }, text: "/start" } });
  await hook(botEnv(), { message: { chat: { id: 42 }, from: { language_code: "xx" }, text: "hallo" } });
  const sent = sentTexts();
  assert.equal(sent.length, 2);
  assert.ok(sent.every((m) => m.chat_id === 42));
  assert.notEqual(sent[0].text, sent[1].text);
});

test("bot: a link is checked, the answer carries the result, the per-chat limit holds, the chat id is never a storage key", async () => {
  router = (u) => u.startsWith(BOT_API) ? jres({ ok: true }) : calmWorld(u);
  let n = 0;
  const env = botEnv({ CHECK_LIMIT: { limit: async ({ key }) => { assert.ok(key.startsWith("tg:") && !key.includes("42")); return { success: ++n <= 1 }; } } });
  const ctx = ctxOf();
  const upd = { message: { chat: { id: 42 }, from: { language_code: "en" }, text: "look https://www.example.org/x" } };
  const r = await hook(env, upd, "s3cret", ctx);
  assert.equal(r.status, 200);
  await Promise.all(ctx.tasks);
  assert.equal(sentTexts().length, 2, "wait notice + result");
  assert.ok([...env.kv.keys()].some((k) => k.startsWith("r:")));
  calls.length = 0;
  await hook(env, upd);
  assert.equal(sentTexts().length, 1, "over the limit: one notice, no check");
});

// ── Mailbox part with a hand-made message (no real mail, no addresses) ───────
function fakeMessage({ subject, text, html, headers = {} }) {
  const raw = ["From: sender@mail.test", "To: pruefen@example.test", `Subject: ${subject}`, "Message-ID: <abc@mail.test>", "MIME-Version: 1.0",
    html ? "Content-Type: text/html; charset=utf-8" : "Content-Type: text/plain; charset=utf-8", "", html || text].join("\r\n");
  const replies = [];
  return { replies, from: "sender@mail.test", to: "pruefen@example.test", headers: new Headers({ "message-id": "<abc@mail.test>", ...headers }), raw: new Response(raw).body, reply: async (m) => { replies.push(m); } };
}
const deps = { runCheck, resultText: (r) => "RESULT " + r.host.domain };

test("mailbox: link in plain text is checked, reply goes back to the sender with In-Reply-To", async () => {
  router = calmWorld;
  const env = makeEnv(); const msg = fakeMessage({ subject: "Please check", text: "Hi, is https://www.example.org/win safe? please and thanks" });
  await handleEmail(msg, env, ctxOf(), deps);
  assert.equal(msg.replies.length, 1);
  const raw = String(msg.replies[0].raw);
  assert.match(raw, /RESULT example\.org/);
  assert.match(raw, /In-Reply-To: <abc@mail\.test>/);
  assert.match(raw, new RegExp("Subject: =\\?utf-8\\?B\\?" + Buffer.from("Re: Please check").toString("base64")));
  assert.ok([...env.kv.keys()].some((k) => k.startsWith("r:")));
});

test("mailbox: links only inside HTML href are found, own-site links and everything past 5 links are skipped", async () => {
  router = calmWorld;
  const env = makeEnv();
  const links = Array.from({ length: 8 }, (_, i) => `<a href="https://site${i}.example.org/">x</a>`).join(" ");
  const msg = fakeMessage({ subject: "s", html: `<p>${links} <a href="https://example.test/own">own</a></p>` });
  const seen = [];
  await handleEmail(msg, env, ctxOf(), { runCheck: async (u, e, o) => { seen.push(u); return runCheck(u, e, o); }, resultText: deps.resultText });
  assert.equal(seen.length, 5);
  assert.ok(seen.every((u) => !u.includes("example.test")));
});

test("mailbox: no link = friendly answer, language from Content-Language", async () => {
  const msg = fakeMessage({ subject: "hello", text: "nothing to see", headers: { "content-language": "fr" } });
  await handleEmail(msg, makeEnv(), ctxOf(), deps);
  assert.equal(msg.replies.length, 1);
  assert.match(String(msg.replies[0].raw), /\S/);
});

test("mailbox: a failing check does not lose the reply", async () => {
  const msg = fakeMessage({ subject: "s", text: "https://www.example.org/ please look at this and you" });
  await handleEmail(msg, makeEnv(), ctxOf(), { runCheck: async () => { throw new Error("kaputt"); }, resultText: deps.resultText });
  assert.equal(msg.replies.length, 1);
});
