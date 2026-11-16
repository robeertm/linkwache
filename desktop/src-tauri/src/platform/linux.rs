//! Linux (freedesktop): `linkwache.desktop` in `$XDG_DATA_HOME/applications`,
//! `xdg-settings` / `xdg-mime` for the default, forwarding by launching the saved desktop
//! entry's `Exec` line directly (never `xdg-open`, that would call Linkwache again).

use super::MakeDefault;
use linkwache_core::forward::{exec_argv, is_self, ForwardTarget, Kind, SELF_DESKTOP};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const ICON_PNG: &[u8] = include_bytes!("../../icons/128x128.png");

fn home() -> PathBuf {
    dirs_home().unwrap_or_else(|| PathBuf::from("/tmp"))
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn env_path(var: &str, default: PathBuf) -> PathBuf {
    std::env::var_os(var).filter(|v| !v.is_empty()).map(PathBuf::from).unwrap_or(default)
}

pub fn data_home() -> PathBuf {
    env_path("XDG_DATA_HOME", home().join(".local/share"))
}

pub fn config_home() -> PathBuf {
    env_path("XDG_CONFIG_HOME", home().join(".config"))
}

fn data_dirs() -> Vec<PathBuf> {
    let v = std::env::var("XDG_DATA_DIRS").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/usr/local/share:/usr/share".into());
    v.split(':').filter(|s| !s.is_empty()).map(PathBuf::from).collect()
}

fn app_dirs() -> Vec<PathBuf> {
    let mut v = vec![data_home().join("applications")];
    v.extend(data_dirs().into_iter().map(|d| d.join("applications")));
    v
}

#[derive(Debug, Default, Clone)]
struct Entry {
    name: String,
    exec: String,
    mime: Vec<String>,
    no_display: bool,
    hidden: bool,
    is_app: bool,
}

fn parse_entry(text: &str) -> Entry {
    let mut e = Entry::default();
    let mut in_main = false;
    for line in text.lines() {
        let l = line.trim();
        if l.starts_with('[') {
            in_main = l == "[Desktop Entry]";
            continue;
        }
        if !in_main {
            continue;
        }
        if let Some((k, v)) = l.split_once('=') {
            let (k, v) = (k.trim(), v.trim());
            match k {
                "Name" => e.name = v.to_string(),
                "Exec" => e.exec = v.to_string(),
                "MimeType" => e.mime = v.split(';').filter(|s| !s.is_empty()).map(String::from).collect(),
                "NoDisplay" => e.no_display = v == "true",
                "Hidden" => e.hidden = v == "true",
                "Type" => e.is_app = v == "Application",
                _ => {}
            }
        }
    }
    e
}

fn find_entry(id: &str) -> Option<(PathBuf, Entry)> {
    if id.contains('/') || id.contains("..") {
        return None;
    }
    for d in app_dirs() {
        let p = d.join(id);
        if let Ok(t) = fs::read_to_string(&p) {
            return Some((p, parse_entry(&t)));
        }
    }
    None
}

fn target_for(id: &str) -> Option<ForwardTarget> {
    let (_, e) = find_entry(id)?;
    Some(ForwardTarget { kind: Kind::LinuxDesktop, id: id.to_string(), name: if e.name.is_empty() { id.to_string() } else { e.name }, command: e.exec })
}

pub fn list_browsers() -> Vec<ForwardTarget> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for d in app_dirs() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        let mut files: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().map(|x| x == "desktop").unwrap_or(false)).collect();
        files.sort();
        for p in files {
            let id = p.file_name().unwrap().to_string_lossy().to_string();
            if !seen.insert(id.clone()) {
                continue;
            }
            let Ok(t) = fs::read_to_string(&p) else { continue };
            let e = parse_entry(&t);
            let web = e.mime.iter().any(|m| m == "x-scheme-handler/https" || m == "x-scheme-handler/http");
            if !e.is_app || e.hidden || e.no_display || !web || e.exec.is_empty() {
                continue;
            }
            let t = ForwardTarget { kind: Kind::LinuxDesktop, id: id.clone(), name: if e.name.is_empty() { id.clone() } else { e.name }, command: e.exec };
            if !is_self(&t, None, None) {
                out.push(t);
            }
        }
    }
    out.sort_by_key(|t| t.name.to_lowercase());
    out
}

