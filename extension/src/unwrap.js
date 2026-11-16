// Unwrap known link wrappers locally, so the real target is judged (docs/DESKTOP.md section 3).
// Shared vectors: test/vectors/redirectors.json. Repeats up to 3 levels; anything unknown is returned unchanged.

const SAFELINKS = /(^|\.)safelinks\.protection\.outlook\.com$/;
const GOOGLE = /^(www\.)?google\.[a-z.]{2,6}$/;
const RULES = [
  { host: (h) => SAFELINKS.test(h), param: "url" },
  { host: (h) => GOOGLE.test(h), path: /^\/url$/, param: ["q", "url"] },
  { host: (h) => h === "l.facebook.com", path: /^\/l\.php$/, param: "u" },
  { host: (h) => h === "l.instagram.com", param: "u" },
  { host: (h) => h === "www.youtube.com" || h === "youtube.com", path: /^\/redirect$/, param: "q" },
  { host: (h) => h === "slack-redir.net", param: "url" },
  { host: (h) => h === "www.linkedin.com" || h === "linkedin.com", path: /^\/safety\/go\/?$/, param: "url" },
];

function once(input) {
  let u;
  try { u = new URL(input); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  for (const r of RULES) {
    if (!r.host(host) || (r.path && !r.path.test(u.pathname))) continue;
    for (const name of [].concat(r.param)) {
      const v = u.searchParams.get(name);
      if (!v) continue;
      try {
        const t = new URL(v);
        if (t.protocol === "https:" || t.protocol === "http:") return t.href;
      } catch { /* not a URL */ }
    }
  }
  return null;
}

/** Real target of a wrapped link, or null when the input is not a (known) wrapper. */
export function unwrap(input, levels = 3) {
  let cur = input, out = null;
  for (let i = 0; i < levels; i++) {
    const next = once(cur);
    if (!next) break;
    out = cur = next;
  }
  return out;
}
