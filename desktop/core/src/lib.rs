//! Linkwache desktop core: everything that decides about a link, without UI or Tauri.
//! See docs/DESKTOP.md (design) and docs/API.md (server contract, native messaging).

pub mod allowlist;
pub mod api;
pub mod cache;
pub mod engine;
pub mod failover;
pub mod forward;
pub mod heuristics;
pub mod history;
pub mod hostinfo;
pub mod i18n;
pub mod link;
pub mod nm;
pub mod redirect;
pub mod settings;
pub mod store;
pub mod updater;
