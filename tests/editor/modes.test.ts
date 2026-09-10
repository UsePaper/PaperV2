// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TextSelection } from "prosemirror-state";
import { Editor, type ViewMode } from "../../src/editor/editor";
import { MODE_ORDER, mountTitlebar, nextMode } from "../../src/ui/titlebar";

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

/**
 * The title bar offers the modes either as one button that cycles or as
 * three side by side. The setting decides which is shown, and a press on
 * either kind names the mode it stands for.
 */
describe("the mode control in the title bar", () => {
  function titlebar() {
    const root = document.createElement("div");
    document.body.append(root);
    const cycled: number[] = [];
    const selected: ViewMode[] = [];
    const handle = mountTitlebar(root, {
      onCycleMode: () => cycled.push(1),
      onSelectMode: (mode) => selected.push(mode),
      onToggleOutline: () => {},
    });
    handle.setMode("editing");
    // The cycling button sits in the bar itself. The three of the switch sit
    // inside their own group.
    const cycle = root.querySelector<HTMLElement>(":scope > .titlebar-mode");
    const switcher = root.querySelector<HTMLElement>(".titlebar-modes");
    if (!cycle || !switcher) throw new Error("the title bar is missing a control");
    return { handle, cycle, switcher, cycled, selected };
  }

  it("cycles from the single button unless told otherwise", () => {
    const made = titlebar();
    made.handle.setModeControl("cycle");
    expect(made.cycle.hidden).toBe(false);
    expect(made.switcher.hidden).toBe(true);

    made.cycle.click();
    expect(made.cycled).toHaveLength(1);
  });

  it("goes straight to any mode from the switch", () => {
    const made = titlebar();
    made.handle.setModeControl("switch");
    expect(made.cycle.hidden).toBe(true);
    expect(made.switcher.hidden).toBe(false);

    const book = made.switcher.querySelector<HTMLElement>('[data-mode="reading"]');
    book?.click();
    expect(made.selected).toEqual(["reading"]);
  });

  it("marks the mode that is showing on the switch", () => {
    const made = titlebar();
    made.handle.setMode("presentation");
    const checked = [...made.switcher.querySelectorAll('[aria-checked="true"]')].map(
      (each) => (each as HTMLElement).dataset.mode,
    );
    expect(checked).toEqual(["presentation"]);
  });
});
