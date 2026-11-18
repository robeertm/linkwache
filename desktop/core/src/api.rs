//! Client for `POST <server>/api/v1/check` (docs/API.md) with a hard timeout.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(6);

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Request {
    pub url: String,
    pub lang: String,
    pub scope: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "kebab-case")]
pub enum ApiError {
    /// No server address configured.
    NoServer,
    Timeout,
    Network(String),
    /// HTTP status and the server's `error` field, if any.
    Status(u16, String),
    /// A 200 response that is not a v1 answer.
    BadResponse(String),
    /// An error status whose body is not JSON (a proxy or gateway page instead of the server's answer).
    BadBody(u16),
}

impl ApiError {
    /// Short machine-readable reason for the "could not be checked" window.
    pub fn reason(&self) -> &'static str {
        match self {
            ApiError::NoServer => "noserver",
            ApiError::Timeout => "timeout",
            ApiError::Network(_) => "network",
            ApiError::Status(429, _) => "rate",
            ApiError::Status(_, _) => "server",
            ApiError::BadResponse(_) => "server",
            ApiError::BadBody(_) => "server",
        }
    }

    /// Worth a try on the reserve server (docs/FALLBACK.md): timeout, no connection, status 500 or higher,
    /// an error page that is not JSON, a 2xx that is not a v1 answer. Never the server's own JSON answers
    /// (400/403/413/415, 429 rate, `err.install`) and never a missing address.
    pub fn failover_worthy(&self) -> bool {
        match self {
            ApiError::NoServer => false,
            ApiError::Timeout | ApiError::Network(_) | ApiError::BadResponse(_) | ApiError::BadBody(_) => true,
            ApiError::Status(code, _) => *code >= 500,
        }
    }
}

pub trait CheckApi {
    fn check(&self, req: &Request) -> Result<Value, ApiError>;
}

/// One server that can be asked with an explicit time limit (the failover wrapper hands out the remaining budget).
pub trait Backend {
    fn check_within(&self, req: &Request, timeout: Duration) -> Result<Value, ApiError>;
    /// `GET /api/health` answered 200 with `ok: true` (3 s limit): the server is back.
    fn healthy(&self) -> bool;
}

pub struct HttpApi {
    pub server: String,
    pub install_id: String,
    pub client: String,
    timeout: Duration,
    agent: ureq::Agent,
}

impl HttpApi {
    pub fn new(server: &str, install_id: &str, app_version: &str, timeout: Duration) -> Self {
        let agent = ureq::AgentBuilder::new()
            .timeout(timeout)
            .timeout_connect(timeout.min(Duration::from_secs(4)))
            .redirects(0)
            .user_agent(&format!("Linkwache-Desktop/{app_version}"))
            .build();
        HttpApi { server: server.trim_end_matches('/').to_string(), install_id: install_id.into(), client: format!("desktop/{app_version}"), timeout, agent }
    }

    /// `GET /api/health` — used by the setup assistant to test the address.
    pub fn health(&self) -> Result<Value, ApiError> {
        if self.server.is_empty() {
            return Err(ApiError::NoServer);
        }
        let r = self.agent.get(&format!("{}/api/health", self.server)).call();
        match r {
            Ok(resp) => resp.into_json::<Value>().map_err(|e| ApiError::BadResponse(e.to_string())),
            Err(e) => Err(map_err(e)),
        }
    }
}

fn map_err(e: ureq::Error) -> ApiError {
    match e {
        ureq::Error::Status(code, resp) => {
            match resp.into_json::<Value>() {
                Ok(v) => ApiError::Status(code, v.get("error").and_then(|x| x.as_str()).map(String::from).unwrap_or_default()),
                Err(_) if code == 429 => ApiError::Status(code, String::new()),
                Err(_) => ApiError::BadBody(code),
            }
        }
        ureq::Error::Transport(t) => {
            let msg = t.to_string();
            let low = msg.to_ascii_lowercase();
            if low.contains("timed out") || low.contains("timeout") {
                ApiError::Timeout
            } else {
                ApiError::Network(msg)
            }
        }
    }
}

impl CheckApi for HttpApi {
    fn check(&self, req: &Request) -> Result<Value, ApiError> {
        self.check_within(req, self.timeout)
    }
}

impl Backend for HttpApi {
    fn healthy(&self) -> bool {
        if self.server.is_empty() {
            return false;
        }
        match self.agent.get(&format!("{}/api/health", self.server)).timeout(Duration::from_secs(3)).call() {
            Ok(resp) => resp.status() == 200 && resp.into_json::<Value>().ok().and_then(|v| v.get("ok").and_then(|o| o.as_bool())) == Some(true),
            Err(_) => false,
        }
    }

    fn check_within(&self, req: &Request, timeout: Duration) -> Result<Value, ApiError> {
        if self.server.is_empty() {
            return Err(ApiError::NoServer);
        }
        let r = self
            .agent
            .post(&format!("{}/api/v1/check", self.server))
            .timeout(timeout)
            .set("content-type", "application/json")
            .set("x-linkwache-install", &self.install_id)
            .set("x-linkwache-client", &self.client)
            .send_json(json!(req));
        let v: Value = match r {
            Ok(resp) => resp.into_json().map_err(|e| {
                let s = e.to_string();
                if s.to_ascii_lowercase().contains("timed out") {
                    ApiError::Timeout
                } else {
                    ApiError::BadResponse(s)
                }
            })?,
            Err(e) => return Err(map_err(e)),
        };
        validate(v)
    }
}

/// Accept only real v1 answers.
pub fn validate(v: Value) -> Result<Value, ApiError> {
    let ok_api = v.get("api").and_then(|a| a.as_u64()) == Some(1);
    let stufe = v.get("stufe").and_then(|s| s.as_str()).unwrap_or("");
    if !ok_api || !matches!(stufe, "gruen" | "gelb" | "rot") {
        return Err(ApiError::BadResponse("not a v1 answer".into()));
    }
    Ok(v)
}

#[derive(Debug, Clone, Deserialize)]
pub struct Health {
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub api: Vec<u32>,
}
