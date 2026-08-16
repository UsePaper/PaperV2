/** The line ending style a file used on disk. */
export type LineEnding = "lf" | "crlf";

export interface FileState {
  /** The absolute path, or null for a document that has never been saved. */
  path: string | null;
  /** The modification time in milliseconds, as of the last read or write. */
  mtimeMs: number | null;
  lineEnding: LineEnding;
  dirty: boolean;
}

const state: FileState = {
  path: null,
  mtimeMs: null,
  lineEnding: "lf",
  dirty: false,
};

type Listener = (state: Readonly<FileState>) => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener(state);
}

/** This module owns the dirty flag. Nothing else may hold one. */
export function getFileState(): Readonly<FileState> {
  return state;
}

export function onFileStateChange(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function markDirty(): void {
  if (state.dirty) return;
  state.dirty = true;
  notify();
}

/** Records a successful read or write. */
export function markSaved(
  path: string,
  mtimeMs: number,
  lineEnding: LineEnding,
): void {
  state.path = path;
  state.mtimeMs = mtimeMs;
  state.lineEnding = lineEnding;
  state.dirty = false;
  notify();
}

/** What a report from the file watcher means for this window. */
export type ExternalChange =
  /** Our own save, a file we no longer show, or no real change. */
  | "ignore"
  /** The buffer is clean, so the new text can simply replace it. */
  | "reload"
  /** The buffer is dirty. Only the user can choose between the two versions. */
  | "ask"
  /** The file was deleted or moved away. The buffer is all that is left. */
  | "gone";

/**
 * Decides what a change on disk means. See CLAUDE.md section 9 rules 4 and 5.
 *
 * `mtimeMs` is null when the file has gone.
 */
export function externalChangeAction(
  state: Readonly<FileState>,
  path: string,
  mtimeMs: number | null,
): ExternalChange {
  // A watcher from a file this window has since left behind.
  if (state.path !== path) return "ignore";
  if (mtimeMs === null) return "gone";
  // Our own write, coming back to us. Filesystem timestamps are coarse, so
  // this compares with the same tolerance the Rust side uses.
  if (state.mtimeMs !== null && Math.abs(mtimeMs - state.mtimeMs) <= 1) {
    return "ignore";
  }
  return state.dirty ? "ask" : "reload";
}

/** Records that the file behind the buffer is gone, leaving unsaved work. */
export function markPathLost(): void {
  state.mtimeMs = null;
  state.dirty = true;
  notify();
}

/**
 * True when a window holds nothing worth keeping, so an opened file can load
 * into it rather than claiming a window of its own.
 */
export function isBlankDocument(
  state: Pick<FileState, "path" | "dirty">,
  markdown: string,
): boolean {
  return state.path === null && !state.dirty && markdown.trim() === "";
}

/** The name shown in the title bar. */
export function displayName(): string {
  if (!state.path) return "Untitled";
  const parts = state.path.split(/[/\\]/);
  return parts[parts.length - 1] || state.path;
}
