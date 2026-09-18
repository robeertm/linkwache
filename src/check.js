// Eine Prüfung von vorn bis hinten: Eingabe → Kurzlink auflösen → Heuristik →
// Netz-Prüfungen parallel → Urteil → Ergebnisobjekt (das in KV landet).
import { normalizeInput, hostInfo, shortId } from "./util.js";
import {
  heuristics, unwrapShortener, dnsFacts, dnsFindings, rdapFacts, rdapFindings, ctFacts,
  safeBrowsing, urlhaus, phishtank, dbFindings, urlscanSearch, urlscanSubmit, urlscanResult,
} from "./checks.js";
import { verdict } from "./verdict.js";

const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e: String(e).slice(0, 120) }));

export async function runCheck(rawInput, env, { withScan = true } = {}) {
  const input = normalizeInput(rawInput);
  if (!input) return { error: "err.nolink" };

  const { finalUrl, chain } = await unwrapShortener(input);
  const url = finalUrl;
  const h = hostInfo(url);
  const { findings: heur } = heuristics(url);
  if (chain.length > 1) {
    const th = hostInfo(chain[chain.length - 1]);
    heur.push({ key: "unwrapped", stufe: "info", p: { host: th.host } });
  }

  const [dns, rdap, ct, sb, uh, pt, us] = await Promise.all([
    settle(dnsFacts(h.host, h.domain)),
    settle(rdapFacts(h.domain)),
    settle(ctFacts(h.domain)),
    settle(safeBrowsing(url, env.SAFE_BROWSING_KEY)),
    settle(urlhaus(h.host, env.URLHAUS_KEY)),
    settle(phishtank(url)),
    settle(urlscanSearch(h.domain)),
  ]);

  const findings = [...heur];
  findings.push(...dnsFindings(dns.ok ? dns.v : { error: dns.e }, h.host));
  if (rdap.ok) findings.push(...rdapFindings(rdap.v));
  if (ct.ok && ct.v.ok && ct.v.count === 0 && dns.ok && dns.v.resolves) {
    findings.push({ key: "ct-none", stufe: "info", p: {} });
  }
  findings.push(...dbFindings({ sb: sb.ok ? sb.v : null, uh: uh.ok ? uh.v : null, pt: pt.ok ? pt.v : null, us: us.ok ? us.v : null }));

  const v = verdict(findings, { url });

  let scan = null;
  if (withScan && env.URLSCAN_KEY && dns.ok && dns.v.resolves) {
    const s = await settle(urlscanSubmit(url, env.URLSCAN_KEY));
    scan = s.ok && s.v.ok ? { uuid: s.v.uuid, status: "pending", submitted: Date.now() } : { status: "unavailable", why: s.ok ? (s.v.text || s.v.status) : s.e };
  } else if (withScan) {
    scan = { status: "skipped" };
  }

  return {
    id: shortId(),
    version: 1,
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
