// Reserve server (failover.js, docs/FALLBACK.md): when to switch, time budget, remembering the main server is down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkWithFailover, reserveFor, probeHealth, TOTAL_MS, DOWN_MS } from "../src/failover.js";
import { checkServer } from "../src/client.js";

const MAIN = "https://main.example", RES = "https://reserve.workers.example";
const ANSWER = { api: 1, stufe: "gruen", findings: [] };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const down = () => Object.assign(new TypeError("Load failed"), { name: "TypeError" });
const slow = () => Object.assign(new Error("timed out"), { name: "TimeoutError" });

/** Fake world: a clock, servers with scripted answers (each answer may cost time), storage of the down-state. */
function world(script) {
  const w = { t: 1_000_000, calls: [], stored: null, probes: [], renewed: 0 };
  w.now = () => w.t;
  w.state = { get: async () => w.stored, set: async (v) => { w.stored = v; } };
  const fetchFn = async (url, init) => {
    const host = new URL(url).origin, step = script[host];
    const s = typeof step === "function" ? step(w) : step;
    w.calls.push({ host, ms: init.timeoutMs });
    if (s && s.cost) w.t += s.cost;
    if (s && s.err) throw s.err;
    return s.res();
  };
  // checkServer with an injected signal that records the budget instead of arming a timer.
  w.check = (server, x) => checkServer({ server, body: { url: "https://a.example/", lang: "en", scope: "url" }, client: "extension/test",
    fetch: (u, i) => fetchFn(u, { ...i, timeoutMs: x.timeoutMs }), installId: async () => "a".repeat(32),
    renewId: async () => { w.renewed++; return "b".repeat(32); }, retryDelayMs: 0, signalFor: () => undefined,
    ...(x.timeoutMs ? { timeoutMs: x.timeoutMs } : {}), noRetry: !!x.noRetry });
  w.probe = async (s) => { w.probes.push(s); return w.probeOk !== false; };
  return w;
}
const ok = (cost = 100) => ({ cost, res: () => json(ANSWER) });
const err = (e, cost = 4500) => ({ cost, err: e });
const run = (w, extra = {}) => checkWithFailover({ server: MAIN, reserve: RES, check: w.check, now: w.now, state: w.state, probe: w.probe, ...extra });
const hosts = (w) => w.calls.map((c) => c.host.replace("https://", ""));

test("reserveFor: only for the built-in address, valid, different, https", () => {
  assert.equal(reserveFor(MAIN, MAIN, RES), RES);
  assert.equal(reserveFor(MAIN + "/", MAIN, RES + "/"), RES);
  assert.equal(reserveFor("https://own.example", MAIN, RES), "", "own address: no foreign reserve");
  assert.equal(reserveFor(MAIN, MAIN, ""), "");
  assert.equal(reserveFor(MAIN, MAIN, MAIN), "");
  assert.equal(reserveFor(MAIN, MAIN, "http://reserve.example"), "");
  assert.equal(reserveFor(MAIN, "", RES), "");
});

test("main up: one call, no reserve, nothing remembered", async () => {
  const w = world({ [MAIN]: ok(), [RES]: ok() });
  const r = await run(w);
  assert.deepEqual(r, { ok: true, res: ANSWER });
  assert.deepEqual(hosts(w), ["main.example"]);
  assert.equal(w.stored, null);
});

test("main down (network): the reserve answers with via reserve, main is remembered down for 5 minutes", async () => {
  const w = world({ [MAIN]: err(down(), 4500), [RES]: ok(300) });
  const r = await run(w);
  assert.deepEqual(r, { ok: true, res: ANSWER, via: "reserve" });
  assert.deepEqual(hosts(w), ["main.example", "reserve.workers.example"], "no blind repeat on main when a reserve exists");
  assert.equal(w.stored.until, 1_000_000 + DOWN_MS);
  assert.equal(w.stored.reason, "network");
});

