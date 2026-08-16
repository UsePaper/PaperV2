import { Editor, type ViewMode } from "./editor/editor";
import { classifyImageSrc, imageMimeType } from "./editor/nodeviews/image";
import {
  StaleFileError,
  confirmDialog,
  closeAllWindows,
  hasFileAccess,
  initialPath,
  messageDialog,
  newWindow,
  onFileChanged,
  onOpenFile,
  onSettingsWritten,
  onCloseRequested,
  onMenuCommand,
  openDialog,
  readFile,
  readImageBytes,
  readSettings,
  saveAsDialog,
  watchFile,
  writeFileAtomic,
  writeSettings,
} from "./file/bridge";
import {
  displayName,
  externalChangeAction,
  getFileState,
  isBlankDocument,
  markDirty,
  markPathLost,
  markSaved,
  onFileStateChange,
} from "./file/state";
import {
  applySettings,
  getSettings,
  onSettingsChange,
  parseSettings,
  setSettings,
  type Settings,
} from "./settings/state";
import { mountFindbar } from "./ui/findbar";
import { mountSettings } from "./ui/settings";
import { mountStatusbar } from "./ui/statusbar";
import { MODE_ORDER, mountTitlebar, nextMode } from "./ui/titlebar";
import "prosemirror-gapcursor/style/gapcursor.css";
import "./themes/fonts.css";
import "./themes/base.css";
import "./themes/light.css";
import "./themes/dark.css";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found as T;
}

// macOS draws the traffic lights over the top left of the content.
if (/Mac/i.test(navigator.userAgent)) document.body.dataset.platform = "mac";

const editorMount = element("editor");
const sourceView = element<HTMLTextAreaElement>("source");
const statusbar = mountStatusbar(element("statusbar"));
const settingsPanel = mountSettings(element("settings"));

const editor = new Editor(editorMount, {
  onChange: () => {
    markDirty();
    statusbar.update(editor.wordCount());
    // Replacing text changes how many matches are left.
    findbar.refresh();
  },
  resolveImage,
});

/**
 * Where a picture comes from. A full URL the page can already fetch is handed
 * back as it is; anything naming a file is read through Rust, because a
 * relative path is relative to the document, not to the application.
 */
async function resolveImage(src: string): Promise<string | null> {
  const source = classifyImageSrc(src, getFileState().path);
  if (source.kind === "direct") return source.url;
  if (source.kind === "unresolved") return null;

  const bytes = await readImageBytes(getFileState().path, source.path);
  if (!bytes) return null;

  const blob = new Blob([bytes], { type: imageMimeType(source.path) });
  return URL.createObjectURL(blob);
}

const findbar = mountFindbar(element("findbar"), editor);

const titlebar = mountTitlebar(element("titlebar"), {
  onCycleMode: () => setMode(nextMode(mode)),
});

/* Modes ---------------------------------------------------------------------

   Three ways of showing the same document, and one button that steps through
   them. Editing shows the syntax of whatever the caret is in. Presentation
   puts the syntax away and keeps the keyboard. Reading puts the keyboard away
   as well, leaving text that can be selected and copied but not typed into. */

let mode: ViewMode = "editing";

function setMode(next: ViewMode): void {
  mode = next;
  for (const name of MODE_ORDER) {
    document.body.classList.toggle(`mode-${name}`, name === mode);
  }

  editor.setMode(mode);
  titlebar.setMode(mode);
  // The source view is the same document in the raw, so it holds the same rule.
  sourceView.readOnly = mode === "reading";
  if (!sourceMode) editor.focus();
}

setMode(mode);

/* Settings ----------------------------------------------------------------- */

let settingsLoaded = false;
let persistTimer: number | undefined;

onSettingsChange((settings) => {
  applySettings(settings);
  editor.setSpellcheck(settings.spellcheck);
  sourceView.spellcheck = settings.spellcheck;
  // Only after the stored settings are in, so the defaults never overwrite
  // the file before it has been read.
  if (settingsLoaded) schedulePersist(settings);
});

function schedulePersist(settings: Readonly<Settings>): void {
  // A slider fires on every step, so the write waits for the dragging to stop.
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    void writeSettings(JSON.stringify(settings, null, 2)).catch(() => {
      // A settings write that fails must not interrupt writing prose.
    });
  }, 400);
}

async function loadSettings(): Promise<void> {
  try {
    const raw = await readSettings();
    if (raw) setSettings(parseSettings(JSON.parse(raw)));
  } catch {
    // A corrupt or unreadable file falls back to the defaults.
  }
  settingsLoaded = true;
}

/**
 * Settings are one file shared by every window. When another window changes
 * them, apply the change here without writing it back, or the two windows
 * would answer each other forever.
 */
void onSettingsWritten((contents) => {
  try {
    const wasLoaded = settingsLoaded;
    settingsLoaded = false;
    setSettings(parseSettings(JSON.parse(contents)));
    settingsLoaded = wasLoaded;
  } catch {
    // Ignore anything unreadable; this window keeps what it has.
  }
});

