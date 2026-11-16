//! Check flow with a mock server: allowlist, cache, server merge, local red, offline,
//! loop-free decisions for non-web input, privacy of what is sent, native messaging.

use linkwache_core::api::{ApiError, CheckApi, Request};
use linkwache_core::engine::{Decision, Engine};
use linkwache_core::link::Scope;
use linkwache_core::nm;
use linkwache_core::settings::Settings;
use linkwache_core::store::Paths;
use serde_json::{json, Value};
use std::cell::RefCell;

struct Mock {
    answer: Result<Value, ApiError>,
    seen: RefCell<Vec<Request>>,
}

impl Mock {
    fn new(answer: Result<Value, ApiError>) -> Self {
        Mock { answer, seen: RefCell::new(Vec::new()) }
    }
}

impl CheckApi for Mock {
    fn check(&self, req: &Request) -> Result<Value, ApiError> {
        self.seen.borrow_mut().push(req.clone());
        self.answer.clone()
    }
}

fn green() -> Value {
    json!({"api":1,"rules":2,"stufe":"gruen","score":0,"kurzKey":"v.gruen","ratKey":"v.gruen.rat","kurz":"No warning signs found","rat":"…","findings":[{"key":"db-clean","stufe":"info","p":{"n":3},"titel":"Not listed","text":"…"}],"cacheTtl":21600})
}

fn setup() -> (tempfile::TempDir, Paths, Settings) {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::new(dir.path());
    let mut s = Settings::load_or_create(&paths, &linkwache_core::settings::Preset::server_only("https://lw.example"), "en").unwrap();
    s.setup_done = true;
    s.save(&paths).unwrap();
    (dir, paths, s)
}

#[test]
fn server_green_then_cached() {
    let (_d, paths, s) = setup();
    let api = Mock::new(Ok(green()));
    let e = Engine { paths: &paths, settings: &s, api: &api };
    let (_, r) = e.check("https://shop.example.com/a/b?token=secret#frag", "de");
    let r = r.unwrap();
    assert_eq!((r.stufe.as_str(), r.source.as_str()), ("gruen", "server"));
    assert_eq!(r.findings[0].titel.as_deref(), Some("Not listed"));
    // Privacy: no query string, no fragment, no user info sent.
    let seen = api.seen.borrow().clone();
    assert_eq!(seen[0].url, "https://shop.example.com/a/b");
    assert_eq!(seen[0].lang, "de");
    assert_eq!(seen[0].scope, "url");
    let (_, r2) = e.check("https://shop.example.com/a/b?other=1", "de");
    assert_eq!(r2.unwrap().source, "cache");
    assert_eq!(api.seen.borrow().len(), 1);
}

#[test]
fn domain_scope_sends_host_only() {
    let (_d, paths, mut s) = setup();
    s.scope = Scope::Domain;
    let api = Mock::new(Ok(green()));
    let e = Engine { paths: &paths, settings: &s, api: &api };
    e.check("http://shop.example.com/x/y?z=1", "en");
    assert_eq!(api.seen.borrow()[0].url, "https://shop.example.com/");
    assert_eq!(api.seen.borrow()[0].scope, "domain");
}

#[test]
fn allowlist_needs_no_server() {
    let (_d, paths, mut s) = setup();
    s.add_allowed("example.org").unwrap();
    let api = Mock::new(Err(ApiError::Timeout));
    let e = Engine { paths: &paths, settings: &s, api: &api };
    let (_, r) = e.check("https://www.example.org/page", "en");
    let r = r.unwrap();
    assert_eq!((r.stufe.as_str(), r.source.as_str()), ("gruen", "allowlist"));
    let (_, r) = e.check("https://de.wikipedia.org/wiki/Test", "en");
    assert_eq!(r.unwrap().source, "allowlist");
    assert!(api.seen.borrow().is_empty());
    // A look-alike goes to the server (here: offline).
    let (_, r) = e.check("https://examp1e.org/", "en");
    assert_eq!(r.unwrap().stufe, "offline");
}

#[test]
fn local_red_wins_over_server_green() {
    let (_d, paths, s) = setup();
    let api = Mock::new(Ok(green()));
    let e = Engine { paths: &paths, settings: &s, api: &api };
    match e.prepare("https://paypal.com.secure-login.example/") {
        Decision::Check(p) => {
            assert_eq!(p.local.stufe, "rot");
            assert!(p.early.is_none());
            let r = e.remote(&p, "en");
            assert_eq!(r.stufe, "rot");
            assert!(r.findings.iter().any(|f| f.key == "brand-sub"));
            assert!(r.findings.iter().any(|f| f.key == "db-clean"));
            assert_eq!(r.findings[0].stufe, "rot");
        }
        d => panic!("{d:?}"),
    }
}

