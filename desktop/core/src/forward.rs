//! Forward target (the user's real browser) and the loop guard: the target can never be
//! Linkwache itself. Also the platform-neutral parsing of launch command lines
//! (freedesktop `Exec=` lines, Windows `shell\open\command` strings).

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    /// macOS: bundle identifier, launched with `open -b <id> <url>`.
    MacBundle,
    /// Windows: key below `Software\Clients\StartMenuInternet`.
    WinClient,
    /// Windows: a ProgID such as `ChromeHTML` (its `shell\open\command`).
    WinProgid,
    /// Linux: desktop file id such as `firefox.desktop`.
    LinuxDesktop,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForwardTarget {
    pub kind: Kind,
    pub id: String,
    pub name: String,
    /// The command found when the target was chosen (Windows command, Linux Exec line, macOS
    /// bundle path). Informational: it is resolved again before every launch.
    #[serde(default)]
    pub command: String,
}

/// Identities of Linkwache itself on every platform.
pub const SELF_BUNDLE_ID: &str = "app.linkwache.desktop";
pub const SELF_CLIENT: &str = "Linkwache";
pub const SELF_PROGIDS: &[&str] = &["LinkwacheURL", "LinkwacheHTML"];
pub const SELF_DESKTOP: &str = "linkwache.desktop";

fn exe_is_self(program: &str, own_exe: Option<&Path>) -> bool {
    let p = Path::new(program);
    // Split on both separators so Windows paths are understood on every platform.
    let file = program.rsplit(['/', '\\']).next().unwrap_or(program).to_ascii_lowercase();
    let stem = file.strip_suffix(".exe").unwrap_or(&file);
    if stem.starts_with("linkwache") {
        return true;
    }
    if let Some(own) = own_exe {
        let a = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
        let b = std::fs::canonicalize(own).unwrap_or_else(|_| own.to_path_buf());
        if a == b {
            return true;
        }
    }
    false
}

/// Loop guard: true if the target (or the program it would start) is Linkwache.
pub fn is_self(t: &ForwardTarget, program: Option<&str>, own_exe: Option<&Path>) -> bool {
    let id = t.id.to_ascii_lowercase();
    let by_id = match t.kind {
        Kind::MacBundle => id == SELF_BUNDLE_ID || id.contains("linkwache"),
        Kind::WinClient => id == SELF_CLIENT.to_ascii_lowercase() || id.contains("linkwache"),
        Kind::WinProgid => SELF_PROGIDS.iter().any(|p| p.eq_ignore_ascii_case(&id)) || id.contains("linkwache"),
        Kind::LinuxDesktop => id == SELF_DESKTOP || id.contains("linkwache"),
    };
    by_id || program.map(|p| exe_is_self(p, own_exe)).unwrap_or(false)
}

/// Split a freedesktop `Exec=` value into arguments and insert the URL for `%u %U %f %F`
/// (other field codes are dropped; `%%` is a literal `%`). If the line has no URL field
/// code, the URL is appended.
pub fn exec_argv(exec: &str, url: &str, name: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut has_token = false;
    let mut chars = exec.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                in_quotes = !in_quotes;
                has_token = true;
            }
            '\\' if in_quotes => {
                if let Some(n) = chars.next() {
                    cur.push(n);
                }
            }
            c if c.is_whitespace() && !in_quotes => {
                if has_token || !cur.is_empty() {
                    tokens.push(std::mem::take(&mut cur));
                    has_token = false;
                }
            }
            c => cur.push(c),
        }
    }
    if has_token || !cur.is_empty() {
        tokens.push(cur);
    }
    let mut out = Vec::new();
    let mut inserted = false;
    for tok in tokens {
        match tok.as_str() {
            "%u" | "%U" | "%f" | "%F" => {
                if !inserted {
                    out.push(url.to_string());
                    inserted = true;
                }
            }
            "%i" | "%k" | "%d" | "%D" | "%n" | "%N" | "%v" | "%m" => {}
            "%c" => out.push(name.to_string()),
            _ => {
                let mut s = String::new();
                let mut it = tok.chars().peekable();
                while let Some(c) = it.next() {
                    if c == '%' {
                        match it.next() {
                            Some('%') => s.push('%'),
                            Some('u') | Some('U') | Some('f') | Some('F') => {
                                s.push_str(url);
                                inserted = true;
                            }
                            _ => {}
                        }
                    } else {
                        s.push(c);
                    }
                }
                if !s.is_empty() {
                    out.push(s);
                }
            }
        }
    }
    if !inserted {
        out.push(url.to_string());
    }
    out
}

