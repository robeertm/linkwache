//! Known link wrappers (mail safety links, social networks, search engines) hide the real
//! target. They are unwrapped locally before the check (docs/DESKTOP.md section 3), so the
//! real target is judged. Vectors: `test/vectors/redirectors.json`.

use crate::hostinfo::split_host;
use url::Url;

pub const MAX_LEVELS: usize = 3;

/// The query parameter that carries the target, if `u` is a known wrapper.
fn wrapper_param(u: &Url) -> Option<&'static [&'static str]> {
    let host = u.host_str()?.to_ascii_lowercase();
    let path = u.path();
    if host.ends_with(".safelinks.protection.outlook.com") {
        return Some(&["url"]);
    }
    let (domain, _suffix, sub) = split_host(&host);
    if domain.split('.').next() == Some("google") && (sub.is_empty() || sub == "www") && path == "/url" {
        return Some(&["q", "url"]);
    }
    match (host.as_str(), path) {
        ("l.facebook.com" | "lm.facebook.com", "/l.php") => Some(&["u"]),
        ("l.instagram.com", "/") => Some(&["u"]),
        ("www.youtube.com" | "youtube.com" | "m.youtube.com", "/redirect") => Some(&["q"]),
        ("slack-redir.net", "/link") => Some(&["url"]),
        ("www.linkedin.com" | "linkedin.com", "/safety/go") => Some(&["url"]),
        _ => None,
    }
}

/// One unwrapping step: the embedded http(s) target, or `None`.
pub fn unwrap_once(u: &Url) -> Option<Url> {
    let names = wrapper_param(u)?;
    for name in names {
        if let Some((_, v)) = u.query_pairs().find(|(k, _)| k == name) {
            let target = Url::parse(v.trim()).ok()?;
            if matches!(target.scheme(), "http" | "https") && target.host_str().is_some() {
                return Some(target);
            }
            return None;
        }
    }
    None
}

/// The real target behind (up to three nested) wrappers, or `None` if `raw` is no wrapper.
pub fn unwrap(raw: &str) -> Option<String> {
    let mut cur = Url::parse(raw).ok()?;
    let mut changed = false;
    for _ in 0..MAX_LEVELS {
        match unwrap_once(&cur) {
            Some(next) => {
                cur = next;
                changed = true;
            }
            None => break,
        }
    }
    changed.then(|| cur.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn depth_is_limited() {
        let mut s = "https://example.com/end".to_string();
        for _ in 0..5 {
            s = format!("https://www.google.com/url?q={}", url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>());
        }
        let out = unwrap(&s).unwrap();
        assert!(out.starts_with("https://www.google.com/url?q="), "{out}");
    }
}
