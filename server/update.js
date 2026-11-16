// Update notice for the operator: asks GitHub once a day whether a newer release exists.
// The result only shows up in /api/health ("update") and in the log, never on the public pages.
// Switch off with UPDATE_CHECK=off. Nothing is installed automatically; the operator page (/admin, needs ADMIN_TOKEN) can file an update request that
// scripts/aktualisieren.sh --if-requested picks up on the host.
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

/** Reduce a GitHub release JSON to what the download page needs: tag, date and the assets (name, size, url, sha256). */
export function parseRelease(j) {
  if (!j || !parseVersion(j.tag_name)) return null;
  const assets = (Array.isArray(j.assets) ? j.assets : [])
    .filter((a) => a && typeof a.name === "string" && /^https:\/\//.test(String(a.browser_download_url || "")))
    .map((a) => {
      const m = /^sha256:([0-9a-f]{64})$/i.exec(String(a.digest || ""));
      return { name: a.name, size: Number(a.size) || 0, url: a.browser_download_url, sha256: m ? m[1].toLowerCase() : "" };
    });
  return {
    tag: String(j.tag_name),
    version: String(j.tag_name).replace(/^v/, ""),
    date: String(j.published_at || j.created_at || "").slice(0, 10),
    assets,
  };
}

/** Lines of a SHA256SUMS.txt ("<hex>  <name>" or "<hex> *<name>") -> { name: hex }. */
export function parseSums(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m) out[m[2]] = m[1].toLowerCase();
  }
  return out;
}

async function getJson(repo, fetchFn) {
  const r = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "linkwache-update-check" },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

/** Latest release incl. assets; missing digests are filled from the SHA256SUMS.txt asset when there is one. */
export async function fetchRelease(repo, fetchFn = fetch) {
  const j = await getJson(repo, fetchFn);
  const rel = parseRelease(j);
  if (!rel) return null;
  const sums = rel.assets.find((a) => a.name === "SHA256SUMS.txt");
  if (sums && rel.assets.some((a) => !a.sha256)) {
    try {
      const r = await fetchFn(sums.url, { headers: { "user-agent": "linkwache-update-check" }, signal: AbortSignal.timeout(10000) });
      if (r.ok) { const map = parseSums(await r.text()); for (const a of rel.assets) if (!a.sha256 && map[a.name]) a.sha256 = map[a.name]; }
    } catch { /* digest stays empty, the page then shows no checksum */ }
  }
  return rel;
}

export async function fetchLatest(repo, fetchFn = fetch) {
  const j = await getJson(repo, fetchFn);
  return parseVersion(j.tag_name) ? String(j.tag_name).replace(/^v/, "") : null;
}

// info.latest is set only while a newer release exists; info.release always holds the latest published release (download page).
export function startUpdateCheck(info, { current, repo, enabled = true, fetchFn = fetch, log = console.log, every = 3 * 3600000 } = {}) { // every 3 h: assets attached after a release (APK, notarised macOS files) show up soon
  if (!enabled || !repo) return null;
  const run = async () => {
    try {
      const rel = await fetchRelease(repo, fetchFn);
      const latest = rel ? rel.version : null;
      info.release = rel || undefined;   // read by the download page; never hard-coded there
      const was = info.latest;
      info.checkedAt = new Date().toISOString();
      info.latest = latest && isNewer(latest, current) ? latest : undefined;
      if (info.latest && info.latest !== was) log(`Update available: ${current} -> ${info.latest} (run scripts/aktualisieren.sh)`);
    } catch { /* offline or rate-limited: try again tomorrow */ }
  };
  run();
  const timer = setInterval(run, every);
  timer.unref?.();
  return timer;
}
