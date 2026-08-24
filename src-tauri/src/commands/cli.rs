//! "Install Command Line Tool…", the menu item behind `paper notes.md`.
//!
//! The command itself is `scripts/paper`, which ships inside the bundle. This
//! links to it rather than copying it, so an app that updates updates its
//! command with it, and a script found on PATH always belongs to a Paper that
//! is actually installed.

use serde::Serialize;
use tauri::AppHandle;

/// On PATH for every shell, and where an application that offers this puts its
/// command. The directory belongs to root on a Mac that has not had Homebrew
/// make it otherwise, which is why the write may need authorisation.
#[cfg(target_os = "macos")]
const LINK: &str = "/usr/local/bin/paper";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstall {
    /// `installed`, `already`, or `cancelled`.
    status: &'static str,
    path: String,
}

/// Blocking: the authorisation sheet stands there until the user answers it,
/// and that thread must not be the one drawing the window.
#[tauri::command]
pub async fn install_cli(app: AppHandle) -> Result<CliInstall, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || macos::install(&app))
            .await
            .map_err(|error| format!("The install could not be started: {error}"))?
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err(
            "The `paper` command is macOS only. Elsewhere the binary takes its files as arguments."
                .to_string(),
        )
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use tauri::{AppHandle, Manager};

    use super::{CliInstall, LINK};

    pub fn install(app: &AppHandle) -> Result<CliInstall, String> {
        let source = script(app)?;
        let link = Path::new(LINK);

        match std::fs::read_link(link) {
            // Already ours, and pointing at this very copy of Paper.
            Ok(target) if same_file(&target, &source) => {
                return Ok(outcome("already"));
            }
            // A link left by another copy: an older install, or one that has
            // moved. Ours to replace, and replacing it is the whole point.
            Ok(target) if is_paper_script(&target) => {}
            Ok(target) => {
                return Err(format!(
                    "{LINK} already points at {}. Remove it first if you want the Paper command there.",
                    target.display()
                ));
            }
            // Not a link, but something is there. Whatever it is, it is not
            // ours to delete.
            Err(_) if link.exists() => {
                return Err(format!(
                    "{LINK} already exists and is not a link. Remove it first if you want the Paper command there."
                ));
            }
            Err(_) => {}
        }

        // The unprivileged write first: on a machine where Homebrew owns
        // /usr/local/bin this succeeds, and asking for a password to do
        // something the user can already do is rude.
        if write_link(&source, link).is_ok() {
            return Ok(outcome("installed"));
        }

        with_privileges(&source, link)
    }

    fn outcome(status: &'static str) -> CliInstall {
        CliInstall {
            status,
            path: LINK.to_string(),
        }
    }

    /// The copy of the script inside this application.
    fn script(app: &AppHandle) -> Result<PathBuf, String> {
        let path = app
            .path()
            .resource_dir()
            .map_err(|error| format!("Could not find the application's resources: {error}"))?
            .join("paper");

        if !path.is_file() {
            return Err(
                "The command ships inside the application bundle, and this copy of Paper has no \
                 bundle around it. Install Paper, then try again from there."
                    .to_string(),
            );
        }

        Ok(path)
    }

    /// A link one Paper left for another: `<somewhere>/Paper.app/Contents/Resources/paper`.
    fn is_paper_script(target: &Path) -> bool {
        target.ends_with("Contents/Resources/paper")
    }

    /// Compares the files, not the text naming them, so `/var` and `/private/var`
    /// do not read as two different installs.
    fn same_file(a: &Path, b: &Path) -> bool {
        match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
            (Ok(a), Ok(b)) => a == b,
            _ => a == b,
        }
    }

    fn write_link(source: &Path, link: &Path) -> std::io::Result<()> {
        if let Some(parent) = link.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // Only ever a link of ours, which the checks above established.
        if link.is_symlink() {
            std::fs::remove_file(link)?;
        }
        std::os::unix::fs::symlink(source, link)
    }

    /// `do shell script … with administrator privileges` raises the system's own
    /// authorisation sheet. The password goes to the system; nothing here sees
    /// it, and nothing here runs as root except the two commands below.
    fn with_privileges(source: &Path, link: &Path) -> Result<CliInstall, String> {
        let parent = link.parent().unwrap_or(Path::new("/usr/local/bin"));
        let line = format!(
            "mkdir -p {} && ln -sfn {} {}",
            shell_quote(&parent.to_string_lossy()),
            shell_quote(&source.to_string_lossy()),
            shell_quote(&link.to_string_lossy()),
        );

        let output = Command::new("osascript")
            .arg("-e")
            .arg(format!(
                "do shell script {} with administrator privileges",
                applescript_quote(&line)
            ))
            .output()
            .map_err(|error| format!("Could not ask for permission to write {LINK}: {error}"))?;

        if output.status.success() {
            return Ok(outcome("installed"));
        }

        let complaint = String::from_utf8_lossy(&output.stderr);
        // The user dismissed the sheet. They know what they did, so there is
        // nothing to tell them about it.
        if complaint.contains("-128") {
            return Ok(outcome("cancelled"));
        }

        Err(format!(
            "Could not write {LINK}. {}",
            complaint.trim().trim_start_matches("execution error: ")
        ))
    }

    /// One word for `sh`, whatever the path holds. A space, a quote or a
    /// semicolon in an application's name must not become shell syntax.
    fn shell_quote(text: &str) -> String {
        format!("'{}'", text.replace('\'', r"'\''"))
    }

    /// The same line again as an AppleScript string literal.
    fn applescript_quote(text: &str) -> String {
        format!("\"{}\"", text.replace('\\', r"\\").replace('"', "\\\""))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn quotes_a_plain_path() {
            assert_eq!(
                shell_quote("/Applications/Paper.app"),
                "'/Applications/Paper.app'"
            );
        }

        #[test]
        fn survives_a_space() {
            assert_eq!(
                shell_quote("/Users/a b/Paper.app"),
                "'/Users/a b/Paper.app'"
            );
        }

        /// The one that ends the quoting if it is not handled: close, escape,
        /// reopen.
        #[test]
        fn survives_a_quote() {
            assert_eq!(
                shell_quote("/Users/o'brien/Paper.app"),
                r"'/Users/o'\''brien/Paper.app'"
            );
        }

        #[test]
        fn shell_syntax_stays_text() {
            assert_eq!(shell_quote("/tmp/a; rm -rf /"), "'/tmp/a; rm -rf /'");
        }

        #[test]
        fn applescript_escapes_its_own_quotes() {
            assert_eq!(applescript_quote(r#"ln -s "a" b"#), r#""ln -s \"a\" b""#);
            assert_eq!(applescript_quote(r"a\b"), r#""a\\b""#);
        }

        #[test]
        fn recognises_another_copys_script() {
            assert!(is_paper_script(Path::new(
                "/Applications/Paper.app/Contents/Resources/paper"
            )));
            assert!(is_paper_script(Path::new(
                "/Users/a/build/Paper.app/Contents/Resources/paper"
            )));
            assert!(!is_paper_script(Path::new("/opt/paper/bin/paper")));
            assert!(!is_paper_script(Path::new("/usr/local/bin/paper")));
        }
    }
}
