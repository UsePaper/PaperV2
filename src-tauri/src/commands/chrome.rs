use serde::Serialize;
use tauri::{Runtime, WebviewWindow};

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

/// The one name every window saves its frame under, so a new document opens at
/// the size and place the last one was left at. Shared on purpose: the frame
/// a person settles on is a preference about the window, not about a file.
#[cfg(target_os = "macos")]
const FRAME_NAME: &str = "Paper";

/// Puts the remembered frame on the window, then shows it.
///
/// macOS does not remember window frames on its own: an application asks
/// AppKit to save a window's frame under a name, and asks for it back. Tauri
/// never did, so every window opened at the size in the configuration. Windows
/// are built hidden and shown here, once the saved frame is on them, so nothing
/// appears at one size and jumps to another.
///
/// The frame is stored in AppKit's own format and place, through
/// `saveFrameUsingName`, called from `save_frame` on every move and resize.
/// Reading it back is done by hand rather than through `setFrameUsingName`,
/// because that restores relative to the screen the window is on when it is
/// not the screen the frame was saved on, and a window that has never been
/// shown is on whichever screen Tauri centred it on. With two displays that
/// carried a window saved on one of them onto the other, scaled to fit.
///
/// `cascaded` says the caller already placed the window a step from the one in
/// front. The saved size is still taken, but the saved position would put the
/// new window exactly over the old, so the cascade is put back afterwards.
///
/// Off macOS there is nothing remembered, and the window is simply shown.
pub fn remember_frame<R: Runtime>(window: &WebviewWindow<R>, cascaded: bool) {
    #[cfg(target_os = "macos")]
    {
        // AppKit may only be touched on the main thread, and `new_window` runs
        // elsewhere. The show waits for the same hop, so it comes after.
        let target = window.clone();
        let hopped = window.run_on_main_thread(move || {
            restore_frame(&target, cascaded);
            let _ = target.show();
        });
        if hopped.is_err() {
            let _ = window.show();
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = cascaded;
        let _ = window.show();
    }
}

/// Writes the window's frame to where AppKit keeps them. Called for every move
/// and resize, so the last window touched is the one remembered.
pub fn save_frame<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        let target = window.clone();
        let _ = window.run_on_main_thread(move || {
            if let Some(ns_window) = ns_window(&target) {
                ns_window.saveFrameUsingName(&objc2_foundation::NSString::from_str(FRAME_NAME));
            }
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
    }
}

/// The AppKit window behind a webview window. Main thread only.
#[cfg(target_os = "macos")]
fn ns_window<R: Runtime>(window: &WebviewWindow<R>) -> Option<&objc2_app_kit::NSWindow> {
    let pointer = window.ns_window().ok()? as *mut objc2_app_kit::NSWindow;
    if pointer.is_null() {
        return None;
    }
    // Safe: `ns_window` hands back the window this webview lives in, and every
    // caller is on the main thread.
    Some(unsafe { &*pointer })
}

#[cfg(target_os = "macos")]
fn restore_frame<R: Runtime>(window: &WebviewWindow<R>, cascaded: bool) {
    use objc2_foundation::NSString;

    let Some(ns_window) = ns_window(window) else {
        return;
    };
    let Some(saved) = saved_frame() else {
        return;
    };

    // Taken before the restore moves anything, so the cascade can be put back.
    let placed = window.outer_position().ok();

    if on_a_screen(saved) {
        ns_window.setFrame_display(saved, false);
    } else {
        // The screen it was saved on is gone. AppKit's own restore brings a
        // frame like that back onto a screen that exists, which is the one
        // case its mapping is right for.
        ns_window.setFrameUsingName(&NSString::from_str(FRAME_NAME));
    }

    if cascaded {
        if let Some(position) = placed {
            let _ = window.set_position(position);
        }
    }
}

/// The frame AppKit saved under `FRAME_NAME`, read back from where AppKit put
/// it. The stored string is eight numbers: the frame, then the screen it was
/// on. Only the frame is wanted here.
#[cfg(target_os = "macos")]
fn saved_frame() -> Option<objc2_foundation::NSRect> {
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSString, NSUserDefaults};

    let key = NSString::from_str(&format!("NSWindow Frame {FRAME_NAME}"));
    let stored = NSUserDefaults::standardUserDefaults()
        .stringForKey(&key)?
        .to_string();

    let mut numbers = stored
        .split_whitespace()
        .map(|number| number.parse::<f64>().ok());
    let mut next = || numbers.next().flatten();
    let (x, y, width, height) = (next()?, next()?, next()?, next()?);
    Some(NSRect::new(NSPoint::new(x, y), NSSize::new(width, height)))
}

/// Whether some part of the frame lies on a display that is connected now.
#[cfg(target_os = "macos")]
fn on_a_screen(frame: objc2_foundation::NSRect) -> bool {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSScreen;

    let Some(main_thread) = MainThreadMarker::new() else {
        return false;
    };
    NSScreen::screens(main_thread).iter().any(|screen| {
        let bounds = screen.frame();
        frame.origin.x < bounds.origin.x + bounds.size.width
            && frame.origin.x + frame.size.width > bounds.origin.x
            && frame.origin.y < bounds.origin.y + bounds.size.height
            && frame.origin.y + frame.size.height > bounds.origin.y
    })
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
