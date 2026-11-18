//! The check flow (docs/DESKTOP.md section 5): normalise → refuse non-http(s) → unwrap
//! redirectors → local heuristics → allowlist → cache → server (hard timeout) → merge.
//! Never "opens silently": an error ends as `offline` with the local assessment.

use crate::allowlist;
use crate::api::{ApiError, CheckApi, Request};
use crate::cache::{self, Cache};
use crate::heuristics::{self, level_order, severity, Finding, Verdict};
use crate::hostinfo::host_info;
use crate::link::{classify, reduce, Incoming};
use crate::redirect;
use crate::settings::Settings;
use crate::store::{now_secs, Paths};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    /// The link as clicked — this is what opens if the user goes ahead.
    pub url: String,
    /// The judged target (differs from `url` when a redirector was unwrapped).
    pub target: String,
    pub unwrapped: bool,
    pub host: String,
    pub domain: String,
    pub unicode_host: String,
    /// `gruen`, `gelb`, `rot` or `offline`.
    pub stufe: String,
    /// `allowlist`, `cache`, `server` or `local`.
    pub source: String,
    /// Why the check could not finish (`timeout`, `network`, `server`, `rate`, `noserver`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub kurz_key: String,
    pub rat_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kurz: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rat: Option<String>,
    pub findings: Vec<Finding>,
    /// Local assessment (always present).
    pub local: Verdict,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_entry: Option<String>,
    /// `reserve` when the answer came from the reserve server (docs/FALLBACK.md): the window shows a quiet note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub via: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Prepared {
    pub url: String,
    pub target: Url,
    pub target_raw: String,
    pub unwrapped: bool,
    pub local: Verdict,
    /// Allowlist or cache hit: no server call needed.
    pub early: Option<CheckResult>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    /// Local HTML file: hand to the browser unchanged.
    PassThrough(String),
    /// Not an http(s) link: never launched. Carries the scheme.
    Refused(String),
    /// Checking is paused: open directly.
    Paused(String),
    Check(Box<Prepared>),
}

pub struct Engine<'a, A: CheckApi> {
    pub paths: &'a Paths,
    pub settings: &'a Settings,
    pub api: &'a A,
}

fn base_result(p: &Prepared) -> CheckResult {
    let h = host_info(&p.target);
    CheckResult {
        url: p.url.clone(),
        target: p.target_raw.clone(),
        unwrapped: p.unwrapped,
        host: h.host,
        domain: h.domain,
        unicode_host: h.unicode_host,
        stufe: p.local.stufe.clone(),
        source: "local".into(),
        reason: None,
        kurz_key: p.local.kurz_key.clone(),
        rat_key: p.local.rat_key.clone(),
        kurz: None,
        rat: None,
        findings: p.local.findings.clone(),
        local: p.local.clone(),
        server: None,
        allow_entry: None,
        via: None,
    }
}

/// Combine the server answer with the local assessment: the worse level wins, server
/// findings (translated) first, local findings the server did not report are added.
/// When the server reported every local finding itself (same keys), its level decides: it runs the
/// same heuristics and may soften one with more knowledge (e.g. `http` to a well-known site, 0.5.3).
pub fn merge(p: &Prepared, server: &Value, source: &str) -> CheckResult {
    let mut r = base_result(p);
    let s_stufe = server.get("stufe").and_then(|x| x.as_str()).unwrap_or("gelb").to_string();
    let mut findings: Vec<Finding> = server
        .get("findings")
        .and_then(|f| f.as_array())
        .map(|a| a.iter().filter_map(|x| serde_json::from_value::<Finding>(x.clone()).ok()).collect())
        .unwrap_or_default();
    let mut local_only = false;
    for lf in &p.local.findings {
        if !findings.iter().any(|f| f.key == lf.key) {
            findings.push(lf.clone());
            local_only = true;
        }
    }
    findings.sort_by_key(|f| level_order(&f.stufe));
    r.findings = findings;
    r.source = source.into();
    r.server = Some(server.clone());
    if local_only && severity(&p.local.stufe) > severity(&s_stufe) {
        r.stufe = p.local.stufe.clone();
    } else {
        r.stufe = s_stufe;
        let gs = |k: &str| server.get(k).and_then(|x| x.as_str()).map(String::from);
        r.kurz_key = gs("kurzKey").unwrap_or(r.kurz_key);
        r.rat_key = gs("ratKey").unwrap_or(r.rat_key);
        r.kurz = gs("kurz");
        r.rat = gs("rat");
    }
    r
}

