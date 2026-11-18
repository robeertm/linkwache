//! Linkwache desktop app (Tauri 2). Decisions live in `linkwache-core`; this crate is the
//! operating-system and window glue. Design: docs/DESKTOP.md.

mod cli;
mod commands;
mod e2e;
mod flow;
mod platform;
mod state;
mod tray;
mod ui;
mod updates;

use linkwache_core::settings::Settings;
use linkwache_core::store::Paths;
use state::{preset, system_locale, AppState, VERSION};
use tauri::{AppHandle, Manager, RunEvent};

/// Arguments that are links/files (not our own flags, not the program path).
fn link_args(args: &[String]) -> Vec<String> {
    args.iter().skip(1).filter(|a| !a.starts_with("--") && !a.is_empty()).cloned().collect()
}

fn native_messaging_host() -> i32 {
    let paths = Paths::default_location();
    let _ = Settings::load_or_create(&paths, &preset(), &system_locale());
    let down = linkwache_core::failover::DownState::new();
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let r = linkwache_core::nm::serve(&mut stdin.lock(), &mut stdout.lock(), &paths, VERSION, &|s: &Settings| state::failover_api(s, &down));
    if r.is_ok() {
        0
    } else {
        1
    }
}

fn on_second_instance(app: &AppHandle, argv: Vec<String>) {
    let links = link_args(&argv);
    if links.is_empty() {
        if app.state::<AppState>().settings().setup_done {
            ui::open_settings(app, "general");
        } else {
            ui::open_setup(app);
        }
        return;
    }
    for l in links {
        flow::handle(app, l);
    }
}

pub fn main_entry() {
    let args: Vec<String> = std::env::args().collect();
    if linkwache_core::nm::is_host_invocation(&args) {
        std::process::exit(native_messaging_host());
    }
    if cli::is_cli(&args) {
        std::process::exit(cli::run(&args));
    }
    // WebKitGTK's DMA-BUF renderer shows blank windows on some GPUs, VMs and virtual
    // displays; the classic renderer works everywhere. Respect an explicit user setting.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    let paths = Paths::default_location();
    let start = linkwache_core::updater::record_start(&paths, VERSION).ok();
    let autostarted = args.iter().any(|a| a == "--autostart");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| on_second_instance(app, argv)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::new(paths.clone()))
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::toast_state,
            commands::get_result,
            commands::decide,
            commands::window_ready,
            commands::get_settings,
            commands::set_lang,
            commands::set_server,
            commands::test_server,
            commands::set_scope,
            commands::set_forward,
            commands::list_browsers,
            commands::handler_status,
            commands::make_default,
            commands::install_nm,
            commands::set_autostart,
            commands::set_update_check,
            commands::pause,
            commands::resume,
            commands::reset_install_id,
            commands::allow_add,
            commands::allow_remove,
            commands::finish_setup,
            commands::get_history,
            commands::clear_history,
            commands::update_status,
            commands::check_update,
            commands::install_update,
            commands::open_window,
            commands::open_guide,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(id) = window.label().strip_prefix("warn-").and_then(|s| s.parse::<u64>().ok()) {
                    flow::closed(window.app_handle(), id);
                }
            }
        })
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let handle = app.handle().clone();
            let st = handle.state::<AppState>();
            let settings = st.settings();
            // Keep the registration current (exe path may change after updates/moves).
            let _ = platform::register(&platform::self_exe());
            let _ = platform::install_native_hosts();
            let _ = ui::ensure_toast(&handle);
            if let Err(e) = tray::create(&handle) {
                eprintln!("tray: {e}");
                e2e::state("tray-error", serde_json::json!({ "error": e.to_string() }));
            }
            if let Some(s) = &start {
                updates::note_start_state(&handle, s);
            }
            updates::schedule(&handle);
            // Pause expiry and status changes show up in the tray.
            let h2 = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(30));
                tray::refresh(&h2);
            });
            // Successful start: remember this version as good (after the windows are up).
            let p2 = paths.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(10));
                let _ = linkwache_core::updater::mark_good(&p2, VERSION);
            });
            let links = link_args(&std::env::args().collect::<Vec<_>>());
            if !settings.setup_done && !autostarted {
                ui::open_setup(&handle);
            } else if links.is_empty() && !autostarted && settings.setup_done && !cfg!(feature = "e2e") {
                // Started by hand (no link): show the settings so the user sees it runs.
                ui::open_settings(&handle, "general");
            }
            for l in links {
                flow::handle(&handle, l);
            }
            e2e::start_commands(&handle);
            e2e::state("started", serde_json::json!({ "version": VERSION, "setupDone": settings.setup_done }));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Linkwache failed to start");

    app.run(|app, event| match event {
        // Keep running in the tray when the last window closes; only "Quit" ends the app.
        RunEvent::ExitRequested { api, code, .. } => {
            if code.is_none() {
                api.prevent_exit();
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => {
            for u in urls {
                let s = if u.scheme() == "file" { u.to_file_path().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|_| u.to_string()) } else { u.to_string() };
                flow::handle(app, s);
            }
        }
        _ => {
            let _ = app;
        }
    });
}
