//! App windows: the check toast (pre-created, undecorated, always on top), warning windows
//! (one per link), setup assistant and settings.

use crate::state::{AppState, ToastState};
use linkwache_core::i18n::t;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const TOAST_W: f64 = 440.0;
pub const TOAST_H: f64 = 108.0;

pub fn ensure_toast(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window("toast") {
        return Ok(w);
    }
    WebviewWindowBuilder::new(app, "toast", WebviewUrl::App("toast.html".into()))
        .title("Linkwache")
        .inner_size(TOAST_W, TOAST_H)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .shadow(true)
        .build()
}

/// Bottom-right corner (top-right on macOS) of the monitor with the mouse pointer.
fn place_toast(app: &AppHandle, w: &WebviewWindow) {
    let mon = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(m) = mon {
        let wa = m.work_area();
        let scale = m.scale_factor();
        let (wpx, hpx, margin) = ((TOAST_W * scale) as i32, (TOAST_H * scale) as i32, (18.0 * scale) as i32);
        let x = wa.position.x + wa.size.width as i32 - wpx - margin;
        let y = if cfg!(target_os = "macos") { wa.position.y + margin } else { wa.position.y + wa.size.height as i32 - hpx - margin };
        let _ = w.set_position(PhysicalPosition::new(x, y));
    }
}

/// Show / update the toast; returns its sequence number (to hide only "our" toast later).
pub fn show_toast(app: &AppHandle, state: &str, domain: &str, host: &str) -> u64 {
    let st = app.state::<AppState>();
    let seq = st.next_toast_seq();
    let ts = ToastState { seq, state: state.into(), domain: domain.into(), host: host.into(), lang: st.settings().lang };
    *st.toast.lock().unwrap() = ts.clone();
    let _ = app.emit("toast", &ts);
    crate::e2e::state("toast", serde_json::json!({ "state": state, "domain": domain }));
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Ok(w) = ensure_toast(&app2) {
            place_toast(&app2, &w);
            let _ = w.show();
            let _ = w.set_always_on_top(true);
        }
    });
    seq
}

pub fn hide_toast(app: &AppHandle, seq: u64) {
    let st = app.state::<AppState>();
    if st.toast.lock().unwrap().seq != seq {
        return; // a newer check took over the toast
    }
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = app2.get_webview_window("toast") {
            let _ = w.hide();
        }
    });
}

pub fn warning_label(id: u64) -> String {
    format!("warn-{id}")
}

pub fn open_warning(app: &AppHandle, id: u64, stufe: &str) {
    let lang = app.state::<AppState>().settings().lang;
    let title = match stufe {
        "rot" => t(&lang, "dt.warn.title.rot", &[]),
        "offline" => t(&lang, "dt.warn.title.offline", &[]),
        _ => t(&lang, "dt.warn.title.gelb", &[]),
    };
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let label = warning_label(id);
        if let Some(w) = app2.get_webview_window(&label) {
            bring_to_front(&w);
            return;
        }
        let built = WebviewWindowBuilder::new(&app2, &label, WebviewUrl::App(format!("warning.html?id={id}").into()))
            .title(format!("Linkwache – {title}"))
            .inner_size(580.0, 680.0)
            .min_inner_size(480.0, 520.0)
            .center()
            .always_on_top(true)
            .focused(true)
            .visible(false)
            .build();
        if built.is_ok() {
            // Shown by the page once its content is rendered (command window_ready); this is
            // only the fallback if that never comes.
            let app3 = app2.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(2500));
                reveal(&app3, &label);
            });
        }
    });
}

/// Show and focus a window that was created hidden.
pub fn reveal(app: &AppHandle, label: &str) {
    let app2 = app.clone();
    let label = label.to_string();
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = app2.get_webview_window(&label) {
            if !w.is_visible().unwrap_or(true) {
                let _ = w.show();
            }
            bring_to_front(&w);
        }
    });
}

/// Put a window in front of everything, also when Linkwache is not the active app (it never is when
/// a link arrives: the click happened in a browser or mail program). Main thread only.
/// - macOS: the app runs as an accessory (no Dock icon) and `show`/`set_focus` alone neither activate it
///   nor bring the window onto a full-screen Space — the warning stayed invisible (0.5.1). So: activate
///   the app, let the window join every Space including full-screen ones, order it front regardless.
/// - Windows/Linux: topmost, focus; if the system refuses focus (foreground lock, focus-stealing
///   prevention) the window stays on top and asks for attention (taskbar flash / urgency hint).
pub fn bring_to_front(w: &WebviewWindow) {
    let _ = w.unminimize();
    if !w.is_visible().unwrap_or(false) {
        let _ = w.show();
    }
    let _ = w.set_always_on_top(true);
    #[cfg(target_os = "macos")]
    if let Ok(ns) = w.ns_window() {
        crate::platform::bring_window_to_front(ns);
    }
    let _ = w.set_focus();
    // Show/focus requests are applied asynchronously on some systems (GTK): look again shortly after.
    let w2 = w.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let w3 = w2.clone();
        let _ = w2.run_on_main_thread(move || {
            let focused = w3.is_focused().unwrap_or(false);
            if !focused {
                let _ = w3.request_user_attention(Some(tauri::UserAttentionType::Critical));
            }
            crate::e2e::state("revealed", serde_json::json!({
                "label": w3.label(), "visible": w3.is_visible().unwrap_or(false), "focused": focused,
                "onTop": w3.is_always_on_top().unwrap_or(false),
            }));
        });
    });
}

pub fn close_window(app: &AppHandle, label: &str) {
    let app2 = app.clone();
    let label = label.to_string();
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = app2.get_webview_window(&label) {
            let _ = w.destroy();
        }
    });
}

fn single(app: &AppHandle, label: &'static str, url: String, title: String, size: (f64, f64), min: (f64, f64)) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = app2.get_webview_window(label) {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
            return;
        }
        if WebviewWindowBuilder::new(&app2, label, WebviewUrl::App(url.into()))
            .title(title)
            .inner_size(size.0, size.1)
            .min_inner_size(min.0, min.1)
            .center()
            .focused(true)
            .visible(false)
            .build()
            .is_ok()
        {
            // Revealed by the page (window_ready) once rendered; fallback after 2.5 s.
            let app3 = app2.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(2500));
                reveal(&app3, label);
            });
        }
    });
}

pub fn open_setup(app: &AppHandle) {
    let lang = app.state::<AppState>().settings().lang;
    crate::e2e::state("window", serde_json::json!({ "window": "setup" }));
    single(app, "setup", "setup.html".into(), t(&lang, "dt.setup.title", &[]), (680.0, 640.0), (560.0, 540.0));
}

pub fn open_settings(app: &AppHandle, tab: &str) {
    let lang = app.state::<AppState>().settings().lang;
    if app.get_webview_window("settings").is_some() {
        let _ = app.emit("show-tab", tab.to_string());
    }
    crate::e2e::state("window", serde_json::json!({ "window": "settings", "tab": tab }));
    single(app, "settings", format!("settings.html#{tab}"), t(&lang, "dt.set.title", &[]), (820.0, 620.0), (700.0, 500.0));
}
