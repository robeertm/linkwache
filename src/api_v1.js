// Client API v1 (desktop app, browser extension, Android): POST /api/v1/check, see docs/API.md.
// Differences from the website check: lite pipeline (no sandbox scan), nothing is stored, per-installation
// and per-IP limits, a short in-memory cache, and a stricter origin policy.
import { runCheck } from "./check.js";
import { normalizeInput, sha256hex } from "./util.js";
import { pickLang, t, findingText, verdictText } from "./i18n.js";
import { VERSION } from "./version.js";

const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const MAX_BODY = 8192;
const TTL = { gruen: 21600, gelb: 86400, rot: 86400 };
const cache = new Map(); // normalised url -> { at, r } (a result object of runCheck; never persisted)

export const clearV1Cache = () => cache.clear();

const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

const EXT_ORIGIN = /^(chrome-extension|moz-extension|safari-web-extension):\/\//;

/** Origin policy: no Origin = desktop/native client; extension origins are fine; a web page of another site is refused. */
export function v1Allowed(req) {
  const origin = req.headers.get("origin");
  if (origin && EXT_ORIGIN.test(origin)) return true;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "none" && site !== "same-origin") return false;
  if (!origin) return true;
  try { return new URL(origin).host === new URL(req.url).host; } catch { return false; }
}

async function over(limiter, key) {
  if (!limiter) return null;
  const r = await limiter.limit({ key });
  return r.success ? null : Math.max(1, Math.round(r.retryAfter || 60));
}

/** Reduce what is checked to what the client may send: fragment never, query only if the client sent it, domain scope = https://host/. */
export function reduceUrl(input, scope) {
  const norm = normalizeInput(input);
  if (!norm) return null;
  let u;
  try { u = new URL(norm); } catch { return null; }
  if (scope === "domain") return `https://${u.host}/`;
  u.hash = "";
  u.username = ""; u.password = "";
  return u.href;
}

export async function apiV1Check(req, env, ctx, lang) {
  if (!v1Allowed(req)) return json({ error: "forbidden" }, 403);
  if (!String(req.headers.get("content-type") || "").startsWith("application/json")) return json({ error: "unsupported media type" }, 415);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "too large" }, 413);
  let body = {};
  try { body = JSON.parse(raw); } catch { /* handled as empty input */ }
  if (!body || typeof body !== "object") body = {};
  lang = typeof body.lang === "string" && pickLang(null, body.lang) === body.lang ? body.lang : lang;
  const install = String(req.headers.get("x-linkwache-install") || "");
  if (!/^[0-9a-f]{32}$/.test(install)) return json({ error: "err.install", message: t(lang, "err.install") }, 400);

  const day = new Date().toISOString().slice(0, 10);
  const ip = req.headers.get("cf-connecting-ip") || "0";
  const wait = (await over(env.V1_IP_LIMIT, "v1p:" + (await sha256hex(ip + "|" + day)).slice(0, 32)))
    || (await over(env.V1_LIMIT, "v1i:" + (await sha256hex(install + "|" + day)).slice(0, 32)));
  if (wait) return json({ error: "err.rate", message: t(lang, "err.rate"), retryAfter: wait }, 429, { "retry-after": String(wait) });

  const url = reduceUrl(String(body.url || "").slice(0, 4000), body.scope === "domain" ? "domain" : "url");
  if (!url) return json({ error: "err.nolink", message: t(lang, "err.nolink") }, 400);

  const now = Date.now();
  let hit = cache.get(url);
  if (hit && now - hit.at > CACHE_MS) { cache.delete(url); hit = null; }
  let r = hit?.r;
  if (!r) {
    r = await runCheck(url, env, { lite: true });
    if (r.error) return json({ error: r.error, message: t(lang, r.error) }, 400);
    cache.set(url, { at: now, r });
    if (cache.size > CACHE_MAX) for (const k of cache.keys()) { cache.delete(k); if (cache.size <= CACHE_MAX * 0.9) break; }
  }
  return json(shape(r, lang));
}

function shape(r, lang) {
  const v = r.verdict;
  const vt = verdictText(lang, v);
  return {
    api: 1,
    stufe: v.stufe,
    score: v.score,
    kurzKey: v.kurzKey, ratKey: v.ratKey,
    kurz: vt.kurz, rat: vt.rat,
    url: r.url,
    host: { host: r.host.host, domain: r.host.domain, unicodeHost: r.host.unicodeHost },
    chain: (r.chain || []).map((c) => { try { return new URL(c).host; } catch { return ""; } }).filter(Boolean),
    findings: (r.findings || []).map((f) => ({ key: f.key, stufe: f.stufe, p: f.p || {}, ...findingText(lang, f) })),
    cacheTtl: TTL[v.stufe] || 86400,
    checked: r.checked,
    server: VERSION,
  };
}
