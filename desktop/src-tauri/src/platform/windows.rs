//! Windows 10/11: per-user browser-candidate registration under HKCU (no admin), the user
//! chooses the default in Settings (UserChoice is protected), forwarding starts the saved
//! browser's `shell\open\command` directly (never ShellExecute on the URL).

use super::MakeDefault;
use linkwache_core::forward::{is_self, windows_argv, ForwardTarget, Kind, SELF_CLIENT, SELF_PROGIDS};
use std::path::{Path, PathBuf};
use winreg::enums::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY};
use winreg::RegKey;

const CLIENTS: &str = r"Software\Clients\StartMenuInternet";
const PROGID_URL: &str = "LinkwacheURL";
const PROGID_HTML: &str = "LinkwacheHTML";
const SETTINGS_URI: &str = "ms-settings:defaultapps?registeredAppUser=Linkwache";

fn hkcu() -> RegKey {
    RegKey::predef(HKEY_CURRENT_USER)
}

fn hklm() -> RegKey {
    RegKey::predef(HKEY_LOCAL_MACHINE)
}

fn default_value(root: &RegKey, path: &str) -> Option<String> {
    root.open_subkey_with_flags(path, KEY_READ).ok()?.get_value::<String, _>("").ok().filter(|s| !s.trim().is_empty())
}

/// Client roots in lookup order: HKCU, HKLM (64-bit view), HKLM (32-bit view).
fn client_roots() -> Vec<RegKey> {
    let mut v = vec![];
    if let Ok(k) = hkcu().open_subkey_with_flags(CLIENTS, KEY_READ) {
        v.push(k);
    }
    if let Ok(k) = hklm().open_subkey_with_flags(CLIENTS, KEY_READ) {
        v.push(k);
    }
    if let Ok(k) = hklm().open_subkey_with_flags(CLIENTS, KEY_READ | KEY_WOW64_32KEY) {
        v.push(k);
    }
    v
}

fn client_command(key: &str) -> Option<String> {
    client_roots().iter().find_map(|r| default_value(r, &format!(r"{key}\shell\open\command")))
}

fn progid_command(progid: &str) -> Option<String> {
    default_value(&hkcu(), &format!(r"Software\Classes\{progid}\shell\open\command")).or_else(|| default_value(&RegKey::predef(HKEY_CLASSES_ROOT), &format!(r"{progid}\shell\open\command")))
}

pub fn list_browsers() -> Vec<ForwardTarget> {
    let mut out: Vec<ForwardTarget> = Vec::new();
    for root in client_roots() {
        for key in root.enum_keys().filter_map(|k| k.ok()) {
            if out.iter().any(|t| t.id.eq_ignore_ascii_case(&key)) {
                continue;
            }
            let Some(cmd) = default_value(&root, &format!(r"{key}\shell\open\command")) else { continue };
            let name = default_value(&root, &key).unwrap_or_else(|| key.clone());
            let t = ForwardTarget { kind: Kind::WinClient, id: key.clone(), name, command: cmd.clone() };
            let program = windows_argv(&cmd, "").map(|(p, _)| p);
            if !is_self(&t, program.as_deref(), None) {
                out.push(t);
            }
        }
    }
    out.sort_by_key(|t| t.name.to_lowercase());
    out
}

