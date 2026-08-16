// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { parseMarkdown } from "../../src/editor/parser";
import { markersPlugin } from "../../src/editor/plugins/markers";
import { serializeMarkdown } from "../../src/editor/serializer";

/** The marker text shown when the caret sits at `caretAt` in the document. */
function markersAt(markdown: string, caretAt: number, enabled = true): string[] {
  const mount = document.createElement("div");
  document.body.appendChild(mount);

  const doc = parseMarkdown(markdown);
  const view = new EditorView(mount, {
    state: EditorState.create({
      doc,
      plugins: [markersPlugin(() => enabled)],
      selection: TextSelection.near(doc.resolve(caretAt)),
    }),
  });

  const markers = Array.from(view.dom.querySelectorAll(".pm-marker")).map(
    (element) => element.textContent ?? "",
  );

  const after = serializeMarkdown(view.state.doc);
  view.destroy();
  mount.remove();

  // A marker is a decoration, never text. See CLAUDE.md section 8 rule 2.
  expect(after).toBe(markdown);
  return markers;
}

describe("syntax markers", () => {
  it("shows the hashes of the heading holding the caret", () => {
    expect(markersAt("## Title\n", 3)).toEqual(["## "]);
  });

  it("shows nothing for a plain paragraph", () => {
    expect(markersAt("Just text.\n", 3)).toEqual([]);
  });

  it("shows the stars around strong text", () => {
    expect(markersAt("a **bold** end\n", 3)).toEqual(["**", "**"]);
  });

  it("shows the star around emphasis", () => {
    expect(markersAt("a *soft* end\n", 3)).toEqual(["*", "*"]);
  });

  it("shows the backticks around a code span", () => {
    expect(markersAt("a `code` end\n", 3)).toEqual(["`", "`"]);
  });

  // The caret is inside the link text: "see " runs from 1 to 5.
  it("shows the full link syntax, target included", () => {
    expect(markersAt("see [text](https://example.com) end\n", 6)).toEqual([
      "[",
      "](https://example.com)",
    ]);
  });

  /*
   * The markers follow the caret, not the block. Showing every mark in a
   * paragraph turned one click into a line full of syntax, which is the thing
   * they exist to spare the reader.
   *
   * In "One **bold** and *soft* and `code` here." the document text is
   * "One bold and soft and code here.", so the runs sit at 5-9, 14-18, 23-27.
   */
  const three = "One **bold** and *soft* and `code` here.\n";

  it("shows nothing when the caret is in the plain text between marks", () => {
    expect(markersAt(three, 11)).toEqual([]);
  });

  it("shows only the run the caret is in", () => {
    expect(markersAt(three, 6)).toEqual(["**", "**"]);
    expect(markersAt(three, 15)).toEqual(["*", "*"]);
    expect(markersAt(three, 24)).toEqual(["`", "`"]);
  });

  // Sitting against either end of a run counts as being in it, because that is
  // where you stand to take the mark off.
  it("counts both edges of a run as inside it", () => {
    expect(markersAt(three, 5)).toEqual(["**", "**"]);
    expect(markersAt(three, 9)).toEqual(["**", "**"]);
    expect(markersAt(three, 10)).toEqual([]);
  });

  // Inside emphasis inside strong, the caret is in both runs at once.
  it("shows every run the caret is inside, nesting included", () => {
    expect(markersAt("**strong with *em* inside**\n", 14)).toEqual([
      "**",
      "*",
      "*",
      "**",
    ]);
  });

  it("shows only the block the caret is in", () => {
    const twoBlocks = "# One\n\n## Two\n";
    expect(markersAt(twoBlocks, 3)).toEqual(["# "]);
    // The second heading starts after the first block closes.
    expect(markersAt(twoBlocks, 10)).toEqual(["## "]);
  });

  // Presentation mode. The caret still goes wherever it is put; it just stops
  // turning what it lands on back into source.
  it("shows nothing at all while it is switched off", () => {
    expect(markersAt("## Title\n", 3, false)).toEqual([]);
    expect(markersAt("a **bold** end\n", 6, false)).toEqual([]);
    expect(markersAt("see [text](https://example.com) end\n", 6, false)).toEqual([]);
  });

  it("shows nothing inside a code block, which is already source", () => {
    expect(markersAt("```rust\nlet x = 1;\n```\n", 10)).toEqual([]);
  });
});
