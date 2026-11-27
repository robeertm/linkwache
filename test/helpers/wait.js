// Waiting for a spawned server: a deadline instead of a fixed number of polls, so a loaded machine
// (CI runner, release gate next to other jobs) only makes the test slower, never red.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls `probe` (async, returns a truthy value when ready; a throw counts as "not yet") until it does or `timeoutMs` has passed. */
export async function waitFor(probe, { timeoutMs = 30000, stepMs = 25, what = "condition" } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try { const v = await probe(); if (v) return v; } catch { /* not up yet */ }
    if (Date.now() >= end) throw new Error(`${what} not reached within ${timeoutMs} ms`);
    await sleep(stepMs);
  }
}

/** Resolves once GET <base>/api/health answers 200. */
export const waitForHealth = (base) => waitFor(async () => (await fetch(base + "/api/health")).ok, { what: "server " + base });
