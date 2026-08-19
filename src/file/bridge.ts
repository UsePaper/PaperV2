import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { LineEnding } from "./state";

/**
 * The only module that calls `invoke`. Everything else talks to these
 * functions, so `pnpm dev` in a plain browser keeps working against the stub
 * below. See CLAUDE.md section 7.
 */

export interface FileContents {
  path: string;
  /** UTF-8 text, BOM removed, line ends normalized to LF. */
  content: string;
  mtimeMs: number;
  lineEnding: LineEnding;
}

export interface WriteReceipt {
  mtimeMs: number;
}

/** Thrown when the file on disk changed since we last read or wrote it. */
export class StaleFileError extends Error {
  constructor(readonly path: string) {
    super(`The file changed on disk: ${path}`);
    this.name = "StaleFileError";
  }
}

const STALE = "changed_on_disk";
const SETTINGS_EVENT = "settings-written";

export const hasFileAccess = (): boolean => isTauri();

/**
 * Registers a listener for this window alone.
 *
 * Plain `listen` registers the target `Any`, which Tauri treats as a wildcard
 * that skips the target filter, so `emit_to` cannot exclude it and every
 * window hears everything. That made one press of Save write every open
 * document. Anything addressed to a single window must come through here.
 */
async function listenHere<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  return getCurrentWebviewWindow().listen<T>(event, (received) => handler(received.payload));
}

export async function readFile(path: string): Promise<FileContents> {
  if (!isTauri()) return stubRead(path);
  return invoke<FileContents>("read_file", { path });
}

/**
 * Writes through a temporary file and a rename, never onto the target
 * directly. `expectedMtimeMs` is null for a file we have not read yet.
 */
export async function writeFileAtomic(
  path: string,
  content: string,
  lineEnding: LineEnding,
  expectedMtimeMs: number | null,
): Promise<WriteReceipt> {
  if (!isTauri()) return stubWrite(path, content);
  try {
    return await invoke<WriteReceipt>("write_file_atomic", {
      path,
      content,
      lineEnding,
      expectedMtimeMs,
    });
  } catch (error) {
    if (typeof error === "string" && error === STALE) throw new StaleFileError(path);
    throw error;
  }
}

/**
 * The bytes of an image the document points at, resolved against the folder
 * the document lives in. Null when there is nothing to read there.
 */
export async function readImageBytes(
  documentPath: string | null,
  src: string,
): Promise<ArrayBuffer | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<ArrayBuffer>("read_image", { document: documentPath, src });
  } catch {
    // A missing or unreadable picture is shown as broken, not as an error: it
    // must not interrupt writing.
    return null;
  }
}

export async function openDialog(): Promise<string | null> {
  if (!isTauri()) return stubOpenDialog();
  return invoke<string | null>("open_dialog");
}

export async function saveAsDialog(defaultName: string): Promise<string | null> {
  if (!isTauri()) return stubSaveAsDialog(defaultName);
  return invoke<string | null>("save_as_dialog", { defaultName });
}

/**
 * A native question, shown as a sheet on the window. Falls back to the webview
 * dialog only in browser mode.
 */
export async function confirmDialog(
  title: string,
  message: string,
  confirmLabel: string,
  cancelLabel = "Cancel",
): Promise<boolean> {
  if (!isTauri()) return window.confirm(`${title}\n\n${message}`);
  return invoke<boolean>("confirm_dialog", {
    title,
    message,
    confirmLabel,
    cancelLabel,
  });
}

export async function messageDialog(
  title: string,
  message: string,
  kind: "error" | "info" = "error",
): Promise<void> {
  if (!isTauri()) {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  await invoke("message_dialog", { title, message, kind });
}

export interface UpdateCheck {
  status: "current" | "available" | "unknown";
  current: string;
  latest: string | null;
}

/**
 * Asks GitHub for the latest release tag. The only network call the
 * application makes, and only ever from the menu item. See exception 5 in
 * CLAUDE.md before calling this from anywhere else.
 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!isTauri()) {
    return { status: "unknown", current: "0.0.0", latest: null };
  }
  return invoke<UpdateCheck>("check_for_update");
}

export async function openReleasesPage(): Promise<void> {
  if (!isTauri()) {
    window.open("https://github.com/UsePaper/PaperV2/releases/latest", "_blank");
    return;
  }
  await invoke("open_releases_page");
}

/**
 * Takes over closing the window so unsaved work can be asked about with a
 * native sheet. `shouldClose` decides; returning true destroys the window.
 */
export async function onCloseRequested(
  shouldClose: () => Promise<boolean>,
): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const appWindow = getCurrentWindow();
  await appWindow.onCloseRequested(async (event) => {
    // Always stop the default close: the answer arrives asynchronously.
    event.preventDefault();
    if (await shouldClose()) await appWindow.destroy();
  });
}

