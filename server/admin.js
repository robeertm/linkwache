// Operator page of the self-hosted build: /admin shows the running version and whether a newer release exists,
// and lets the operator file an update request with one click. The page installs nothing: the request is a small
// file in DATA_DIR that scripts/aktualisieren.sh --if-requested picks up on the host (check, backup, swap, rollback).
// Disabled unless ADMIN_TOKEN is set. Public pages never show any of this.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { page } from "../src/render.js";
import { t, pickLang } from "../src/i18n.js";
import { esc } from "../src/util.js";
import { createLimiter } from "./ratelimit.js";

const JSON_HEAD = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: JSON_HEAD });

const sameKey = (a, b) => {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

export function createAdmin({ token, dataDir, version, info, checkEnabled, now = Date.now }) {
  const file = path.join(dataDir, "update-request.json");
  const tries = createLimiter({ perMinute: 10, perDay: 200, now });
  const readRequest = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
  const status = () => {
    const req = readRequest();
    return {
      version,
      latest: info.latest || null,
      checkEnabled,
      checkedAt: info.checkedAt || null,
      pending: req && req.version ? req.version : null,
    };
  };

  async function handle(req, env) {
    if (!token) return null;
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === "/admin" || p === "/admin/") {
      const lang = pickLang(req, url.searchParams.get("lang"));
      const s = Object.fromEntries(["title", "token", "login", "version", "uptodate", "avail", "request", "requested", "off", "bad", "hint", "pending", "checked", "never"].map((k) => [k, t(lang, "adm." + k)]));
      const body = `<section class="admin"><h1>${esc(s.title)}</h1>
  <form id="adm-login" class="paste"><label class="small" for="adm-token">${esc(s.token)}</label>
  <input id="adm-token" type="password" autocomplete="current-password" spellcheck="false">
  <div class="row"><button class="btn big" type="submit">${esc(s.login)}</button></div></form>
  <div id="adm-box" hidden><p id="adm-ver"></p><p id="adm-state" class="adm-state"></p>
  <div class="row"><button class="btn big" id="adm-req" type="button" hidden>${esc(s.request)}</button></div>
  <p id="adm-meta" class="hint"></p></div>
  <p id="adm-msg" class="error" hidden></p><p class="hint">${esc(s.hint)}</p></section>`;
      const html = page({ lang, title: s.title, body, env, noindex: true, path: "/admin", extraHead: `<script src="/admin.js?v=${esc(env.ASSET_VER || "1")}" defer></script>`, client: { adm: s } });
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    if (p !== "/api/admin/status" && p !== "/api/admin/update-request") return null;
    const ip = req.headers.get("cf-connecting-ip") || "0";
    if (!(await tries.limit({ key: ip })).success) return json({ error: "rate" }, 429);
    const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") || "");
    if (!m || !sameKey(m[1], token)) return json({ error: "unauthorized" }, 401);
    if (p === "/api/admin/status") return req.method === "GET" ? json(status()) : json({ error: "method" }, 405);
    if (req.method !== "POST") return json({ error: "method" }, 405);
    if (req.headers.get("sec-fetch-site") && !["same-origin", "none"].includes(req.headers.get("sec-fetch-site"))) return json({ error: "forbidden" }, 403);
    if (!info.latest) return json({ error: "nothing-to-update" }, 409);
    fs.writeFileSync(file, JSON.stringify({ version: info.latest, at: new Date(now()).toISOString() }), { mode: 0o600 });
    return json(status());
  }
  return { handle, status, file };
}