fn user_choice(scheme: &str) -> Option<String> {
    let base = format!(r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\{scheme}");
    for sub in ["UserChoiceLatest", "UserChoice"] {
        if let Ok(k) = hkcu().open_subkey_with_flags(format!(r"{base}\{sub}"), KEY_READ) {
            if let Ok(p) = k.get_value::<String, _>("ProgId") {
                if !p.is_empty() {
                    return Some(p);
                }
            }
        }
    }
    None
}

/// The current default browser (by the https UserChoice), as a StartMenuInternet client if one
/// claims that ProgID, else as the ProgID itself.
pub fn current_default() -> Option<ForwardTarget> {
    let progid = user_choice("https").or_else(|| user_choice("http"))?;
    if SELF_PROGIDS.iter().any(|p| p.eq_ignore_ascii_case(&progid)) {
        return None;
    }
    for root in client_roots() {
        for key in root.enum_keys().filter_map(|k| k.ok()) {
            let assoc = root
                .open_subkey_with_flags(format!(r"{key}\Capabilities\URLAssociations"), KEY_READ)
                .ok()
                .and_then(|k| k.get_value::<String, _>("https").ok());
            if assoc.map(|a| a.eq_ignore_ascii_case(&progid)).unwrap_or(false) {
                if let Some(cmd) = default_value(&root, &format!(r"{key}\shell\open\command")) {
                    let name = default_value(&root, &key).unwrap_or_else(|| key.clone());
                    let t = ForwardTarget { kind: Kind::WinClient, id: key.clone(), name, command: cmd };
                    if !is_self(&t, None, None) {
                        return Some(t);
                    }
                }
            }
        }
    }
    let cmd = progid_command(&progid)?;
    Some(ForwardTarget { kind: Kind::WinProgid, id: progid.clone(), name: progid, command: cmd })
}

fn set_default(path: &str, value: &str) -> Result<(), String> {
    let (k, _) = hkcu().create_subkey(path).map_err(|e| format!("{path}: {e}"))?;
    k.set_value("", &value.to_string()).map_err(|e| format!("{path}: {e}"))
}

fn set_named(path: &str, name: &str, value: &str) -> Result<(), String> {
    let (k, _) = hkcu().create_subkey(path).map_err(|e| format!("{path}: {e}"))?;
    k.set_value(name, &value.to_string()).map_err(|e| format!("{path}\\{name}: {e}"))
}

fn notify_assoc_changed() {
    use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
    unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED as _, SHCNF_IDLIST as _, std::ptr::null(), std::ptr::null()) };
}

/// Per-user browser-candidate registration (docs/DESKTOP.md section 3, Windows).
pub fn register(exe: &Path) -> Result<(), String> {
    let exe = exe.to_string_lossy().to_string();
    let open = format!("\"{exe}\" \"%1\"");
    let icon = format!("\"{exe}\",0");
    for (progid, label) in [(PROGID_URL, "Linkwache URL"), (PROGID_HTML, "Linkwache HTML document")] {
        let base = format!(r"Software\Classes\{progid}");
        set_default(&base, label)?;
        set_named(&base, "FriendlyTypeName", label)?;
        set_default(&format!(r"{base}\DefaultIcon"), &icon)?;
        set_default(&format!(r"{base}\shell\open\command"), &open)?;
        set_named(&format!(r"{base}\Application"), "ApplicationName", "Linkwache")?;
    }
    let c = format!(r"{CLIENTS}\{SELF_CLIENT}");
    set_default(&c, "Linkwache")?;
    set_default(&format!(r"{c}\DefaultIcon"), &icon)?;
    set_default(&format!(r"{c}\shell\open\command"), &format!("\"{exe}\""))?;
    let cap = format!(r"{c}\Capabilities");
    set_named(&cap, "ApplicationName", "Linkwache")?;
    set_named(&cap, "ApplicationDescription", "Checks every link before it opens")?;
    set_named(&cap, "ApplicationIcon", &icon)?;
    set_named(&format!(r"{cap}\StartMenu"), "StartMenuInternet", SELF_CLIENT)?;
    for scheme in ["http", "https"] {
        set_named(&format!(r"{cap}\URLAssociations"), scheme, PROGID_URL)?;
    }
    for ext in [".html", ".htm", ".xhtml"] {
        set_named(&format!(r"{cap}\FileAssociations"), ext, PROGID_HTML)?;
    }
    set_named(r"Software\RegisteredApplications", "Linkwache", &format!(r"{CLIENTS}\{SELF_CLIENT}\Capabilities"))?;
    notify_assoc_changed();
    Ok(())
}

