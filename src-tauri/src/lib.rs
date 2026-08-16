mod commands;
mod menu;

use tauri::Manager;

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::window::PendingPaths::default())
        .manage(commands::watch::FileWatchers::default())
        .setup(|app| {
            let (menu, window_menu) = menu::build(app.handle())?;
            app.set_menu(menu)?;
            // macOS keeps the window list itself, once the menu is on the bar.
            menu::attach_window_menu(&window_menu);

            // Windows and Linux hand a double clicked file over as an argument.
            // macOS does not; it sends `RunEvent::Opened` instead.
            #[cfg(not(target_os = "macos"))]
            {
                let paths: Vec<String> = std::env::args().skip(1).collect();
                if !paths.is_empty() {
                    commands::window::open_paths(app.handle(), paths);
                }
            }

            Ok(())
        })
        .on_menu_event(menu::on_event)
        .invoke_handler(tauri::generate_handler![
            commands::chrome::titlebar_metrics,
            commands::window::new_window,
            commands::window::close_all_windows,
            commands::window::initial_path,
            commands::fs::read_file,
            commands::fs::write_file_atomic,
            commands::fs::read_image,
            commands::dialog::open_dialog,
            commands::dialog::save_as_dialog,
            commands::dialog::confirm_dialog,
            commands::dialog::message_dialog,
            commands::settings::read_settings,
            commands::settings::write_settings,
            commands::watch::watch_file,
        ])
        .on_window_event(|window, event| {
            // A closed document leaves its watcher, its thread and its file
            // handle behind unless they are released here.
            if let tauri::WindowEvent::Destroyed = event {
                commands::watch::forget(window.app_handle(), window.label());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_handle, _event| {
        // Finder opening a file, whether the app was already running or was
        // launched by the double click itself.
        //
        // Only macOS delivers a file this way, and only macOS has the variant:
        // naming it anywhere else does not compile. Everywhere else the path
        // arrives as an argument and is handled in `setup` above.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|path| path.to_string_lossy().into_owned())
                .collect();
            if !paths.is_empty() {
                commands::window::open_paths(_handle, paths);
            }
        }
    });
}