impl<'a, A: CheckApi> Engine<'a, A> {
    pub fn prepare(&self, raw: &str) -> Decision {
        let u = match classify(raw) {
            Incoming::Web(u) => u,
            Incoming::LocalHtml(s) => return Decision::PassThrough(s),
            Incoming::Refused(s) => return Decision::Refused(s),
        };
        let url = u.to_string();
        if self.settings.is_paused() {
            return Decision::Paused(url);
        }
        let (target, target_raw, unwrapped) = match redirect::unwrap(u.as_str()) {
            Some(t) => (Url::parse(&t).expect("unwrapped target parses"), t, true),
            None => (u.clone(), url.clone(), false),
        };
        let local = heuristics::verdict(&heuristics::heuristics_url(&target_raw, &target), &target_raw);
        let mut p = Prepared { url, target, target_raw, unwrapped, local, early: None };
        if p.local.stufe != "rot" {
            if let Some(entry) = allowlist::matches(&self.settings.allowlist, &p.target) {
                let mut r = base_result(&p);
                r.stufe = "gruen".into();
                r.source = "allowlist".into();
                r.kurz_key = "v.gruen".into();
                r.rat_key = "v.gruen.rat".into();
                r.findings = Vec::new();
                r.allow_entry = Some(entry);
                p.early = Some(r);
                return Decision::Check(Box::new(p));
            }
        }
        let key = cache::key(&p.target, self.settings.scope);
        let c = Cache::load(&self.paths.cache());
        if let Some(e) = c.get(&key, now_secs()) {
            p.early = Some(merge(&p, &e.result, "cache"));
        }
        Decision::Check(Box::new(p))
    }

    /// Ask the server (blocking, hard timeout in the client) and cache the answer.
    pub fn remote(&self, p: &Prepared, lang: &str) -> CheckResult {
        let req = Request { url: reduce(&p.target, self.settings.scope), lang: lang.into(), scope: self.settings.scope.as_str().into() };
        match self.api.check(&req) {
            Ok(mut v) => {
                // The mark of the reserve belongs to this answer only, never into the cache.
                let via = v.as_object_mut().and_then(|o| o.remove("via")).and_then(|x| x.as_str().map(String::from)).filter(|x| x == "reserve");
                let mut r = merge(p, &v, "server");
                r.via = via;
                let ttl = v.get("cacheTtl").and_then(|t| t.as_u64());
                let s_stufe = v.get("stufe").and_then(|x| x.as_str()).unwrap_or("gelb").to_string();
                let mut c = Cache::load(&self.paths.cache());
                let now = now_secs();
                c.note_rules(cache::rules_of(&v));
                c.put(cache::key(&p.target, self.settings.scope), &s_stufe, v, ttl, now);
                let _ = c.save(&self.paths.cache(), now);
                r
            }
            Err(e) => offline(p, &e),
        }
    }

    /// Full check: early answer if there is one, else the server.
    pub fn check(&self, raw: &str, lang: &str) -> (Decision, Option<CheckResult>) {
        let d = self.prepare(raw);
        let r = match &d {
            Decision::Check(p) => Some(p.early.clone().unwrap_or_else(|| self.remote(p, lang))),
            _ => None,
        };
        (d, r)
    }
}

pub fn offline(p: &Prepared, e: &ApiError) -> CheckResult {
    let mut r = base_result(p);
    r.stufe = "offline".into();
    r.source = "local".into();
    r.reason = Some(e.reason().into());
    r
}
