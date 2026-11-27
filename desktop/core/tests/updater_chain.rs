//! Evidence for the updater promises (docs/DESKTOP.md section 8), without a real release or key:
//! signature check (same minisign verifier the Tauri updater uses), backup before install,
//! a refused update leaves the installed app untouched, rollback copy, data survives.
//! Fixtures: tests/fixtures/updater (throwaway key, see desktop/scripts/make_updater_fixture.py).

use linkwache_core::store::Paths;
use linkwache_core::updater::{backup, backup_item, mark_good, record_start, FAILED_STARTS};
use minisign_verify::{PublicKey, Signature};
use std::fs;
use std::path::PathBuf;

fn fx(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/updater").join(name)
}

fn verify(pub_text: &str, sig_file: &str, data: &[u8]) -> Result<(), String> {
    let pk = PublicKey::decode(pub_text).map_err(|e| e.to_string())?;
    let sig = Signature::decode(&fs::read_to_string(fx(sig_file)).unwrap()).map_err(|e| e.to_string())?;
    pk.verify(data, &sig, false).map_err(|e| e.to_string())
}

fn test_pub() -> String {
    fs::read_to_string(fx("test.pub")).unwrap()
}

/// The key baked into the app must be a well-formed minisign public key (a typo would
/// make every future update unverifiable).
#[test]
fn shipped_updater_key_is_wellformed() {
    let conf = fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src-tauri/tauri.conf.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&conf).unwrap();
    let b64 = v["plugins"]["updater"]["pubkey"].as_str().expect("pubkey");
    let raw = String::from_utf8(b64_decode(b64)).expect("pubkey is text");
    PublicKey::decode(&raw).expect("shipped pubkey decodes");
    for e in v["plugins"]["updater"]["endpoints"].as_array().unwrap() {
        assert!(e.as_str().unwrap().starts_with("https://"), "update endpoints are https only");
    }
}

fn b64_decode(s: &str) -> Vec<u8> {
    let t: Vec<u8> = s.bytes().filter(|b| *b != b'=').collect();
    let val = |c: u8| b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".iter().position(|x| *x == c).unwrap() as u32;
    let mut out = Vec::new();
    for ch in t.chunks(4) {
        let mut n = 0u32;
        for (i, c) in ch.iter().enumerate() {
            n |= val(*c) << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if ch.len() > 2 { out.push((n >> 8) as u8); }
        if ch.len() > 3 { out.push(n as u8); }
    }
    out
}

#[test]
fn good_signature_is_accepted() {
    let art = fs::read(fx("artefact-9.9.9.bin")).unwrap();
    verify(&test_pub(), "artefact-9.9.9.bin.sig", &art).unwrap();
}

#[test]
fn tampered_artefact_is_rejected() {
    let mut art = fs::read(fx("artefact-9.9.9.bin")).unwrap();
    art[10] ^= 1;
    assert!(verify(&test_pub(), "artefact-9.9.9.bin.sig", &art).is_err());
    let short = &art[..art.len() - 1];
    assert!(verify(&test_pub(), "artefact-9.9.9.bin.sig", short).is_err());
}

#[test]
fn signature_of_a_foreign_key_is_rejected() {
    let art = fs::read(fx("artefact-9.9.9.bin")).unwrap();
    assert!(verify(&test_pub(), "artefact-9.9.9.bin.othersig", &art).is_err());
}

#[test]
fn garbage_signature_is_rejected() {
    assert!(Signature::decode("not a signature").is_err());
}

/// Whole chain on disk: backup first, verified update replaces the app, refused update does not,
/// three failed starts of the new version offer the backup, restoring it brings the old app
/// back, and settings + history are byte-identical throughout.
#[test]
fn update_refusal_rollback_and_data_survive() {
    let tmp = tempfile::tempdir().unwrap();
    let paths = Paths::new(tmp.path().join("data"));
    fs::create_dir_all(tmp.path().join("data")).unwrap();
    let app = tmp.path().join("linkwache-app");
    fs::write(&app, b"old app 0.8.8").unwrap();
    let settings = br#"{"lang":"de","server":"https://example.org","allowlist":["example.com"]}"#;
    let history = br#"{"items":[{"host":"example.com","outcome":"green"}]}"#;
    fs::write(paths.settings(), settings).unwrap();
    fs::write(paths.history(), history).unwrap();
    mark_good(&paths, "0.8.8").unwrap();

    let art = fs::read(fx("artefact-9.9.9.bin")).unwrap();
    let install = |bytes: &[u8]| -> Result<(), String> {
        verify(&test_pub(), "artefact-9.9.9.bin.sig", bytes)?;
        backup(&paths, &app, "0.8.8").map_err(|e| e.to_string())?;
        fs::write(&app, bytes).map_err(|e| e.to_string())
    };

    // Refused: nothing touched.
    let mut bad = art.clone();
    bad[0] ^= 1;
    assert!(install(&bad).is_err());
    assert_eq!(fs::read(&app).unwrap(), b"old app 0.8.8");
    assert!(backup_item(&paths, "0.8.8").is_none(), "no backup churn for a refused update");

    // Accepted: backup holds the old app, the app is the new one.
    install(&art).unwrap();
    assert_eq!(fs::read(&app).unwrap(), art);
    let kept = backup_item(&paths, "0.8.8").unwrap();
    assert_eq!(fs::read(&kept).unwrap(), b"old app 0.8.8");

    // The new version fails to start FAILED_STARTS times: the backup is offered.
    let mut state = record_start(&paths, "9.9.9").unwrap();
    for _ in 1..FAILED_STARTS {
        assert_eq!(state.offer_backup, None);
        state = record_start(&paths, "9.9.9").unwrap();
    }
    assert_eq!(state.offer_backup.as_deref(), Some("0.8.8"));

    // Rollback = put the offered copy back.
    fs::copy(backup_item(&paths, "0.8.8").unwrap(), &app).unwrap();
    assert_eq!(fs::read(&app).unwrap(), b"old app 0.8.8");

    // Data survived everything.
    assert_eq!(fs::read(paths.settings()).unwrap(), settings);
    assert_eq!(fs::read(paths.history()).unwrap(), history);
}