/* Source mode -------------------------------------------------------------- */

/** A debug tool and an escape hatch. See CLAUDE.md section 1. */
let sourceMode = false;

function toggleSourceMode(): void {
  sourceMode = !sourceMode;
  if (sourceMode) {
    // The bar searches the document, and source mode shows the raw text
    // instead, so leaving it open would highlight something off screen.
    findbar.close();
    sourceView.value = editor.getMarkdown();
    document.body.classList.add("source-mode");
    sourceView.focus();
  } else {
    // The text area is the source of truth while it is open.
    editor.setMarkdown(sourceView.value);
    document.body.classList.remove("source-mode");
    markDirty();
    statusbar.update(editor.wordCount());
    editor.focus();
  }
}

function currentMarkdown(): string {
  return sourceMode ? sourceView.value : editor.getMarkdown();
}

function loadIntoEditor(markdown: string): void {
  editor.setMarkdown(markdown);
  if (sourceMode) sourceView.value = markdown;
  statusbar.update(editor.wordCount());
}

/* File actions ------------------------------------------------------------- */

async function openFile(): Promise<void> {
  const path = await openDialog();
  if (!path) return;

  // An untouched window is a blank sheet, so the file lands here. Anything
  // else keeps its document and the file gets a window of its own.
  if (!isBlankDocument(getFileState(), currentMarkdown())) {
    await newWindow(path);
    return;
  }
  await loadPath(path);
}

/**
 * Puts a file the system handed us somewhere sensible: here when this window is
 * a blank sheet, otherwise in a window of its own so nothing in progress is
 * displaced.
 */
async function openPath(path: string): Promise<void> {
  // Finder can deliver the same path twice, once stashed and once announced.
  if (getFileState().path === path) return;

  if (!isBlankDocument(getFileState(), currentMarkdown())) {
    await newWindow(path);
    return;
  }
  await loadPath(path);
}

async function loadPath(path: string): Promise<void> {
  try {
    const file = await readFile(path);
    // The path is recorded first: a relative image resolves against the folder
    // the document lives in, and the pictures are loaded as the document is
    // built, so the file has to be known by then.
    markSaved(file.path, file.mtimeMs, file.lineEnding);
    loadIntoEditor(file.content);
    editor.focus();
  } catch (error) {
    await reportError("Could not open the file.", error);
  }
}

async function saveFile(forceOverwrite = false): Promise<void> {
  const state = getFileState();
  const path = state.path ?? (await saveAsDialog("Untitled.md"));
  if (!path) return;

  // A path we have never read has no expected mtime to compare against.
  const expected = forceOverwrite || path !== state.path ? null : state.mtimeMs;

  try {
    const receipt = await writeFileAtomic(
      path,
      currentMarkdown(),
      state.lineEnding,
      expected,
    );
    markSaved(path, receipt.mtimeMs, state.lineEnding);
  } catch (error) {
    if (error instanceof StaleFileError) {
      const overwrite = await confirmDialog(
        `${displayName()} changed on disk.`,
        "Another program has written to this file since you opened it. Overwrite it with this version?",
        "Overwrite",
      );
      if (overwrite) await saveFile(true);
      return;
    }
    await reportError("Could not save the file.", error);
  }
}

async function saveFileAs(): Promise<void> {
  const path = await saveAsDialog(displayName());
  if (!path) return;
  try {
    const receipt = await writeFileAtomic(
      path,
      currentMarkdown(),
      getFileState().lineEnding,
      null,
    );
    markSaved(path, receipt.mtimeMs, getFileState().lineEnding);
  } catch (error) {
    await reportError("Could not save the file.", error);
  }
}

/* The file underneath -------------------------------------------------------

   Another program can write to the file while it is open here. The watcher
   follows whichever file this window holds, and every report is answered by
   the rules in CLAUDE.md section 9. */

let documentPath: string | null = null;

/** Everything that depends on which file this window is holding. */
onFileStateChange((state) => {
  if (state.path === documentPath) return;
  documentPath = state.path;

  void watchFile(state.path).catch(() => {
    // Losing the watch costs the reload, not the document. The mtime check on
    // save still stands between the user and an overwrite.
  });

  // A relative image address is relative to the file, so saving an untitled
  // document, or saving it somewhere else, points the same address elsewhere.
  editor.refreshImages();
});

/** One question at a time, however many events a save produces. */
let answeringChange = false;

async function fileChangedOnDisk(path: string, mtimeMs: number | null): Promise<void> {
  if (answeringChange) return;

  switch (externalChangeAction(getFileState(), path, mtimeMs)) {
    case "ignore":
      return;
    case "gone":
      // The text in the window is now the only copy, so it counts as unsaved.
      markPathLost();
      return;
    case "reload":
      await reloadFromDisk(path);
      return;
    case "ask": {
      answeringChange = true;
      try {
        const reload = await confirmDialog(
          `${displayName()} changed on disk.`,
          "Another program has written to this file. Reload it and lose the changes made here?",
          "Reload",
          "Keep Mine",
        );
        // Keeping ours leaves the stale mtime in place, so saving later still
        // asks before it overwrites the other version.
        if (reload) await reloadFromDisk(path);
      } finally {
        answeringChange = false;
      }
    }
  }
}

