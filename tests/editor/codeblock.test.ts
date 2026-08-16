import { describe, expect, it } from "vitest";
import { Decoration, DecorationSet, type DecorationSource } from "prosemirror-view";
import { parseMarkdown } from "../../src/editor/parser";
import { diffRange, findRangesIn } from "../../src/editor/nodeviews/codeblock";

/**
 * The two editors inside a code block keep one document between them, and this
 * is the arithmetic that carries a change from one to the other. An off by one
 * here does not throw: it quietly writes the wrong characters into the file.
 *
 * So every case checks the property that matters rather than the numbers:
 * replacing `before[from..toBefore]` with `after[from..toAfter]` must produce
 * exactly `after`.
 */
function applied(before: string, after: string): string {
  const { from, toBefore, toAfter } = diffRange(before, after);
  return before.slice(0, from) + after.slice(from, toAfter) + before.slice(toBefore);
}

function check(before: string, after: string): void {
  expect(applied(before, after)).toBe(after);
}

describe("diffRange", () => {
  it("reports an empty range when nothing changed", () => {
    const { from, toBefore, toAfter } = diffRange("const a = 1;", "const a = 1;");
    expect(toBefore).toBe(from);
    expect(toAfter).toBe(from);
  });

  it("handles an insertion in the middle", () => {
    check("const a = 1;", "const ab = 1;");
  });

  it("handles a deletion in the middle", () => {
    check("const ab = 1;", "const a = 1;");
  });

  it("handles text appended at the end", () => {
    check("const a = 1;", "const a = 1;\nconst b = 2;");
  });

  it("handles text inserted at the start", () => {
    check("const a = 1;", "// note\nconst a = 1;");
  });

  it("handles a complete replacement", () => {
    check("aaa", "bbb");
  });

  it("handles growing from empty", () => {
    check("", "a");
  });

  it("handles shrinking to empty", () => {
    check("a", "");
  });

  // The prefix and the suffix scan must not cross each other, or the range
  // comes back inverted and the wrong span is replaced.
  it("handles repeated characters, where prefix and suffix could overlap", () => {
    check("aaa", "aaaa");
    check("aaaa", "aaa");
    check("aa", "aaaaa");
    check("aaaaa", "aa");
  });

  it("never returns a range that runs backwards", () => {
    const pairs: Array<[string, string]> = [
      ["aaa", "aaaa"],
      ["aaaa", "aaa"],
      ["", "abc"],
      ["abc", ""],
      ["abcabc", "abc"],
      ["x", "xxxxxxx"],
    ];
    for (const [before, after] of pairs) {
      const { from, toBefore, toAfter } = diffRange(before, after);
      expect(toBefore).toBeGreaterThanOrEqual(from);
      expect(toAfter).toBeGreaterThanOrEqual(from);
      expect(toBefore).toBeLessThanOrEqual(before.length);
      expect(toAfter).toBeLessThanOrEqual(after.length);
    }
  });

  it("handles a realistic edit inside a block of code", () => {
    check(
      'function shout(text) {\n  return text.toUpperCase();\n}',
      'function shout(text) {\n  return text.toUpperCase() + "!";\n}',
    );
  });

  it("handles a newline typed in the middle", () => {
    check("const a = 1; const b = 2;", "const a = 1;\nconst b = 2;");
  });
});

/**
 * The outer editor's find matches, redrawn inside the block. ProseMirror gives
 * these in the block's own coordinates, but a range that fell outside the text
 * would throw rather than merely look wrong, so the clamping is pinned here.
 */
function source(...decorations: Decoration[]): DecorationSource {
  const doc = parseMarkdown("placeholder");
  const set = DecorationSet.create(doc, []);
  return {
    map: () => source(),
    forChild: () => source(),
    forEachSet: (run) => run(decorations.length ? set.add(doc, decorations) : set),
  };
}

const match = (from: number, to: number, current = false) =>
  Decoration.inline(from, to, { class: "find-match" }, { current });

describe("findRangesIn", () => {
  it("finds nothing when there are no decorations", () => {
    expect(findRangesIn(source(), 20)).toEqual([]);
  });

  it("carries a range through as it stands", () => {
    expect(findRangesIn(source(match(3, 9)), 20)).toEqual([
      { from: 3, to: 9, current: false },
    ]);
  });

  it("marks which one the find bar is on", () => {
    expect(findRangesIn(source(match(3, 9, true)), 20)).toEqual([
      { from: 3, to: 9, current: true },
    ]);
  });

  // A stale range, arriving before the text it points into, must not throw.
  it("clamps a range that runs past the end of the text", () => {
    expect(findRangesIn(source(match(2, 99)), 10)).toEqual([
      { from: 2, to: 10, current: false },
    ]);
  });

  it("drops a range that falls entirely outside the text", () => {
    expect(findRangesIn(source(match(40, 50)), 10)).toEqual([]);
  });

  it("drops an empty range, which cannot carry a mark", () => {
    expect(findRangesIn(source(match(5, 5)), 20)).toEqual([]);
  });

  it("returns ranges in order, whatever order they arrived in", () => {
    const ranges = findRangesIn(source(match(12, 15), match(2, 5), match(7, 9)), 20);
    expect(ranges.map((range) => range.from)).toEqual([2, 7, 12]);
  });
});