fn run(cmd: &str, args: &[&str]) -> Option<String> {
    let mut c = Command::new(cmd);
    c.args(args);
    sanitize_env(&mut c);
    let o = c.output().ok()?;
    if !o.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
}

fn default_id() -> Option<String> {
    run("xdg-settings", &["get", "default-web-browser"])
        .filter(|s| s.ends_with(".desktop"))
        .or_else(|| run("xdg-mime", &["query", "default", "x-scheme-handler/https"]).filter(|s| s.ends_with(".desktop")))
}

/// The current default browser (the forward target the assistant suggests).
pub fn current_default() -> Option<ForwardTarget> {
    let id = default_id()?;
    let t = target_for(&id).unwrap_or(ForwardTarget { kind: Kind::LinuxDesktop, id: id.clone(), name: id, command: String::new() });
    if is_self(&t, None, None) {
        None
    } else {
        Some(t)
    }
}

fn own_desktop() -> PathBuf {
    data_home().join("applications").join(SELF_DESKTOP)
}

fn quote_exec(p: &str) -> String {
    let escaped = p.replace('\\', "\\\\").replace('"', "\\\"").replace('`', "\\`").replace('$', "\\$");
    format!("\"{escaped}\"")
}

/// Register as a browser candidate (per user, no root): desktop entry + icon.
pub fn register(exe: &Path) -> Result<(), String> {
    let apps = data_home().join("applications");
    fs::create_dir_all(&apps).map_err(|e| e.to_string())?;
    let icon_dir = data_home().join("icons/hicolor/128x128/apps");
    fs::create_dir_all(&icon_dir).map_err(|e| e.to_string())?;
    fs::write(icon_dir.join("linkwache.png"), ICON_PNG).map_err(|e| e.to_string())?;
    let entry = format!(
        "[Desktop Entry]\nType=Application\nName=Linkwache\nGenericName=Link checker\nComment=Checks every link before it opens\nExec={} %u\nIcon=linkwache\nTerminal=false\nCategories=Network;WebBrowser;Security;\nMimeType=x-scheme-handler/http;x-scheme-handler/https;text/html;\nStartupNotify=false\n",
        quote_exec(&exe.to_string_lossy())
    );
    let path = own_desktop();
    if fs::read_to_string(&path).ok().as_deref() != Some(entry.as_str()) {
        fs::write(&path, entry).map_err(|e| e.to_string())?;
        let _ = run("update-desktop-database", &[&apps.to_string_lossy()]);
    }
    Ok(())
}

pub fn unregister() -> Result<(), String> {
    let _ = fs::remove_file(own_desktop());
    let _ = fs::remove_file(data_home().join("icons/hicolor/128x128/apps/linkwache.png"));
    for (_, _, loc) in nm_locations() {
        let _ = fs::remove_file(loc);
    }
    Ok(())
}

pub fn is_default() -> bool {
    if run("xdg-settings", &["check", "default-web-browser", SELF_DESKTOP]).as_deref() == Some("yes") {
        return true;
    }
    let q = |m: &str| run("xdg-mime", &["query", "default", m]).as_deref() == Some(SELF_DESKTOP);
    q("x-scheme-handler/http") && q("x-scheme-handler/https")
}

pub fn make_default() -> MakeDefault {
    if let Err(e) = register(&super::self_exe()) {
        return MakeDefault::Failed(e);
    }
    let _ = run("xdg-settings", &["set", "default-web-browser", SELF_DESKTOP]);
    if !is_default() {
        let _ = run("xdg-mime", &["default", SELF_DESKTOP, "x-scheme-handler/http", "x-scheme-handler/https"]);
    }
    if is_default() {
        MakeDefault::Done
    } else {
        MakeDefault::Failed("xdg-settings/xdg-mime did not take effect".into())
    }
}

