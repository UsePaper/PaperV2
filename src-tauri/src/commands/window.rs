use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use tauri::{
    AppHandle, Emitter, EventTarget, Manager, Runtime, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

/// Sent to a window when the operating system asks us to open a file, for
/// example on a double click in Finder while the app is already running.
pub const OPEN_FILE_EVENT: &str = "open-file";

/// A file a window should open as soon as its frontend is ready.
///
/// The path cannot be handed over in the URL without escaping trouble, so it
/// waits here under the new window's label until that window asks for it.
#[derive(Default)]
pub struct PendingPaths(pub Mutex<HashMap<String, String>>);

static NEXT_WINDOW: AtomicU32 = AtomicU32::new(1);

/// The label Tauri gives the window declared in `tauri.conf.json`.
const MAIN_LABEL: &str = "main";

/// The window the user is working in. The app handle exposes no accessor for
/// this, so the window list is asked directly.
pub fn focused<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.webview_windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false))
}

/// Each new window steps down and across from the one in front, so a stack of
/// them stays clickable.
const CASCADE: f64 = 24.0;

#[tauri::command]
pub async fn new_window(app: AppHandle, path: Option<String>) -> Result<String, String> {
    new_window_for(app, path).await
}

pub async fn new_window_for<R: Runtime>(
    app: AppHandle<R>,
    path: Option<String>,
) -> Result<String, String> {
    let index = NEXT_WINDOW.fetch_add(1, Ordering::Relaxed);
    let label = format!("doc-{index}");

    if let Some(path) = path {
        app.state::<PendingPaths>()
            .0
            .lock()
            .map_err(|_| "The pending path table is poisoned".to_string())?
            .insert(label.clone(), path);
    }

    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::default())
        .title("Paper")
        .inner_size(900.0, 680.0)
        .min_inner_size(480.0, 360.0)
        .decorations(true);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    // Offset from whichever window is in front. Each new one lands relative to
    // the last, so a run of them cascades on its own.
    if let Some(front) = focused(&app) {
        if let (Ok(position), Ok(scale)) = (front.outer_position(), front.scale_factor()) {
            let logical = position.to_logical::<f64>(scale);
            builder = builder.position(logical.x + CASCADE, logical.y + CASCADE);
        }
    }

    let window = builder.build().map_err(|err| err.to_string())?;
    Ok(window.label().to_string())
}

/// The file this window was opened for, if any. Taken once, so a reload starts
/// the window empty rather than reopening the file over the user's edits.
#[tauri::command]
pub fn initial_path(app: AppHandle, window: WebviewWindow) -> Option<String> {
    app.state::<PendingPaths>()
        .0
        .lock()
        .ok()?
        .remove(window.label())
}

/// Asks every window to close. Each one runs its own unsaved work prompt, and
/// a window that refuses simply stays open. Tauri ends the process once the
/// last one is gone, so this is the whole of quitting.
#[tauri::command]
pub fn close_all_windows(app: AppHandle) {
    for window in app.webview_windows().into_values() {
        let _ = window.close();
    }
}

/// Opens files the operating system handed us.
///
/// The path is both stashed and announced. A window that has not finished
/// loading picks it up from the stash through `initial_path`; one that is
/// already running hears the event. The frontend ignores a path it is already
/// showing, so arriving twice is harmless.
pub fn open_paths<R: Runtime>(app: &AppHandle<R>, paths: Vec<String>) {
    for path in paths {
        // Prefer the window in front; at launch nothing is focused yet, so fall
        // back to whichever window exists.
        let target = focused(app).or_else(|| app.webview_windows().into_values().next());

        match target {
            // A running window is listening, so the event is enough. Stashing
            // here would leave an entry nothing ever drains, and the file would
            // reopen if that window were reloaded.
            Some(window) => {
                let label = window.label().to_string();
                let _ = app.emit_to(EventTarget::webview_window(&label), OPEN_FILE_EVENT, &path);
            }
            // Launch: the window declared in the config has not appeared yet.
            // It will ask for its path as soon as it is ready, so leave it
            // there rather than opening a second, empty window beside it.
            None => {
                let claimed = app
                    .state::<PendingPaths>()
                    .0
                    .lock()
                    .map(|mut pending| match pending.entry(MAIN_LABEL.to_string()) {
                        std::collections::hash_map::Entry::Vacant(slot) => {
                            slot.insert(path.clone());
                            true
                        }
                        // A file earlier in this batch already took it.
                        std::collections::hash_map::Entry::Occupied(_) => false,
                    })
                    .unwrap_or(false);

                if !claimed {
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = new_window_for(handle, Some(path)).await;
                    });
                }
            }
        }
    }
}
