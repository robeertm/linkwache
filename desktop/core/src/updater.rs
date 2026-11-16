//! Updater safety net (docs/DESKTOP.md section 8): copy of the running executable/bundle to
//! `<app data>/backup/<version>/` before an update is installed, `last-good-version` marker,
//! and start-attempt counting so a version that fails to start three times offers the backup.
//! Settings, allowlist and history are never touched here.

use crate::store::{read_json, write_atomic, write_json, Paths};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const KEEP_BACKUPS: usize = 2;
pub const FAILED_STARTS: u32 = 3;

fn copy_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    let meta = fs::symlink_metadata(src)?;
    if meta.file_type().is_symlink() {
        #[cfg(unix)]
        {
            let target = fs::read_link(src)?;
            std::os::unix::fs::symlink(target, dst)?;
            return Ok(());
        }
        #[cfg(not(unix))]
        {
            fs::copy(src, dst)?;
            return Ok(());
        }
    }
    if meta.is_dir() {
        fs::create_dir_all(dst)?;
        for e in fs::read_dir(src)? {
            let e = e?;
            copy_recursive(&e.path(), &dst.join(e.file_name()))?;
        }
    } else {
        fs::copy(src, dst)?;
    }
    Ok(())
}

/// Copy `source` (a file, or a directory such as `Linkwache.app`) to
/// `<backup root>/<version>/<name>`; keeps the newest `KEEP_BACKUPS` versions.
pub fn backup(paths: &Paths, source: &Path, version: &str) -> io::Result<PathBuf> {
    if version.is_empty() || version.contains(['/', '\\']) || version.contains("..") {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "bad version"));
    }
    let name = source.file_name().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no file name"))?;
    let dir = paths.backup_root().join(version);
    if dir.exists() {
        fs::remove_dir_all(&dir)?;
    }
    fs::create_dir_all(&dir)?;
    let dst = dir.join(name);
    copy_recursive(source, &dst)?;
    write_json(&dir.join("backup.json"), &serde_json::json!({ "version": version, "source": source }))?;
    prune(paths, version)?;
    Ok(dst)
}

fn version_key(v: &str) -> Vec<u64> {
    v.split(|c: char| !c.is_ascii_digit()).filter(|s| !s.is_empty()).map(|s| s.parse().unwrap_or(0)).collect()
}

/// Versions with a backup, newest first.
pub fn backups(paths: &Paths) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(paths.backup_root())
        .map(|it| it.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()).filter_map(|e| e.file_name().to_str().map(String::from)).collect())
        .unwrap_or_default();
    v.sort_by_key(|s| std::cmp::Reverse(version_key(s)));
    v
}

fn prune(paths: &Paths, keep_always: &str) -> io::Result<()> {
    let all = backups(paths);
    let mut kept = 0;
    for v in all {
        if v == keep_always || kept < KEEP_BACKUPS {
            kept += 1;
            continue;
        }
        fs::remove_dir_all(paths.backup_root().join(&v))?;
    }
    Ok(())
}

