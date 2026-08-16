use serde::Serialize;
use tauri::WebviewWindow;

/// What the system chrome actually measures, in points.
///
/// Both of these used to be constants in the stylesheet, and both were wrong:
/// the title bar band is 32pt rather than the widely quoted 28, and the traffic
/// lights are 14pt wide ending at 69 rather than 12pt ending at 72.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TitlebarMetrics {
    /// Height of the native title bar band.
    height: f64,
    /// Right edge of the last traffic light, or 0 when they are hidden.
    traffic_lights_right: f64,
}

/// Returns `None` off macOS, where there is no such chrome to measure.
#[tauri::command]
pub fn titlebar_metrics(window: WebviewWindow) -> Option<TitlebarMetrics> {
    #[cfg(target_os = "macos")]
    {
        // AppKit may only be touched on the main thread, and a command does not
        // run there, so the measurement is hopped over and sent back.
        let (sender, receiver) = std::sync::mpsc::channel();
        let target = window.clone();
        if window
            .run_on_main_thread(move || {
                let _ = sender.send(measure(&target));
            })
            .is_err()
        {
            return None;
        }
        receiver.recv().ok().flatten()
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        None
    }
}

#[cfg(target_os = "macos")]
fn measure(window: &WebviewWindow) -> Option<TitlebarMetrics> {
    use objc2_app_kit::{NSWindow, NSWindowButton};

    let pointer = window.ns_window().ok()? as *mut NSWindow;
    if pointer.is_null() {
        return None;
    }

    // Safe: `ns_window` hands back the window this webview lives in, and this
    // runs on the main thread.
    let ns_window: &NSWindow = unsafe { &*pointer };

    // The title bar occupies whatever band the content layout does not.
    let frame = ns_window.frame();
    let content = ns_window.contentLayoutRect();
    let height = frame.size.height - content.size.height;

    let button = ns_window.standardWindowButton(NSWindowButton::ZoomButton)?;
    // Full screen hides the buttons, and then the title needs no indent.
    let traffic_lights_right = if button.isHidden() {
        0.0
    } else {
        let rect = button.frame();
        rect.origin.x + rect.size.width
    };

    Some(TitlebarMetrics {
        height,
        traffic_lights_right,
    })
}
