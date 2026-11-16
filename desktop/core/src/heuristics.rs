//! Offline heuristics and verdict, ported from `src/checks.js` (`heuristics`) and
//! `src/verdict.js`. The shared vectors in `test/vectors/heuristics.json` pin both ports.

use crate::hostinfo::{host_info, HostInfo};
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use url::Url;

pub const RISKY_TLDS: &[&str] = &[
    "zip", "mov", "top", "xyz", "icu", "cfd", "rest", "sbs", "cyou", "click", "gq", "ml", "cf", "ga", "tk", "buzz",
    "monster", "quest", "bond", "lat", "boats", "hair", "makeup", "skin", "beauty", "motorcycles", "autos", "cam",
    "surf", "fun", "life", "run", "live", "work", "world", "link", "site", "online", "website", "space", "store",
    "shop", "vip", "biz.id", "my.id", "web.id", "co.vu", "pw", "su", "ws", "cc", "asia", "bar", "best",
];

pub const BRANDS: &[&str] = &[
    "paypal", "sparkasse", "volksbank", "postbank", "commerzbank", "deutschebank", "ing-diba", "dkb", "comdirect",
    "n26", "klarna", "amazon", "dhl", "dpd", "hermes", "ups", "fedex", "deutschepost", "whatsapp", "telegram",
    "signal", "instagram", "facebook", "microsoft", "office365", "outlook", "apple", "icloud", "google", "netflix",
    "disney", "spotify", "ebay", "kleinanzeigen", "vinted", "zalando", "otto", "lidl", "aldi", "rewe", "telekom",
    "vodafone", "o2", "1und1", "ionos", "strato", "gmx", "web.de", "bahn", "elster", "bundesagentur", "finanzamt",
    "polizei", "ikea", "steam", "playstation", "xbox", "coinbase", "binance", "bitpanda", "trade-republic",
    "scalable", "check24", "booking", "airbnb",
];

pub const BRAND_HOMES: &[&str] = &[
    "office.com", "office365.com", "live.com", "outlook.com", "microsoft.com", "microsoftonline.com",
    "sharepoint.com", "onedrive.com", "xbox.com", "apple.com", "icloud.com", "google.com", "google.de",
    "gmail.com", "youtube.com", "googleusercontent.com", "amazon.com", "amazon.de", "paypal.com", "paypal.de",
    "facebook.com", "instagram.com", "whatsapp.com", "dhl.de", "dhl.com", "deutschepost.de", "telekom.de",
    "t-online.de", "ebay.com", "ebay.de", "netflix.com", "spotify.com", "steampowered.com", "steamcommunity.com",
];

pub const LURE_WORDS: &[&str] = &[
    "login", "signin", "anmelden", "verify", "verifizier", "bestaetig", "bestätig", "secure", "sicherheit", "konto",
    "account", "update", "aktualisier", "wallet", "sperr", "unlock", "freischalt", "vote", "voting", "abstimm",
    "gewinn", "prize", "bonus", "paket", "zustell", "delivery", "zoll", "customs", "gebuehr", "invoice", "rechnung",
    "mahnung", "steuer", "refund", "rueckerstatt", "support", "helpdesk", "2fa", "otp", "code", "webmail",
    "password", "passwort",
];

pub const SHORTENERS: &[&str] = &[
    "bit.ly", "t.co", "tinyurl.com", "cutt.ly", "rb.gy", "is.gd", "goo.gl", "ow.ly", "buff.ly", "t.ly",
    "shorturl.at", "rebrand.ly", "s.id", "lnkd.in", "tiny.cc", "shorte.st", "adf.ly", "u.to", "v.gd", "qr.ae",
    "bl.ink", "short.io", "kurzelinks.de", "t1p.de", "ogy.de", "1url.de", "shorturl.com", "surl.li", "clck.ru",
    "vk.cc",
];

/// One finding: `key` (translated as `f.<key>` / `pat.<key>`), level and parameters.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Finding {
    pub key: String,
    pub stufe: String,
    #[serde(default)]
    pub p: Map<String, Value>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub muster: bool,
    /// Translated texts (only present when they came from the server).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub titel: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

impl Finding {
    pub fn new(key: &str, stufe: &str, p: Value) -> Self {
        let p = match p {
            Value::Object(m) => m,
            _ => Map::new(),
        };
        Finding { key: key.into(), stufe: stufe.into(), p, muster: false, titel: None, text: None }
    }
}

/// `heuristics(url)` of `src/checks.js`. `raw` is the URL string as received (its length and
/// `@` are inspected like in JavaScript); returns `None` if it does not parse.
pub fn heuristics(raw: &str) -> Option<(Vec<Finding>, HostInfo)> {
    let u = Url::parse(raw).ok()?;
    Some((heuristics_url(raw, &u), host_info(&u)))
}

