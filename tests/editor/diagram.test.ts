import { describe, expect, it } from "vitest";
import { isDiagram } from "../../src/editor/nodeviews/diagram";

/**
 * Which fences get drawn. Everything else stays code, including the languages
 * whose names merely look close.
 */
describe("isDiagram", () => {
  it("takes a mermaid fence", () => {
    expect(isDiagram("mermaid")).toBe(true);
  });

  it("ignores the case the fence was written in", () => {
    expect(isDiagram("Mermaid")).toBe(true);
    expect(isDiagram("MERMAID")).toBe(true);
  });

  it("reads only the first word, the way the highlighter does", () => {
    expect(isDiagram("mermaid theme=dark")).toBe(true);
    expect(isDiagram("  mermaid  ")).toBe(true);
  });

  it("leaves every other fence as code", () => {
    for (const language of ["js", "ts", "rust", "", "mermaidjs", "not-mermaid"]) {
      expect(isDiagram(language)).toBe(false);
    }
  });
});