#[test]
fn red_is_never_allowlisted() {
    let (_d, paths, mut s) = setup();
    s.allowlist.push("secure-login.example".into());
    let api = Mock::new(Ok(green()));
    let e = Engine { paths: &paths, settings: &s, api: &api };
    let (_, r) = e.check("https://paypal.com.secure-login.example/", "en");
    assert_eq!(r.unwrap().stufe, "rot");
}

#[test]
fn offline_keeps_local_assessment() {
    let (_d, paths, s) = setup();
    for (err, reason) in [
        (ApiError::Timeout, "timeout"),
        (ApiError::Network("refused".into()), "network"),
        (ApiError::Status(500, "internal".into()), "server"),
        (ApiError::Status(429, "err.rate".into()), "rate"),
    ] {
        let api = Mock::new(Err(err));
        let e = Engine { paths: &paths, settings: &s, api: &api };
        let (_, r) = e.check("https://cheap-deals.top/", "en");
        let r = r.unwrap();
        assert_eq!(r.stufe, "offline");
        assert_eq!(r.reason.as_deref(), Some(reason));
        assert_eq!(r.local.stufe, "gelb");
        assert!(r.findings.iter().any(|f| f.key == "tld"));
    }
}

#[test]
fn redirectors_are_judged_by_target_but_original_opens() {
    let (_d, paths, s) = setup();
    let api = Mock::new(Ok(green()));
    let e = Engine { paths: &paths, settings: &s, api: &api };
    let wrapped = "https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fpaypal.com.secure-login.example%2Fx&data=1";
    let (_, r) = e.check(wrapped, "en");
    let r = r.unwrap();
    assert!(r.unwrapped);
    assert_eq!(r.target, "https://paypal.com.secure-login.example/x");
    assert_eq!(r.url, wrapped);
    assert_eq!(r.stufe, "rot");
    assert_eq!(api.seen.borrow()[0].url, "https://paypal.com.secure-login.example/x");
}

#[test]
fn non_web_input_is_not_checked() {
    let (_d, paths, mut s) = setup();
    let api = Mock::new(Ok(green()));
    let e = Engine { paths: &paths, settings: &s, api: &api };
    assert_eq!(e.prepare("mailto:x@example.com"), Decision::Refused("mailto".into()));
    assert_eq!(e.prepare("javascript:alert(1)"), Decision::Refused("javascript".into()));
    assert!(matches!(e.prepare("file:///tmp/a.html"), Decision::PassThrough(_)));
    s.pause_for(15);
    let e = Engine { paths: &paths, settings: &s, api: &api };
    assert_eq!(e.prepare("https://example.com/"), Decision::Paused("https://example.com/".into()));
    assert!(api.seen.borrow().is_empty());
}

fn nm_roundtrip(paths: &Paths, msgs: &[Value], answer: Result<Value, ApiError>) -> Vec<Value> {
    let mut input = Vec::new();
    for m in msgs {
        nm::write_message(&mut input, m).unwrap();
    }
    let mut out = Vec::new();
    let a = answer.clone();
    nm::serve(&mut input.as_slice(), &mut out, paths, "0.5.0", &move |_s: &Settings| Mock::new(a.clone())).unwrap();
    let mut r = out.as_slice();
    let mut res = Vec::new();
    while let Some(v) = nm::read_message(&mut r).unwrap() {
        res.push(v);
    }
    res
}

