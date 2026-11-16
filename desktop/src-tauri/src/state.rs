//! Shared app state. Settings, cache and history live in files (shared with the
//! native-messaging host process) and are read fresh where it matters.

use linkwache_core::api::{HttpApi, DEFAULT_TIMEOUT};
use linkwache_core::engine::{CheckResult, Prepared};
use linkwache_core::settings::{Preset, Settings};
use linkwache_core::store::Paths;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Build-time default server (repository variable in CI); never hard-coded in the source.
pub fn default_server() -> &'static str {
    option_env!("LINKWACHE_DEFAULT_SERVER").unwrap_or("")
}

/// Earlier built-in addresses (repository variable in CI) that installations still following the
/// preset move away from; installations from 0.5.0/0.5.1 did not record that they follow it.
pub fn preset_migrate_from() -> &'static str {
    option_env!("LINKWACHE_PRESET_MIGRATE_FROM").unwrap_or("")
}

pub fn preset() -> Preset {
    Preset::new(default_server(), preset_migrate_from())
}

pub fn system_locale() -> String {
    sys_locale::get_locale().unwrap_or_else(|| "en".into())
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToastState {
    pub seq: u64,
    pub state: String,
    pub domain: String,
    pub host: String,
    pub lang: String,
}

/// A warning window waiting for the user's decision.
pub struct Pending {
    pub result: CheckResult,
    #[allow(dead_code)] // kept for a later "check again with details"
    pub prepared: Prepared,
    pub shown: Instant,
    pub red_step: Option<Instant>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// idle | checking | none | available | installing | error
    pub state: String,
    pub version: Option<String>,
    pub current: String,
    /// In-app install possible (false for .deb/.rpm installs).
    pub inapp: bool,
    /// Backup offer after repeated failed starts: { version, old, path }.
    pub backup: Option<serde_json::Value>,
}

pub struct AppState {
    pub paths: Paths,
    pub next_id: AtomicU64,
    pub toast_seq: AtomicU64,
    pub toast: Mutex<ToastState>,
    pub pending: Mutex<HashMap<u64, Pending>>,
    pub update: Mutex<UpdateInfo>,
    pub settings_lock: Mutex<()>,
}

impl AppState {
    pub fn new(paths: Paths) -> Self {
        let (_, inapp) = crate::platform::update_source();
        AppState {
            paths,
            next_id: AtomicU64::new(1),
            toast_seq: AtomicU64::new(1),
            toast: Mutex::new(ToastState::default()),
            pending: Mutex::new(HashMap::new()),
            update: Mutex::new(UpdateInfo { state: "idle".into(), current: VERSION.into(), inapp, ..Default::default() }),
            settings_lock: Mutex::new(()),
        }
    }

    pub fn settings(&self) -> Settings {
        Settings::load_or_create(&self.paths, &preset(), &system_locale()).unwrap_or_default()
    }

    /// Read-modify-write of the settings file.
    pub fn update_settings<R>(&self, f: impl FnOnce(&mut Settings) -> R) -> R {
        let _g = self.settings_lock.lock().unwrap();
        let mut s = self.settings();
        let r = f(&mut s);
        let _ = s.save(&self.paths);
        r
    }

    pub fn api(&self, s: &Settings) -> HttpApi {
        HttpApi::new(&s.server, &s.install_id, VERSION, DEFAULT_TIMEOUT)
    }

    pub fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::SeqCst)
    }

    pub fn next_toast_seq(&self) -> u64 {
        self.toast_seq.fetch_add(1, Ordering::SeqCst)
    }
}
