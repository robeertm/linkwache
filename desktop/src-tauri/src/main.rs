// Release builds have no console window on Windows (stdio still works for the
// native-messaging host and for redirected CLI output).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    linkwache_app::main_entry();
}