#[test]
fn native_messaging_protocol() {
    let (_d, paths, _s) = setup();
    let res = nm_roundtrip(
        &paths,
        &[
            json!({"type":"hello","version":"0.5.0"}),
            json!({"type":"check","id":"7","url":"https://example.net/x?y=1","lang":"de"}),
            json!({"type":"check","id":"8","url":"https://example.net/x"}),
            json!({"type":"allow","domain":"https://Shop.Example.com/"}),
            json!({"type":"allow","domain":"xn--bcher-kva.example"}),
            json!({"type":"log","event":"open-anyway","stufe":"gelb","domain":"cheap-deals.top"}),
            json!({"type":"what","id":"9"}),
            json!({"type":"check","id":"10","url":"mailto:a@example.com"}),
        ],
        Ok(green()),
    );
    assert_eq!(res[0], json!({"type":"hello","app":"0.5.0","server":"https://lw.example","scope":"url","paused":false}));
    assert_eq!(res[1]["type"], "result");
    assert_eq!(res[1]["id"], "7");
    assert_eq!(res[1]["source"], "server");
    assert_eq!(res[1]["stufe"], "gruen");
    assert_eq!(res[1]["api"], 1);
    assert_eq!(res[2]["source"], "cache");
    assert_eq!(res[3], json!({"type":"ok"}));
    assert_eq!(res[4]["type"], "error");
    assert_eq!(res[5], json!({"type":"ok"}));
    assert_eq!(res[6], json!({"type":"error","id":"9","error":"unknown"}));
    assert_eq!(res[7]["type"], "error");
    let s = Settings::load(&paths).unwrap();
    assert_eq!(s.allowlist, vec!["example.com"]);
    let h = linkwache_core::history::History::load(&paths.history());
    assert_eq!(h.items[0].action, "open-anyway");
    assert_eq!(h.items[0].source, "extension");
}

#[test]
fn native_messaging_offline() {
    let (_d, paths, _s) = setup();
    let res = nm_roundtrip(&paths, &[json!({"type":"check","id":"1","url":"https://paypal-konto.example/"})], Err(ApiError::Timeout));
    assert_eq!(res[0]["offline"], true);
    assert_eq!(res[0]["local"]["stufe"], "rot");
    assert_eq!(res[0]["id"], "1");
}

#[test]
fn host_invocation_detection() {
    let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert!(nm::is_host_invocation(&a(&["linkwache", "chrome-extension://ldehleohedacddboipopkjkphjnphine/"])));
    assert!(nm::is_host_invocation(&a(&["linkwache", "/x/app.linkwache.desktop.json", "{ef1e5d25-3e24-4517-a534-dad3a936dcb3}"])));
    assert!(nm::is_host_invocation(&a(&["linkwache", "--native-messaging"])));
    assert!(!nm::is_host_invocation(&a(&["linkwache", "https://example.com/"])));
    let m = nm::chrome_manifest("/opt/linkwache");
    assert_eq!(m["allowed_origins"][0], "chrome-extension://ldehleohedacddboipopkjkphjnphine/");
    assert_eq!(nm::firefox_manifest("/x")["allowed_extensions"][0], "{ef1e5d25-3e24-4517-a534-dad3a936dcb3}");
}

#[test]
fn server_may_soften_a_local_finding_it_reported_itself() {
    let (_d, paths, s) = setup();
    // http:// to a well-known site: the server reports `http` as info and answers green (0.5.3)
    let soft = json!({"api":1,"rules":2,"stufe":"gruen","score":0,"kurzKey":"v.gruen","ratKey":"v.gruen.rat","findings":[{"key":"http","stufe":"info","p":{"known":true}}],"cacheTtl":21600});
    let api = Mock::new(Ok(soft));
    let e = Engine { paths: &paths, settings: &s, api: &api };
    let (_, r) = e.check("http://www.example.com/", "en");
    assert_eq!(r.unwrap().stufe, "gruen");
    // a local finding the server did not report still counts
    let api2 = Mock::new(Ok(green()));
    let e2 = Engine { paths: &paths, settings: &s, api: &api2 };
    let (_, r2) = e2.check("http://plain.example.net/", "en");
    assert_eq!(r2.unwrap().stufe, "gelb");
}

#[test]
fn cached_answer_of_older_rules_is_asked_again() {
    let (_d, paths, s) = setup();
    let mut c = linkwache_core::cache::Cache::default();
    let u = url::Url::parse("https://shop.example.com/a").unwrap();
    // a red answer cached by 0.5.1 (no rules field)
    c.put(linkwache_core::cache::key(&u, Scope::Url), "rot", json!({"api":1,"stufe":"rot","findings":[]}), None, linkwache_core::store::now_secs());
    c.save(&paths.cache(), linkwache_core::store::now_secs()).unwrap();
    let api = Mock::new(Ok(green()));
    let e = Engine { paths: &paths, settings: &s, api: &api };
    let (_, r) = e.check("https://shop.example.com/a", "en");
    let r = r.unwrap();
    assert_eq!((r.stufe.as_str(), r.source.as_str()), ("gruen", "server"));
}