/**
 * Opens another window, optionally on a file. Each window runs its own copy of
 * the frontend, so its document, dirty flag and undo history are its own.
 */
export async function newWindow(path?: string): Promise<void> {
  if (!isTauri()) {
    window.open(window.location.href, "_blank");
    return;
  }
  await invoke("new_window", { path: path ?? null });
}

/**
 * Fires when the operating system asks this window to open a file, for example
 * a double click in Finder while the app is already running.
 */
export async function onOpenFile(
  handler: (path: string) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  return listenHere<string>("open-file", handler);
}

/** Lets Rust raise this window when the same file is opened again. */
export async function setWindowPath(path: string | null): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_window_path", { path });
}

/**
 * Raises the window already showing this file, if there is one, and reports
 * whether it did. A document belongs in one window.
 */
export async function raiseWindowFor(path: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("raise_window_for", { path });
}

/** The file this window was opened for. Taken once, so a reload starts empty. */
export async function initialPath(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("initial_path");
}

/** A report that the file this window is showing changed on disk. */
export interface FileChanged {
  path: string;
  /** Null when the file has been deleted or moved away. */
  mtimeMs: number | null;
}

/**
 * Watches the file this window is showing, replacing any earlier watch. Pass
 * null to stop, for a document that has never been saved.
 */
export async function watchFile(path: string | null): Promise<void> {
  if (!isTauri()) return;
  await invoke("watch_file", { path });
}

/** Fires when another program writes to, or removes, the watched file. */
export async function onFileChanged(
  handler: (change: FileChanged) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  return listenHere<FileChanged>("file-changed", handler);
}

/**
 * The window's own name, not the one drawn in our title bar. The Window menu,
 * the app switcher and Mission Control read this, and a window per document
 * leaves all three unreadable without it.
 */
export async function setWindowTitle(title: string): Promise<void> {
  if (!isTauri()) {
    // The tab is the window in browser mode.
    document.title = title;
    return;
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTitle(title);
}

/** What the system chrome measures, in points. Null when there is none. */
export interface TitlebarMetrics {
  height: number;
  /** Right edge of the last traffic light, 0 when they are hidden. */
  trafficLightsRight: number;
}

export async function titlebarMetrics(): Promise<TitlebarMetrics | null> {
  if (!isTauri()) return null;
  return invoke<TitlebarMetrics | null>("titlebar_metrics");
}

/**
 * Asks every window to close. Each runs its own unsaved work prompt, and the
 * process ends once the last one goes, so this is how quitting happens.
 */
export async function closeAllWindows(): Promise<void> {
  if (!isTauri()) {
    window.close();
    return;
  }
  await invoke("close_all_windows");
}

/** The raw settings JSON, or null when nothing has been saved yet. */
export async function readSettings(): Promise<string | null> {
  if (!isTauri()) return window.localStorage.getItem(STUB_SETTINGS_KEY);
  return invoke<string | null>("read_settings");
}

export async function writeSettings(contents: string): Promise<void> {
  if (!isTauri()) {
    window.localStorage.setItem(STUB_SETTINGS_KEY, contents);
    return;
  }
  await invoke("write_settings", { contents });
  // Settings are one file shared by every window, so the others are told.
  await emit(SETTINGS_EVENT, contents);
}

/** Fires when another window changes the settings. */
export async function onSettingsWritten(
  handler: (contents: string) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  return listen<string>(SETTINGS_EVENT, (event) => handler(event.payload));
}

/**
 * Subscribes to the native menu. Every menu item is handled in the frontend,
 * so Rust only reports which one was chosen.
 */
export async function onMenuCommand(
  handler: (id: string) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  return listenHere<string>("menu", handler);
}

/* The browser only fallbacks. They keep `pnpm dev` usable for editor work. */

const STUB_SETTINGS_KEY = "paperv2.settings";
const memoryFiles = new Map<string, string>();

function stubRead(path: string): FileContents {
  return {
    path,
    content: memoryFiles.get(path) ?? "",
    mtimeMs: 0,
    lineEnding: "lf",
  };
}

function stubWrite(path: string, content: string): WriteReceipt {
  memoryFiles.set(path, content);
  return { mtimeMs: 0 };
}

function stubOpenDialog(): string | null {
  return window.prompt("Path to open (browser mode is in memory only)") || null;
}

function stubSaveAsDialog(defaultName: string): string | null {
  return window.prompt("Save as (browser mode is in memory only)", defaultName) || null;
}
