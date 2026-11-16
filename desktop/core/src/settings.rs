//! Settings (`settings.json`), created on first run with a random installation id.

use crate::forward::ForwardTarget;
use crate::link::Scope;
use crate::store::{now_secs, read_json, write_json, Paths};
use serde::{Deserialize, Serialize};
use std::io;

pub const LANGS: &[&str] = &["de", "en", "tr", "pl", "ru", "es", "fr", "it"];

/// The server address built into this release plus earlier built-in addresses that installations
/// still following the preset should move away from. Both come from the build (repository
/// variables in CI), never from the source, so the public repository carries no hostname.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Preset {
    /// Normalized preset address; empty when the build has none.
    pub server: String,
    /// Normalized earlier presets (installations from releases that did not record the preset yet).
    pub migrate_from: Vec<String>,
}

impl Preset {
    /// `migrate_from`: earlier preset addresses separated by commas, semicolons or whitespace.
    pub fn new(server: &str, migrate_from: &str) -> Preset {
        let server = crate::link::valid_server(server).unwrap_or_default();
        let mut list: Vec<String> = Vec::new();
        for item in migrate_from.split(|c: char| c == ',' || c == ';' || c.is_whitespace()) {
            if let Some(v) = crate::link::valid_server(item) {
                if v != server && !list.contains(&v) {
                    list.push(v);
                }
            }
        }
        Preset { server, migrate_from: list }
    }

