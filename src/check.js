// Eine Prüfung von vorn bis hinten: Eingabe → Kurzlink auflösen → Heuristik →
// Netz-Prüfungen parallel → Urteil → Ergebnisobjekt (das in KV landet).
import { normalizeInput, hostInfo, shortId } from "./util.js";
import {
  heuristics, unwrapShortener, dnsFacts, dnsFindings, rdapFacts, rdapFindings, ctFacts,
  safeBrowsing, urlhaus, urlhausUrl, phishtank, urlscanSearch, urlscanSubmit, urlscanResult,
} from "./checks.js";
import { listFindings, softenHttp, RULES } from "./lists.js";
import { verdict } from "./verdict.js";
import { stripSecrets } from "./redact.js";

const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e: String(e).slice(0, 120) }));
// A lookup that is not back in time counts as failed (its request may still finish in the background).
const within = (p, ms) => ms ? Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("deadline")), ms).unref?.())]) : p;

// Time budget of the client API: the apps wait at most 6 s, so the server must answer well before that,
// even when one provider hangs (each provider alone may take up to 6 s on the website path).
export const LITE_BUDGET = { unwrap: 2000, first: 2500, second: 1200 };

/** Lookup budget of the client API; LITE_BUDGET_MS="unwrap,first,second" tightens it (the reserve server, docs/FALLBACK.md). */
export function liteBudget(env) {
  const p = String(env?.LITE_BUDGET_MS || "").split(",").map((x) => Number(x.trim()));
  if (p.length !== 3 || p.some((x) => !Number.isFinite(x) || x < 100 || x > 10000)) return LITE_BUDGET;
  return { unwrap: p[0], first: p[1], second: p[2] };
}

// lite (client API v1): never submits a sandbox scan, searches urlscan only when the first pass is not green,
// skips crt.sh (it only ever adds an info finding without weight and is often slow), and keeps every lookup
// inside LITE_BUDGET. The website path (lite = false) behaves exactly as before.
export async function runCheck(rawInput, env, { withScan = true, lite = false } = {}) {
  if (lite) withScan = false;
  const B = liteBudget(env);
  const input = normalizeInput(rawInput);
  if (!input) return { error: "err.nolink" };

  const { finalUrl, chain } = lite
    ? await within(unwrapShortener(input), B.unwrap).catch(() => ({ finalUrl: input, chain: [input] }))
    : await unwrapShortener(input);
  const url = finalUrl;
  const h = hostInfo(url);
  // Outside services (Safe Browsing, URLhaus, PhishTank, urlscan) never see tokens or signatures from the query.
  const ext = stripSecrets(url);
  const heur = softenHttp(heuristics(url).findings, h.domain, h.host);
  if (chain.length > 1) {
    const th = hostInfo(chain[chain.length - 1]);
    heur.push({ key: "unwrapped", stufe: "info", p: { host: th.host } });
  }

  const skipped = { ok: false, e: "lite" };
  const lim = lite ? B.first : 0;
  let [dns, rdap, ct, sb, uh, uhu, pt, us] = await Promise.all([
    settle(within(dnsFacts(h.host, h.domain), lim)),
    settle(within(rdapFacts(h.domain), lim)),
    lite ? skipped : settle(ctFacts(h.domain)),
    settle(within(safeBrowsing(ext, env.SAFE_BROWSING_KEY), lim)),
    settle(within(urlhaus(h.host, env.URLHAUS_KEY), lim)),
    settle(within(urlhausUrl(ext, env.URLHAUS_KEY), lim)),
    settle(within(phishtank(ext), lim)),
    lite ? skipped : settle(urlscanSearch(h.domain)),
  ]);

  const assemble = () => {
    const all = [...heur];
    all.push(...dnsFindings(dns.ok ? dns.v : { error: dns.e }, h.host));
    if (rdap.ok) all.push(...rdapFindings(rdap.v));
    if (ct.ok && ct.v.ok && ct.v.count === 0 && dns.ok && dns.v.resolves) {
      all.push({ key: "ct-none", stufe: "info", p: {} });
    }
    all.push(...listFindings({ url, ext, domain: h.domain, sb: sb.ok ? sb.v : null, uh: uh.ok ? uh.v : null, uhu: uhu.ok ? uhu.v : null, pt: pt.ok ? pt.v : null, us: us.ok ? us.v : null }));
    return all;
  };
  let v = verdict(assemble(), { url });
  if (lite && v.stufe !== "gruen") {
    us = await settle(within(urlscanSearch(h.domain), B.second));
    v = verdict(assemble(), { url });
  }

  let scan = null;
  // Tagesbudget für urlscan (Node-Betrieb): ist es aufgebraucht, wird ohne Sandbox geprüft
  if (withScan && env.URLSCAN_KEY && dns.ok && dns.v.resolves && (!env.SCAN_BUDGET || env.SCAN_BUDGET.take())) {
    const s = await settle(urlscanSubmit(ext, env.URLSCAN_KEY));
    scan = s.ok && s.v.ok ? { uuid: s.v.uuid, status: "pending", submitted: Date.now() } : { status: "unavailable", why: s.ok ? (s.v.text || s.v.status) : s.e };
  } else if (withScan) {
    scan = { status: "skipped" };
  }

  return {
    id: shortId(),
    version: 1,
    rules: RULES,
    checked: new Date().toISOString(),
    input, url, chain,
    host: h,
    verdict: { stufe: v.stufe, kurzKey: v.kurzKey, ratKey: v.ratKey, score: v.score },
    findings: v.findings,
    facts: {
      dns: dns.ok ? dns.v : { error: dns.e },
      rdap: rdap.ok ? rdap.v : { error: rdap.e },
      ct: ct.ok ? ct.v : { error: ct.e },
      safebrowsing: sb.ok ? sb.v : { error: sb.e },
      urlhaus: uh.ok ? uh.v : { error: uh.e },
      urlhausUrl: uhu.ok ? uhu.v : { error: uhu.e },
      phishtank: pt.ok ? pt.v : { error: pt.e },
      urlscanSearch: us.ok ? us.v : { error: us.e },
    },
    scan,
  };
}

/** Sandbox-Ergebnis nachziehen (wird beim Abruf des Ergebnisses versucht). */
export async function refreshScan(result, env) {
  if (!result.scan || result.scan.status !== "pending") return result;
  const r = await urlscanResult(result.scan.uuid, env.URLSCAN_KEY).catch(() => ({ ok: false }));
  if (r.ok && r.status === "done") {
    result.scan = { ...result.scan, ...r, status: "done" };
    if (r.malicious && !result.findings.some((f) => f.key === "urlscan-verdict")) {
      result.findings.unshift({ key: "urlscan-verdict", stufe: "rot", p: r.brands?.length ? { brands: r.brands.join(", ") } : {} });
      const v = verdict(result.findings.filter((f) => !f.muster), { url: result.url });
      result.verdict = { stufe: v.stufe, kurzKey: v.kurzKey, ratKey: v.ratKey, score: v.score };
      result.findings = v.findings;
    }
  } else if (Date.now() - (result.scan.submitted || 0) > 3 * 60 * 1000) {
    result.scan = { ...result.scan, status: "timeout" };
  }
  return result;
}
