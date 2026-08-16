use tauri::menu::{
    AboutMetadata, Menu, MenuEvent, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, EventTarget, Runtime};

use crate::commands::window::focused;

/// The event name the frontend listens on. The payload is the menu item id.
pub const MENU_EVENT: &str = "menu";

/// The native menu bar. On macOS the first submenu becomes the application
/// menu, so the settings item belongs there rather than under File.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<(Menu<R>, Submenu<R>)> {
    let settings = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let app_menu = SubmenuBuilder::new(app, "PaperV2")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About PaperV2"),
            Some(AboutMetadata::default()),
        )?)
        .separator()
        .item(&settings)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        // Not the predefined quit item: that ends the process at once, which
        // would throw away unsaved work without asking. This one asks first.
        .item(
            &MenuItemBuilder::with_id("quit", "Quit PaperV2")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?,
        )
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("new_window", "New Window")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("open", "Open…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("save_as", "Save As…")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    // Undo and redo are handled by the editor, not the webview, so they carry
    // our own ids. The clipboard items are the predefined ones.
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(
            &MenuItemBuilder::with_id("undo", "Undo")
                .accelerator("CmdOrCtrl+Z")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("redo", "Redo")
                .accelerator("CmdOrCtrl+Shift+Z")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("find", "Find…")
                .accelerator("CmdOrCtrl+F")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("replace", "Find and Replace…")
                .accelerator("CmdOrCtrl+Alt+F")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("find_next", "Find Next")
                .accelerator("CmdOrCtrl+G")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("find_previous", "Find Previous")
                .accelerator("CmdOrCtrl+Shift+G")
                .build(app)?,
        )
        .build()?;

    let format_menu = SubmenuBuilder::new(app, "Format")
        .item(
            &MenuItemBuilder::with_id("strong", "Strong")
                .accelerator("CmdOrCtrl+B")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("em", "Emphasis")
                .accelerator("CmdOrCtrl+I")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("code", "Code")
                .accelerator("CmdOrCtrl+E")
                .build(app)?,
        )
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("toggle_source", "Markdown Source")
                .accelerator("CmdOrCtrl+/")
                .build(app)?,
        )
        .separator()
        // Three ways of showing the same document. See src/editor/editor.ts.
        .item(
            &MenuItemBuilder::with_id("mode_editing", "Editing")
                .accelerator("CmdOrCtrl+Shift+E")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("mode_presentation", "Presentation")
                .accelerator("CmdOrCtrl+Shift+P")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("mode_reading", "Reading")
                .accelerator("CmdOrCtrl+Shift+R")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    // A window per document, so the list of them belongs somewhere. macOS fills
    // this menu with the open windows itself, once it has been told which menu
    // that is. That has to wait until the menu is on the bar, which is why it
    // is handed back rather than wired up here. See `attach_window_menu`.
    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
        .separator()
        .build()?;

    let menu = Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &format_menu,
            &view_menu,
            &window_menu,
        ],
    )?;

    Ok((menu, window_menu))
}

/// Hands the Window menu to macOS, which keeps the list of open windows in it.
/// Only meaningful once the menu is the application's, so this runs after it
/// has been set.
pub fn attach_window_menu<R: Runtime>(window_menu: &Submenu<R>) {
    #[cfg(target_os = "macos")]
    let _ = window_menu.set_as_windows_menu_for_nsapp();
    #[cfg(not(target_os = "macos"))]
    let _ = window_menu;
}

/// Forwards the chosen item to the frontend, which owns every action.
///
/// Only to the focused window: the menu bar is shared by every window, so a
/// broadcast would save or close all of them at once.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().0.as_str();
    match focused(app) {
        Some(window) => {
            let _ = app.emit_to(EventTarget::webview_window(window.label()), MENU_EVENT, id);
        }
        // Nothing is focused, so there is no document the item could apply to.
        // Opening a window is still meaningful, and any window can do it.
        None => {
            if id == "new_window" || id == "open" {
                let _ = app.emit(MENU_EVENT, id);
            }
        }
    }
}