    /// Only a server address (tests, the native-messaging fallback).
    pub fn server_only(server: &str) -> Preset {
        Preset::new(server, "")
    }
}

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
    /// The built-in preset that `server` was taken from; empty when the user chose the address.
    /// Installations following the preset move along when a later release ships another one.
    pub server_preset: String,
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
            server_preset: String::new(),
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
    /// Load, or create with defaults (`preset` comes from the build, `lang` from the system).
    /// An installation that still follows the built-in address moves to the current preset.
    pub fn load_or_create(paths: &Paths, preset: &Preset, lang: &str) -> io::Result<Settings> {
        if let Some(mut s) = read_json::<Settings>(&paths.settings()) {
            let mut dirty = s.apply_preset(preset);
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
            server: preset.server.clone(),
            server_preset: preset.server.clone(),
            install_id: new_install_id(),
            ..Settings::default()
        };
        s.save(paths)?;
        Ok(s)
    }

    /// Does the stored address still follow the built-in preset (and may therefore move)?
    /// Yes when it is empty, when it equals the preset it was taken from, when it equals the
    /// current preset, or when it is one of the earlier presets listed in the build. An address
    /// the user entered never matches and stays untouched.
    pub fn follows_preset(&self, preset: &Preset) -> bool {
        let Some(cur) = crate::link::valid_server(&self.server) else {
            return true;
        };
        (!self.server_preset.is_empty() && crate::link::valid_server(&self.server_preset).as_deref() == Some(cur.as_str()))
            || (!preset.server.is_empty() && cur == preset.server)
            || preset.migrate_from.contains(&cur)
    }

    /// Move an installation that follows the preset to the current preset. Returns true when
    /// something changed. An empty preset changes nothing (the address in use stays).
    pub fn apply_preset(&mut self, preset: &Preset) -> bool {
        if self.follows_preset(preset) {
            if preset.server.is_empty() || (self.server == preset.server && self.server_preset == preset.server) {
                return false;
            }
            self.server = preset.server.clone();
            self.server_preset = preset.server.clone();
            return true;
        }
        if !self.server_preset.is_empty() {
            self.server_preset.clear();
            return true;
        }
        false
    }

    /// Set an address chosen by the user (settings, setup assistant, command line). Choosing the
    /// current preset keeps following it; any other address is the user's own and never moves.
    pub fn set_server(&mut self, server: String, preset: &Preset) {
        self.server_preset = if !preset.server.is_empty() && server == preset.server { server.clone() } else { String::new() };
        self.server = server;
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
        let s = Settings::load_or_create(&p, &Preset::server_only("https://lw.example/"), "de_DE.UTF-8").unwrap();
        assert!(valid_install_id(&s.install_id));
        assert_eq!(s.lang, "de");
        assert_eq!(s.server, "https://lw.example");
        assert_eq!(s.server_preset, "https://lw.example");
        assert!(!s.setup_done);
        let again = Settings::load_or_create(&p, &Preset::server_only("https://lw.example"), "en").unwrap();
        assert_eq!(again.install_id, s.install_id);
        assert_eq!(again.server, "https://lw.example");
    }

    #[test]
    fn invalid_default_server_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let s = Settings::load_or_create(&Paths::new(dir.path()), &Preset::default(), "xx").unwrap();
        assert_eq!(s.server, "");
        assert_eq!(s.server_preset, "");
        assert_eq!(s.lang, "en");
    }

    const OLD: &str = "https://old-preset.example";
    const NEW: &str = "https://new-preset.example";

    /// settings.json as written by 0.5.0/0.5.1: preset baked in, no `server_preset` field.
    fn legacy_file(p: &Paths, server: &str) {
        let v = serde_json::json!({
            "lang": "de", "server": server, "scope": "url", "forward": null, "allowlist": ["example.com"],
            "paused_until": 0, "update_check": true, "install_id": "0123456789abcdef0123456789abcdef",
            "setup_done": true, "autostart": true
        });
        std::fs::create_dir_all(&p.dir).unwrap();
        std::fs::write(p.settings(), serde_json::to_vec_pretty(&v).unwrap()).unwrap();
    }

    #[test]
    fn preset_lists_are_parsed_and_normalized() {
        let pr = Preset::new(" https://new-preset.example/ ", "https://old-preset.example/, https://older.example;bogus https://new-preset.example");
        assert_eq!(pr.server, NEW);
        assert_eq!(pr.migrate_from, vec![OLD.to_string(), "https://older.example".to_string()]);
        assert_eq!(Preset::new("", ""), Preset::default());
    }

    #[test]
    fn old_preset_moves_to_the_new_one_and_keeps_everything_else() {
        let dir = tempfile::tempdir().unwrap();
        let p = Paths::new(dir.path());
        legacy_file(&p, OLD);
        let s = Settings::load_or_create(&p, &Preset::new(NEW, OLD), "en").unwrap();
        assert_eq!(s.server, NEW);
        assert_eq!(s.server_preset, NEW);
        assert_eq!(s.install_id, "0123456789abcdef0123456789abcdef");
        assert_eq!(s.allowlist, vec!["example.com"]);
        assert!(s.setup_done);
        // persisted, and a later release with yet another preset follows without a list
        assert_eq!(Settings::load(&p).unwrap().server, NEW);
        let later = Settings::load_or_create(&p, &Preset::server_only("https://third.example"), "en").unwrap();
        assert_eq!(later.server, "https://third.example");
    }

    #[test]
    fn own_address_stays() {
        let dir = tempfile::tempdir().unwrap();
        let p = Paths::new(dir.path());
        legacy_file(&p, "https://my-own.example");
        let s = Settings::load_or_create(&p, &Preset::new(NEW, OLD), "en").unwrap();
        assert_eq!(s.server, "https://my-own.example");
        assert_eq!(s.server_preset, "");
        // chosen in the settings after a preset: stays as well
        let mut s = Settings::load_or_create(&p, &Preset::server_only(OLD), "en").unwrap();
        s.set_server("https://mine.example".into(), &Preset::server_only(OLD));
        s.save(&p).unwrap();
        let s = Settings::load_or_create(&p, &Preset::new(NEW, OLD), "en").unwrap();
        assert_eq!(s.server, "https://mine.example");
    }

    #[test]
    fn choosing_the_preset_keeps_following_it() {
        let mut s = Settings::default();
        s.set_server(OLD.into(), &Preset::server_only(OLD));
        assert_eq!(s.server_preset, OLD);
        assert!(s.apply_preset(&Preset::server_only(NEW)));
        assert_eq!(s.server, NEW);
    }

    #[test]
    fn fresh_install_gets_the_new_preset() {
        let dir = tempfile::tempdir().unwrap();
        let s = Settings::load_or_create(&Paths::new(dir.path()), &Preset::new(NEW, OLD), "en").unwrap();
        assert_eq!(s.server, NEW);
        assert_eq!(s.server_preset, NEW);
    }

    #[test]
    fn empty_preset_breaks_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let p = Paths::new(dir.path());
        legacy_file(&p, OLD);
        let s = Settings::load_or_create(&p, &Preset::new("", OLD), "en").unwrap();
        assert_eq!(s.server, OLD, "an empty preset never empties a working address");
        let mut own = Settings { server: "https://my-own.example".into(), ..Settings::default() };
        assert!(!own.apply_preset(&Preset::default()));
        assert_eq!(own.server, "https://my-own.example");
        let mut empty = Settings::default();
        assert!(!empty.apply_preset(&Preset::default()));
        assert_eq!(empty.server, "");
        // an empty address (build without preset) is filled once a preset exists
        assert!(empty.apply_preset(&Preset::server_only(NEW)));
        assert_eq!(empty.server, NEW);
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
