//! Settings (`settings.json`), created on first run with a random installation id.

use crate::forward::ForwardTarget;
use crate::link::Scope;
use crate::store::{now_secs, read_json, write_json, Paths};
use serde::{Deserialize, Serialize};
use std::io;

pub const LANGS: &[&str] = &["de", "en", "tr", "pl", "ru", "es", "fr", "it"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub lang: String,
    pub server: String,
    pub scope: Scope,
    pub forward: Option<ForwardTarget>,
    pub allowlist: Vec<String>,
    /// Unix seconds until which checking is paused (links open directly).
    pub paused_until: u64,
    pub update_check: bool,
    pub install_id: String,
    pub setup_done: bool,
    pub autostart: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            lang: "en".into(),
            server: String::new(),
            scope: Scope::Url,
            forward: None,
            allowlist: Vec::new(),
            paused_until: 0,
            update_check: true,
            install_id: String::new(),
            setup_done: false,
            autostart: true,
        }
    }
}

/// 128 random bits as 32 lowercase hex digits.
pub fn new_install_id() -> String {
    let mut b = [0u8; 16];
    getrandom::getrandom(&mut b).expect("system random source");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn valid_install_id(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

/// Best language for a system locale such as `de_DE.UTF-8` or `pt-BR`.
pub fn lang_from_locale(locale: &str) -> String {
    let code = locale.to_ascii_lowercase().chars().take(2).collect::<String>();
    if LANGS.contains(&code.as_str()) {
        code
    } else {
        "en".into()
    }
}

impl Settings {
    /// Load, or create with defaults (`default_server` comes from the build, `lang` from the system).
    pub fn load_or_create(paths: &Paths, default_server: &str, lang: &str) -> io::Result<Settings> {
        if let Some(mut s) = read_json::<Settings>(&paths.settings()) {
            let mut dirty = false;
            if !valid_install_id(&s.install_id) {
                s.install_id = new_install_id();
                dirty = true;
            }
            if !LANGS.contains(&s.lang.as_str()) {
                s.lang = lang_from_locale(lang);
                dirty = true;
            }
            if dirty {
                s.save(paths)?;
            }
            return Ok(s);
        }
        let s = Settings {
            lang: lang_from_locale(lang),
            server: crate::link::valid_server(default_server).unwrap_or_default(),
            install_id: new_install_id(),
            ..Settings::default()
        };
        s.save(paths)?;
        Ok(s)
    }

    pub fn load(paths: &Paths) -> Option<Settings> {
        read_json(&paths.settings())
    }

    pub fn save(&self, paths: &Paths) -> io::Result<()> {
        write_json(&paths.settings(), self)
    }

    pub fn is_paused(&self) -> bool {
        self.paused_until > now_secs()
    }

    pub fn pause_for(&mut self, minutes: u64) {
        self.paused_until = now_secs() + minutes * 60;
    }

    pub fn resume(&mut self) {
        self.paused_until = 0;
    }

    pub fn reset_install_id(&mut self) {
        self.install_id = new_install_id();
    }

    pub fn add_allowed(&mut self, input: &str) -> Result<String, crate::allowlist::AddError> {
        let d = crate::allowlist::normalize_entry(input)?;
        if !self.allowlist.contains(&d) {
            self.allowlist.push(d.clone());
            self.allowlist.sort();
        }
        Ok(d)
    }

    pub fn remove_allowed(&mut self, domain: &str) {
        self.allowlist.retain(|d| d != domain);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_run_creates_id_and_persists() {
        let dir = tempfile::tempdir().unwrap();
        let p = Paths::new(dir.path());
        let s = Settings::load_or_create(&p, "https://lw.example/", "de_DE.UTF-8").unwrap();
        assert!(valid_install_id(&s.install_id));
        assert_eq!(s.lang, "de");
        assert_eq!(s.server, "https://lw.example");
        assert!(!s.setup_done);
        let again = Settings::load_or_create(&p, "https://other.example", "en").unwrap();
        assert_eq!(again.install_id, s.install_id);
        assert_eq!(again.server, "https://lw.example");
    }

    #[test]
    fn invalid_default_server_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let s = Settings::load_or_create(&Paths::new(dir.path()), "", "xx").unwrap();
        assert_eq!(s.server, "");
        assert_eq!(s.lang, "en");
    }

    #[test]
    fn pause_resume_reset() {
        let mut s = Settings::default();
        assert!(!s.is_paused());
        s.pause_for(15);
        assert!(s.is_paused());
        s.resume();
        assert!(!s.is_paused());
        s.install_id = "x".into();
        s.reset_install_id();
        assert!(valid_install_id(&s.install_id));
        let a = new_install_id();
        assert_ne!(a, new_install_id());
    }

    #[test]
    fn allowlist_editing() {
        let mut s = Settings::default();
        assert_eq!(s.add_allowed("https://Shop.Example.com/x").unwrap(), "example.com");
        s.add_allowed("example.com").unwrap();
        assert_eq!(s.allowlist, vec!["example.com"]);
        assert!(s.add_allowed("xn--bcher-kva.example").is_err());
        s.remove_allowed("example.com");
        assert!(s.allowlist.is_empty());
    }
}
