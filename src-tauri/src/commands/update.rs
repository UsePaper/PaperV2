//! The one network call the application makes, and only when the user asks for
//! it from the menu. See exception 5 in CLAUDE.md before adding anything here:
//! a check that runs on its own is the thing that was ruled out.

use serde::Serialize;

const LATEST_RELEASE: &str = "https://api.github.com/repos/UsePaper/PaperV2/releases/latest";
const RELEASES_PAGE: &str = "https://github.com/UsePaper/PaperV2/releases/latest";

/// GitHub answers 403 to a request without one of these.
const USER_AGENT: &str = concat!("Paper/", env!("CARGO_PKG_VERSION"));

/// Long enough for a slow connection, short enough that a black hole does not
/// leave the user staring at a menu that did nothing.
const TIMEOUT_SECONDS: &str = "10";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    /// `current`, `available`, or `unknown`.
    status: &'static str,
    current: &'static str,
    /// The released version, when we managed to read one.
    latest: Option<String>,
}

impl UpdateCheck {
    fn new(status: &'static str, latest: Option<String>) -> Self {
        Self {
            status,
            current: env!("CARGO_PKG_VERSION"),
            latest,
        }
    }
}

/// Numbers, so that 0.10.0 is newer than 0.9.0. Comparing the strings would say
/// otherwise, and would only start being wrong at the tenth release.
fn parse_version(version: &str) -> Option<(u64, u64, u64)> {
    let mut parts = version.trim().trim_start_matches('v').split('.');
    let major: u64 = parts.next()?.parse().ok()?;
    let minor: u64 = parts.next().unwrap_or("0").parse().ok()?;
    // A tag may carry a suffix, as in 1.2.0-beta.1. Everything from the first
    // dash or plus describes a pre-release, which this comparison ignores.
    let patch: u64 = parts
        .next()
        .unwrap_or("0")
        .split(['-', '+'])
        .next()?
        .parse()
        .ok()?;
    Some((major, minor, patch))
}

/// Through curl rather than an HTTP crate. reqwest was the obvious choice and
/// cost 2.6MB of binary, a half again on top of everything else the editor is,
/// for one request made when somebody picks a menu item. curl is part of macOS,
/// ships with Windows, and is on any Linux that has a package manager. Where it
/// is somehow absent the check reports that it could not reach the release,
/// which is what it would say about a missing network anyway.
///
/// Blocking, so it is called from a thread that is allowed to block.
fn fetch_latest_tag() -> Option<String> {
    let output = std::process::Command::new("curl")
        .args([
            // Draft releases are not "latest", so before the first published
            // one this is a 404. --fail turns that into a non-zero exit rather
            // than an error page parsed as if it were a release.
            "--fail",
            "--silent",
            "--location",
            "--max-time",
            TIMEOUT_SECONDS,
            "--user-agent",
            USER_AGENT,
            "--header",
            "Accept: application/vnd.github+json",
            LATEST_RELEASE,
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let parsed: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    parsed.get("tag_name")?.as_str().map(str::to_owned)
}

#[tauri::command]
pub async fn check_for_update() -> UpdateCheck {
    // Waiting on a subprocess is not something to do on the thread drawing the
    // window, and up to TIMEOUT_SECONDS of it even less so.
    let tag = tauri::async_runtime::spawn_blocking(fetch_latest_tag)
        .await
        .ok()
        .flatten();

    let Some(tag) = tag else {
        return UpdateCheck::new("unknown", None);
    };

    let current = parse_version(env!("CARGO_PKG_VERSION"));
    let latest = parse_version(&tag);
    let display = tag.trim_start_matches('v').to_owned();

    match (current, latest) {
        (Some(current), Some(latest)) if latest > current => {
            UpdateCheck::new("available", Some(display))
        }
        (Some(_), Some(_)) => UpdateCheck::new("current", Some(display)),
        // A tag we cannot read is not evidence of anything, and guessing at it
        // would mean either a phantom update or a missed one.
        _ => UpdateCheck::new("unknown", Some(display)),
    }
}

/// Takes no URL on purpose. A command that opens whatever it is handed is a
/// way to turn any scripting defect in the webview into "open this link", and
/// the only page this ever needs to reach is our own.
#[tauri::command]
pub fn open_releases_page() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(RELEASES_PAGE);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(RELEASES_PAGE);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("cmd");
        // The empty string is the window title. Without it `start` reads the
        // URL as the title and opens nothing.
        command.args(["/C", "start", "", RELEASES_PAGE]);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open the releases page: {error}"))
}

#[cfg(test)]
mod tests {
    use super::parse_version;

    #[test]
    fn reads_a_plain_version() {
        assert_eq!(parse_version("1.2.3"), Some((1, 2, 3)));
    }

    #[test]
    fn ignores_the_tag_prefix() {
        assert_eq!(parse_version("v0.1.0"), Some((0, 1, 0)));
    }

    #[test]
    fn compares_as_numbers_not_text() {
        assert!(parse_version("0.10.0") > parse_version("0.9.0"));
    }

    #[test]
    fn fills_in_missing_parts() {
        assert_eq!(parse_version("2"), Some((2, 0, 0)));
        assert_eq!(parse_version("2.1"), Some((2, 1, 0)));
    }

    #[test]
    fn drops_a_prerelease_suffix() {
        assert_eq!(parse_version("1.2.0-beta.1"), Some((1, 2, 0)));
        assert_eq!(parse_version("1.2.0+build7"), Some((1, 2, 0)));
    }

    #[test]
    fn refuses_what_it_cannot_read() {
        assert_eq!(parse_version("nightly"), None);
        assert_eq!(parse_version(""), None);
    }
}
