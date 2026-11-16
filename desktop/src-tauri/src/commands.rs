//! Commands called from the UI (window.__TAURI__.core.invoke). All async, so window
//! operations never block the main thread (WebView2 requirement on Windows).

use crate::state::{AppState, ToastState, UpdateInfo, VERSION};
use crate::{flow, platform, tray, ui, updates};
use linkwache_core::api::{ApiError, HttpApi};
use linkwache_core::forward::{is_self, ForwardTarget};
use linkwache_core::history::{History, Item};
use linkwache_core::link::{valid_server, Scope};
use linkwache_core::settings::LANGS;
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

type R<T> = Result<T, String>;

fn changed(app: &AppHandle) {
    let _ = app.emit("settings-changed", ());
    tray::refresh(app);
}

#[tauri::command]
pub async fn bootstrap(app: AppHandle) -> R<Value> {
    let s = app.state::<AppState>().settings();
    Ok(json!({ "lang": s.lang, "platform": platform::PLATFORM, "version": VERSION }))
}

#[tauri::command]
pub async fn toast_state(app: AppHandle) -> R<ToastState> {
    Ok(app.state::<AppState>().toast.lock().unwrap().clone())
}

#[tauri::command]
pub async fn get_result(app: AppHandle, id: u64) -> R<Value> {
    let st = app.state::<AppState>();
    let map = st.pending.lock().unwrap();
    let pd = map.get(&id).ok_or("unknown")?;
    Ok(flow::payload(id, pd))
}

#[tauri::command]
pub async fn decide(app: AppHandle, id: u64, action: String) -> R<()> {
    flow::decide(&app, id, &action)
}

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> R<Value> {
    let s = app.state::<AppState>().settings();
    Ok(json!({
        "lang": s.lang, "server": s.server, "scope": s.scope.as_str(), "allowlist": s.allowlist,
        "paused": s.is_paused(), "pausedUntil": s.paused_until, "updateCheck": s.update_check,
        "installId": s.install_id, "setupDone": s.setup_done, "autostart": s.autostart, "forward": s.forward,
    }))
}