pub fn last_good(paths: &Paths) -> Option<String> {
    fs::read_to_string(paths.last_good()).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Attempts {
    pub version: String,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StartState {
    pub version: String,
    pub attempts: u32,
    pub last_good: Option<String>,
    /// Version whose backup the assistant should offer.
    pub offer_backup: Option<String>,
}

/// Call once at start, before anything can fail.
pub fn record_start(paths: &Paths, version: &str) -> io::Result<StartState> {
    let mut a: Attempts = read_json(&paths.start_attempts()).unwrap_or_default();
    if a.version != version {
        a = Attempts { version: version.into(), count: 0 };
    }
    a.count += 1;
    write_json(&paths.start_attempts(), &a)?;
    let lg = last_good(paths);
    let offer = if a.count >= FAILED_STARTS && lg.as_deref() != Some(version) {
        lg.clone().filter(|v| backups(paths).contains(v))
    } else {
        None
    };
    Ok(StartState { version: version.into(), attempts: a.count, last_good: lg, offer_backup: offer })
}

/// Call when the app has started successfully (windows and tray are up).
pub fn mark_good(paths: &Paths, version: &str) -> io::Result<()> {
    write_atomic(&paths.last_good(), version.as_bytes())?;
    write_json(&paths.start_attempts(), &Attempts { version: version.into(), count: 0 })
}

/// Path of the backed-up executable/bundle of `version`.
pub fn backup_item(paths: &Paths, version: &str) -> Option<PathBuf> {
    let dir = paths.backup_root().join(version);
    fs::read_dir(&dir).ok()?.filter_map(|e| e.ok()).map(|e| e.path()).find(|p| p.file_name().map(|n| n != "backup.json").unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backs_up_files_and_bundles_and_prunes() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::new(tmp.path().join("data"));
        let exe = tmp.path().join("linkwache");
        fs::write(&exe, b"v1").unwrap();
        let b = backup(&paths, &exe, "0.5.0").unwrap();
        assert_eq!(fs::read(&b).unwrap(), b"v1");
        assert_eq!(backup_item(&paths, "0.5.0").unwrap(), b);

        let app = tmp.path().join("Linkwache.app");
        fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        fs::write(app.join("Contents/MacOS/linkwache"), b"bin").unwrap();
        fs::write(app.join("Contents/Info.plist"), b"plist").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("MacOS/linkwache", app.join("Contents/link")).unwrap();
        let b = backup(&paths, &app, "0.5.1").unwrap();
        assert_eq!(fs::read(b.join("Contents/MacOS/linkwache")).unwrap(), b"bin");
        #[cfg(unix)]
        assert!(fs::symlink_metadata(b.join("Contents/link")).unwrap().file_type().is_symlink());

        backup(&paths, &exe, "0.10.0").unwrap();
        assert_eq!(backups(&paths), vec!["0.10.0", "0.5.1"]);
        assert!(backup(&paths, &exe, "../x").is_err());
    }

    #[test]
    fn settings_files_are_untouched() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::new(tmp.path());
        fs::write(paths.settings(), b"{\"lang\":\"de\"}").unwrap();
        fs::write(paths.history(), b"{\"items\":[]}").unwrap();
        let exe = tmp.path().join("bin");
        fs::write(&exe, b"x").unwrap();
        backup(&paths, &exe, "1.0.0").unwrap();
        mark_good(&paths, "1.0.0").unwrap();
        assert_eq!(fs::read(paths.settings()).unwrap(), b"{\"lang\":\"de\"}");
        assert_eq!(fs::read(paths.history()).unwrap(), b"{\"items\":[]}");
    }

    #[test]
    fn three_failed_starts_offer_the_backup() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::new(tmp.path());
        let exe = tmp.path().join("bin");
        fs::write(&exe, b"x").unwrap();
        // 0.5.0 ran fine, then an update to 0.6.0 was installed (backup of 0.5.0 first).
        record_start(&paths, "0.5.0").unwrap();
        mark_good(&paths, "0.5.0").unwrap();
        assert_eq!(last_good(&paths).as_deref(), Some("0.5.0"));
        backup(&paths, &exe, "0.5.0").unwrap();
        let s1 = record_start(&paths, "0.6.0").unwrap();
        assert_eq!((s1.attempts, s1.offer_backup.clone()), (1, None));
        record_start(&paths, "0.6.0").unwrap();
        let s3 = record_start(&paths, "0.6.0").unwrap();
        assert_eq!(s3.attempts, 3);
        assert_eq!(s3.offer_backup.as_deref(), Some("0.5.0"));
        // A successful start clears it.
        mark_good(&paths, "0.6.0").unwrap();
        let s4 = record_start(&paths, "0.6.0").unwrap();
        assert_eq!((s4.attempts, s4.offer_backup), (1, None));
        assert_eq!(last_good(&paths).as_deref(), Some("0.6.0"));
    }

    #[test]
    fn no_offer_without_backup() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::new(tmp.path());
        mark_good(&paths, "0.5.0").unwrap();
        for _ in 0..4 {
            record_start(&paths, "0.6.0").unwrap();
        }
        assert_eq!(record_start(&paths, "0.6.0").unwrap().offer_backup, None);
    }
}
