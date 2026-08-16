import { describe, expect, it } from "vitest";
import {
  externalChangeAction,
  isBlankDocument,
  type FileState,
} from "../../src/file/state";

/**
 * This decides whether an opened file lands in the current window or claims a
 * new one. Getting it wrong either scatters windows or, worse, drops the
 * document someone was working on.
 */
describe("isBlankDocument", () => {
  const fresh = { path: null, dirty: false };

  it("is blank for an untouched new window", () => {
    expect(isBlankDocument(fresh, "")).toBe(true);
  });

  it("is blank when only whitespace has been typed", () => {
    expect(isBlankDocument(fresh, "\n\n   \n")).toBe(true);
  });

  it("is not blank once there is text", () => {
    expect(isBlankDocument(fresh, "a")).toBe(false);
  });

  it("is not blank when a file is open, even an empty one", () => {
    expect(isBlankDocument({ path: "/notes.md", dirty: false }, "")).toBe(false);
  });

  // The dirty flag is the safety net: unsaved work must never be replaced.
  it("is not blank when there are unsaved changes", () => {
    expect(isBlankDocument({ path: null, dirty: true }, "")).toBe(false);
  });
});

/**
 * What the file watcher's report means. The dangerous answer is "reload" while
 * there are unsaved changes, so that case is pinned from several directions.
 */
describe("externalChangeAction", () => {
  const open: FileState = {
    path: "/notes.md",
    mtimeMs: 1_000,
    lineEnding: "lf",
    dirty: false,
  };

  it("reloads a clean buffer without asking", () => {
    expect(externalChangeAction(open, "/notes.md", 2_000)).toBe("reload");
  });

  it("asks before replacing unsaved changes", () => {
    expect(externalChangeAction({ ...open, dirty: true }, "/notes.md", 2_000)).toBe(
      "ask",
    );
  });

  it("ignores the write we just made ourselves", () => {
    expect(externalChangeAction(open, "/notes.md", 1_000)).toBe("ignore");
  });

  // Filesystem timestamps are coarse, so our own write can come back a
  // fraction off. Treating that as someone else's edit would reload the file
  // after every save.
  it("ignores a timestamp within the tolerance", () => {
    expect(externalChangeAction(open, "/notes.md", 1_000.5)).toBe("ignore");
  });

  it("ignores a report for a file this window no longer holds", () => {
    expect(externalChangeAction(open, "/other.md", 2_000)).toBe("ignore");
  });

  it("ignores a report when nothing is open", () => {
    expect(
      externalChangeAction({ ...open, path: null, mtimeMs: null }, "/notes.md", 2_000),
    ).toBe("ignore");
  });

  it("reports a deleted file rather than emptying the window", () => {
    expect(externalChangeAction(open, "/notes.md", null)).toBe("gone");
  });

  it("still reports deletion when there are unsaved changes", () => {
    expect(externalChangeAction({ ...open, dirty: true }, "/notes.md", null)).toBe(
      "gone",
    );
  });

  // After a deletion the window holds the only copy, so a file that reappears
  // must not overwrite it silently.
  it("asks when a file reappears after being lost", () => {
    expect(
      externalChangeAction({ ...open, mtimeMs: null, dirty: true }, "/notes.md", 3_000),
    ).toBe("ask");
  });
});
