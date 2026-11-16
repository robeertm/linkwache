//! The shared vectors pin the Rust port to the server code (docs/DESKTOP.md section 5).

use linkwache_core::heuristics::{heuristics, verdict};
use linkwache_core::redirect::unwrap;
use serde_json::Value;

fn load(name: &str) -> Value {
    let p = format!("{}/../../test/vectors/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

#[test]
fn heuristics_vectors_match_exactly() {
    let v = load("heuristics.json");
    let vectors = v["vectors"].as_array().unwrap();
    assert!(vectors.len() >= 30);
    let mut failures = Vec::new();
    for vec in vectors {
        let url = vec["url"].as_str().unwrap();
        let (findings, _) = heuristics(url).unwrap_or_else(|| panic!("parse {url}"));
        let got: Vec<(String, String)> = findings.iter().map(|f| (f.key.clone(), f.stufe.clone())).collect();
        let want: Vec<(String, String)> = vec["findings"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| (f["key"].as_str().unwrap().to_string(), f["stufe"].as_str().unwrap().to_string()))
            .collect();
        let st = verdict(&findings, url).stufe;
        if got != want || st != vec["stufe"].as_str().unwrap() {
            failures.push(format!("{url}: got {got:?} / {st}, want {want:?} / {}", vec["stufe"]));
        }
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}

#[test]
fn redirector_vectors_match_exactly() {
    let v = load("redirectors.json");
    let mut failures = Vec::new();
    for vec in v["vectors"].as_array().unwrap() {
        let input = vec["in"].as_str().unwrap();
        let want = vec["out"].as_str().map(String::from);
        let got = unwrap(input);
        if got != want {
            failures.push(format!("{input}: got {got:?}, want {want:?}"));
        }
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}