pub fn heuristics_url(raw: &str, u: &Url) -> Vec<Finding> {
    let mut f = Vec::new();
    let h = host_info(u);

    if h.is_ip {
        f.push(Finding::new("ip-host", "rot", json!({})));
    }
    if !u.username().is_empty() || u.password().is_some() || raw.contains('@') {
        f.push(Finding::new("at-sign", "rot", json!({})));
    }
    if h.is_idn {
        f.push(Finding::new("idn", "gelb", json!({ "host": h.unicode_host })));
    }
    if u.scheme() == "http" {
        f.push(Finding::new("http", "gelb", json!({})));
    }
    if !h.port.is_empty() && h.port != "80" && h.port != "443" {
        f.push(Finding::new("port", "gelb", json!({ "port": h.port })));
    }

    let tld_key = h.tld.to_lowercase();
    let tld_tail = tld_key.rsplit('.').next().unwrap_or("").to_string();
    if RISKY_TLDS.contains(&tld_key.as_str()) || RISKY_TLDS.contains(&tld_tail.as_str()) {
        f.push(Finding::new("tld", "gelb", json!({ "tld": h.tld })));
    }

    let dom_lower = h.domain.to_lowercase();
    let strip = |s: &str| s.chars().filter(|c| *c != '-' && *c != '.').collect::<String>();
    if !BRAND_HOMES.contains(&dom_lower.as_str()) {
        let dom_stripped = strip(&dom_lower);
        let sub_stripped = strip(&h.sub);
        let first_label = dom_lower.split('.').next().unwrap_or("");
        for b in BRANDS {
            let bb = strip(b);
            let in_sub = !h.sub.is_empty() && sub_stripped.contains(&bb);
            let in_domain = dom_stripped.contains(&bb);
            let is_brand_domain = dom_lower == format!("{b}.{}", h.tld) || dom_lower.starts_with(&format!("{b}."));
            if in_sub && !is_brand_domain {
                f.push(Finding::new("brand-sub", "rot", json!({ "brand": b, "domain": h.domain })));
                break;
            }
            if in_domain && !is_brand_domain && first_label != *b {
                f.push(Finding::new("brand-typo", "rot", json!({ "brand": b, "domain": h.domain })));
                break;
            }
        }
    }

    if h.sub_count >= 3 {
        f.push(Finding::new("subdomains", "gelb", json!({})));
    }

    let path_low = percent_decode_str(&h.path).decode_utf8_lossy().to_lowercase();
    let mut hits: Vec<&str> = Vec::new();
    for w in LURE_WORDS {
        if (path_low.contains(w) || dom_lower.contains(w)) && !hits.contains(w) {
            hits.push(w);
        }
    }
    if !hits.is_empty() {
        let words = hits.iter().take(4).cloned().collect::<Vec<_>>().join(", ");
        let stufe = if hits.len() >= 2 { "gelb" } else { "info" };
        f.push(Finding::new("lure", stufe, json!({ "words": words })));
    }

    if SHORTENERS.contains(&h.domain.as_str()) {
        f.push(Finding::new("shortener", "info", json!({})));
    }
    // JavaScript's String.length counts UTF-16 code units.
    if raw.encode_utf16().count() > 120 {
        f.push(Finding::new("long", "info", json!({})));
    }
    f
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Verdict {
    pub stufe: String,
    #[serde(rename = "kurzKey")]
    pub kurz_key: String,
    #[serde(rename = "ratKey")]
    pub rat_key: String,
    pub score: i32,
    pub findings: Vec<Finding>,
}

fn weight(stufe: &str) -> i32 {
    match stufe {
        "rot" => 10,
        "gelb" => 3,
        "gruen" => -2,
        _ => 0,
    }
}

fn any_in(hay: &str, words: &[&str]) -> bool {
    words.iter().any(|w| hay.contains(w))
}

/// `verdict(findings, { url })` of `src/verdict.js`.
pub fn verdict(findings: &[Finding], url: &str) -> Verdict {
    let has = |k: &str| findings.iter().any(|f| f.key == k);
    let low = url.to_lowercase();
    let mut all: Vec<Finding> = Vec::new();
    if has("age-fresh") && any_in(&low, &["vot", "abstimm", "poll", "contest", "wettbewerb", "dance", "tanz", "ballet"]) {
        all.push(pattern("vote"));
    }
    if (has("brand-sub") || has("brand-typo") || has("age-fresh"))
        && any_in(&low, &["dhl", "dpd", "hermes", "ups", "fedex", "paket", "zustell", "zoll", "customs", "post"])
    {
        all.push(pattern("parcel"));
    }
    if (has("brand-sub") || has("brand-typo"))
        && any_in(
            &low,
            &["bank", "sparkasse", "paypal", "volksbank", "postbank", "dkb", "n26", "ing", "comdirect", "klarna", "tan", "login", "konto"],
        )
    {
        all.push(pattern("bank"));
    }
    all.extend(findings.iter().cloned());
    let score: i32 = all.iter().map(|f| weight(&f.stufe)).sum();
    let rot = all.iter().filter(|f| f.stufe == "rot").count();
    let gelb = all.iter().filter(|f| f.stufe == "gelb").count();
    let (stufe, kurz, rat) = if rot >= 1 || score >= 10 {
        ("rot", if rot >= 2 { "v.rot.multi" } else { "v.rot.one" }, "v.rot.rat")
    } else if gelb >= 2 || score >= 5 {
        ("gelb", "v.gelb.multi", "v.gelb.multi.rat")
    } else if gelb == 1 || score >= 2 {
        ("gelb", "v.gelb.one", "v.gelb.one.rat")
    } else {
        ("gruen", "v.gruen", "v.gruen.rat")
    };
    all.sort_by_key(|f| level_order(&f.stufe));
    Verdict { stufe: stufe.into(), kurz_key: kurz.into(), rat_key: rat.into(), score, findings: all }
}

fn pattern(key: &str) -> Finding {
    let mut f = Finding::new(key, "rot", json!({}));
    f.muster = true;
    f
}

/// Sort order of finding levels (worst first).
pub fn level_order(stufe: &str) -> u8 {
    match stufe {
        "rot" => 0,
        "gelb" => 1,
        "info" => 2,
        "gruen" => 3,
        _ => 4,
    }
}

/// Rank of a verdict level (higher = worse).
pub fn severity(stufe: &str) -> u8 {
    match stufe {
        "rot" => 3,
        "gelb" => 2,
        "gruen" => 1,
        _ => 0,
    }
}

/// Local assessment of a URL: findings plus verdict.
pub fn assess(raw: &str) -> Option<Verdict> {
    let (f, _) = heuristics(raw)?;
    Some(verdict(&f, raw))
}