pub fn unregister() -> Result<(), String> {
    let cu = hkcu();
    let _ = cu.delete_subkey_all(format!(r"{CLIENTS}\{SELF_CLIENT}"));
    let _ = cu.delete_subkey_all(format!(r"Software\Classes\{PROGID_URL}"));
    let _ = cu.delete_subkey_all(format!(r"Software\Classes\{PROGID_HTML}"));
    if let Ok(k) = cu.open_subkey_with_flags(r"Software\RegisteredApplications", winreg::enums::KEY_ALL_ACCESS) {
        let _ = k.delete_value("Linkwache");
    }
    for (_, _, key) in nm_registry() {
        let _ = cu.delete_subkey_all(key);
    }
    notify_assoc_changed();
    Ok(())
}

pub fn is_default() -> bool {
    let me = |s: &str| user_choice(s).map(|p| p.eq_ignore_ascii_case(PROGID_URL)).unwrap_or(false);
    me("http") && me("https")
}

/// Only the user may set the default on Windows: open the Settings page for Linkwache.
pub fn make_default() -> MakeDefault {
    if let Err(e) = register(&super::self_exe()) {
        return MakeDefault::Failed(e);
    }
    if is_default() {
        return MakeDefault::Done;
    }
    // explorer.exe opens the ms-settings: URI (its exit code is not meaningful).
    match std::process::Command::new("explorer.exe").arg(SETTINGS_URI).spawn() {
        Ok(_) => MakeDefault::User,
        Err(e) => MakeDefault::Failed(e.to_string()),
    }
}

pub fn launch(t: &ForwardTarget, arg: &str) -> Result<(), String> {
    let cmd = match t.kind {
        Kind::WinClient => client_command(&t.id),
        Kind::WinProgid => progid_command(&t.id),
        _ => return Err("wrong target kind".into()),
    }
    .ok_or_else(|| format!("no open command for {}", t.id))?;
    let (program, args) = windows_argv(&cmd, arg).ok_or("bad command")?;
    let own = std::env::current_exe().ok();
    if is_self(t, Some(&program), own.as_deref()) {
        return Err("loop: the forward target is Linkwache itself".into());
    }
    super::spawn_detached(&program, &args)
}

fn nm_dir() -> PathBuf {
    linkwache_core::store::default_dir().join("native-messaging")
}

/// (browser, is_firefox, registry key below HKCU).
fn nm_registry() -> Vec<(&'static str, bool, String)> {
    let h = linkwache_core::nm::HOST_NAME;
    vec![
        ("chrome", false, format!(r"Software\Google\Chrome\NativeMessagingHosts\{h}")),
        ("chromium", false, format!(r"Software\Chromium\NativeMessagingHosts\{h}")),
        ("edge", false, format!(r"Software\Microsoft\Edge\NativeMessagingHosts\{h}")),
        ("brave", false, format!(r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\{h}")),
        ("firefox", true, format!(r"Software\Mozilla\NativeMessagingHosts\{h}")),
    ]
}

/// On Windows the manifests are files referenced from the registry; `loc` is the file.
pub fn nm_locations() -> Vec<(&'static str, bool, PathBuf)> {
    nm_registry().into_iter().map(|(b, ff, _)| (b, ff, nm_dir().join(if ff { "firefox.json" } else { "chromium.json" }))).collect()
}

pub fn write_nm(loc: &Path, manifest: &serde_json::Value) -> Result<(), String> {
    std::fs::create_dir_all(nm_dir()).map_err(|e| e.to_string())?;
    std::fs::write(loc, serde_json::to_vec_pretty(manifest).unwrap()).map_err(|e| e.to_string())?;
    let ff = loc.file_name().map(|n| n == "firefox.json").unwrap_or(false);
    for (_, is_ff, key) in nm_registry() {
        if is_ff == ff {
            set_default(&key, &loc.to_string_lossy())?;
        }
    }
    Ok(())
}

pub fn nm_installed() -> Vec<String> {
    nm_registry().into_iter().filter(|(_, _, k)| default_value(&hkcu(), k).map(|p| Path::new(&p).exists()).unwrap_or(false)).map(|(b, _, _)| b.to_string()).collect()
}
