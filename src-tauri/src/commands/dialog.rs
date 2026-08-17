use std::sync::mpsc;

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const FILTER_NAME: &str = "Markdown";
const EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "txt"];

/// The pick callbacks fire on the UI thread, so the command waits on a channel
/// rather than calling the blocking helpers, which would deadlock.
#[tauri::command]
pub async fn open_dialog(app: AppHandle) -> Option<String> {
    let (sender, receiver) = mpsc::channel();
    app.dialog()
        .file()
        .add_filter(FILTER_NAME, EXTENSIONS)
        .pick_file(move |picked| {
            let _ = sender.send(picked);
        });

    receiver
        .recv()
        .ok()
        .flatten()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

/// A native question. Given a parent window it opens as a real sheet attached
/// to the title bar, rather than as a webview dialog.
#[tauri::command]
pub async fn confirm_dialog(
    app: AppHandle,
    title: String,
    message: String,
    confirm_label: String,
    cancel_label: String,
) -> bool {
    let (sender, receiver) = mpsc::channel();
    let mut builder =
        app.dialog()
            .message(message)
            .title(title)
            .buttons(MessageDialogButtons::OkCancelCustom(
                confirm_label,
                cancel_label,
            ));
    if let Some(window) = app.get_webview_window("main") {
        builder = builder.parent(&window);
    }
    builder.show(move |confirmed| {
        let _ = sender.send(confirmed);
    });

    // A dialog we cannot show must not be read as a yes.
    receiver.recv().unwrap_or(false)
}

/// `kind` decides the icon. Most of these are failures, so anything unrecognised
/// is treated as one; "the check found nothing" is the exception that has to ask
/// for `info`, rather than wearing a warning badge for saying all is well.
#[tauri::command]
pub async fn message_dialog(app: AppHandle, title: String, message: String, kind: Option<String>) {
    let (sender, receiver) = mpsc::channel();
    let kind = match kind.as_deref() {
        Some("info") => MessageDialogKind::Info,
        _ => MessageDialogKind::Error,
    };
    let mut builder = app
        .dialog()
        .message(message)
        .title(title)
        .kind(kind)
        .buttons(MessageDialogButtons::Ok);
    if let Some(window) = app.get_webview_window("main") {
        builder = builder.parent(&window);
    }
    builder.show(move |_| {
        let _ = sender.send(());
    });
    let _ = receiver.recv();
}

#[tauri::command]
pub async fn save_as_dialog(app: AppHandle, default_name: String) -> Option<String> {
    let (sender, receiver) = mpsc::channel();
    app.dialog()
        .file()
        .add_filter(FILTER_NAME, EXTENSIONS)
        .set_file_name(default_name)
        .save_file(move |picked| {
            let _ = sender.send(picked);
        });

    receiver
        .recv()
        .ok()
        .flatten()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}
