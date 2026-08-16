import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../src/editor/parser";
import { serializeMarkdown } from "../../src/editor/serializer";

const corpusDir = fileURLToPath(new URL("./corpus", import.meta.url));

const corpus = readdirSync(corpusDir)
  .filter((name) => name.endsWith(".md"))
  .sort()
  .map((name) => ({ name, text: readFileSync(join(corpusDir, name), "utf8") }));

describe("markdown round trip", () => {
  it("has a corpus", () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  // The corpus files are written in the canonical output style, so the
  // serializer must reproduce them byte for byte.
  describe.each(corpus)("$name", ({ text }) => {
    it("serializes back to the same text", () => {
      expect(serializeMarkdown(parseMarkdown(text))).toBe(text);
    });

    // The weaker rule, which must hold for any input, canonical or not.
    it("is stable across a second parse", () => {
      const once = parseMarkdown(text);
      const twice = parseMarkdown(serializeMarkdown(once));
      expect(twice.toJSON()).toEqual(once.toJSON());
    });
  });
});
