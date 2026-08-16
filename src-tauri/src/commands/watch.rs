use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime, WebviewWindow};

use super::fs::mtime_ms;

/// Sent to a window when its file changed underneath it. See CLAUDE.md
/// section 9 rules 4 and 5.
pub const FILE_CHANGED_EVENT: &str = "file-changed";

/// One save by another program arrives as several events, and an editor that
/// writes atomically produces a create and a rename rather than one write.
/// Waiting for the noise to stop turns that back into a single report.
const QUIET: Duration = Duration::from_millis(150);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileChanged {
    path: String,
    /// None when the file no longer exists.
    mtime_ms: Option<f64>,
}

/// The live watcher of each window, by label. Dropping one closes its channel,
/// which ends the thread that was reading from it.
#[derive(Default)]
pub struct FileWatchers(Mutex<HashMap<String, RecommendedWatcher>>);

/// Watches the file this window is showing, replacing whatever it watched
/// before. A null path only stops watching.
#[tauri::command]
pub fn watch_file<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    path: Option<String>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let watchers = app.state::<FileWatchers>();

    let mut map = watchers
        .0
        .lock()
        .map_err(|_| "The watcher table is poisoned".to_string())?;
    map.remove(&label);

    let Some(path) = path else { return Ok(()) };
    let target = PathBuf::from(&path);

    // Watch the directory, not the file. A well behaved editor saves by
    // renaming a temporary file over the target, and that replaces the inode a
    // file watch is bound to, so the second external save would go unseen.
    let directory = target
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .ok_or_else(|| "The path has no parent directory".to_string())?;

    let (sender, receiver) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |event| {
        // A closed receiver only means the window moved on.
        let _ = sender.send(event);
    })
    .map_err(|err| err.to_string())?;

    watcher
        .watch(&directory, RecursiveMode::NonRecursive)
        .map_err(|err| err.to_string())?;

    let handle = app.clone();
    std::thread::spawn(move || report_changes(handle, label, target, receiver));

    map.insert(window.label().to_string(), watcher);
    Ok(())
}

/// Stops watching for a window that has gone. Without this the watcher, its
/// thread and its file handle would outlive every closed document.
pub fn forget<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Ok(mut map) = app.state::<FileWatchers>().0.lock() {
        map.remove(label);
    }
}

/// Reports each settled change to the window, until the watcher is dropped.
fn report_changes<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    target: PathBuf,
    receiver: Receiver<notify::Result<notify::Event>>,
) {
    let name = target.file_name().map(std::ffi::OsStr::to_os_string);

    while let Ok(first) = receiver.recv() {
        if !touches(&first, name.as_deref()) {
            continue;
        }

        // Drain the rest of the burst, so a save is reported once.
        loop {
            match receiver.recv_timeout(QUIET) {
                Ok(_) => continue,
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }

        let payload = FileChanged {
            path: target.to_string_lossy().into_owned(),
            mtime_ms: mtime_ms(&target).ok(),
        };
        let _ = app.emit_to(
            EventTarget::webview_window(&label),
            FILE_CHANGED_EVENT,
            payload,
        );
    }
}

/// The directory holds other files, and our own temporary file passes through
/// it on every save, so events are matched against the file name.
///
/// The name rather than the whole path: FSEvents on macOS reports the resolved
/// path, so a document under a symlinked directory would never compare equal.
/// The watch is not recursive, so within it the name is enough.
fn touches(event: &notify::Result<notify::Event>, name: Option<&std::ffi::OsStr>) -> bool {
    match event {
        Ok(event) => event
            .paths
            .iter()
            .any(|path| path.file_name() == name && name.is_some()),
        Err(_) => false,
    }
}
