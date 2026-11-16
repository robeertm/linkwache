//! Allowlist: domains the user approved plus a short built-in list of very large sites.
//! Matching is on the registrable domain only and never on look-alikes (IDN/punycode,
//! digit-for-letter swaps, hyphenated brand names, IP hosts, user info, odd ports).

use crate::hostinfo::{host_info, split_host};
use url::{Host, Url};

/// Very large sites (search, webmail/office, video, encyclopedias). Kept short on purpose.
pub const BUILTIN: &[&str] = &[
    "google.com", "google.de", "youtube.com", "wikipedia.org", "wikimedia.org", "bing.com", "duckduckgo.com",
    "ecosia.org", "microsoft.com", "office.com", "live.com", "outlook.com", "microsoftonline.com", "apple.com",
    "icloud.com", "gmx.net", "gmx.de", "web.de", "t-online.de", "yahoo.com", "proton.me", "mozilla.org",
    "amazon.de", "amazon.com", "tagesschau.de",
];

/// Hosts on built-in domains that serve content anyone can publish (forms, sites, file
/// shares). They are always checked normally.
pub const BUILTIN_USER_CONTENT: &[&str] = &[
    "sites.google.com", "docs.google.com", "drive.google.com", "forms.office.com", "onedrive.live.com",
    "storage.live.com", "1drv.ms", "web.archive.org",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AddError {
    Invalid,
    Idn,
    Ip,
}

/// Normalise a user entry (`https://Shop.Example.com/x` → `example.com`).
pub fn normalize_entry(input: &str) -> Result<String, AddError> {
    let s = input.trim().trim_end_matches('.').to_lowercase();
    if s.is_empty() {
        return Err(AddError::Invalid);
    }
    let with_scheme = if s.contains("://") { s.clone() } else { format!("https://{s}") };
    let u = Url::parse(&with_scheme).map_err(|_| AddError::Invalid)?;
    match u.host() {
        Some(Host::Domain(d)) => {
            if d.contains("xn--") || !d.is_ascii() {
                return Err(AddError::Idn);
            }
            if !d.contains('.') {
                return Err(AddError::Invalid);
            }
            let (domain, suffix, _) = split_host(d);
            if domain == suffix {
                return Err(AddError::Invalid);
            }
            Ok(domain)
        }
        Some(_) => Err(AddError::Ip),
        None => Err(AddError::Invalid),
    }
}

/// Which allowlist entry a link matches, if any (`user` first, then built-in).
pub fn matches(user: &[String], u: &Url) -> Option<String> {
    let host = match u.host() {
        Some(Host::Domain(d)) => d.to_ascii_lowercase(),
        _ => return None,
    };
    if host.contains("xn--") || !host.is_ascii() {
        return None;
    }
    if !u.username().is_empty() || u.password().is_some() || u.port().is_some() {
        return None;
    }
    let domain = host_info(u).domain;
    if let Some(e) = user.iter().find(|e| **e == domain) {
        return Some(e.clone());
    }
    if BUILTIN_USER_CONTENT.contains(&host.as_str()) {
        return None;
    }
    BUILTIN.iter().find(|e| **e == domain).map(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(user: &[&str], url: &str) -> Option<String> {
        let user: Vec<String> = user.iter().map(|s| s.to_string()).collect();
        matches(&user, &Url::parse(url).unwrap())
    }

    #[test]
    fn registrable_domain_matches() {
        assert_eq!(m(&[], "https://accounts.google.com/x").as_deref(), Some("google.com"));
        assert_eq!(m(&[], "https://de.wikipedia.org/wiki/A").as_deref(), Some("wikipedia.org"));
        assert_eq!(m(&["example.com"], "https://shop.example.com/").as_deref(), Some("example.com"));
    }

    #[test]
    fn look_alikes_never_match() {
        for url in [
            "https://g00gle.com/",
            "https://goog1e.com/",
            "https://google-login.com/",
            "https://google.com-login.example/",
            "https://google.com.evil.example/",
            "https://xn--ggle-0nda.com/",
            "https://gооgle.com/",
            "https://wikipedia.org.example/",
            "https://user@google.com/",
            "https://google.com:8443/",
            "https://142.250.0.1/",
            "https://notgoogle.com/",
        ] {
            assert_eq!(m(&[], url), None, "{url}");
        }
        assert_eq!(m(&["example.com"], "https://examp1e.com/"), None);
        assert_eq!(m(&["example.com"], "https://example-com.example/"), None);
        assert_eq!(m(&["example.com"], "https://example.com.evil.example/"), None);
    }

    #[test]
    fn user_content_hosts_are_checked() {
        assert_eq!(m(&[], "https://docs.google.com/forms/d/x"), None);
        assert_eq!(m(&[], "https://sites.google.com/view/x"), None);
        // But the user may approve a whole domain explicitly.
        assert_eq!(m(&["google.com"], "https://docs.google.com/x").as_deref(), Some("google.com"));
    }

    #[test]
    fn entries_are_normalised() {
        assert_eq!(normalize_entry("https://Shop.Example.co.uk/path").unwrap(), "example.co.uk");
        assert_eq!(normalize_entry("example.com").unwrap(), "example.com");
        assert_eq!(normalize_entry("xn--bcher-kva.example"), Err(AddError::Idn));
        assert_eq!(normalize_entry("bücher.example"), Err(AddError::Idn));
        assert_eq!(normalize_entry("192.0.2.1"), Err(AddError::Ip));
        assert_eq!(normalize_entry("co.uk"), Err(AddError::Invalid));
        assert_eq!(normalize_entry("localhost"), Err(AddError::Invalid));
        assert_eq!(normalize_entry(""), Err(AddError::Invalid));
    }
}
