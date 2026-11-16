//! Local history of the last 200 checks. Stays on the device, can be cleared. Stores the
//! reduced link (no query string, no fragment), never more.

use crate::store::{read_json, write_json};
use serde::{Deserialize, Serialize};
use std::io;
use std::path::Path;

pub const MAX: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Item {
    pub time: u64,
    pub domain: String,
    /// `scheme://host[:port]/path`.
    pub url: String,
    /// `gruen`, `gelb`, `rot`, `offline`, or empty for links that were not checked.
    pub stufe: String,
    /// `allowlist`, `cache`, `server`, `local`, `extension`, `paused`.
    pub source: String,
    /// `opened`, `blocked`, `open-anyway`, `refused`, `passthrough`, `paused`.
    pub action: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct History {
    pub items: Vec<Item>,
}

impl History {
    pub fn load(path: &Path) -> History {
        read_json(path).unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> io::Result<()> {
        write_json(path, self)
    }

    /// Newest first, at most `MAX` entries.
    pub fn push(&mut self, item: Item) {
        self.items.insert(0, item);
        self.items.truncate(MAX);
    }

    /// Load, add one entry, save (used by both processes).
    pub fn append(path: &Path, item: Item) -> io::Result<()> {
        let mut h = History::load(path);
        h.push(item);
        h.save(path)
    }

    pub fn clear(path: &Path) -> io::Result<()> {
        History::default().save(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(i: u64) -> Item {
        Item { time: i, domain: "example.com".into(), url: "https://example.com/".into(), stufe: "gruen".into(), source: "server".into(), action: "opened".into() }
    }

    #[test]
    fn keeps_last_200_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("history.json");
        for i in 0..205 {
            History::append(&p, item(i)).unwrap();
        }
        let h = History::load(&p);
        assert_eq!(h.items.len(), MAX);
        assert_eq!(h.items[0].time, 204);
        assert_eq!(h.items[MAX - 1].time, 5);
        History::clear(&p).unwrap();
        assert!(History::load(&p).items.is_empty());
    }
}
