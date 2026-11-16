//! Test hook for the end-to-end tests: with the `e2e` cargo feature, UI state changes are
//! appended as JSON lines to `$LINKWACHE_E2E_STATE_FILE`. Without the feature (all release
//! builds) this compiles to nothing.

#[cfg(feature = "e2e")]
pub fn state(event: &str, data: serde_json::Value) {
    use std::io::Write;
    let Some(path) = std::env::var_os("LINKWACHE_E2E_STATE_FILE") else { return };
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let line = serde_json::json!({ "t": ms as u64, "event": event, "data": data });
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{line}");
    }
}

#[cfg(not(feature = "e2e"))]
#[inline(always)]
pub fn state(_event: &str, _data: serde_json::Value) {}

/// With the `e2e` feature: follow `$LINKWACHE_E2E_CMD_FILE` (one command per line) so the
/// end-to-end test can press the buttons a user would press:
///   decide <id> <close|open|red-step|open-red|retry> · settings <tab> · setup · quit
#[cfg(feature = "e2e")]
pub fn start_commands(app: &tauri::AppHandle) {
    let Some(path) = std::env::var_os("LINKWACHE_E2E_CMD_FILE") else { return };
    let app = app.clone();
    std::thread::spawn(move || {
        // Only commands written after this start count (an earlier instance's "quit" stays in the file).
        let mut done = std::fs::read_to_string(&path).map(|t| t.lines().count()).unwrap_or(0);
        loop {
            std::thread::sleep(std::time::Duration::from_millis(150));
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            let lines: Vec<&str> = text.lines().collect();
            while done < lines.len() {
                let parts: Vec<&str> = lines[done].split_whitespace().collect();
                done += 1;
                match parts.as_slice() {
                    ["decide", id, action] => {
                        let r = id.parse::<u64>().map_err(|e| e.to_string()).and_then(|id| crate::flow::decide(&app, id, action));
                        state("decide", serde_json::json!({ "id": id, "action": action, "ok": r.is_ok(), "error": r.err() }));
                    }
                    ["settings", tab] => crate::ui::open_settings(&app, tab),
                    ["setup"] => crate::ui::open_setup(&app),
                    ["quit"] => app.exit(0),
                    _ => state("bad-command", serde_json::json!({ "line": lines[done - 1] })),
                }
            }
        }
    });
}

#[cfg(not(feature = "e2e"))]
#[inline(always)]
pub fn start_commands(_app: &tauri::AppHandle) {}
