// Linkwache — Cloudflare Worker. Eine Datei entscheidet, was wohin geht:
//   POST /api/check          Link prüfen → JSON (die Startseite ruft das auf)
//   GET  /api/result/:id     Ergebnis (zieht das Sandbox-Bild nach)
//   GET  /r/:id              teilbare Ergebnisseite
//   GET  /share?url=…        Android „Teilen“-Ziel → Startseite mit Link
//   POST /telegram           Bot-Webhook
//   email()                  Mail-Eingang (Cloudflare Email Routing)
// Alles andere sind statische Dateien aus public/.
import { runCheck, refreshScan } from "./check.js";
import { page, homePage, resultCard, resultText, paypalLink, legalPage, privacyPage, shortcutPage, notFoundPage } from "./render.js";
import { handleTelegram } from "./telegram.js";
import { extractUrls, sha256hex, esc } from "./util.js";
import { pickLang, t, verdictText } from "./i18n.js";

const TTL = 90 * 86400;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    const lang = pickLang(req, url.searchParams.get("lang"));
    try {
      if (p === "/" || p === "/index.html") return html(homePage(lang, env), 200, lang);
      if (p === "/api/check" && req.method === "POST") return apiCheck(req, env, ctx, lang);
      if (p.startsWith("/api/result/")) return apiResult(p.slice("/api/result/".length), env, ctx, lang);
      if (p.startsWith("/r/")) return resultPage(p.slice(3), env, ctx, lang);
      if (p === "/impressum.html") return html(legalPage(lang, env), 200, lang);
      if (p === "/datenschutz.html") return html(privacyPage(lang, env), 200, lang);
      if (p === "/kurzbefehl.html") return html(shortcutPage(lang, env), 200, lang);
      if (p === "/share") return share(url);
      if (p === "/telegram" && req.method === "POST") return handleTelegram(req, env, ctx, { runCheck, resultText });
      if (p === "/api/health") return json({ ok: true, name: env.SITE_NAME, paypal: paypalLink(env), scan: !!env.URLSCAN_KEY, sb: !!env.SAFE_BROWSING_KEY, telegram: !!env.TELEGRAM_TOKEN });
    } catch (e) {
      return json({ error: "Interner Fehler: " + String(e).slice(0, 200) }, 500);
    }
    return staticPage(req, env);
  },

  async email(message, env, ctx) {
    const { handleEmail } = await import("./email.js");
    return handleEmail(message, env, ctx, { runCheck, resultText });
  },
};

async function limited(req, env) {
  if (!env.CHECK_LIMIT) return false;
  const ip = req.headers.get("cf-connecting-ip") || "0";
  const day = new Date().toISOString().slice(0, 10);
  const key = (await sha256hex(ip + "|" + day)).slice(0, 32); // nie die IP selbst
  const { success } = await env.CHECK_LIMIT.limit({ key });
  return !success;
}

async function apiCheck(req, env, ctx, lang) {
  if (await limited(req, env)) return json({ error: t(lang, "err.rate") }, 429);
  let body = {};
  try { body = await req.json(); } catch { /* leer */ }
  lang = pickLang(req, body.lang) === body.lang ? body.lang : lang;
  const input = String(body.url || body.text || "").slice(0, 4000);
  const r = await runCheck(input, env);
  if (r.error) return json({ error: t(lang, r.error) }, 400);
  ctx.waitUntil(env.RESULTS.put("r:" + r.id, JSON.stringify(r), { expirationTtl: TTL }));
  return json(strip(r, env, lang));
}

async function load(id, env) {
  if (!/^[a-z0-9]{6,12}$/.test(id)) return null;
  const raw = await env.RESULTS.get("r:" + id);
  return raw ? JSON.parse(raw) : null;
}

async function apiResult(id, env, ctx, lang) {
  const r = await load(id, env);
  if (!r) return json({ error: t(lang, "err.notfound") }, 404);
  const before = r.scan?.status;
  await refreshScan(r, env);
  if (r.scan?.status !== before) ctx.waitUntil(env.RESULTS.put("r:" + r.id, JSON.stringify(r), { expirationTtl: TTL }));
  return json(strip(r, env, lang));
}

async function resultPage(id, env, ctx, lang) {
  const r = await load(id, env);
  if (!r) return html(page({ lang, title: t(lang, "r.nf.h"), env, noindex: true, path: "/r/" + id, body: `<h1>${esc(t(lang, "r.nf.h"))}</h1><p>${esc(t(lang, "r.nf.p"))} <a href="/?lang=${lang}">${esc(t(lang, "r.nf.new"))}</a></p>` }), 404, lang);
  const before = r.scan?.status;
  await refreshScan(r, env);
  if (r.scan?.status !== before) ctx.waitUntil(env.RESULTS.put("r:" + r.id, JSON.stringify(r), { expirationTtl: TTL }));
  const v = verdictText(lang, r.verdict);
  const title = `${v.kurz} — ${r.host.domain}`;
  const og = r.scan?.screenshot ? `<meta property="og:image" content="${esc(r.scan.screenshot)}">` : "";
  return html(page({ lang, title, env, noindex: true, extraHead: og, path: "/r/" + r.id, body: `<div class="result">${resultCard(r, env, lang)}</div><p class="again"><a class="btn" href="/?lang=${lang}">${esc(t(lang, "r.again"))}</a></p>` }), 200, lang);
}

function share(url) {
  // Web-Share-Target (Android): text/url/title kommen als Query. Wir suchen den ersten Link.
  const cand = [url.searchParams.get("url"), url.searchParams.get("text"), url.searchParams.get("title")].filter(Boolean).join(" ");
  const found = extractUrls(cand);
  const q = found.length ? found[0] : cand.trim();
  const lang = url.searchParams.get("lang");
  return Response.redirect(new URL("/?u=" + encodeURIComponent(q) + (lang ? "&lang=" + encodeURIComponent(lang) : ""), url).href, 303);
}

/** Interna raus, bevor ein Ergebnis das Haus verlässt — und die fertige Karte gleich mit,
 *  damit Startseite und Ergebnisseite dieselbe Darstellung haben. */
function strip(r, env, lang) {
  return { ...r, scan: r.scan ? { ...r.scan, api: undefined } : null, html: resultCard(r, env, lang) };
}

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const html = (s, status = 200, lang = "de") => new Response(s, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-language": lang, "vary": "accept-language" } });


async function staticPage(req, env) {
  const r = await env.ASSETS.fetch(req);
  if (r.status !== 404) return r;
  const lang = pickLang(req, new URL(req.url).searchParams.get("lang"));
  return html(notFoundPage(lang, env), 404, lang);
}
