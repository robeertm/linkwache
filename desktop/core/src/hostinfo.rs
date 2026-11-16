//! Host decomposition, a port of `hostInfo` in `src/util.js` (tldts with ICANN rules only).

use url::{Host, Url};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostInfo {
    /// Lowercase host as the URL parser serialises it (punycode, IPv6 in brackets).
    pub host: String,
    /// Registrable domain (`accounts.example.co.uk` → `example.co.uk`); the host itself for IPs
    /// and single labels.
    pub domain: String,
    /// Public suffix (ICANN section of the public suffix list); last label when unknown.
    pub tld: String,
    /// Everything left of the registrable domain.
    pub sub: String,
    pub is_ip: bool,
    pub sub_count: usize,
    pub is_idn: bool,
    pub unicode_host: String,
    /// Explicit non-default port, empty otherwise.
    pub port: String,
    /// Path plus `?query` (like `pathname + search`).
    pub path: String,
}

/// ICANN public suffix of a host name. Private-section rules (e.g. hosting platforms) are
/// skipped, exactly like tldts with `allowPrivateDomains: false`.
pub fn icann_suffix(host: &str) -> String {
    let mut cur = host.trim_end_matches('.').to_string();
    loop {
        let found = psl::suffix(cur.as_bytes());
        match found {
            Some(s) => {
                let text = String::from_utf8_lossy(s.as_bytes()).to_string();
                if s.typ() == Some(psl::Type::Private) {
                    match text.split_once('.') {
                        Some((_, rest)) if !rest.is_empty() => {
                            cur = rest.to_string();
                            continue;
                        }
                        _ => return last_label(host),
                    }
                }
                return text;
            }
            None => return last_label(host),
        }
    }
}

fn last_label(host: &str) -> String {
    host.trim_end_matches('.').rsplit('.').next().unwrap_or(host).to_string()
}

/// Registrable domain and subdomain of a (non-IP) host.
pub fn split_host(host: &str) -> (String, String, String) {
    let h = host.trim_end_matches('.');
    let suffix = icann_suffix(h);
    if h.len() <= suffix.len() || !h.ends_with(&format!(".{suffix}")) {
        // The host is a suffix itself (or a single label): tldts reports no domain.
        return (h.to_string(), suffix, String::new());
    }
    let left = &h[..h.len() - suffix.len() - 1];
    let (sub, label) = match left.rsplit_once('.') {
        Some((s, l)) => (s.to_string(), l),
        None => (String::new(), left),
    };
    (format!("{label}.{suffix}"), suffix, sub)
}

pub fn to_unicode(host: &str) -> String {
    let (u, res) = idna::domain_to_unicode(host);
    if res.is_err() {
        host.to_string()
    } else {
        u
    }
}

pub fn host_info(u: &Url) -> HostInfo {
    let host = u.host_str().unwrap_or("").to_lowercase();
    let is_ip = matches!(u.host(), Some(Host::Ipv4(_)) | Some(Host::Ipv6(_)));
    let (domain, tld, sub) = if is_ip {
        let last = host.rsplit('.').next().unwrap_or(&host).to_string();
        (host.clone(), last, String::new())
    } else {
        split_host(&host)
    };
    let unicode_host = if is_ip { host.clone() } else { to_unicode(&host) };
    let is_idn = host.contains("xn--") || !unicode_host.is_ascii();
    let sub_count = if sub.is_empty() { 0 } else { sub.split('.').count() };
    let mut path = u.path().to_string();
    if let Some(q) = u.query() {
        if !q.is_empty() {
            path.push('?');
            path.push_str(q);
        }
    }
    HostInfo {
        host,
        domain,
        tld,
        sub,
        is_ip,
        sub_count,
        is_idn,
        unicode_host,
        port: u.port().map(|p| p.to_string()).unwrap_or_default(),
        path,
    }
}

/// Registrable domain of a URL string, if it parses.
pub fn registrable(url: &str) -> Option<String> {
    Url::parse(url).ok().map(|u| host_info(&u).domain)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hi(s: &str) -> HostInfo {
        host_info(&Url::parse(s).unwrap())
    }

    #[test]
    fn registrable_domains() {
        let h = hi("https://accounts.example.co.uk/x?y=1");
        assert_eq!(h.domain, "example.co.uk");
        assert_eq!(h.tld, "co.uk");
        assert_eq!(h.sub, "accounts");
        assert_eq!(h.path, "/x?y=1");
        let h = hi("https://a.b.c.d.example.com/");
        assert_eq!(h.sub_count, 4);
        let h = hi("https://paypal.com.secure-login.example/");
        assert_eq!(h.domain, "secure-login.example");
        assert_eq!(h.tld, "example");
        assert_eq!(h.sub, "paypal.com");
    }

    #[test]
    fn private_suffixes_are_ignored() {
        // github.io is a private-section rule; tldts (allowPrivateDomains: false) uses "io".
        let h = hi("https://user.github.io/");
        assert_eq!(h.domain, "github.io");
        assert_eq!(h.tld, "io");
        assert_eq!(h.sub, "user");
    }

    #[test]
    fn ips_and_idn() {
        let h = hi("https://192.0.2.10/login");
        assert!(h.is_ip);
        assert_eq!(h.domain, "192.0.2.10");
        let h = hi("https://[2001:db8::1]/");
        assert!(h.is_ip);
        let h = hi("https://xn--pypal-4ve.com/");
        assert!(h.is_idn);
        assert_ne!(h.unicode_host, h.host);
        let h = hi("https://bücher.example/");
        assert!(h.is_idn);
        assert!(h.host.starts_with("xn--"));
    }

    #[test]
    fn ports() {
        assert_eq!(hi("https://example.com:443/").port, "");
        assert_eq!(hi("https://example.com:8443/").port, "8443");
    }
}
