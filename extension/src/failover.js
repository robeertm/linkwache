// Reserve server (docs/FALLBACK.md): when the main server fails for real, the same check goes to the reserve server.
// Pure logic: the check itself, the clock, the storage of the down-state and the health probe are handed in, so Node tests
// cover every path. The down-state lives in storage (key primaryDown) because the MV3 service worker is restarted often.
import { validServer } from "./store.js";
import { normServer } from "./preset.js";

export const PRIMARY_MS = 4500;     // main server, believed up
export const RESERVE_MS = 6000;     // reserve, at most
export const TOTAL_MS = 8000;       // whole check, both servers
export const MIN_LEFT_MS = 1500;    // a second try with less than this left is pointless
export const DOWN_MS = 5 * 60 * 1000;
export const PROBE_EVERY_MS = 60 * 1000;
export const PROBE_MS = 3000;

/** Which reserve address applies: only while the effective server is the built-in preset and the reserve is a different, valid address. */
export function reserveFor(server, preset, fallback) {
  const main = normServer(server), res = normServer(fallback);
  if (!main || !preset || main !== normServer(preset)) return "";
  return res && res !== main && validServer(res) ? res : "";
}

/** GET <server>/api/health: true only for 200 with { ok: true }. */
export async function probeHealth(server, fetchFn, signal) {
  try {
    const r = await fetchFn(server.replace(/\/$/, "") + "/api/health", { method: "GET", signal, cache: "no-store" });
    if (r.status !== 200) return false;
    const j = await r.json();
    return !!j && j.ok === true;
  } catch { return false; }
}

/**
 * @param o.server    effective main server
 * @param o.reserve   reserve address ("" = none; see reserveFor)
 * @param o.check     async (server, { timeoutMs, noRetry, access }) => checkServer result
 * @param o.now       () => ms
 * @param o.state     { get: async () => { until, server, probeAt, reason, status } | null, set: async (obj | null) => void }
 * @param o.probe     async (server) => boolean   (health probe, 3 s)
 * @returns checkServer result; { ok: true, res, via: "reserve" } when the reserve answered
 */
export async function checkWithFailover(o) {
  if (!o.reserve) return o.check(o.server, {});
  const start = o.now();
  const left = () => TOTAL_MS - (o.now() - start);
  const st = await o.state.get();
  const down = !!st && st.server === o.server && st.until > start;

  const viaReserve = async (ms) => {
    const r = await o.check(o.reserve, { timeoutMs: ms, noRetry: true, access: false });
    return r.ok ? { ...r, via: "reserve" } : r;
  };

  if (down) {
    // Switch back: probe in the background, at most once a minute, never delays the check.
    if (!(st.probeAt > start - PROBE_EVERY_MS)) {
      o.state.set({ ...st, probeAt: start }).catch(() => {});
      Promise.resolve().then(() => o.probe(o.server)).then((ok) => { if (ok) return o.state.set(null); }).catch(() => {});
    }
    const r = await viaReserve(Math.min(RESERVE_MS, left()));
    if (r.ok) return r;
    // Reserve failed too: the main server gets what is left, if it is worth it.
    if (!r.fo) return { ...r, host: hostOfServer(o.server) };
    const l = left();
    if (l >= MIN_LEFT_MS) {
      const m = await o.check(o.server, { timeoutMs: l, noRetry: true });
      if (m.ok) { await o.state.set(null); return m; }
      return m;
    }
    return { ok: false, reason: st.reason || r.reason, host: hostOfServer(o.server), ...(st.status ? { status: st.status } : {}) };
  }

  const m = await o.check(o.server, { timeoutMs: PRIMARY_MS, noRetry: true });
  if (m.ok) { if (st) await o.state.set(null); return m; }
  if (!m.fo) return m;   // err.install (renewed inside check), 4xx JSON, 429, refused, noserver, access: no switch
  await o.state.set({ server: o.server, until: start + DOWN_MS, probeAt: 0, reason: m.reason, ...(m.status ? { status: m.status } : {}) });
  const l = Math.min(RESERVE_MS, left());
  if (l < MIN_LEFT_MS) return m;
  const r = await viaReserve(l);
  return r.ok ? r : m;   // both failed: the reason of the main server
}

function hostOfServer(s) { try { return new URL(s).host; } catch { return ""; } }
