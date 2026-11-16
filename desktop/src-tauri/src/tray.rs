//! Tray icon with status (active / paused / error / update available) and menu.
//! Texts come from the generated strings (same as the UI).

use crate::state::AppState;
use crate::{platform, ui, updates};
use linkwache_core::i18n::t;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

const ICON_ACTIVE: &[u8] = include_bytes!("../icons/tray/tray-active.png");
const ICON_PAUSED: &[u8] = include_bytes!("../icons/tray/tray-paused.png");
const ICON_ERROR: &[u8] = include_bytes!("../icons/tray/tray-error.png");
const ICON_UPDATE: &[u8] = include_bytes!("../icons/tray/tray-update.png");

#[derive(Debug, Clone, PartialEq)]
pub enum Status {
    Active,
    Paused(u64),
    Error,
    Update(String),
}

pub fn status(app: &AppHandle) -> Status {
    let st = app.state::<AppState>();
    let s = st.settings();
    if s.is_paused() {
        return Status::Paused(s.paused_until);
    }
    if s.server.is_empty() || s.forward.is_none() || !platform::is_default() {
        return Status::Error;
    }
    let u = st.update.lock().unwrap().clone();
    if u.state == "available" {
        return Status::Update(u.version.unwrap_or_default());
    }
    Status::Active
}

fn time_text(secs: u64) -> String {
    // Local wall-clock time HH:MM without extra crates: use the offset of the system clock.
    let local = secs as i64 + local_offset();
    let m = (local / 60).rem_euclid(60);
    let h = (local / 3600).rem_euclid(24);
    format!("{h:02}:{m:02}")
}

#[cfg(unix)]
fn local_offset() -> i64 {
    // Ask `date` once for the UTC offset (+hhmm); cheap and avoids a time-zone crate.
    use std::sync::OnceLock;
    static OFF: OnceLock<i64> = OnceLock::new();
    *OFF.get_or_init(|| {
        let o = std::process::Command::new("date").arg("+%z").output().ok();
        let s = o.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
        if s.len() == 5 {
            let sign = if s.starts_with('-') { -1 } else { 1 };
            let h: i64 = s[1..3].parse().unwrap_or(0);
            let m: i64 = s[3..5].parse().unwrap_or(0);
            sign * (h * 3600 + m * 60)
        } else {
            0
        }
    })
}

#[cfg(windows)]
fn local_offset() -> i64 {
    use windows_sys::Win32::System::Time::{GetTimeZoneInformation, TIME_ZONE_INFORMATION};
    let mut tz: TIME_ZONE_INFORMATION = unsafe { std::mem::zeroed() };
    let r = unsafe { GetTimeZoneInformation(&mut tz) };
    let bias = tz.Bias + if r == 2 { tz.DaylightBias } else { tz.StandardBias };
    -(bias as i64) * 60
}

fn build_menu(app: &AppHandle, status: &Status) -> tauri::Result<Menu<tauri::Wry>> {
    let lang = app.state::<AppState>().settings().lang;
    let tr = |k: &str| t(&lang, k, &[]);
    let status_text = match status {
        Status::Active => tr("dt.tray.status.active"),
        Status::Paused(until) => t(&lang, "dt.tray.status.paused", &[("time", &time_text(*until))]),
        Status::Error => tr("dt.tray.status.error"),
        Status::Update(v) => t(&lang, "dt.tray.status.update", &[("v", v)]),
    };
    let head = MenuItem::with_id(app, "status", status_text, matches!(status, Status::Error), None::<&str>)?;
    let pause = match status {
        Status::Paused(_) => MenuItem::with_id(app, "resume", tr("dt.tray.resume"), true, None::<&str>)?,
        _ => MenuItem::with_id(app, "pause", tr("dt.tray.pause"), true, None::<&str>)?,
    };
    let history = MenuItem::with_id(app, "history", tr("dt.tray.history"), true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", tr("dt.tray.settings"), true, None::<&str>)?;
    let update = match status {
        Status::Update(v) => MenuItem::with_id(app, "install-update", t(&lang, "dt.tray.update.install", &[("v", v)]), true, None::<&str>)?,
        _ => MenuItem::with_id(app, "check-update", tr("dt.tray.update.check"), true, None::<&str>)?,
    };
    let quit = MenuItem::with_id(app, "quit", tr("dt.tray.quit"), true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    Menu::with_items(app, &[&head, &sep1, &pause, &history, &settings, &sep2, &update, &sep3, &quit])
}

fn icon_for(status: &Status) -> Image<'static> {
    let bytes = match status {
        Status::Active => ICON_ACTIVE,
        Status::Paused(_) => ICON_PAUSED,
        Status::Error => ICON_ERROR,
        Status::Update(_) => ICON_UPDATE,
    };
    Image::from_bytes(bytes).expect("tray icon png")
}

fn tooltip(app: &AppHandle, status: &Status) -> String {
    let lang = app.state::<AppState>().settings().lang;
    let s = match status {
        Status::Active => t(&lang, "dt.tray.status.active", &[]),
        Status::Paused(u) => t(&lang, "dt.tray.status.paused", &[("time", &time_text(*u))]),
        Status::Error => t(&lang, "dt.tray.status.error", &[]),
        Status::Update(v) => t(&lang, "dt.tray.status.update", &[("v", v)]),
    };
    t(&lang, "dt.tray.tooltip", &[("status", &s)])
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let s = status(app);
    let menu = build_menu(app, &s)?;
    TrayIconBuilder::with_id("main")
        .icon(icon_for(&s))
        .tooltip(tooltip(app, &s))
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, ev| on_menu(app, ev.id().as_ref()))
        .build(app)?;
    crate::e2e::state("tray", serde_json::json!({ "status": format!("{s:?}") }));
    Ok(())
}

/// Rebuild menu, icon and tooltip (language or status changed).
pub fn refresh(app: &AppHandle) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let s = status(&app2);
        if let Some(tray) = app2.tray_by_id("main") {
            if let Ok(m) = build_menu(&app2, &s) {
                let _ = tray.set_menu(Some(m));
            }
            let _ = tray.set_icon(Some(icon_for(&s)));
            let _ = tray.set_tooltip(Some(tooltip(&app2, &s)));
        }
    });
}

fn on_menu(app: &AppHandle, id: &str) {
    let st = app.state::<AppState>();
    match id {
        "pause" => {
            st.update_settings(|s| s.pause_for(15));
            let _ = app.emit("settings-changed", ());
            refresh(app);
        }
        "resume" => {
            st.update_settings(|s| s.resume());
            let _ = app.emit("settings-changed", ());
            refresh(app);
        }
        "history" => ui::open_settings(app, "history"),
        "settings" | "status" => {
            if st.settings().setup_done {
                ui::open_settings(app, "general")
            } else {
                ui::open_setup(app)
            }
        }
        "check-update" => {
            ui::open_settings(app, "updates");
            let app2 = app.clone();
            tauri::async_runtime::spawn(async move {
                updates::check(&app2).await;
            });
        }
        "install-update" => {
            let app2 = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = updates::install(&app2).await;
            });
        }
        "quit" => app.exit(0),
        _ => {}
    }
}
