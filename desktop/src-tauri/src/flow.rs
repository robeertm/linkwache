//! What happens with one incoming link (docs/DESKTOP.md sections 1 and 5).

use crate::state::{AppState, Pending};
use crate::{e2e, platform, ui};
use linkwache_core::engine::{CheckResult, Decision, Engine, Prepared};
use linkwache_core::history::{History, Item};
use linkwache_core::link::{classify, reduce, Incoming};
use linkwache_core::settings::Settings;
use linkwache_core::store::now_secs;
use serde_json::json;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// "Open anyway" is enabled after this delay (amber and offline).
pub const OPEN_DELAY: Duration = Duration::from_millis(3000);
/// The confirm button of the red second step arms after this delay.
pub const RED_CONFIRM_DELAY: Duration = Duration::from_millis(1500);
/// The green toast stays this long before the browser opens.
pub const GREEN_HOLD: Duration = Duration::from_millis(800);

/// Handle a link (or local file) asynchronously.
pub fn handle(app: &AppHandle, raw: String) {
    let app = app.clone();
    std::thread::spawn(move || run(&app, &raw));
}

fn log(app: &AppHandle, domain: &str, url: &str, stufe: &str, source: &str, action: &str) {
    let st = app.state::<AppState>();
    let item = Item { time: now_secs(), domain: domain.into(), url: url.into(), stufe: stufe.into(), source: source.into(), action: action.into() };
    let _ = History::append(&st.paths.history(), item);
    let _ = app.emit("settings-changed", ());
}

fn reduced(raw: &str) -> String {
    match classify(raw) {
        Incoming::Web(u) => reduce(&u, linkwache_core::link::Scope::Url),
        _ => String::new(),
    }
}

/// Hand `arg` to the saved real browser. Never the system default (that is Linkwache).
pub fn forward(app: &AppHandle, settings: &Settings, arg: &str) -> Result<(), String> {
    let target = settings.forward.clone().or_else(platform::current_default);
    let Some(t) = target else {
        ui::show_toast(app, "noforward", "", "");
        ui::open_settings(app, "browser");
        return Err("no forward target".into());
    };
    match platform::launch(&t, arg) {
        Ok(()) => {
            e2e::state("forwarded", json!({ "url": arg, "target": t.id }));
            Ok(())
        }
        Err(e) => {
            e2e::state("forward-error", json!({ "url": arg, "error": e }));
            ui::show_toast(app, "noforward", "", "");
            ui::open_settings(app, "browser");
            Err(e)
        }
    }
}

fn run(app: &AppHandle, raw: &str) {
    let st = app.state::<AppState>();
    let settings = st.settings();
    let api = st.api(&settings);
    let engine = Engine { paths: &st.paths, settings: &settings, api: &api };
    e2e::state("incoming", json!({ "url": raw }));
    match engine.prepare(raw) {
        Decision::Refused(scheme) => {
            e2e::state("refused", json!({ "scheme": scheme }));
            log(app, "", "", "", "local", "refused");
            let seq = ui::show_toast(app, "refused", &format!("{scheme}:"), "");
            std::thread::sleep(Duration::from_millis(3500));
            ui::hide_toast(app, seq);
        }
        Decision::PassThrough(p) => {
            log(app, "", "", "", "local", "passthrough");
            let _ = forward(app, &settings, &p);
        }
        Decision::Paused(u) => {
            let r = reduced(&u);
            let d = linkwache_core::hostinfo::registrable(&u).unwrap_or_default();
            log(app, &d, &r, "", "paused", "paused");
            let _ = forward(app, &settings, &u);
        }
        Decision::Check(p) => {
            let id = st.next_id();
            if let Some(r) = p.early.clone() {
                if r.stufe == "gruen" {
                    green(app, &settings, &r);
                } else {
                    warn(app, id, r, *p);
                }
                return;
            }
            if p.local.stufe == "rot" {
                // A local red is shown at once; the server adds its details afterwards.
                let local = linkwache_core::engine::offline(&p, &linkwache_core::api::ApiError::Timeout);
                let mut first = local.clone();
                first.stufe = "rot".into();
                first.reason = None;
                warn(app, id, first, (*p).clone());
                let r = engine.remote(&p, &settings.lang);
                update_pending(app, id, r);
                return;
            }
            let seq = ui::show_toast(app, "checking", &display_domain(&p), &p.target.host_str().unwrap_or("").to_string());
            let started = Instant::now();
            let r = engine.remote(&p, &settings.lang);
            e2e::state("checked", json!({ "stufe": r.stufe, "source": r.source, "ms": started.elapsed().as_millis() as u64 }));
            if r.stufe == "gruen" {
                green(app, &settings, &r);
            } else {
                ui::hide_toast(app, seq);
                warn(app, id, r, *p);
            }
        }
    }
}

fn display_domain(p: &Prepared) -> String {
    let h = linkwache_core::hostinfo::host_info(&p.target);
    if h.is_idn {
        h.unicode_host
    } else {
        h.domain
    }
}

