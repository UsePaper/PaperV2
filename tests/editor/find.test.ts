import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../src/editor/parser";
import { findMatches } from "../../src/editor/plugins/find";

/**
 * A match is a pair of document positions, and replace writes straight to them,
 * so a range that is off by one would eat the wrong characters. Each case below
 * checks the text the positions actually cover, not just how many were found.
 */
function matchedText(markdown: string, query: string): string[] {
  const doc = parseMarkdown(markdown);
  return findMatches(doc, query).map((match) => doc.textBetween(match.from, match.to));
}

describe("findMatches", () => {
  it("finds nothing for an empty query", () => {
    expect(findMatches(parseMarkdown("Some text here."), "")).toEqual([]);
  });

  it("finds nothing when the text is absent", () => {
    expect(matchedText("Some text here.", "absent")).toEqual([]);
  });

  it("covers exactly the text it matched", () => {
    expect(matchedText("The cat sat on the mat.", "cat")).toEqual(["cat"]);
  });

  it("finds every occurrence in a paragraph", () => {
    expect(matchedText("one two one two one", "one")).toEqual(["one", "one", "one"]);
  });

  it("matches without regard to case, keeping the original text", () => {
    expect(matchedText("Cat cat CAT", "cat")).toEqual(["Cat", "cat", "CAT"]);
  });

  it("finds matches across separate blocks", () => {
    expect(matchedText("# Needle heading\n\nA needle paragraph.\n", "needle")).toEqual([
      "Needle",
      "needle",
    ]);
  });

  // Marks split a paragraph into several text nodes. Searching node by node
  // would miss anything that runs across the boundary.
  it("finds a match that runs across a mark boundary", () => {
    expect(matchedText("A *bold* claim", "bold claim")).toEqual(["bold claim"]);
    expect(matchedText("the *quick* fox", "quick")).toEqual(["quick"]);
    expect(matchedText("un*frame*d", "unframed")).toEqual(["unframed"]);
  });

  // The syntax is a decoration, not text, so the document holds "quick" alone
  // and the asterisks are not there to be found.
  it("does not match the syntax that is only ever drawn", () => {
    expect(matchedText("the *quick* fox", "*quick*")).toEqual([]);
  });

  it("does not run a match past the end of a block", () => {
    expect(matchedText("first\n\nsecond", "firstsecond")).toEqual([]);
  });

  it("steps past each match rather than overlapping them", () => {
    expect(matchedText("aaaa", "aa")).toEqual(["aa", "aa"]);
  });

  it("finds text inside a list item and a quote", () => {
    expect(matchedText("- a needle here\n", "needle")).toEqual(["needle"]);
    expect(matchedText("> a needle here\n", "needle")).toEqual(["needle"]);
  });

  it("finds text inside a code block, which is still text on the page", () => {
    expect(matchedText("```js\nconst needle = 1;\n```\n", "needle")).toEqual(["needle"]);
  });

  it("reports positions in document order", () => {
    const doc = parseMarkdown("one\n\ntwo one\n\none\n");
    const found = findMatches(doc, "one");
    expect(found).toHaveLength(3);
    expect(found[0].from).toBeLessThan(found[1].from);
    expect(found[1].from).toBeLessThan(found[2].from);
  });
});
