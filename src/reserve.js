// Reserve server (docs/FALLBACK.md): the same check code as the main server, deployed as a Cloudflare Worker that
// serves only the app API. The apps switch to it when the main server is unreachable.
//   POST    /api/v1/check   the check (src/api_v1.js, unchanged)
//   OPTIONS /api/v1/check   CORS preflight for extension pages
//   GET     /api/health     { ok, role: "reserve", version, api, rules }
//   GET     /               a short page for people who open the address by hand
// Everything else is 404. No website, no Telegram, no result pages, no KV, nothing stored, no sandbox scans.
import { apiV1Check, v1Preflight, withV1Cors } from "./api_v1.js";
import { pickLang } from "./i18n.js";
import { VERSION } from "./version.js";
import { RULES } from "./lists.js";

const SECURITY = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "cache-control": "no-store",
};

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", ...SECURITY } });

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Linkwache reserve server</title></head>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;color:#222">
<h1 style="font-size:1.4rem">Linkwache reserve server</h1>
<p>This address only answers the Linkwache apps while the main server cannot be reached. It has no website of its own.</p>
<p>Diese Adresse beantwortet nur die Linkwache-Apps, solange der Hauptserver nicht erreichbar ist. Sie hat keine eigene Webseite.</p>
</body></html>`;

/** Wraps the worker environment: the app API must never store anything here and never submit a sandbox scan. */
export function reserveEnv(env) {
  return { ...env, URLSCAN_KEY: "", RESULTS: undefined, ASSETS: undefined, METRICS: undefined, SCAN_BUDGET: { take: () => false } };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === "/api/v1/check" && req.method === "POST") {
        const lang = pickLang(req, url.searchParams.get("lang"));
        return withV1Cors(req, await apiV1Check(req, reserveEnv(env), ctx, lang));
      }
      if (p === "/api/v1/check" && req.method === "OPTIONS") return v1Preflight(req);
      if (p === "/api/health" && (req.method === "GET" || req.method === "HEAD")) {
        return json({ ok: true, role: "reserve", version: VERSION, api: [1], rules: RULES, sb: !!env.SAFE_BROWSING_KEY });
      }
      if ((p === "/" || p === "/index.html") && (req.method === "GET" || req.method === "HEAD")) {
        return new Response(PAGE, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", ...SECURITY } });
      }
    } catch (e) {
      console.error("reserve error", p, String(e).slice(0, 300));
      return json({ error: "internal" }, 500);
    }
    return json({ error: "not found" }, 404);
  },
};
