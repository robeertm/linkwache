//! Operating-system integration (docs/DESKTOP.md section 3): browser-candidate registration,
//! default-handler status, forwarding to the saved real browser, native-messaging manifests.

use std::path::PathBuf;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use self::windows::*;

/// Result of asking the system to make Linkwache the default.
#[allow(dead_code)] // `User` is used on macOS and Windows only
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MakeDefault {
    /// Linkwache is the default now.
    Done,
    /// The system asks the user (macOS dialog, Windows settings page); poll `is_default()`.
    User,
    Failed(String),
}

impl MakeDefault {
    pub fn as_str(&self) -> &'static str {
        match self {
            MakeDefault::Done => "done",
            MakeDefault::User => "user",
            MakeDefault::Failed(_) => "failed",
        }
    }
}

pub const PLATFORM: &str = if cfg!(target_os = "macos") {
    "macos"
} else if cfg!(windows) {
    "windows"
} else {
    "linux"
};

/// The executable browsers and the OS should start (the AppImage file when running from one).
pub fn self_exe() -> PathBuf {
    #[cfg(target_os = "linux")]
    if let Some(p) = std::env::var_os("APPIMAGE") {
        return PathBuf::from(p);
    }
    std::env::current_exe().unwrap_or_else(|_| PathBuf::from("linkwache"))
}

/// Write the native-messaging host manifests; returns the browsers that got one.
pub fn install_native_hosts() -> Vec<String> {
    let exe = self_exe();
    let exe = exe.to_string_lossy().to_string();
    let mut done = Vec::new();
    for (browser, firefox, loc) in nm_locations() {
        let manifest = if firefox { linkwache_core::nm::firefox_manifest(&exe) } else { linkwache_core::nm::chrome_manifest(&exe) };
        if write_nm(&loc, &manifest).is_ok() {
            done.push(browser.to_string());
        }
    }
    done
}

/// Spawn a program detached from our stdio and reap it in the background.
pub fn spawn_detached(program: &str, args: &[String]) -> Result<(), String> {
    let mut cmd = std::process::Command::new(program);
    cmd.args(args).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(target_os = "linux")]
    linux::sanitize_env(&mut cmd);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
        cmd.creation_flags(0x0000_0008 | 0x0000_0200);
    }
    let mut child = cmd.spawn().map_err(|e| format!("{program}: {e}"))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// Path of the installed thing the updater replaces (backed up before an update), and whether
/// in-app updates are possible for this kind of installation.
pub fn update_source() -> (Option<PathBuf>, bool) {
    let exe = std::env::current_exe().ok();
    #[cfg(target_os = "linux")]
    {
        match std::env::var_os("APPIMAGE") {
            Some(p) => (Some(PathBuf::from(p)), true),
            None => (exe, false), // .deb / .rpm: the package manager updates
        }
    }
    #[cfg(target_os = "macos")]
    {
        let bundle = exe.as_ref().and_then(|e| e.ancestors().nth(3).map(|p| p.to_path_buf())).filter(|p| p.extension().map(|x| x == "app").unwrap_or(false));
        let ok = bundle.is_some();
        (bundle.or(exe), ok)
    }
    #[cfg(windows)]
    {
        (exe, true)
    }
}
