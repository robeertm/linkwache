// Update notice for the operator: asks GitHub once a day whether a newer release exists.
// The result only shows up in /api/health ("update") and in the log, never on the public pages.
// Switch off with UPDATE_CHECK=off. Nothing is installed automatically; roll out with scripts/ausrollen.sh.
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isNewer(latest, current) {
  const a = parseVersion(latest), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export async function fetchLatest(repo, fetchFn = fetch) {
  const r = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "linkwache-update-check" },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  return parseVersion(j.tag_name) ? String(j.tag_name).replace(/^v/, "") : null;
}

// info.latest is set only while a newer release exists.
export function startUpdateCheck(info, { current, repo, enabled = true, fetchFn = fetch, log = console.log, every = 86400000 } = {}) {
  if (!enabled || !repo) return null;
  const run = async () => {
    try {
      const latest = await fetchLatest(repo, fetchFn);
      const was = info.latest;
      info.latest = latest && isNewer(latest, current) ? latest : undefined;
      if (info.latest && info.latest !== was) log(`Update available: ${current} -> ${info.latest} (run scripts/ausrollen.sh)`);
    } catch { /* offline or rate-limited: try again tomorrow */ }
  };
  run();
  const timer = setInterval(run, every);
  timer.unref?.();
  return timer;
}
