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
