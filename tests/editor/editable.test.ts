// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { parseMarkdown } from "../../src/editor/parser";
import { markersPlugin } from "../../src/editor/plugins/markers";
import { placeholderPlugin } from "../../src/editor/plugins/placeholder";

/**
 * A `contenteditable="false"` element that is the only child of an empty block
 * makes the browser refuse to insert text there, which leaves that block
 * impossible to type into. Decorations on an empty block must therefore be
 * drawn with CSS, never as widgets.
 */
function emptyBlocksWithUneditableContent(
  markdown: string,
  caretAt: number,
): string[] {
  const mount = document.createElement("div");
  document.body.appendChild(mount);

  const doc = parseMarkdown(markdown);
  const view = new EditorView(mount, {
    state: EditorState.create({
      doc,
      plugins: [markersPlugin(), placeholderPlugin("Start writing.")],
      selection: TextSelection.near(doc.resolve(caretAt)),
    }),
  });

  // ProseMirror marks every widget with this class and with
  // `contenteditable="false"`. The class is what we look for, because jsdom
  // does not reflect the contentEditable property into an attribute.
  const offenders: string[] = [];
  for (const block of view.dom.children) {
    const widgets = block.querySelectorAll(".ProseMirror-widget");
    if (widgets.length === 0) continue;
    // Only a block with no typeable text of its own is a trap.
    const total = (block.textContent ?? "").length;
    let inWidgets = 0;
    for (const node of widgets) inWidgets += (node.textContent ?? "").length;
    if (total === inWidgets) offenders.push(block.outerHTML);
  }

  view.destroy();
  mount.remove();
  return offenders;
}

describe("an empty block stays typeable", () => {
  it("holds nothing uneditable in an empty document", () => {
    expect(emptyBlocksWithUneditableContent("", 1)).toEqual([]);
  });

  it("holds nothing uneditable in a heading with no text yet", () => {
    // What the document looks like the moment "# " turns into a heading.
    expect(emptyBlocksWithUneditableContent("#\n", 1)).toEqual([]);
  });

  // A cell with nothing in it is the one place in a table you have to be able
  // to click into, and it is the easiest one to make untypeable.
  it("holds nothing uneditable in an empty table cell", () => {
    expect(emptyBlocksWithUneditableContent("| A | B |\n|---|---|\n|  |  |\n", 1)).toEqual(
      [],
    );
  });

  it("still shows the placeholder on the empty document", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const doc = parseMarkdown("");
    const view = new EditorView(mount, {
      state: EditorState.create({
        doc,
        plugins: [placeholderPlugin("Start writing.")],
      }),
    });

    const hint = view.dom.querySelector("[data-placeholder]");
    expect(hint?.getAttribute("data-placeholder")).toBe("Start writing.");

    view.destroy();
    mount.remove();
  });

  it("still shows the hashes on an empty heading", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const doc = parseMarkdown("##\n");
    const view = new EditorView(mount, {
      state: EditorState.create({
        doc,
        plugins: [markersPlugin()],
        selection: TextSelection.near(doc.resolve(1)),
      }),
    });

    const marker = view.dom.querySelector("[data-marker]");
    expect(marker?.getAttribute("data-marker")).toBe("## ");

    view.destroy();
    mount.remove();
  });
});
