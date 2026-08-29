import { Editor, type ViewMode } from "./editor/editor";
import { classifyImageSrc, imageMimeType } from "./editor/nodeviews/image";
import {
  StaleFileError,
  checkForUpdate,
  confirmDialog,
  closeAllWindows,
  hasFileAccess,
  initialPath,
  installCli,
  messageDialog,
  newWindow,
  openReleasesPage,
  onFileChanged,
  onOpenFile,
  onSettingsWritten,
  onCloseRequested,
  onMenuCommand,
  openDialog,
  readFile,
  readImageBytes,
  raiseWindowFor,
  readSettings,
  saveAsDialog,
  setWindowPath,
  watchFile,
  writeFileAtomic,
  writeSettings,
  type FileContents,
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
  startingMode,
  type Settings,
} from "./settings/state";
import { mountFindbar } from "./ui/findbar";
import { mountOutline } from "./ui/outline";
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
    // Editing a heading changes the outline.
    outlinePanel.refresh();
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
const outlinePanel = mountOutline(
  element("outline"),
  editor,
  element("workspace"),
  // The button in the title bar shows whether the panel is out, however it
  // was opened or closed.
  (open) => titlebar.setOutlineOpen(open),
);

const titlebar = mountTitlebar(element("titlebar"), {
  onCycleMode: () => setMode(nextMode(mode)),
  onToggleOutline: () => runCommand("toggle_outline"),
});

/* Modes ---------------------------------------------------------------------

   Three ways of showing the same document, and one button that steps through
   them. Editing shows the syntax of whatever the caret is in. Presentation
   puts the syntax away and keeps the keyboard. Reading puts the keyboard away
   as well, leaving text that can be selected and copied but not typed into. */

let mode: ViewMode = "editing";

/** A debug tool and an escape hatch. See CLAUDE.md section 1. Declared here
    because the first `setMode` call below reads it: further down, that read
    hit the temporal dead zone and stopped the whole module from loading. */
let sourceMode = false;

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
  // A diagram is drawn in the theme that was current when it was drawn.
  editor.refreshDiagrams();
  sourceView.spellcheck = settings.spellcheck;
  // Only after the stored settings are in, so the defaults never overwrite
  // the file before it has been read.
  if (settingsLoaded) schedulePersist(settings);
});

// The "System" theme follows the operating system, which can change without
// the settings file moving, and a diagram holds the colours it was drawn in.
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => editor.refreshDiagrams());

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

function toggleSourceMode(): void {
  sourceMode = !sourceMode;
  if (sourceMode) {
    // The bar searches the document, and the outline points into it, but
    // source mode shows the raw text instead, so leaving either open would
    // aim at something that is not on screen.
    findbar.close();
    outlinePanel.close();
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

/**
 * Where a file lands, whether it was chosen here or handed to us by the system.
 * A document lives in one window, so the window already showing it wins, even
 * when this one is blank and could have taken it. Failing that, an untouched
 * window is a blank sheet and the file loads into it; anything else keeps the
 * document it is holding and the file gets a window of its own.
 */
async function routeToWindow(path: string): Promise<void> {
  if (await raiseWindowFor(path)) return;

  if (!isBlankDocument(getFileState(), currentMarkdown())) {
    await newWindow(path);
    return;
  }
  await loadPath(path);
}

async function openFile(): Promise<void> {
  const path = await openDialog();
  if (!path) return;
  await routeToWindow(path);
}

/** Finder, the `paper` command, or a second window opening a file we hold. */
async function openPath(path: string): Promise<void> {
  // The same path can arrive twice, once stashed and once announced.
  if (getFileState().path === path) return;
  await routeToWindow(path);
}

/**
 * Reads a file for opening, or reports why it could not be and answers null.
 * Split out of `loadPath` so `start` can read before the mode is chosen,
 * without opening the file into the editor twice.
 */
async function readFileForOpening(path: string): Promise<FileContents | null> {
  try {
    return await readFile(path);
  } catch (error) {
    await reportError("Could not open the file.", error);
    return null;
  }
}

async function loadPath(path: string): Promise<void> {
  const file = await readFileForOpening(path);
  if (!file) return;
  // The path is recorded first: a relative image resolves against the folder
  // the document lives in, and the pictures are loaded as the document is
  // built, so the file has to be known by then.
  markSaved(file.path, file.mtimeMs, file.lineEnding);
  loadIntoEditor(file.content);
  editor.focus();
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
   the rules in CLAUDE.md section 8. */

let documentPath: string | null = null;

/** Everything that depends on which file this window is holding. */
onFileStateChange((state) => {
  if (state.path === documentPath) return;
  documentPath = state.path;

  // Rust keeps the file-to-window map, because no window can see what the
  // others are showing.
  void setWindowPath(state.path).catch(() => {
    // Losing this costs the raise-instead-of-reopen, not the document.
  });

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
    case "toggle_outline":
      // Source mode shows the raw text, which the outline cannot point into.
      if (!sourceMode) outlinePanel.toggle();
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
    case "check_for_updates":
      void checkForUpdates();
      break;
    case "install_cli":
      void installCommandLineTool();
      break;
    case "quit":
      void quit();
      break;
  }
}

/**
 * The menu item, end to end. Nothing here runs on its own: the check happens
 * because the user asked for it, and the answer is a dialog they opened.
 */
async function checkForUpdates(): Promise<void> {
  const result = await checkForUpdate();

  if (result.status === "available") {
    const download = await confirmDialog(
      "A new version is available",
      `Paper ${result.latest} is available. You have ${result.current}.`,
      "Download",
      "Later",
    );
    if (download) await openReleasesPage();
    return;
  }

  if (result.status === "current") {
    await messageDialog(
      "You are up to date",
      `Paper ${result.current} is the latest version.`,
      "info",
    );
    return;
  }

  // Offline, rate limited, or nothing published yet. None of that is worth a
  // stack trace, and none of it means an update does or does not exist.
  await messageDialog(
    "Could not check for updates",
    "The latest version could not be reached. Check your connection, or look at the releases page.",
  );
}

/**
 * The other menu item that reaches outside the document: it links the `paper`
 * command from inside the bundle onto PATH. Writing to /usr/local/bin may need
 * authorisation, which the system asks for itself.
 */
async function installCommandLineTool(): Promise<void> {
  try {
    const result = await installCli();

    // The authorisation sheet was dismissed. The user knows what they did.
    if (result.status === "cancelled") return;

    await messageDialog(
      result.status === "already"
        ? "The command is already installed"
        : "The command is installed",
      `${result.path} runs Paper. Open a file with \`paper notes.md\`, and remove the command with \`rm ${result.path}\`.`,
      "info",
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await messageDialog("Could not install the command", detail);
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
      return shift ? "toggle_outline" : "open";
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
void start();

/**
 * The order matters. Reading mode is a dead end on a document with nothing in
 * it, whether that is because no file was opened or because the file opened
 * is empty, so the mode cannot be chosen until the file has been read. It is
 * still chosen before the file is loaded into the editor, so the document
 * does not appear in one mode and change to another in front of the reader.
 * Never from the settings listener: that also fires when another window
 * writes, which would drag every open window along with it.
 */
async function start(): Promise<void> {
  await loadSettings();
  const path = await initialPath();
  const file = path ? await readFileForOpening(path) : null;

  setMode(startingMode(getSettings().defaultMode, !file || file.content.trim() === ""));

  if (file) {
    markSaved(file.path, file.mtimeMs, file.lineEnding);
    loadIntoEditor(file.content);
    editor.focus();
  }
}

// Finder opening a file while this window is already running.
void onOpenFile((path) => void openPath(path));
