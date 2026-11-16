//! Updater (docs/DESKTOP.md section 8): check on start and every 12 h (switchable), notice in
//! tray and settings, one-click install with a backup of the running executable/bundle first.
//! The plugin verifies the minisign signature before anything is replaced.

use crate::state::{AppState, UpdateInfo, VERSION};
use crate::{platform, tray};
use linkwache_core::updater;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

pub const INTERVAL: Duration = Duration::from_secs(12 * 3600);

fn set(app: &AppHandle, f: impl FnOnce(&mut UpdateInfo)) -> UpdateInfo {
    let st = app.state::<AppState>();
    let mut u = st.update.lock().unwrap();
    f(&mut u);
    let out = u.clone();
    drop(u);
    let _ = app.emit("update-status", &out);
    out
}

pub async fn check(app: &AppHandle) -> UpdateInfo {
    set(app, |u| u.state = "checking".into());
    let res = match app.updater() {
        Ok(up) => up.check().await.map_err(|e| e.to_string()),
        Err(e) => Err(e.to_string()),
    };
    let info = match res {
        Ok(Some(update)) => set(app, |u| {
            u.state = "available".into();
            u.version = Some(update.version.clone());
        }),
        Ok(None) => set(app, |u| {
            u.state = "none".into();
            u.version = None;
        }),
        Err(e) => {
            crate::e2e::state("update-error", serde_json::json!({ "error": e }));
            set(app, |u| u.state = "error".into())
        }
    };
    tray::refresh(app);
    info
}

/// Back up, download, verify, install, restart. Settings/allowlist/history stay untouched.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let (source, inapp) = platform::update_source();
    if !inapp {
        return Err("package-managed installation".into());
    }
    set(app, |u| u.state = "installing".into());
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let Some(update) = update else {
        set(app, |u| u.state = "none".into());
        return Ok(());
    };
    let paths = app.state::<AppState>().paths.clone();
    if let Some(src) = source {
        if let Err(e) = updater::backup(&paths, &src, VERSION) {
            set(app, |u| u.state = "error".into());
            return Err(format!("backup failed: {e}"));
        }
    }
    match update.download_and_install(|_, _| {}, || {}).await {
        Ok(()) => {
            app.restart();
        }
        Err(e) => {
            set(app, |u| u.state = "error".into());
            Err(e.to_string())
        }
    }
}

/// Periodic check (first one shortly after start), on its own thread.
pub fn schedule(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(20));
        loop {
            if app.state::<AppState>().settings().update_check {
                tauri::async_runtime::block_on(check(&app));
            }
            std::thread::sleep(INTERVAL);
        }
    });
}

/// After repeated failed starts of this version: tell the settings window about the backup.
pub fn note_start_state(app: &AppHandle, s: &updater::StartState) {
    if let Some(old) = &s.offer_backup {
        let paths = app.state::<AppState>().paths.clone();
        let path = updater::backup_item(&paths, old).map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        set(app, |u| u.backup = Some(serde_json::json!({ "version": s.version, "old": old, "path": path })));
    }
}
