#!/usr/bin/env node
// Minimal Linkwache server for the desktop end-to-end tests: implements the v1 contract of
// docs/API.md (POST /api/v1/check, GET /api/health) with the real offline heuristics of
// src/checks.js + src/verdict.js. Green for normal domains, amber/red as the heuristics say.
// Paths containing "e2e-slow" answer after 2.5 s (to photograph the "checking" toast).
// Every request body is appended to --log so the test can verify what the app sent.
// Usage: node desktop/e2e/mock-server.mjs --port 8787 [--log requests.jsonl]
import http from "node:http";
import fs from "node:fs";
import { heuristics } from "../../src/checks.js";
import { verdict } from "../../src/verdict.js";
import { findingText, verdictText, LANGS } from "../../src/i18n.js";

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
};
const port = Number(arg("--port", "8787"));
const log = arg("--log", "");

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/health") return send(res, 200, { ok: true, version: "0.5.0-mock", api: [1] });
  if (req.method !== "POST" || req.url !== "/api/v1/check") return send(res, 404, { error: "not found" });
  if (!String(req.headers["content-type"] || "").startsWith("application/json")) return send(res, 415, { error: "type" });
  if (!/^[0-9a-f]{32}$/.test(String(req.headers["x-linkwache-install"] || ""))) return send(res, 400, { error: "err.install" });
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    let body;
    try { body = JSON.parse(raw); } catch { return send(res, 400, { error: "err.nolink" }); }
    if (log) fs.appendFileSync(log, JSON.stringify({ body, client: req.headers["x-linkwache-client"] }) + "\n");
    let u;
    try { u = new URL(body.url); } catch { return send(res, 400, { error: "err.nolink" }); }
    if (!/^https?:$/.test(u.protocol)) return send(res, 400, { error: "err.nolink" });
    const lang = LANGS.includes(body.lang) ? body.lang : "en";
    const { findings, host } = heuristics(u.href);
    const v = verdict(findings, { url: u.href });
    const vt = verdictText(lang, v);
    const out = {
      api: 1, stufe: v.stufe, score: v.score, kurzKey: v.kurzKey, ratKey: v.ratKey, kurz: vt.kurz, rat: vt.rat,
      url: u.href, host: { host: host.host, domain: host.domain, unicodeHost: host.unicodeHost }, chain: [],
      findings: v.findings.map((f) => ({ ...f, ...findingText(lang, f) })),
      cacheTtl: 60, checked: new Date().toISOString(), server: "0.5.0-mock",
    };
    const delay = u.pathname.includes("e2e-slow") ? 2500 : 0;
    setTimeout(() => send(res, 200, out), delay);
  });
});

server.listen(port, "127.0.0.1", () => console.log(`mock server on http://127.0.0.1:${port}`));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => server.close(() => process.exit(0)));
