// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Editor } from "../../src/editor/editor";
import { mountOutline, type OutlineTarget } from "../../src/ui/outline";

// jsdom draws nothing, so it has no scrolling to do.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function editor(markdown: string): Editor {
  const mount = document.createElement("div");
  document.body.append(mount);
  const made = new Editor(mount);
  made.setMarkdown(markdown);
  return made;
}

const DOCUMENT = [
  "# One",
  "",
  "Some prose.",
  "",
  "## Two",
  "",
  "> ### Quoted",
  "",
  "More prose.",
  "",
  "## Late",
  "",
].join("\n");

describe("the outline of a document", () => {
  it("lists every heading in order, with its level", () => {
    const made = editor(DOCUMENT);
    const entries = made.outline();

    expect(entries.map((entry) => [entry.level, entry.text])).toEqual([
      [1, "One"],
      [2, "Two"],
      [3, "Quoted"],
      [2, "Late"],
    ]);
    // Document order, so the panel can be walked top to bottom.
    for (let index = 1; index < entries.length; index += 1) {
      expect(entries[index].pos).toBeGreaterThan(entries[index - 1].pos);
    }
    made.destroy();
  });

  it("is empty for a document with no headings", () => {
    const made = editor("Only prose here.\n");
    expect(made.outline()).toEqual([]);
    made.destroy();
  });

  it("puts the caret into the heading it reveals", () => {
    const made = editor(DOCUMENT);
    const late = made.outline()[3];

    made.revealHeading(late.pos);

    const { $from } = made.view.state.selection;
    expect($from.parent.type.name).toBe("heading");
    expect($from.parent.textContent).toBe("Late");
    made.destroy();
  });

  // A click in the outline is navigation, not a selection.
  it("does not move the selection while reading", () => {
    const made = editor(DOCUMENT);
    made.setMode("reading");
    const before = made.view.state.selection;

    made.revealHeading(made.outline()[3].pos);

    expect(made.view.state.selection.eq(before)).toBe(true);
    made.destroy();
  });

  it("ignores a position that is not a heading", () => {
    const made = editor(DOCUMENT);
    const before = made.view.state.selection;

    made.revealHeading(1);

    expect(made.view.state.selection.eq(before)).toBe(true);
    made.destroy();
  });
});

/** A panel over a hand-rolled target, so the DOM can be asserted alone. */
function panel(entries: { level: number; text: string; pos: number }[]) {
  const root = document.createElement("nav");
  const scroller = document.createElement("div");
  document.body.append(root, scroller);

  const revealed: number[] = [];
  const openChanges: boolean[] = [];
  const target: OutlineTarget = {
    outline: () => entries,
    revealHeading: (pos) => revealed.push(pos),
    headingTop: () => null,
  };

  const handle = mountOutline(root, target, scroller, (open) => openChanges.push(open));
  return { root, handle, revealed, openChanges };
}

describe("the outline panel", () => {
  it("stays closed until toggled, and toggles back", () => {
    const { root, handle } = panel([]);
    expect(root.classList.contains("is-open")).toBe(false);

    handle.toggle();
    expect(root.classList.contains("is-open")).toBe(true);
    expect(handle.isOpen).toBe(true);

    handle.toggle();
    expect(root.classList.contains("is-open")).toBe(false);
    expect(handle.isOpen).toBe(false);
  });

  it("renders one item per heading, indented by level", () => {
    const { root, handle } = panel([
      { level: 1, text: "One", pos: 0 },
      { level: 2, text: "Two", pos: 10 },
    ]);
    handle.toggle();

    const items = root.querySelectorAll<HTMLButtonElement>(".outline-item");
    expect([...items].map((item) => item.textContent)).toEqual(["One", "Two"]);
    expect([...items].map((item) => item.dataset.level)).toEqual(["1", "2"]);
  });

  it("says so when there is nothing to list", () => {
    const { root, handle } = panel([]);
    handle.toggle();
    expect(root.querySelector(".outline-empty")?.textContent).toBe("No headings");
  });

  it("reveals the clicked heading", () => {
    const { root, handle, revealed } = panel([{ level: 1, text: "One", pos: 4 }]);
    handle.toggle();

    root.querySelector<HTMLButtonElement>(".outline-item")?.click();
    expect(revealed).toEqual([4]);
  });

  // The title bar button mirrors the panel, however it was opened or closed.
  it("reports every change of openness, and only changes", () => {
    const { handle, openChanges } = panel([]);
    handle.toggle();
    handle.toggle();
    handle.close();
    expect(openChanges).toEqual([true, false]);
  });

  it("follows the document as it changes", () => {
    const entries = [{ level: 1, text: "One", pos: 0 }];
    const { root, handle } = panel(entries);
    handle.toggle();

    entries.push({ level: 2, text: "Two", pos: 12 });
    handle.refresh();

    expect(root.querySelectorAll(".outline-item").length).toBe(2);
  });
});
