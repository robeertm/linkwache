//! macOS: the bundle declares http/https URL types and the HTML document type (Info.plist);
//! `LSSetDefaultHandlerForURLScheme` asks the user once; forwarding uses
//! `open -b <bundle id of the saved browser> <url>` (never plain `open <url>`).

use super::MakeDefault;
use core_foundation::array::{CFArray, CFArrayRef};
use core_foundation::base::TCFType;
use core_foundation::string::{CFString, CFStringRef};
use core_foundation::url::{CFURLRef, CFURL};
use core_foundation_sys::error::CFErrorRef;
use linkwache_core::forward::{is_self, ForwardTarget, Kind, SELF_BUNDLE_ID};
use std::path::{Path, PathBuf};

#[link(name = "CoreServices", kind = "framework")]
extern "C" {
    fn LSCopyDefaultHandlerForURLScheme(scheme: CFStringRef) -> CFStringRef;
    fn LSSetDefaultHandlerForURLScheme(scheme: CFStringRef, bundle: CFStringRef) -> i32;
    fn LSCopyAllHandlersForURLScheme(scheme: CFStringRef) -> CFArrayRef;
    fn LSCopyApplicationURLsForBundleIdentifier(bundle: CFStringRef, err: *mut CFErrorRef) -> CFArrayRef;
    fn LSRegisterURL(url: CFURLRef, update: u8) -> i32;
}

fn default_handler(scheme: &str) -> Option<String> {
    let s = CFString::new(scheme);
    unsafe {
        let r = LSCopyDefaultHandlerForURLScheme(s.as_concrete_TypeRef());
        if r.is_null() {
            None
        } else {
            Some(CFString::wrap_under_create_rule(r).to_string())
        }
    }
}

fn all_handlers(scheme: &str) -> Vec<String> {
    let s = CFString::new(scheme);
    unsafe {
        let r = LSCopyAllHandlersForURLScheme(s.as_concrete_TypeRef());
        if r.is_null() {
            return Vec::new();
        }
        let arr: CFArray<CFString> = CFArray::wrap_under_create_rule(r);
        arr.iter().map(|x| x.to_string()).collect()
    }
}

fn app_path(bundle: &str) -> Option<PathBuf> {
    let s = CFString::new(bundle);
    unsafe {
        let r = LSCopyApplicationURLsForBundleIdentifier(s.as_concrete_TypeRef(), std::ptr::null_mut());
        if r.is_null() {
            return None;
        }
        let arr: CFArray<CFURL> = CFArray::wrap_under_create_rule(r);
        let first = arr.iter().next().and_then(|u| u.to_path());
        first
    }
}

fn target_for(id: &str) -> ForwardTarget {
    let path = app_path(id);
    let name = path.as_ref().and_then(|p| p.file_stem()).map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| id.to_string());
    ForwardTarget { kind: Kind::MacBundle, id: id.to_string(), name, command: path.map(|p| p.to_string_lossy().to_string()).unwrap_or_default() }
}

pub fn list_browsers() -> Vec<ForwardTarget> {
    let mut ids = all_handlers("https");
    for id in all_handlers("http") {
        if !ids.iter().any(|x| x.eq_ignore_ascii_case(&id)) {
            ids.push(id);
        }
    }
    let mut out: Vec<ForwardTarget> = ids.iter().map(|id| target_for(id)).filter(|t| !is_self(t, None, None) && !t.command.is_empty()).collect();
    out.sort_by_key(|t| t.name.to_lowercase());
    out.dedup_by(|a, b| a.id.eq_ignore_ascii_case(&b.id));
    out
}

pub fn current_default() -> Option<ForwardTarget> {
    let id = default_handler("https")?;
    let t = target_for(&id);
    if is_self(&t, None, None) {
        None
    } else {
        Some(t)
    }
}

fn bundle_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors().nth(3).filter(|p| p.extension().map(|x| x == "app").unwrap_or(false)).map(|p| p.to_path_buf())
}

/// Make sure LaunchServices knows this bundle (it normally does after the first start).
pub fn register(_exe: &Path) -> Result<(), String> {
    let Some(b) = bundle_path() else { return Ok(()) };
    let url = CFURL::from_path(&b, true).ok_or("bundle url")?;
    let st = unsafe { LSRegisterURL(url.as_concrete_TypeRef(), 1) };
    if st == 0 {
        Ok(())
    } else {
        Err(format!("LSRegisterURL: {st}"))
    }
}

pub fn unregister() -> Result<(), String> {
    for (_, _, loc) in nm_locations() {
        let _ = std::fs::remove_file(loc);
    }
    Ok(())
}

pub fn is_default() -> bool {
    let me = |s: &str| default_handler(s).map(|h| h.eq_ignore_ascii_case(SELF_BUNDLE_ID)).unwrap_or(false);
    me("http") && me("https")
}

pub fn make_default() -> MakeDefault {
    if is_default() {
        return MakeDefault::Done;
    }
    let _ = register(&super::self_exe());
    let me = CFString::new(SELF_BUNDLE_ID);
    let mut errs = Vec::new();
    for scheme in ["http", "https"] {
        let s = CFString::new(scheme);
        let st = unsafe { LSSetDefaultHandlerForURLScheme(s.as_concrete_TypeRef(), me.as_concrete_TypeRef()) };
        if st != 0 {
            errs.push(format!("{scheme}: {st}"));
        }
    }
    if is_default() {
        MakeDefault::Done
    } else if errs.is_empty() {
        // macOS shows its confirmation dialog; the assistant polls is_default().
        MakeDefault::User
    } else {
        MakeDefault::Failed(errs.join(", "))
    }
}

pub fn launch(t: &ForwardTarget, arg: &str) -> Result<(), String> {
    if t.kind != Kind::MacBundle {
        return Err("wrong target kind".into());
    }
    let own = std::env::current_exe().ok();
    let program = app_path(&t.id).map(|p| p.to_string_lossy().to_string());
    if is_self(t, program.as_deref(), own.as_deref()) || program.as_deref().map(|p| p.to_ascii_lowercase().contains("linkwache.app")).unwrap_or(false) {
        return Err("loop: the forward target is Linkwache itself".into());
    }
    super::spawn_detached("/usr/bin/open", &["-b".to_string(), t.id.clone(), arg.to_string()])
}

fn app_support() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/tmp")).join("Library/Application Support")
}

pub fn nm_locations() -> Vec<(&'static str, bool, PathBuf)> {
    let a = app_support();
    let all: Vec<(&str, bool, PathBuf)> = vec![
        ("chrome", false, a.join("Google/Chrome")),
        ("chromium", false, a.join("Chromium")),
        ("edge", false, a.join("Microsoft Edge")),
        ("brave", false, a.join("BraveSoftware/Brave-Browser")),
        ("firefox", true, a.join("Mozilla")),
    ];
    all.into_iter()
        .filter(|(_, _, p)| p.is_dir())
        .map(|(b, ff, p)| {
            let dir = if ff { p.join("NativeMessagingHosts") } else { p.join("NativeMessagingHosts") };
            (b, ff, dir.join(format!("{}.json", linkwache_core::nm::HOST_NAME)))
        })
        .collect()
}

pub fn write_nm(loc: &Path, manifest: &serde_json::Value) -> Result<(), String> {
    if let Some(d) = loc.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    std::fs::write(loc, serde_json::to_vec_pretty(manifest).unwrap()).map_err(|e| e.to_string())
}

pub fn nm_installed() -> Vec<String> {
    nm_locations().into_iter().filter(|(_, _, p)| p.exists()).map(|(b, _, _)| b.to_string()).collect()
}