/// Split a Windows command string (`"C:\…\chrome.exe" --single-argument %1`) into program and
/// arguments, with the URL in place of `%1` (or appended if there is no placeholder).
pub fn windows_argv(command: &str, url: &str) -> Option<(String, Vec<String>)> {
    let s = command.trim();
    if s.is_empty() {
        return None;
    }
    let (program, rest) = if let Some(stripped) = s.strip_prefix('"') {
        let end = stripped.find('"')?;
        (stripped[..end].to_string(), stripped[end + 1..].to_string())
    } else {
        let low = s.to_ascii_lowercase();
        match low.find(".exe") {
            Some(i) => (s[..i + 4].to_string(), s[i + 4..].to_string()),
            None => match s.split_once(' ') {
                Some((a, b)) => (a.to_string(), b.to_string()),
                None => (s.to_string(), String::new()),
            },
        }
    };
    let mut args = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut has = false;
    for c in rest.chars() {
        match c {
            '"' => {
                in_quotes = !in_quotes;
                has = true;
            }
            c if c.is_whitespace() && !in_quotes => {
                if has || !cur.is_empty() {
                    args.push(std::mem::take(&mut cur));
                    has = false;
                }
            }
            c => cur.push(c),
        }
    }
    if has || !cur.is_empty() {
        args.push(cur);
    }
    let mut inserted = false;
    let mut out = Vec::new();
    for a in args {
        if a == "%1" || a == "%l" || a == "%L" {
            out.push(url.to_string());
            inserted = true;
        } else if a == "%*" {
            continue;
        } else if a.contains("%1") {
            out.push(a.replace("%1", url));
            inserted = true;
        } else {
            out.push(a);
        }
    }
    if !inserted {
        out.push(url.to_string());
    }
    Some((program, out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(kind: Kind, id: &str) -> ForwardTarget {
        ForwardTarget { kind, id: id.into(), name: id.into(), command: String::new() }
    }

    #[test]
    fn loop_guard_by_id() {
        assert!(is_self(&t(Kind::MacBundle, "app.linkwache.desktop"), None, None));
        assert!(is_self(&t(Kind::WinClient, "Linkwache"), None, None));
        assert!(is_self(&t(Kind::WinProgid, "LinkwacheURL"), None, None));
        assert!(is_self(&t(Kind::LinuxDesktop, "linkwache.desktop"), None, None));
        assert!(is_self(&t(Kind::LinuxDesktop, "Linkwache.desktop"), None, None));
        assert!(!is_self(&t(Kind::LinuxDesktop, "firefox.desktop"), Some("/usr/bin/firefox"), None));
        assert!(!is_self(&t(Kind::MacBundle, "org.mozilla.firefox"), None, None));
    }

    #[test]
    fn loop_guard_by_program() {
        let f = t(Kind::LinuxDesktop, "my-browser.desktop");
        assert!(is_self(&f, Some("/opt/Linkwache/linkwache"), None));
        assert!(is_self(&f, Some("C:\\Users\\u\\AppData\\Local\\Linkwache\\Linkwache.exe"), None));
        let own = std::env::current_exe().unwrap();
        assert!(is_self(&f, Some(own.to_str().unwrap()), Some(&own)));
        assert!(!is_self(&f, Some("/usr/bin/true"), Some(&own)));
    }

    #[test]
    fn desktop_exec_lines() {
        let url = "https://example.com/a?b=1&c=%20";
        assert_eq!(exec_argv("/usr/lib/firefox/firefox %u", url, "Firefox"), vec!["/usr/lib/firefox/firefox", url]);
        assert_eq!(exec_argv("chromium --new-window %U", url, "C"), vec!["chromium", "--new-window", url]);
        assert_eq!(exec_argv("\"/opt/My Browser/br\" --x=%% %i %c", url, "My"), vec!["/opt/My Browser/br", "--x=%", "My", url]);
        assert_eq!(exec_argv("env A=1 browser", url, "B"), vec!["env", "A=1", "browser", url]);
        assert_eq!(exec_argv("br --url=%u", url, "B"), vec!["br", format!("--url={url}").as_str()]);
        assert_eq!(exec_argv("\"/a\\\"b\" %u", url, "B"), vec!["/a\"b", url]);
    }

    #[test]
    fn windows_command_lines() {
        let url = "https://example.com/?a=1&b=2";
        let (p, a) = windows_argv("\"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\" --single-argument %1", url).unwrap();
        assert_eq!(p, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
        assert_eq!(a, vec!["--single-argument", url]);
        let (p, a) = windows_argv("\"C:\\Program Files\\Mozilla Firefox\\firefox.exe\" -osint -url \"%1\"", url).unwrap();
        assert_eq!(p, "C:\\Program Files\\Mozilla Firefox\\firefox.exe");
        assert_eq!(a, vec!["-osint", "-url", url]);
        let (p, a) = windows_argv("\"C:\\x\\msedge.exe\"", url).unwrap();
        assert_eq!(p, "C:\\x\\msedge.exe");
        assert_eq!(a, vec![url]);
        let (p, a) = windows_argv("C:\\Program Files\\B\\b.exe %1", url).unwrap();
        assert_eq!(p, "C:\\Program Files\\B\\b.exe");
        assert_eq!(a, vec![url]);
        assert!(windows_argv("  ", url).is_none());
    }
}
