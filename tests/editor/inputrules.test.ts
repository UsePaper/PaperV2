// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { inputRulesPlugin } from "../../src/editor/inputrules";
import { editorKeymap, baseKeymapPlugin } from "../../src/editor/keymap";
import { parseMarkdown } from "../../src/editor/parser";
import { serializeMarkdown } from "../../src/editor/serializer";

/**
 * Drives the real EditorView through `handleTextInput`, which is the path a
 * keystroke takes, so the input rules are exercised the way a user hits them.
 */
function typeInto(startingMarkdown: string, text: string): string {
  const mount = document.createElement("div");
  document.body.appendChild(mount);

  const view = new EditorView(mount, {
    state: EditorState.create({
      doc: parseMarkdown(startingMarkdown),
      plugins: [inputRulesPlugin, editorKeymap, baseKeymapPlugin],
    }),
  });

  // Start at the end of the document.
  const end = view.state.doc.content.size;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(end), -1)),
  );

  for (const character of text) {
    const { from, to } = view.state.selection;
    const insert = () => view.state.tr.insertText(character, from, to);
    const handled = view.someProp("handleTextInput", (f) =>
      f(view, from, to, character, insert),
    );
    if (!handled) view.dispatch(insert());
  }

  const markdown = serializeMarkdown(view.state.doc);
  view.destroy();
  mount.remove();
  return markdown;
}

describe("block input rules", () => {
  it("turns a hash and a space into a heading", () => {
    expect(typeInto("", "# Title")).toBe("# Title\n");
  });

  it("supports every heading level", () => {
    expect(typeInto("", "### Third")).toBe("### Third\n");
    expect(typeInto("", "###### Sixth")).toBe("###### Sixth\n");
  });

  it("turns a dash and a space into a bullet list", () => {
    expect(typeInto("", "- milk")).toBe("- milk\n");
  });

  it("turns a number and a dot into an ordered list", () => {
    expect(typeInto("", "1. first")).toBe("1. first\n");
  });

  it("turns an angle bracket into a blockquote", () => {
    expect(typeInto("", "> quoted")).toBe("> quoted\n");
  });

  it("turns a fence into a code block that keeps its language", () => {
    expect(typeInto("", "```rust ")).toBe("```rust\n\n```\n");
  });
});

describe("inline input rules", () => {
  it("applies strong and removes the stars", () => {
    expect(typeInto("", "a **bold** end")).toBe("a **bold** end\n");
  });

  it("applies emphasis and removes the star", () => {
    expect(typeInto("", "a *soft* end")).toBe("a *soft* end\n");
  });

  it("applies code and removes the backticks", () => {
    expect(typeInto("", "a `code` end")).toBe("a `code` end\n");
  });

  it("applies emphasis with underscores", () => {
    expect(typeInto("", "a _soft_ end")).toBe("a *soft* end\n");
  });

  it("leaves an underscore inside a word alone", () => {
    expect(typeInto("", "snake_case_name here")).toBe("snake_case_name here\n");
  });

  it("does not eat the character in front of the marker", () => {
    // The pattern consumes a leading character; the rule must not delete it.
    expect(typeInto("", "x**y**")).toBe("x**y**\n");
  });

  it("stops the mark from continuing onto the next word", () => {
    expect(typeInto("", "**bold** plain")).toBe("**bold** plain\n");
  });
});