fn green(app: &AppHandle, settings: &Settings, r: &CheckResult) {
    let state = if r.source == "allowlist" { "allowlist" } else { "green" };
    let domain = if r.unicode_host != r.host { r.unicode_host.clone() } else { r.domain.clone() };
    let seq = ui::show_toast(app, state, &domain, &r.host);
    std::thread::sleep(GREEN_HOLD);
    let ok = forward(app, settings, &r.url).is_ok();
    log(app, &r.domain, &reduced(&r.url), &r.stufe, &r.source, if ok { "opened" } else { "blocked" });
    std::thread::sleep(Duration::from_millis(400));
    ui::hide_toast(app, seq);
}

fn warn(app: &AppHandle, id: u64, r: CheckResult, p: Prepared) {
    let st = app.state::<AppState>();
    e2e::state("warning", json!({
        "id": id, "stufe": r.stufe, "reason": r.reason, "domain": r.domain,
        "findings": r.findings.iter().map(|f| f.key.clone()).collect::<Vec<_>>(),
    }));
    let stufe = r.stufe.clone();
    st.pending.lock().unwrap().insert(id, Pending { result: r, prepared: p, shown: Instant::now(), red_step: None });
    ui::open_warning(app, id, &stufe);
}

fn update_pending(app: &AppHandle, id: u64, r: CheckResult) {
    let st = app.state::<AppState>();
    let mut map = st.pending.lock().unwrap();
    if let Some(pd) = map.get_mut(&id) {
        // The local red stays red even if the server could not be reached.
        let mut r = r;
        if r.stufe == "offline" {
            r.stufe = "rot".into();
            r.reason = None;
        }
        pd.result = r;
        let payload = payload(id, pd);
        drop(map);
        e2e::state("warning-update", json!({ "id": id }));
        let _ = app.emit("result", payload);
    }
}

pub fn wait_ms(pd: &Pending) -> u64 {
    OPEN_DELAY.saturating_sub(pd.shown.elapsed()).as_millis() as u64
}

pub fn payload(id: u64, pd: &Pending) -> serde_json::Value {
    json!({ "id": id, "result": pd.result, "waitMs": wait_ms(pd), "redStep": pd.red_step.is_some() })
}

fn is_red(r: &CheckResult) -> bool {
    r.stufe == "rot" || (r.stufe == "offline" && r.local.stufe == "rot")
}

/// The user's decision in a warning window. The delays are enforced here, not only in the UI.
pub fn decide(app: &AppHandle, id: u64, action: &str) -> Result<(), String> {
    let st = app.state::<AppState>();
    let label = ui::warning_label(id);
    match action {
        "red-step" => {
            let mut map = st.pending.lock().unwrap();
            let pd = map.get_mut(&id).ok_or("unknown")?;
            if !is_red(&pd.result) {
                return Err("not red".into());
            }
            pd.red_step = Some(Instant::now());
            e2e::state("red-step", json!({ "id": id }));
            Ok(())
        }
        "open" | "open-red" => {
            let pd = {
                let map = st.pending.lock().unwrap();
                let pd = map.get(&id).ok_or("unknown")?;
                let red = is_red(&pd.result);
                if action == "open" && (red || pd.shown.elapsed() < OPEN_DELAY) {
                    return Err("not allowed yet".into());
                }
                if action == "open-red" {
                    match pd.red_step {
                        Some(t) if red && t.elapsed() >= RED_CONFIRM_DELAY => {}
                        _ => return Err("second step missing".into()),
                    }
                }
                (pd.result.clone(), red)
            };
            st.pending.lock().unwrap().remove(&id);
            let (r, _) = pd;
            let settings = st.settings();
            let ok = forward(app, &settings, &r.url).is_ok();
            let stufe = if r.stufe == "offline" { "offline" } else { r.stufe.as_str() };
            log(app, &r.domain, &reduced(&r.url), stufe, &r.source, if ok { "open-anyway" } else { "blocked" });
            e2e::state("open-anyway", json!({ "id": id, "stufe": stufe }));
            ui::close_window(app, &label);
            Ok(())
        }
        "retry" => {
            let removed = st.pending.lock().unwrap().remove(&id);
            ui::close_window(app, &label);
            if let Some(pd) = removed {
                handle(app, pd.result.url.clone());
            }
            Ok(())
        }
        _ => {
            // "close" (button, Escape) — nothing opens.
            closed(app, id);
            ui::close_window(app, &label);
            Ok(())
        }
    }
}

/// A warning window went away without "open": record it once.
pub fn closed(app: &AppHandle, id: u64) {
    let st = app.state::<AppState>();
    let removed = st.pending.lock().unwrap().remove(&id);
    if let Some(pd) = removed {
        let r = &pd.result;
        log(app, &r.domain, &reduced(&r.url), &r.stufe, &r.source, "blocked");
        e2e::state("closed", json!({ "id": id }));
    }
}
