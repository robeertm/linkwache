fn main() {
    println!("cargo:rerun-if-env-changed=LINKWACHE_DEFAULT_SERVER");
    println!("cargo:rerun-if-env-changed=LINKWACHE_PRESET_MIGRATE_FROM");
    tauri_build::build()
}