test("failover-worthy: timeout, 5xx, non-JSON error page, non-v1 answer; never JSON 4xx, 403 JSON, 429, err.install", async () => {
  const yes = [err(slow()), { res: () => json({ error: "x" }, 503) }, { res: () => new Response("<html>bad gateway", { status: 502 }) },
    { res: () => new Response("<html>", { status: 403 }) }, { res: () => json({ api: 2 }) }, { res: () => new Response("nope") }];
  for (const m of yes) {
    const w = world({ [MAIN]: m, [RES]: ok() });
    const r = await run(w);
    assert.equal(r.via, "reserve");
  }
  const no = [[json({ error: "err.nolink" }, 400), "server"], [json({ error: "x" }, 413), "server"], [json({ error: "x" }, 415), "server"],
    [json({ error: "forbidden" }, 403), "refused"], [json({ error: "err.rate" }, 429), "rate"]];
  for (const [a, reason] of no) {
    const w = world({ [MAIN]: { res: () => a.clone() }, [RES]: ok() });
    const r = await run(w);
    assert.equal(r.ok, false); assert.equal(r.reason, reason);
    assert.deepEqual(hosts(w), ["main.example"], reason + " must not reach the reserve");
    assert.equal(w.stored, null, "and does not mark main as down");
  }
});

test("400 err.install: new id and one repeat on the same server, no reserve", async () => {
  let n = 0;
  const w = world({ [MAIN]: { res: () => (n++ === 0 ? json({ error: "err.install" }, 400) : json(ANSWER)) }, [RES]: ok() });
  const r = await run(w);
  assert.deepEqual(r, { ok: true, res: ANSWER });
  assert.equal(w.renewed, 1);
  assert.deepEqual(hosts(w), ["main.example", "main.example"]);
});

test("access (browser blocks the host) and noserver: no reserve", async () => {
  const w = world({ [MAIN]: err(down(), 10), [RES]: ok() });
  const r = await checkWithFailover({ server: MAIN, reserve: RES, now: w.now, state: w.state, probe: w.probe,
    check: (s, x) => checkServer({ server: s, body: {}, client: "x", fetch: async () => { w.calls.push({ host: s }); throw down(); }, installId: async () => "a".repeat(32),
      hasAccess: async () => false, signalFor: () => undefined, retryDelayMs: 0, noRetry: !!x.noRetry }) });
  assert.equal(r.reason, "access");
  assert.equal(w.calls.length, 1);
  const q = world({ [RES]: ok() });
  const n = await checkWithFailover({ server: "", reserve: RES, now: q.now, state: q.state, probe: q.probe, check: q.check });
  assert.equal(n.reason, "noserver"); assert.equal(q.calls.length, 0);
});

test("own address: no reserve even when the main server is down", async () => {
  const w = world({ [MAIN]: err(down(), 4500), [RES]: ok() });
  const r = await run(w, { reserve: reserveFor(MAIN, "https://preset.example", RES) });
  assert.equal(r.reason, "network");
  assert.deepEqual(hosts(w), ["main.example", "main.example"], "unchanged behaviour: one repeat on main, nothing else");
  assert.equal(w.stored, null);
});

test("both down: reason of the MAIN server, host = main, total time <= 8 s", async () => {
  const w = world({ [MAIN]: { cost: 4500, res: () => json({ error: "x" }, 502) }, [RES]: err(down(), 3500) });
  const t0 = w.t;
  const r = await run(w);
  assert.deepEqual(r, { ok: false, reason: "server", host: "main.example", status: 502, fo: true });
  assert.ok(w.t - t0 <= TOTAL_MS, "elapsed " + (w.t - t0));
  assert.equal(w.calls[1].ms, 3500, "reserve gets min(6 s, 8 s - elapsed)");
});

test("reserve timeout shrinks with elapsed time; skipped when less than 1.5 s remain", async () => {
  const w = world({ [MAIN]: err(slow(), 7000), [RES]: ok() });
  const r = await run(w);
  assert.equal(r.reason, "timeout");
  assert.deepEqual(hosts(w), ["main.example"], "1 s left: reserve skipped");
  assert.ok(w.stored, "main still remembered down");
});

test("main marked down: checks go straight to the reserve; main is not tried while the reserve works", async () => {
  const w = world({ [MAIN]: err(down(), 4500), [RES]: ok(200) });
  await run(w);
  w.calls.length = 0; w.t += 10_000;
  const r = await run(w);
  assert.equal(r.via, "reserve");
  assert.deepEqual(hosts(w), ["reserve.workers.example"]);
  assert.equal(w.calls[0].ms, 6000);
});

