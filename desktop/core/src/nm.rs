//! Native messaging host (`app.linkwache.desktop`, docs/API.md): the browser extension
//! talks to the app over stdio with length-prefixed JSON, sharing cache, allowlist and
//! server setting.

use crate::api::CheckApi;
use crate::engine::{Decision, Engine};
use crate::history::{History, Item};
use crate::settings::Settings;
use crate::store::{now_secs, Paths};
use serde_json::{json, Value};
use std::io::{self, Read, Write};

pub const HOST_NAME: &str = "app.linkwache.desktop";
pub const CHROME_ORIGIN: &str = "chrome-extension://ldehleohedacddboipopkjkphjnphine/";
pub const FIREFOX_ID: &str = "{ef1e5d25-3e24-4517-a534-dad3a936dcb3}";
/// Messages from the browser are small; anything bigger is refused.
pub const MAX_IN: usize = 1024 * 1024;

/// True if the process was started by a browser as native-messaging host.
pub fn is_host_invocation(args: &[String]) -> bool {
    args.iter().skip(1).any(|a| a == "--native-messaging" || a.starts_with("chrome-extension://") || a == FIREFOX_ID)
}

pub fn read_message<R: Read>(r: &mut R) -> io::Result<Option<Value>> {
    let mut len = [0u8; 4];
    match r.read_exact(&mut len) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let n = u32::from_ne_bytes(len) as usize;
    if n > MAX_IN {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "message too large"));
    }
    let mut buf = vec![0u8; n];
    r.read_exact(&mut buf)?;
    Ok(Some(serde_json::from_slice(&buf).unwrap_or(Value::Null)))
}

pub fn write_message<W: Write>(w: &mut W, v: &Value) -> io::Result<()> {
    let data = serde_json::to_vec(v).map_err(io::Error::other)?;
    w.write_all(&(data.len() as u32).to_ne_bytes())?;
    w.write_all(&data)?;
    w.flush()
}

fn err(id: &Value, msg: &str) -> Value {
    json!({ "type": "error", "id": id, "error": msg })
}

/// Answer one message. `api_for` builds the API client from the current settings.
pub fn handle<A: CheckApi>(msg: &Value, paths: &Paths, app_version: &str, api_for: &dyn Fn(&Settings) -> A) -> Value {
    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    let settings = match Settings::load(paths) {
        Some(s) => s,
        None => Settings::load_or_create(paths, &crate::settings::Preset::default(), "en").unwrap_or_default(),
    };
    let s = |k: &str| msg.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    match msg.get("type").and_then(|t| t.as_str()).unwrap_or("") {
        "hello" => json!({
            "type": "hello", "app": app_version, "server": settings.server,
            "scope": settings.scope.as_str(), "paused": settings.is_paused(),
        }),
        "check" => {
            let url = s("url");
            let lang = {
                let l = s("lang");
                if crate::settings::LANGS.contains(&l.as_str()) { l } else { settings.lang.clone() }
            };
            let api = api_for(&settings);
            let engine = Engine { paths, settings: &settings, api: &api };
            match engine.prepare(&url) {
                Decision::Check(p) => {
                    let r = p.early.clone().unwrap_or_else(|| engine.remote(&p, &lang));
                    if r.stufe == "offline" {
                        return json!({
                            "type": "result", "id": id, "offline": true, "reason": r.reason,
                            "local": { "stufe": r.local.stufe, "findings": r.local.findings },
                        });
                    }
                    let mut out = match &r.server {
                        Some(Value::Object(m)) => Value::Object(m.clone()),
                        _ => json!({ "api": 1 }),
                    };
                    let o = out.as_object_mut().expect("object");
                    o.insert("type".into(), json!("result"));
                    o.insert("id".into(), id);
                    o.insert("source".into(), json!(r.source));
                    o.insert("stufe".into(), json!(r.stufe));
                    o.insert("kurzKey".into(), json!(r.kurz_key));
                    o.insert("ratKey".into(), json!(r.rat_key));
                    if r.kurz.is_none() {
                        o.remove("kurz");
                        o.remove("rat");
                    }
                    o.insert("findings".into(), json!(r.findings));
                    o.insert("host".into(), json!({ "host": r.host, "domain": r.domain, "unicodeHost": r.unicode_host }));
                    if r.unwrapped {
                        o.insert("unwrapped".into(), json!(r.target));
                    }
                    out
                }
                Decision::Paused(_) => json!({ "type": "result", "id": id, "paused": true, "stufe": "gruen", "source": "paused" }),
                Decision::PassThrough(_) | Decision::Refused(_) => err(&id, "err.nolink"),
            }
        }
        "allow" => {
            let mut st = settings.clone();
            match st.add_allowed(&s("domain")) {
                Ok(_) => match st.save(paths) {
                    Ok(()) => json!({ "type": "ok" }),
                    Err(_) => err(&id, "io"),
                },
                Err(_) => err(&id, "bad-domain"),
            }
        }
        "log" => {
            let stufe = s("stufe");
            let domain = s("domain");
            if !matches!(stufe.as_str(), "gelb" | "rot" | "offline" | "gruen") || domain.len() > 253 {
                return err(&id, "bad-log");
            }
            let action = match s("event").as_str() {
                "open-anyway" => "open-anyway",
                "blocked" => "blocked",
                "opened" => "opened",
                _ => return err(&id, "bad-log"),
            };
            let item = Item { time: now_secs(), domain: domain.clone(), url: String::new(), stufe, source: "extension".into(), action: action.into() };
            match History::append(&paths.history(), item) {
                Ok(()) => json!({ "type": "ok" }),
                Err(_) => err(&id, "io"),
            }
        }
        _ => err(&id, "unknown"),
    }
}

/// Serve until the browser closes stdin.
pub fn serve<R: Read, W: Write, A: CheckApi>(r: &mut R, w: &mut W, paths: &Paths, app_version: &str, api_for: &dyn Fn(&Settings) -> A) -> io::Result<()> {
    while let Some(msg) = read_message(r)? {
        let answer = if msg.is_object() { handle(&msg, paths, app_version, api_for) } else { err(&Value::Null, "bad-json") };
        write_message(w, &answer)?;
    }
    Ok(())
}

/// Host manifest for Chromium browsers.
pub fn chrome_manifest(exe: &str) -> Value {
    json!({
        "name": HOST_NAME,
        "description": "Linkwache desktop app",
        "path": exe,
        "type": "stdio",
        "allowed_origins": [CHROME_ORIGIN],
    })
}

/// Host manifest for Firefox.
pub fn firefox_manifest(exe: &str) -> Value {
    json!({
        "name": HOST_NAME,
        "description": "Linkwache desktop app",
        "path": exe,
        "type": "stdio",
        "allowed_extensions": [FIREFOX_ID],
    })
}
