fn main() {
    println!("cargo:rerun-if-env-changed=LINKWACHE_DEFAULT_SERVER");
    tauri_build::build()
}
