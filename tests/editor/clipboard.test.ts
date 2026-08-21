import { describe, expect, it } from "vitest";
import { looksLikeMarkdown, markdownSlice } from "../../src/editor/clipboard";

/**
 * The clipboard usually carries HTML as well as text, and the HTML a code
 * editor writes is syntax colouring around Markdown source. These decide which
 * of the two to believe.
 */
describe("looksLikeMarkdown", () => {
  const yes: Array<[string, string]> = [
    ["a heading", "# Markdown syntax guide"],
    ["a deep heading", "###### This is a Heading h6"],
    ["a fence", "```\nlet message = 'Hello';\n```"],
    ["a bullet", "* Item 1\n* Item 2"],
    ["a dash bullet", "- Item 1"],
    ["an ordered item", "1. Item 1\n2. Item 2"],
    ["a quote", "> Markdown is a lightweight markup language."],
    ["a rule", "---"],
    ["a table row", "| Left | Right |\n| --- | --- |"],
    ["an indented heading", "   ## Still a heading"],
  ];
  for (const [what, text] of yes) {
    it(`sees ${what}`, () => expect(looksLikeMarkdown(text)).toBe(true));
  }

  const no: Array<[string, string]> = [
    ["plain prose", "The best writing tool gets out of the way."],
    ["a sentence with a dash", "He paused - then went on."],
    ["a hash mid sentence", "Filed under #writing today."],
    ["prose with asterisks", "She said it was 2 * 3 and moved on."],
    ["an empty selection", ""],
  ];
  for (const [what, text] of no) {
    it(`leaves ${what} alone`, () => expect(looksLikeMarkdown(text)).toBe(false));
  }
});

describe("markdownSlice", () => {
  it("keeps one paragraph inline, so a paste joins the sentence", () => {
    const slice = markdownSlice("just some words");
    expect(slice.content.firstChild?.type.name).toBe("text");
  });

  it("brings blocks across as blocks", () => {
    const slice = markdownSlice("# Title\n\nA paragraph.");
    expect(slice.content.firstChild?.type.name).toBe("heading");
    expect(slice.content.childCount).toBe(2);
  });

  it("reads the structure of a real document", () => {
    const doc = [
      "# Markdown syntax guide",
      "",
      "## Headers",
      "",
      "* Item 1",
      "* Item 2",
      "",
      "> A quote.",
      "",
      "| Left | Right |",
      "| --- | --- |",
      "| a | b |",
      "",
      "```js",
      "const x = 1;",
      "```",
    ].join("\n");

    const kinds: string[] = [];
    markdownSlice(doc).content.forEach((node) => kinds.push(node.type.name));
    expect(kinds).toEqual([
      "heading",
      "heading",
      "bullet_list",
      "blockquote",
      "table",
      "code_block",
    ]);
  });

  it("keeps emphasis a mark rather than punctuation", () => {
    const slice = markdownSlice("*italic* and **bold**");
    const marks: string[] = [];
    slice.content.forEach((node) => marks.push(...node.marks.map((m) => m.type.name)));
    expect(marks).toContain("em");
    expect(marks).toContain("strong");
  });
});
