//! What arrives at the handler: web links, local HTML files, or anything else (refused).
//! Also the privacy reduction of what is sent to the server.

use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    /// An http(s) link with a host — this is what gets checked.
    Web(Url),
    /// A local HTML file (path or file:// URL): handed to the saved browser unchanged.
    LocalHtml(String),
    /// Anything else (`mailto:`, `javascript:`, custom schemes, other files): never launched.
    Refused(String),
}

const HTML_EXT: &[&str] = &[".html", ".htm", ".xhtml", ".shtml", ".xht"];

fn is_html_path(p: &str) -> bool {
    let low = p.to_ascii_lowercase();
    HTML_EXT.iter().any(|e| low.ends_with(e))
}

fn looks_like_path(s: &str) -> bool {
    let b = s.as_bytes();
    s.starts_with('/') || s.starts_with("\\\\") || (b.len() > 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/'))
}

/// Classify one command-line argument / Apple Event URL.
pub fn classify(raw: &str) -> Incoming {
    let s: String = raw.trim().chars().filter(|c| !c.is_control()).collect();
    if s.is_empty() {
        return Incoming::Refused(String::new());
    }
    if looks_like_path(&s) {
        return if is_html_path(&s) { Incoming::LocalHtml(s) } else { Incoming::Refused("file".into()) };
    }
    match Url::parse(&s) {
        Ok(u) => match u.scheme() {
            "http" | "https" if u.host_str().map(|h| !h.is_empty()).unwrap_or(false) => Incoming::Web(u),
            "file" if is_html_path(u.path()) => Incoming::LocalHtml(s),
            other => Incoming::Refused(other.to_string()),
        },
        Err(_) => {
            // "www.example.com" without a scheme (some apps pass that): treat as https.
            if s.starts_with("www.") && !s.contains(char::is_whitespace) {
                if let Ok(u) = Url::parse(&format!("https://{s}")) {
                    return Incoming::Web(u);
                }
            }
            Incoming::Refused(s.split(':').next().unwrap_or("").chars().take(20).collect())
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    /// `scheme://host[:port]/path` — query string and fragment removed.
    #[default]
    Url,
    /// `https://host/` only.
    Domain,
}

impl Scope {
    pub fn as_str(&self) -> &'static str {
        match self {
            Scope::Url => "url",
            Scope::Domain => "domain",
        }
    }
    pub fn parse(s: &str) -> Scope {
        if s == "domain" {
            Scope::Domain
        } else {
            Scope::Url
        }
    }
}

/// What the server receives for a link (docs/DESKTOP.md section 6).
pub fn reduce(u: &Url, scope: Scope) -> String {
    let host = u.host_str().unwrap_or("");
    match scope {
        Scope::Domain => format!("https://{host}/"),
        Scope::Url => {
            let port = u.port().map(|p| format!(":{p}")).unwrap_or_default();
            format!("{}://{host}{port}{}", u.scheme(), u.path())
        }
    }
}

/// Server address validation: https, or http only on loopback / private networks.
pub fn valid_server(s: &str) -> Option<String> {
    let u = Url::parse(s.trim()).ok()?;
    let host = u.host()?;
    let ok = match u.scheme() {
        "https" => true,
        "http" => match host {
            url::Host::Ipv4(ip) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
            url::Host::Ipv6(ip) => ip.is_loopback() || (ip.segments()[0] & 0xfe00) == 0xfc00,
            url::Host::Domain(d) => d == "localhost" || d.ends_with(".local") || d.ends_with(".lan") || d.ends_with(".home.arpa"),
        },
        _ => false,
    };
    if !ok || u.query().is_some() || !u.username().is_empty() {
        return None;
    }
    let mut out = u.to_string();
    while out.ends_with('/') {
        out.pop();
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classification() {
        assert!(matches!(classify("https://example.com/a?b=1#c"), Incoming::Web(_)));
        assert!(matches!(classify("  HTTP://Example.COM  "), Incoming::Web(u) if u.as_str() == "http://example.com/"));
        assert!(matches!(classify("www.example.com/x"), Incoming::Web(_)));
        assert_eq!(classify("mailto:a@example.com"), Incoming::Refused("mailto".into()));
        assert_eq!(classify("javascript:alert(1)"), Incoming::Refused("javascript".into()));
        assert_eq!(classify("data:text/html,hi"), Incoming::Refused("data".into()));
        assert_eq!(classify("tel:+100"), Incoming::Refused("tel".into()));
        assert_eq!(classify("ms-settings:defaultapps"), Incoming::Refused("ms-settings".into()));
        assert_eq!(classify("http:///nohost"), Incoming::Web(Url::parse("http://nohost/").unwrap()));
        assert!(matches!(classify("file:///home/u/page.html"), Incoming::LocalHtml(_)));
        assert!(matches!(classify("C:\\Users\\u\\Page.HTM"), Incoming::LocalHtml(_)));
        assert!(matches!(classify("/home/u/x.html"), Incoming::LocalHtml(_)));
        assert!(matches!(classify("/home/u/x.exe"), Incoming::Refused(_)));
        assert!(matches!(classify("file:///etc/passwd"), Incoming::Refused(_)));
        assert!(matches!(classify(""), Incoming::Refused(_)));
    }

    #[test]
    fn privacy_reduction() {
        let u = Url::parse("https://user:pw@shop.example.com:8443/a/b?token=1#frag").unwrap();
        assert_eq!(reduce(&u, Scope::Url), "https://shop.example.com:8443/a/b");
        assert_eq!(reduce(&u, Scope::Domain), "https://shop.example.com/");
        let u = Url::parse("http://example.com/?mail=a@b.example").unwrap();
        assert_eq!(reduce(&u, Scope::Url), "http://example.com/");
    }

    #[test]
    fn servers() {
        assert_eq!(valid_server("https://lw.example/").as_deref(), Some("https://lw.example"));
        assert_eq!(valid_server("http://127.0.0.1:8787").as_deref(), Some("http://127.0.0.1:8787"));
        assert_eq!(valid_server("http://192.168.1.5:8787/").as_deref(), Some("http://192.168.1.5:8787"));
        assert!(valid_server("http://lw.example").is_none());
        assert!(valid_server("ftp://lw.example").is_none());
        assert!(valid_server("https://a@lw.example").is_none());
        assert!(valid_server("nonsense").is_none());
    }
}
