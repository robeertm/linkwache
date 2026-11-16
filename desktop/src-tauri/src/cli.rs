//! Command-line actions (no window): used by the installer hooks, by administrators and by the
//! end-to-end tests. `linkwache --help` lists them.

use crate::platform;
use crate::state::{preset, system_locale, VERSION};
use linkwache_core::forward::{is_self, ForwardTarget, Kind};
use linkwache_core::link::{valid_server, Scope};
use linkwache_core::settings::{Settings, LANGS};
use linkwache_core::store::Paths;
use serde_json::{json, Value};

const HELP: &str = "Linkwache desktop

Usage:
  linkwache [URL|FILE ...]          check and open links (normal use, also via the OS)
  linkwache --status [--out FILE]   handler/default/forward status as JSON
  linkwache --register              register as browser candidate + native-messaging hosts
  linkwache --unregister            remove those registrations
  linkwache --make-default          ask the system to make Linkwache the default
  linkwache --list-browsers         installed browsers (possible forward targets) as JSON
  linkwache --configure KEY=VALUE…  server=URL forward=KIND:ID lang=de scope=url|domain
                                    setup-done=1 update-check=0|1 autostart=0|1
  linkwache --version
";

pub fn is_cli(args: &[String]) -> bool {
    matches!(
        args.get(1).map(String::as_str),
        Some("--status" | "--register" | "--unregister" | "--make-default" | "--list-browsers" | "--configure" | "--version" | "--help" | "-h")
    )
}

fn emit(v: &Value, args: &[String]) {
    let text = serde_json::to_string_pretty(v).unwrap();
    if let Some(i) = args.iter().position(|a| a == "--out") {
        if let Some(p) = args.get(i + 1) {
            let _ = std::fs::write(p, &text);
            return;
        }
    }
    println!("{text}");
}

pub fn status() -> Value {
    let paths = Paths::default_location();
    let s = Settings::load(&paths);
    json!({
        "version": VERSION,
        "platform": platform::PLATFORM,
        "exe": platform::self_exe(),
        "isDefault": platform::is_default(),
        "currentDefault": platform::current_default(),
        "forward": s.as_ref().and_then(|s| s.forward.clone()),
        "server": s.as_ref().map(|s| s.server.clone()),
        "setupDone": s.as_ref().map(|s| s.setup_done).unwrap_or(false),
        "nativeHosts": platform::nm_installed(),
        "configDir": paths.dir,
    })
}

fn parse_kind(k: &str) -> Option<Kind> {
    Some(match k {
        "mac-bundle" => Kind::MacBundle,
        "win-client" => Kind::WinClient,
        "win-progid" => Kind::WinProgid,
        "linux-desktop" => Kind::LinuxDesktop,
        _ => return None,
    })
}

fn configure(pairs: &[String]) -> Result<Value, String> {
    let paths = Paths::default_location();
    let mut s = Settings::load_or_create(&paths, &preset(), &system_locale()).map_err(|e| e.to_string())?;
    for p in pairs {
        let (k, v) = p.split_once('=').ok_or_else(|| format!("expected KEY=VALUE: {p}"))?;
        match k {
            "server" => s.set_server(valid_server(v).ok_or("invalid server address")?, &preset()),
            "lang" if LANGS.contains(&v) => s.lang = v.into(),
            "scope" => s.scope = Scope::parse(v),
            "setup-done" => s.setup_done = v == "1" || v == "true",
            "update-check" => s.update_check = v == "1" || v == "true",
            "autostart" => s.autostart = v == "1" || v == "true",
            "forward" => {
                let (kind, id) = v.split_once(':').ok_or("forward=KIND:ID")?;
                let kind = parse_kind(kind).ok_or("unknown forward kind")?;
                let t = platform::list_browsers()
                    .into_iter()
                    .find(|b| b.kind == kind && b.id == id)
                    .unwrap_or(ForwardTarget { kind, id: id.into(), name: id.into(), command: String::new() });
                if is_self(&t, None, None) {
                    return Err("the forward target can not be Linkwache itself".into());
                }
                s.forward = Some(t);
            }
            _ => return Err(format!("unknown or invalid setting: {k}")),
        }
    }
    s.save(&paths).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

/// Run a CLI action; returns the process exit code.
pub fn run(args: &[String]) -> i32 {
    let cmd = args.get(1).map(String::as_str).unwrap_or("");
    let result: Result<Value, String> = match cmd {
        "--version" => Ok(json!({ "version": VERSION })),
        "--help" | "-h" => {
            print!("{HELP}");
            return 0;
        }
        "--status" => Ok(status()),
        "--register" => platform::register(&platform::self_exe()).map(|_| json!({ "registered": true, "nativeHosts": platform::install_native_hosts() })),
        "--unregister" => platform::unregister().map(|_| json!({ "unregistered": true })),
        "--make-default" => {
            let r = platform::make_default();
            Ok(json!({ "outcome": r.as_str(), "detail": format!("{r:?}"), "isDefault": platform::is_default() }))
        }
        "--list-browsers" => Ok(json!(platform::list_browsers())),
        "--configure" => configure(&args[2..].iter().filter(|a| a.contains('=')).cloned().collect::<Vec<_>>()),
        _ => Err("unknown command".into()),
    };
    match result {
        Ok(v) => {
            emit(&v, args);
            0
        }
        Err(e) => {
            emit(&json!({ "error": e }), args);
            1
        }
    }
}
