// Talks to the Linkwache server (POST /api/v1/check, docs/API.md) and says honestly why a check did not finish.
// No browser API in here: fetch, the install id and the permission lookup are handed in, so Node tests cover every path.
//
// Failure reasons (shown on the warning page, texts ext.w.why.*):
//   noserver  no valid server address           access   the browser does not let the extension reach the server
//   network   no connection / no answer at all  timeout  no answer within the time limit
//   install   server refused the installation id (a new id is made and the check repeated once before this shows)
//   refused   server refused the request (origin policy, 403)
//   rate      too many checks (429)              server   any other error status or an answer that is not a v1 answer
import { validServer } from "./store.js";
import { timeoutSignal } from "./platform.js";

export const REASONS = ["noserver", "access", "network", "timeout", "install", "refused", "rate", "server"];
export const TIMEOUT_MS = 6000;

const isTimeout = (e) => !!e && (e.name === "TimeoutError" || e.name === "AbortError");
const hostOf = (s) => { try { return new URL(s).host; } catch { return ""; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A v1 answer the extension can use. */
export const validAnswer = (j) => !!j && j.api === 1 && ["gruen", "gelb", "rot"].includes(j.stufe);

/**
 * One check against the server.
 * @param o.server     server address (validated here)
 * @param o.body       { url, lang, scope } as sent
 * @param o.client     x-linkwache-client header ("extension/0.7.1")
 * @param o.fetch      fetch implementation
 * @param o.installId  async () => current id (creates one when missing)
 * @param o.renewId    async () => a fresh id, stored (after the server refused the old one)
 * @param o.hasAccess  async (origin) => true | false | null (null = cannot tell); asked only after a network failure
 * @param o.noRetry    do not repeat once after a network failure (the reserve server is the second try instead)
 * @returns { ok: true, res } or { ok: false, reason, status?, host, fo? }  (fo: true = worth a try on the reserve server, docs/FALLBACK.md)
 */
export async function checkServer(o) {
  const host = hostOf(o.server);
  if (!validServer(o.server)) return { ok: false, reason: "noserver", host };
  const endpoint = o.server.replace(/\/$/, "") + "/api/v1/check";
  const ms = o.timeoutMs || TIMEOUT_MS;
  const signalFor = o.signalFor || ((n) => timeoutSignal(n));
  const fail = (reason, status, fo) => ({ ok: false, reason, host, ...(status ? { status } : {}), ...(fo ? { fo: true } : {}) });
  let renewed = false, retriedNet = false;
  for (;;) {
    let r;
    try {
      r = await o.fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-linkwache-install": await o.installId(), "x-linkwache-client": o.client },
        body: JSON.stringify(o.body), signal: signalFor(ms),
      });
    } catch (e) {
      if (isTimeout(e)) return fail("timeout", 0, true);
      // A blocked request and a dead network look the same to fetch (TypeError). Only the permission lookup tells them apart.
      if (o.hasAccess) { let a = null; try { a = await o.hasAccess(new URL(o.server).origin); } catch { a = null; } if (a === false) return fail("access"); }
      if (!retriedNet && !o.noRetry) { retriedNet = true; await wait(o.retryDelayMs ?? 400); continue; }
      return fail("network", 0, true);
    }
    let j = null;
    try { j = await r.json(); } catch { j = null; }
    if (r.status === 400 && j && j.error === "err.install") {
      if (!renewed && o.renewId) { renewed = true; await o.renewId(); continue; }
      return fail("install", 400);
    }
    // Failover-worthy (docs/FALLBACK.md): status >= 500, an error page that is not JSON, a 2xx that is not a v1 answer.
    // A JSON answer with 4xx is the server's own word and the reserve would say the same.
    if (r.status === 403 && j) return fail("refused", 403);
    if (r.status === 429) return fail("rate", 429);
    if (!r.ok) return fail("server", r.status, r.status >= 500 || !j);
    return validAnswer(j) ? { ok: true, res: j } : fail("server", r.status, true);
  }
}
