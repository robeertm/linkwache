//! Device-local cache of server verdicts per registrable domain + path hash.
//! Green for 6 h, amber and red for 24 h; the server may send `cacheTtl`.

use crate::hostinfo::host_info;
use crate::link::Scope;
use crate::store::{read_json, write_json};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io;
use std::path::Path;
use url::Url;

pub const TTL_GREEN: u64 = 6 * 3600;
pub const TTL_WARN: u64 = 24 * 3600;
pub const TTL_MAX: u64 = 48 * 3600;
pub const MAX_ENTRIES: usize = 2000;
/// Rules version of the server (field `rules` of a v1 answer, 0.5.3 = 2). Cached answers of older rules
/// are never used: a fixed false alarm must not live on in the cache.
pub const RULES: u64 = 2;

/// Rules version of a cached server answer; answers before 0.5.3 carry none (= 1).
pub fn rules_of(v: &Value) -> u64 {
    v.get("rules").and_then(|r| r.as_u64()).unwrap_or(1)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub stufe: String,
    pub expires: u64,
    /// The server's v1 response.
    pub result: Value,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Cache {
    pub entries: HashMap<String, Entry>,
    /// Highest rules version the server has answered with.
    #[serde(default)]
    pub rules: u64,
}

/// `domain|sha256(host:port/path)` — the query string never takes part (it is never sent).
pub fn key(u: &Url, scope: Scope) -> String {
    let h = host_info(u);
    let what = match scope {
        Scope::Url => format!("{}://{}:{}{}", u.scheme(), h.host, h.port, u.path()),
        Scope::Domain => format!("domain:{}", h.host),
    };
    let digest = Sha256::digest(what.as_bytes());
    let hex: String = digest.iter().take(12).map(|b| format!("{b:02x}")).collect();
    format!("{}|{hex}", h.domain)
}

/// Lifetime of an entry: the server's `cacheTtl` if given (capped), else by level.
pub fn ttl(stufe: &str, server_ttl: Option<u64>) -> u64 {
    match server_ttl {
        Some(t) => t.min(TTL_MAX),
        None if stufe == "gruen" => TTL_GREEN,
        None => TTL_WARN,
    }
}

impl Cache {
    pub fn load(path: &Path) -> Cache {
        let mut c: Cache = read_json(path).unwrap_or_default();
        let min = c.min_rules();
        c.entries.retain(|_, e| rules_of(&e.result) >= min);
        c
    }

    fn min_rules(&self) -> u64 {
        RULES.max(self.rules)
    }

    /// The server answered with rules version `r`: drop every entry of older rules.
    pub fn note_rules(&mut self, r: u64) {
        if r > self.rules {
            self.rules = r;
            let min = self.min_rules();
            self.entries.retain(|_, e| rules_of(&e.result) >= min);
        }
    }

    pub fn save(&mut self, path: &Path, now: u64) -> io::Result<()> {
        self.prune(now);
        write_json(path, self)
    }

    pub fn get(&self, key: &str, now: u64) -> Option<&Entry> {
        let min = self.min_rules();
        self.entries.get(key).filter(|e| e.expires > now && rules_of(&e.result) >= min)
    }

    pub fn put(&mut self, key: String, stufe: &str, result: Value, server_ttl: Option<u64>, now: u64) {
        let t = ttl(stufe, server_ttl);
        if t == 0 {
            self.entries.remove(&key);
            return;
        }
        self.entries.insert(key, Entry { stufe: stufe.into(), expires: now + t, result });
    }

    pub fn prune(&mut self, now: u64) {
        self.entries.retain(|_, e| e.expires > now);
        if self.entries.len() > MAX_ENTRIES {
            let mut v: Vec<(String, u64)> = self.entries.iter().map(|(k, e)| (k.clone(), e.expires)).collect();
            v.sort_by_key(|(_, exp)| *exp);
            let drop = v.len() - MAX_ENTRIES;
            for (k, _) in v.into_iter().take(drop) {
                self.entries.remove(&k);
            }
        }
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn keys_ignore_query_but_not_path() {
        let a = key(&u("https://shop.example.com/a?x=1"), Scope::Url);
        let b = key(&u("https://shop.example.com/a?x=2#f"), Scope::Url);
        let c = key(&u("https://shop.example.com/b"), Scope::Url);
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert!(a.starts_with("example.com|"));
        assert_eq!(key(&u("https://shop.example.com/a"), Scope::Domain), key(&u("https://shop.example.com/b"), Scope::Domain));
        assert_ne!(key(&u("http://example.com/"), Scope::Url), key(&u("https://example.com/"), Scope::Url));
    }

    #[test]
    fn lifetimes() {
        assert_eq!(ttl("gruen", None), 6 * 3600);
        assert_eq!(ttl("gelb", None), 24 * 3600);
        assert_eq!(ttl("rot", None), 24 * 3600);
        assert_eq!(ttl("gruen", Some(60)), 60);
        assert_eq!(ttl("gruen", Some(10_000_000)), TTL_MAX);
    }

    #[test]
    fn expiry_and_persistence() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.json");
        let mut c = Cache::default();
        c.put("k1".into(), "gruen", json!({"stufe":"gruen","rules":RULES}), None, 1000);
        c.put("k2".into(), "rot", json!({"stufe":"rot","rules":RULES}), None, 1000);
        c.put("k3".into(), "gelb", json!({}), Some(0), 1000);
        assert!(c.get("k1", 1000 + TTL_GREEN - 1).is_some());
        assert!(c.get("k1", 1000 + TTL_GREEN).is_none());
        assert!(c.get("k2", 1000 + TTL_GREEN + 1).is_some());
        assert!(c.get("k3", 1000).is_none());
        c.save(&path, 1000 + TTL_GREEN + 1).unwrap();
        let back = Cache::load(&path);
        assert!(back.entries.contains_key("k2"));
        assert!(!back.entries.contains_key("k1"));
    }

    #[test]
    fn size_is_bounded() {
        let mut c = Cache::default();
        for i in 0..(MAX_ENTRIES + 50) {
            c.put(format!("k{i}"), "gruen", json!({}), Some(100 + i as u64), 0);
        }
        c.prune(0);
        assert_eq!(c.entries.len(), MAX_ENTRIES);
        assert!(!c.entries.contains_key("k0"));
        assert!(c.entries.contains_key(&format!("k{}", MAX_ENTRIES + 49)));
    }

    #[test]
    fn answers_of_older_rules_are_never_used() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.json");
        let mut c = Cache::default();
        // as 0.5.1 cached it: no rules field (a false red that was fixed on the server)
        c.put("old".into(), "rot", json!({"stufe":"rot"}), None, 1000);
        c.put("new".into(), "gruen", json!({"stufe":"gruen","rules":RULES}), None, 1000);
        assert!(c.get("old", 1001).is_none(), "pre-0.5.3 answer ignored");
        assert!(c.get("new", 1001).is_some());
        c.save(&path, 1001).unwrap();
        let mut l = Cache::load(&path);
        assert!(!l.entries.contains_key("old"), "dropped on load");
        // the server moves to newer rules: everything older goes
        l.note_rules(RULES + 1);
        assert!(l.get("new", 1001).is_none());
        assert!(l.entries.is_empty());
        l.put("n3".into(), "gruen", json!({"stufe":"gruen","rules":RULES + 1}), None, 1001);
        l.save(&path, 1002).unwrap();
        let again = Cache::load(&path);
        assert_eq!(again.rules, RULES + 1);
        assert!(again.get("n3", 1003).is_some());
    }
}