/// Open `arg` (URL or local file) in the saved browser by its desktop entry.
pub fn launch(t: &ForwardTarget, arg: &str) -> Result<(), String> {
    if t.kind != Kind::LinuxDesktop {
        return Err("wrong target kind".into());
    }
    let (_, e) = find_entry(&t.id).ok_or_else(|| format!("desktop entry {} not found", t.id))?;
    let argv = exec_argv(&e.exec, arg, &e.name);
    let own = std::env::current_exe().ok();
    let program = argv.first().cloned().ok_or("empty Exec")?;
    if is_self(t, Some(&program), own.as_deref()) || argv.iter().any(|a| is_self(t, Some(a), own.as_deref()) && a != arg) {
        return Err("loop: the forward target is Linkwache itself".into());
    }
    super::spawn_detached(&program, &argv[1..])
}

/// Remove variables an AppImage runtime sets for itself so the browser starts with the
/// user's normal environment.
pub fn sanitize_env(cmd: &mut Command) {
    let Some(appdir) = std::env::var_os("APPDIR").map(|a| a.to_string_lossy().to_string()) else { return };
    for v in ["APPDIR", "APPIMAGE", "ARGV0", "OWD", "GIO_MODULE_DIR", "GDK_PIXBUF_MODULE_FILE", "GTK_PATH", "GTK_DATA_PREFIX", "GTK_EXE_PREFIX", "GSETTINGS_SCHEMA_DIR", "PYTHONHOME", "PERLLIB", "QT_PLUGIN_PATH"] {
        cmd.env_remove(v);
    }
    for v in ["LD_LIBRARY_PATH", "XDG_DATA_DIRS", "PATH", "GST_PLUGIN_SYSTEM_PATH", "GST_PLUGIN_SYSTEM_PATH_1_0"] {
        if let Ok(val) = std::env::var(v) {
            let kept: Vec<&str> = val.split(':').filter(|p| !p.is_empty() && !p.starts_with(&appdir)).collect();
            if kept.is_empty() {
                cmd.env_remove(v);
            } else {
                cmd.env(v, kept.join(":"));
            }
        }
    }
}

/// (browser, is_firefox, manifest path) — only for browsers whose profile directory exists.
pub fn nm_locations() -> Vec<(&'static str, bool, PathBuf)> {
    let c = config_home();
    let h = home();
    let all: Vec<(&str, bool, PathBuf, PathBuf)> = vec![
        ("chrome", false, c.join("google-chrome"), c.join("google-chrome/NativeMessagingHosts")),
        ("chromium", false, c.join("chromium"), c.join("chromium/NativeMessagingHosts")),
        ("edge", false, c.join("microsoft-edge"), c.join("microsoft-edge/NativeMessagingHosts")),
        ("brave", false, c.join("BraveSoftware/Brave-Browser"), c.join("BraveSoftware/Brave-Browser/NativeMessagingHosts")),
        ("firefox", true, h.join(".mozilla"), h.join(".mozilla/native-messaging-hosts")),
    ];
    all.into_iter()
        .filter(|(_, _, profile, _)| profile.is_dir())
        .map(|(b, ff, _, dir)| (b, ff, dir.join(format!("{}.json", linkwache_core::nm::HOST_NAME))))
        .collect()
}

pub fn write_nm(loc: &Path, manifest: &serde_json::Value) -> Result<(), String> {
    if let Some(d) = loc.parent() {
        fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    fs::write(loc, serde_json::to_vec_pretty(manifest).unwrap()).map_err(|e| e.to_string())
}

/// Which manifests exist (for the status output).
pub fn nm_installed() -> Vec<String> {
    nm_locations().into_iter().filter(|(_, _, p)| p.exists()).map(|(b, _, _)| b.to_string()).collect()
}