test("down + reserve fails too: main is tried with what is left (>= 1.5 s), main's answer wins", async () => {
  const w = world({ [MAIN]: ok(100), [RES]: err(down(), 4000) });
  w.stored = { server: MAIN, until: w.t + 60_000, probeAt: w.t, reason: "network" };
  const r = await run(w);
  assert.deepEqual(r, { ok: true, res: ANSWER });
  assert.deepEqual(hosts(w), ["reserve.workers.example", "main.example"]);
  assert.equal(w.calls[1].ms, 4000);
  assert.equal(w.stored, null, "a successful main answer clears the mark");
  // both fail with too little time left: the remembered main reason
  const v = world({ [MAIN]: ok(), [RES]: err(slow(), 6900) });
  v.stored = { server: MAIN, until: v.t + 60_000, probeAt: v.t, reason: "timeout" };
  const f = await run(v);
  assert.deepEqual(f, { ok: false, reason: "timeout", host: "main.example" });
  assert.deepEqual(hosts(v), ["reserve.workers.example"]);
});

test("switching back: health probe at most once a minute, ok clears the mark at once", async () => {
  const w = world({ [RES]: ok(100) });
  w.stored = { server: MAIN, until: w.t + DOWN_MS, probeAt: 0, reason: "network" };
  await run(w);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(w.probes, [MAIN]);
  assert.equal(w.stored, null, "probe ok: next check goes to main");
  // probe failing: mark stays, and no second probe within 60 s
  const v = world({ [RES]: ok(100) });
  v.probeOk = false;
  v.stored = { server: MAIN, until: v.t + DOWN_MS, probeAt: 0, reason: "network" };
  await run(v); await new Promise((r) => setTimeout(r, 5));
  assert.equal(v.probes.length, 1); assert.ok(v.stored);
  v.t += 30_000; await run(v); await new Promise((r) => setTimeout(r, 5));
  assert.equal(v.probes.length, 1, "not within 60 s");
  v.t += 31_000; await run(v); await new Promise((r) => setTimeout(r, 5));
  assert.equal(v.probes.length, 2, "again after a minute");
});

test("switching back after 5 minutes: main is tried first again", async () => {
  const w = world({ [MAIN]: ok(100), [RES]: ok() });
  w.stored = { server: MAIN, until: w.t + DOWN_MS, probeAt: w.t, reason: "network" };
  w.t += DOWN_MS + 1;
  const r = await run(w);
  assert.deepEqual(r, { ok: true, res: ANSWER });
  assert.deepEqual(hosts(w), ["main.example"]);
  assert.equal(w.stored, null);
});

test("a down-mark for another server address is ignored", async () => {
  const w = world({ [MAIN]: ok(100), [RES]: ok() });
  w.stored = { server: "https://old.example", until: w.t + DOWN_MS, probeAt: 0 };
  const r = await run(w);
  assert.equal(r.via, undefined);
  assert.deepEqual(hosts(w), ["main.example"]);
});

test("without a reserve: exactly the old behaviour (check is called once with no limits)", async () => {
  const w = world({ [MAIN]: ok() });
  const seen = [];
  const r = await checkWithFailover({ server: MAIN, reserve: "", now: w.now, state: w.state, probe: w.probe, check: (s, x) => { seen.push(x); return w.check(s, x); } });
  assert.equal(r.ok, true); assert.deepEqual(seen, [{}]);
});

test("probeHealth: only 200 with ok: true counts", async () => {
  const f = (r) => async () => r;
  assert.equal(await probeHealth(MAIN, f(json({ ok: true }))), true);
  assert.equal(await probeHealth(MAIN, f(json({ ok: false }))), false);
  assert.equal(await probeHealth(MAIN, f(json({ ok: true }, 503))), false);
  assert.equal(await probeHealth(MAIN, f(new Response("<html>"))), false);
  assert.equal(await probeHealth(MAIN, async () => { throw down(); }), false);
});
