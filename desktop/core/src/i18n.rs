//! The desktop strings, generated from `src/i18n.js` by `desktop/scripts/i18n.mjs` and embedded
//! here so the tray menu (Rust) uses exactly the same texts as the UI.

use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

pub const GENERATED: &str = include_str!("../../ui/i18n.generated.json");
pub const DEFAULT_LANG: &str = "de";

#[derive(Debug, Deserialize)]
pub struct Bundle {
    pub langs: Vec<String>,
    pub names: HashMap<String, String>,
    pub strings: HashMap<String, HashMap<String, String>>,
}

pub fn bundle() -> &'static Bundle {
    static B: OnceLock<Bundle> = OnceLock::new();
    B.get_or_init(|| serde_json::from_str(GENERATED).expect("i18n.generated.json is valid"))
}

/// Same lookup as `t()` in `src/i18n.js`: language, then German, then the key itself.
pub fn t(lang: &str, key: &str, params: &[(&str, &str)]) -> String {
    let b = bundle();
    let from = |l: &str| b.strings.get(l).and_then(|d| d.get(key)).cloned();
    let mut s = from(lang).or_else(|| from(DEFAULT_LANG)).unwrap_or_else(|| key.to_string());
    for (k, v) in params {
        s = s.replace(&format!("{{{k}}}"), v);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_languages_present() {
        let b = bundle();
        assert_eq!(b.langs, vec!["de", "en", "tr", "pl", "ru", "es", "fr", "it"]);
        for l in &b.langs {
            assert!(b.strings.contains_key(l), "{l}");
        }
        assert_eq!(t("xx", "nope.key", &[]), "nope.key");
        assert_eq!(t("en", "f.port", &[("port", "8443")]), "Unusual port :8443");
    }
}