async function reloadFromDisk(path: string): Promise<void> {
  try {
    const file = await readFile(path);
    // Same order as `loadPath`, and for the same reason.
    markSaved(file.path, file.mtimeMs, file.lineEnding);
    loadIntoEditor(file.content);
  } catch (error) {
    await reportError("Could not reload the file.", error);
  }
}

void onFileChanged((change) => void fileChangedOnDisk(change.path, change.mtimeMs));

/** True when it is safe to throw the current document away. */
async function confirmDiscard(): Promise<boolean> {
  if (!getFileState().dirty) return true;
  return confirmDialog(
    `Do you want to discard the changes to ${displayName()}?`,
    "Your changes will be lost if you do not save them.",
    "Discard Changes",
  );
}

async function reportError(message: string, error: unknown): Promise<void> {
  const detail = error instanceof Error ? error.message : String(error);
  await messageDialog(message, detail);
}

/* Commands ----------------------------------------------------------------- */

/** Every menu item routes here, and so do the browser mode shortcuts. */
function runCommand(id: string): void {
  switch (id) {
    case "new_window":
      void newWindow();
      break;
    case "open":
      void openFile();
      break;
    case "save":
      void saveFile();
      break;
    case "save_as":
      void saveFileAs();
      break;
    case "undo":
      editor.undo();
      break;
    case "redo":
      editor.redo();
      break;
    case "strong":
    case "em":
    case "code":
      editor.toggleMark(id);
      break;
    case "find":
      openFind(false);
      break;
    case "replace":
      openFind(true);
      break;
    case "find_next":
      findbar.step(1);
      break;
    case "find_previous":
      findbar.step(-1);
      break;
    case "toggle_source":
      toggleSourceMode();
      break;
    case "mode_editing":
      setMode("editing");
      break;
    case "mode_presentation":
      setMode("presentation");
      break;
    case "mode_reading":
      setMode("reading");
      break;
    case "settings":
      settingsPanel.toggle();
      break;
    case "quit":
      void quit();
      break;
  }
}

/**
 * Source mode is a plain text area showing the raw Markdown, and the bar
 * searches the document, so the two would disagree about what is on screen.
 */
function openFind(replace: boolean): void {
  if (sourceMode) return;
  findbar.open({ replace });
}

void onMenuCommand(runCommand);

// Without a native menu bar there are no accelerators, so `pnpm dev` in a
// browser needs its own bindings. In the app the menu owns these keys.
if (!hasFileAccess()) {
  window.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    // Alt rewrites `key` on macOS, so a letter is read from the physical key.
    const key = event.code.startsWith("Key")
      ? event.code.slice(3).toLowerCase()
      : event.key.toLowerCase();
    const command = browserShortcut(key, event.shiftKey, event.altKey);
    if (!command) return;
    event.preventDefault();
    runCommand(command);
  });
}

function browserShortcut(key: string, shift: boolean, alt: boolean): string | null {
  switch (key) {
    case "n":
      return "new_window";
    case "o":
      return "open";
    case "s":
      return shift ? "save_as" : "save";
    case "f":
      return alt ? "replace" : "find";
    case "g":
      return shift ? "find_previous" : "find_next";
    case "/":
      return "toggle_source";
    case "e":
      return shift ? "mode_editing" : null;
    case "p":
      return shift ? "mode_presentation" : null;
    case "r":
      return shift ? "mode_reading" : null;
    case ",":
      return "settings";
    default:
      return null;
  }
}

// Escape from anywhere, not only from inside the panel that is open. The sheet
// is modal, so it goes first when both are up.
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (settingsPanel.isOpen) {
    event.preventDefault();
    settingsPanel.close();
  } else if (findbar.isOpen) {
    event.preventDefault();
    findbar.close();
  }
});

/**
 * Quit from the menu. Every window is asked to close and prompts for its own
 * unsaved work, so a document in a background window cannot be lost silently.
 */
async function quit(): Promise<void> {
  await closeAllWindows();
}

// Closing the window asks the same question, with a native sheet.
void onCloseRequested(confirmDiscard);

// The browser has no close hook of its own, so it keeps the page level prompt.
if (!hasFileAccess()) {
  window.addEventListener("beforeunload", (event) => {
    if (getFileState().dirty) event.preventDefault();
  });
}

applySettings(getSettings());
statusbar.update(editor.wordCount());
editor.focus();
void loadSettings();

// A window opened for a file loads it as soon as it is ready.
void initialPath().then((path) => {
  if (path) void loadPath(path);
});

// Finder opening a file while this window is already running.
void onOpenFile((path) => void openPath(path));