#[tauri::command]
pub async fn set_lang(app: AppHandle, lang: String) -> R<()> {
    if !LANGS.contains(&lang.as_str()) {
        return Err("lang".into());
    }
    app.state::<AppState>().update_settings(|s| s.lang = lang);
    changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn set_server(app: AppHandle, url: String) -> R<String> {
    let v = valid_server(&url).ok_or("invalid")?;
    let out = v.clone();
    app.state::<AppState>().update_settings(|s| s.server = v);
    changed(&app);
    Ok(out)
}

#[tauri::command]
pub async fn test_server(app: AppHandle, url: String) -> R<String> {
    let v = valid_server(&url).ok_or("invalid")?;
    let id = app.state::<AppState>().settings().install_id;
    let res = tauri::async_runtime::spawn_blocking(move || HttpApi::new(&v, &id, VERSION, Duration::from_secs(6)).health()).await.map_err(|e| e.to_string())?;
    match res {
        Ok(h) => {
            let api_ok = h.get("api").and_then(|a| a.as_array()).map(|a| a.iter().any(|x| x == 1)).unwrap_or(false);
            let version = h.get("version").and_then(|x| x.as_str()).unwrap_or("?").to_string();
            if api_ok {
                Ok(version)
            } else {
                Err(format!("server {version} has no API v1"))
            }
        }
        Err(ApiError::NoServer) => Err("invalid".into()),
        Err(e) => Err(format!("{e:?}")),
    }
}

#[tauri::command]
pub async fn set_scope(app: AppHandle, scope: String) -> R<()> {
    app.state::<AppState>().update_settings(|s| s.scope = Scope::parse(&scope));
    changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn set_forward(app: AppHandle, target: ForwardTarget) -> R<()> {
    // Loop guard when saving (and again before every launch).
    if is_self(&target, None, None) {
        return Err("loop".into());
    }
    let known = platform::list_browsers();
    let t = known.into_iter().find(|b| b.kind == target.kind && b.id == target.id).unwrap_or(target);
    app.state::<AppState>().update_settings(|s| s.forward = Some(t));
    changed(&app);
    Ok(())
}

#[derive(Serialize)]
pub struct BrowserEntry {
    target: ForwardTarget,
    previous: bool,
    selected: bool,
}

#[tauri::command]
pub async fn list_browsers(app: AppHandle) -> R<Vec<BrowserEntry>> {
    let s = app.state::<AppState>().settings();
    let prev = platform::current_default();
    let mut list = platform::list_browsers();
    if let Some(p) = &prev {
        if !list.iter().any(|b| b.id == p.id) {
            list.insert(0, p.clone());
        }
    }
    Ok(list
        .into_iter()
        .map(|t| {
            let previous = prev.as_ref().map(|p| p.id == t.id).unwrap_or(false);
            let selected = s.forward.as_ref().map(|f| f.id == t.id && f.kind == t.kind).unwrap_or(false);
            BrowserEntry { target: t, previous, selected }
        })
        .collect())
}

#[tauri::command]
pub async fn handler_status() -> R<Value> {
    Ok(json!({ "isDefault": platform::is_default(), "current": platform::current_default() }))
}

#[tauri::command]
pub async fn make_default(app: AppHandle) -> R<String> {
    let r = platform::make_default();
    crate::e2e::state("make-default", json!({ "outcome": r.as_str() }));
    tray::refresh(&app);
    Ok(r.as_str().to_string())
}

#[tauri::command]
pub async fn install_nm() -> R<Vec<String>> {
    Ok(platform::install_native_hosts())
}

#[tauri::command]
pub async fn set_autostart(app: AppHandle, enabled: bool) -> R<()> {
    let al = app.autolaunch();
    let r = if enabled { al.enable() } else { al.disable() };
    app.state::<AppState>().update_settings(|s| s.autostart = enabled);
    r.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_update_check(app: AppHandle, enabled: bool) -> R<()> {
    app.state::<AppState>().update_settings(|s| s.update_check = enabled);
    changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn pause(app: AppHandle, minutes: Option<u64>) -> R<()> {
    app.state::<AppState>().update_settings(|s| s.pause_for(minutes.unwrap_or(15).clamp(1, 24 * 60)));
    changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn resume(app: AppHandle) -> R<()> {
    app.state::<AppState>().update_settings(|s| s.resume());
    changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn reset_install_id(app: AppHandle) -> R<String> {
    let id = app.state::<AppState>().update_settings(|s| {
        s.reset_install_id();
        s.install_id.clone()
    });
    changed(&app);
    Ok(id)
}

#[tauri::command]
pub async fn allow_add(app: AppHandle, domain: String) -> R<String> {
    let r = app.state::<AppState>().update_settings(|s| s.add_allowed(&domain));
    changed(&app);
    r.map_err(|e| format!("{e:?}"))
}

#[tauri::command]
pub async fn allow_remove(app: AppHandle, domain: String) -> R<()> {
    app.state::<AppState>().update_settings(|s| s.remove_allowed(&domain));
    changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn finish_setup(app: AppHandle) -> R<()> {
    app.state::<AppState>().update_settings(|s| s.setup_done = true);
    changed(&app);
    ui::close_window(&app, "setup");
    Ok(())
}

#[tauri::command]
pub async fn get_history(app: AppHandle) -> R<Vec<Item>> {
    Ok(History::load(&app.state::<AppState>().paths.history()).items)
}

#[tauri::command]
pub async fn clear_history(app: AppHandle) -> R<()> {
    History::clear(&app.state::<AppState>().paths.history()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_status(app: AppHandle) -> R<UpdateInfo> {
    Ok(app.state::<AppState>().update.lock().unwrap().clone())
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> R<UpdateInfo> {
    Ok(updates::check(&app).await)
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> R<()> {
    updates::install(&app).await
}

#[tauri::command]
pub async fn open_window(app: AppHandle, which: String, tab: Option<String>) -> R<()> {
    match which.as_str() {
        "setup" => ui::open_setup(&app),
        _ => ui::open_settings(&app, tab.as_deref().unwrap_or("general")),
    }
    Ok(())
}
