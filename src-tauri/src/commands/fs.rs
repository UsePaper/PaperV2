use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// Returned to the frontend when a write finds a newer file on disk. The
/// frontend asks the user before it overwrites.
pub const STALE: &str = "changed_on_disk";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContents {
    path: String,
    /// UTF-8, BOM removed, line ends normalized to LF.
    content: String,
    mtime_ms: f64,
    line_ending: LineEnding,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteReceipt {
    mtime_ms: f64,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
}

pub fn mtime_ms(path: &Path) -> Result<f64, String> {
    let modified = fs::metadata(path)
        .and_then(|meta| meta.modified())
        .map_err(|err| err.to_string())?;
    let since_epoch = modified
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| SystemTime::UNIX_EPOCH.elapsed().unwrap_or_default());
    Ok(since_epoch.as_millis() as f64)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<FileContents, String> {
    let bytes = fs::read(&path).map_err(|err| err.to_string())?;
    let text = String::from_utf8(bytes).map_err(|_| "The file is not valid UTF-8".to_string())?;

    let text = text.strip_prefix('\u{feff}').unwrap_or(&text).to_string();
    let line_ending = if text.contains("\r\n") {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    };

    Ok(FileContents {
        mtime_ms: mtime_ms(Path::new(&path))?,
        content: text.replace("\r\n", "\n"),
        line_ending,
        path,
    })
}

/// The bytes of an image a document refers to.
///
/// A relative path in Markdown is relative to the file it was written in, but
/// the webview's origin is the application, not that folder, so the browser
/// cannot fetch it. Reading it here is what makes a local image appear at all.
#[tauri::command]
pub fn read_image(document: Option<String>, src: String) -> Result<tauri::ipc::Response, String> {
    let target = image_path(document.as_deref(), &src)?;
    let bytes = fs::read(&target).map_err(|err| err.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn image_path(document: Option<&str>, src: &str) -> Result<PathBuf, String> {
    let raw = src.strip_prefix("file://").unwrap_or(src);
    let decoded = percent_decode(raw);
    let path = PathBuf::from(&decoded);

    if path.is_absolute() {
        return Ok(path);
    }

    let directory = document
        .map(Path::new)
        .and_then(Path::parent)
        .ok_or_else(|| "An unsaved document has no folder to resolve against".to_string())?;
    Ok(directory.join(path))
}

/// Markdown carries URLs, so a space arrives as `%20`. Only the escape needs
/// undoing; nothing here is a URL once it reaches the filesystem.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let pair = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(byte) = pair.and_then(|hex| u8::from_str_radix(hex, 16).ok()) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }

    String::from_utf8_lossy(&out).into_owned()
}

/// Writes to a temporary file in the same directory, flushes it, then renames
/// it over the target. The target is never opened for writing, so a crash
/// part way through cannot truncate it. See CLAUDE.md section 9 rule 3.
#[tauri::command]
pub fn write_file_atomic(
    path: String,
    content: String,
    line_ending: LineEnding,
    expected_mtime_ms: Option<f64>,
) -> Result<WriteReceipt, String> {
    let target = PathBuf::from(&path);

    if let Some(expected) = expected_mtime_ms {
        if target.exists() {
            let current = mtime_ms(&target)?;
            // Filesystem timestamps are coarse, so compare with a tolerance
            // rather than for equality.
            if (current - expected).abs() > 1.0 {
                return Err(STALE.to_string());
            }
        }
    }

    let bytes = match line_ending {
        LineEnding::Lf => content,
        LineEnding::Crlf => content.replace('\n', "\r\n"),
    };

    let directory = target
        .parent()
        .ok_or_else(|| "The path has no parent directory".to_string())?;
    let file_name = target
        .file_name()
        .ok_or_else(|| "The path has no file name".to_string())?
        .to_string_lossy()
        .into_owned();
    let temporary = directory.join(format!(".{file_name}.paperv2.tmp"));

    let write_result = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(bytes.as_bytes())?;
        file.sync_all()
    })();

    if let Err(err) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(err.to_string());
    }

    // Keep the permissions the file already had.
    if let Ok(meta) = fs::metadata(&target) {
        let _ = fs::set_permissions(&temporary, meta.permissions());
    }

    if let Err(err) = fs::rename(&temporary, &target) {
        let _ = fs::remove_file(&temporary);
        return Err(err.to_string());
    }

    Ok(WriteReceipt {
        mtime_ms: mtime_ms(&target)?,
    })
}
