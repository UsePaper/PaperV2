// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TextSelection } from "prosemirror-state";
import { Editor } from "../../src/editor/editor";
import { MODE_ORDER, nextMode } from "../../src/ui/titlebar";

/**
 * Three ways of showing the same document. What separates them is what is
 * drawn and whether there is a keyboard, never what the file may contain.
 */

/** An editor holding a document, with the caret inside the strong run. */
function editor(): Editor {
  const mount = document.createElement("div");
  document.body.append(mount);

  const made = new Editor(mount);
  made.setMarkdown("# Title\n\nA word that is **strong** here.\n");

  const { doc } = made.view.state;
  let inStrong = 1;
  doc.descendants((node, pos) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === "strong")) {
      inStrong = pos + 1;
    }
    return true;
  });
  made.view.dispatch(
    made.view.state.tr.setSelection(TextSelection.create(doc, inStrong)),
  );

  return made;
}

const markers = (made: Editor) => made.view.dom.querySelectorAll(".pm-marker").length;

describe("the modes", () => {
  it("shows the syntax and takes the keyboard while editing", () => {
    const made = editor();
    expect(made.view.editable).toBe(true);
    expect(markers(made)).toBeGreaterThan(0);
    made.destroy();
  });

  it("keeps the keyboard but puts the syntax away while presenting", () => {
    const made = editor();
    made.setMode("presentation");
    expect(made.view.editable).toBe(true);
    expect(markers(made)).toBe(0);
    made.destroy();
  });

  it("puts the keyboard away as well while reading", () => {
    const made = editor();
    made.setMode("reading");
    expect(made.view.editable).toBe(false);
    expect(markers(made)).toBe(0);
    made.destroy();
  });

  it("comes back to what it was", () => {
    const made = editor();
    made.setMode("reading");
    made.setMode("editing");
    expect(made.view.editable).toBe(true);
    expect(markers(made)).toBeGreaterThan(0);
    made.destroy();
  });

  // Reading is the one mode that refuses the caret, so focus has to know it.
  it("does not put a caret back while reading", () => {
    const made = editor();
    made.setMode("reading");
    made.focus();
    expect(made.view.hasFocus()).toBe(false);
    made.destroy();
  });

  // One button steps through them, so the order has to come back round.
  it("steps through every mode and returns to the first", () => {
    expect(MODE_ORDER).toEqual(["editing", "presentation", "reading"]);
    expect(nextMode("editing")).toBe("presentation");
    expect(nextMode("presentation")).toBe("reading");
    expect(nextMode("reading")).toBe("editing");
  });
});
