//! Files of the app: one directory per user, shared by the app and its native-messaging host.
//! Writes are atomic (temporary file + rename) so two processes never read half a file.

use serde::{de::DeserializeOwned, Serialize};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const APP_ID: &str = "app.linkwache.desktop";

/// `<config dir>/app.linkwache.desktop` (the same directory Tauri uses for the app config).
pub fn default_dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(std::env::temp_dir).join(APP_ID)
}

pub fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    let data = fs::read(path).ok()?;
    serde_json::from_slice(&data).ok()
}

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    let data = serde_json::to_vec_pretty(value).map_err(io::Error::other)?;
    write_atomic(path, &data)
}

pub fn write_atomic(path: &Path, data: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension(format!("tmp{}", std::process::id()));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all().ok();
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600)).ok();
    }
    fs::rename(&tmp, path)
}

/// Paths of all files below one directory.
#[derive(Debug, Clone)]
pub struct Paths {
    pub dir: PathBuf,
}

impl Paths {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Paths { dir: dir.into() }
    }
    pub fn default_location() -> Self {
        Paths::new(default_dir())
    }
    pub fn settings(&self) -> PathBuf {
        self.dir.join("settings.json")
    }
    pub fn cache(&self) -> PathBuf {
        self.dir.join("cache.json")
    }
    pub fn history(&self) -> PathBuf {
        self.dir.join("history.json")
    }
    pub fn backup_root(&self) -> PathBuf {
        self.dir.join("backup")
    }
    pub fn last_good(&self) -> PathBuf {
        self.dir.join("last-good-version")
    }
    pub fn start_attempts(&self) -> PathBuf {
        self.dir.join("start-attempts.json")
    }
}
