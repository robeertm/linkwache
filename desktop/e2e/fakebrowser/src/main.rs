//! Fake "real browser" for the end-to-end tests: appends each argument it receives to
//! `received.log` next to its own executable (or to `$FAKE_BROWSER_LOG`), one per line.
#![cfg_attr(windows, windows_subsystem = "windows")]

use std::io::Write;

fn main() {
    let log = std::env::var_os("FAKE_BROWSER_LOG").map(std::path::PathBuf::from).unwrap_or_else(|| {
        let exe = std::env::current_exe().expect("own path");
        exe.parent().expect("exe dir").join("received.log")
    });
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&log).expect("open log");
    for a in std::env::args().skip(1) {
        if !a.starts_with('-') {
            writeln!(f, "{a}").expect("write log");
        }
    }
}
