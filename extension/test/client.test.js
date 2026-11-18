// Server check of the extension (client.js): every way a check can fail is named honestly, the install id heals itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkServer, REASONS } from "../src/client.js";
import { effectiveServer } from "../src/store.js";

const SERVER = "https://lw.example";
const ANSWER = { api: 1, stufe: "gruen", findings: [], server: "0.7.1" };
const res = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const netError = () => Object.assign(new TypeError("Load failed"), { name: "TypeError" });
const timeoutError = () => Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });

/** fetch that plays the answers in order and records every request. */
function player(...steps) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, install: init.headers["x-linkwache-install"] });
    const s = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (s instanceof Error) throw s;
    return typeof s === "function" ? s() : s;
  };
  return { f, calls };
}
function ids() {
  let id = "a".repeat(32), renewed = 0;
  return { installId: async () => id, renewId: async () => { renewed++; id = "b".repeat(32); return id; }, get renewed() { return renewed; } };
}
const run = (fetch, extra = {}) => {
  const i = extra.ids || ids();
  return checkServer({ server: SERVER, body: { url: "https://a.example/x", lang: "de", scope: "url" }, client: "extension/0.7.1",
    fetch, installId: i.installId, renewId: i.renewId, retryDelayMs: 0, signalFor: () => undefined, ...extra });
};

test("success: one POST to /api/v1/check with install id and client headers", async () => {
  const p = player(res(ANSWER));
  const r = await run(p.f);
  assert.deepEqual(r, { ok: true, res: ANSWER });
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].url, SERVER + "/api/v1/check");
  assert.equal(p.calls[0].init.method, "POST");
  assert.equal(p.calls[0].init.headers["x-linkwache-client"], "extension/0.7.1");
  assert.match(p.calls[0].install, /^[0-9a-f]{32}$/);
  assert.deepEqual(JSON.parse(p.calls[0].init.body), { url: "https://a.example/x", lang: "de", scope: "url" });
});

test("noserver: empty or invalid address, nothing is sent", async () => {
  for (const server of ["", "ftp://lw.example", "http://lw.example", "https://lw.example/?x=1", "kein server"]) {
    const p = player(res(ANSWER));
    const r = await run(p.f, { server });
    assert.equal(r.ok, false); assert.equal(r.reason, "noserver", server);
    assert.equal(p.calls.length, 0, server);
  }
});

test("err.install: a new id is made and the check repeated once (self-healing)", async () => {
  const i = ids();
  const p = player(res({ error: "err.install" }, 400), res(ANSWER));
  const r = await run(p.f, { ids: i });
  assert.equal(r.ok, true);
  assert.equal(i.renewed, 1);
  assert.equal(p.calls.length, 2);
  assert.notEqual(p.calls[0].install, p.calls[1].install, "the repeat carries the new id");
});

test("err.install twice: reason install (not 'no connection'), only one renewal", async () => {
  const i = ids();
  const p = player(() => res({ error: "err.install" }, 400));
  const r = await run(p.f, { ids: i });
  assert.deepEqual(r, { ok: false, reason: "install", host: "lw.example", status: 400 });
  assert.equal(i.renewed, 1);
  assert.equal(p.calls.length, 2);
});

test("network failure: repeated once, then reason network with the server host", async () => {
  const p = player(netError());
  const r = await run(p.f, { hasAccess: async () => true });
  assert.deepEqual(r, { ok: false, reason: "network", host: "lw.example", fo: true });
  assert.equal(p.calls.length, 2);
  const q = player(netError(), res(ANSWER));
  assert.equal((await run(q.f)).ok, true, "a passing hiccup heals with the repeat");
});

test("network failure without host access (Safari site access not granted): reason access, no blind repeat", async () => {
  const asked = [];
  const p = player(netError());
  const r = await run(p.f, { hasAccess: async (o) => { asked.push(o); return false; } });
  assert.deepEqual(r, { ok: false, reason: "access", host: "lw.example" });
  assert.deepEqual(asked, [SERVER]);
  assert.equal(p.calls.length, 1);
});

test("a permission lookup that cannot tell (null or throws) does not hide the network reason", async () => {
  for (const hasAccess of [async () => null, async () => { throw new Error("no permissions API"); }, undefined]) {
    const r = await run(player(netError()).f, { hasAccess });
    assert.equal(r.reason, "network");
  }
});

test("timeout: reason timeout (TimeoutError and AbortError), no repeat", async () => {
  for (const e of [timeoutError(), Object.assign(new Error("aborted"), { name: "AbortError" })]) {
    const p = player(e);
    const r = await run(p.f);
    assert.equal(r.reason, "timeout", e.name); assert.equal(r.fo, true);
    assert.equal(p.calls.length, 1);
  }
});

test("timeout: the request really carries an abort signal (6 s default)", async () => {
  let got;
  await checkServer({ server: SERVER, body: {}, client: "x", fetch: async (u, i) => { got = i.signal; return res(ANSWER); }, installId: async () => "a".repeat(32) });
  assert.ok(got && typeof got.aborted === "boolean");
});

test("status answers: 403 refused, 429 rate, 5xx server, other 400 server, broken answer server", async () => {
  const cases = [
    [res({ error: "forbidden" }, 403), "refused", 403, false], [res({ error: "err.rate" }, 429), "rate", 429, false],
    [res({ error: "x" }, 500), "server", 500, true], [res({ error: "err.nolink" }, 400), "server", 400, false],
    [new Response("<html>", { status: 502 }), "server", 502, true], [res({ api: 2 }), "server", 200, true], [new Response("not json"), "server", 200, true],
    [new Response("<html>", { status: 403 }), "server", 403, true], [new Response("<html>", { status: 400 }), "server", 400, true],
    [res({ error: "x" }, 413), "server", 413, false],
  ];
  for (const [answer, reason, status, fo] of cases) {
    const r = await run(player(answer).f);
    assert.deepEqual(r, { ok: false, reason, host: "lw.example", status, ...(fo ? { fo: true } : {}) }, reason + " " + status);
  }
});

test("every reason has a text in all languages on the warning page", async () => {
  const { EXTENSION } = await import("../../src/i18n_extension.js");
  for (const l of Object.keys(EXTENSION)) for (const r of REASONS) assert.ok(EXTENSION[l]["ext.w.why." + r], l + " " + r);
});

test("effectiveServer: an empty field checks against the built-in address, a typed one wins", () => {
  assert.equal(effectiveServer({ server: "" }, "https://preset.example"), "https://preset.example");
  assert.equal(effectiveServer({ server: "  " }, "https://preset.example"), "https://preset.example");
  assert.equal(effectiveServer({}, "https://preset.example"), "https://preset.example");
  assert.equal(effectiveServer({ server: "https://mine.example" }, "https://preset.example"), "https://mine.example");
  assert.equal(effectiveServer({ server: "" }, ""), "");
});
