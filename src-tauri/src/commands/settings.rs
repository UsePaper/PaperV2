use std::fs;

use tauri::{AppHandle, Manager, Runtime};

const FILE_NAME: &str = "settings.json";

/// The settings are stored as the frontend's own JSON. Rust does not know the
/// shape, which keeps the model in one place: `src/settings/state.ts`.
fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("No config directory: {err}"))?;
    Ok(directory.join(FILE_NAME))
}

#[tauri::command]
pub fn read_settings<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let path = settings_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        // A missing file is the normal first run, not a failure.
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn write_settings<R: Runtime>(app: AppHandle<R>, contents: String) -> Result<(), String> {
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::write(&path, contents).map_err(|err| err.to_string())
}
