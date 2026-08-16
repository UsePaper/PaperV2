import { describe, expect, it } from "vitest";
import { classifyImageSrc, imageMimeType } from "../../src/editor/nodeviews/image";

/**
 * Getting this wrong fails in one of two ugly ways: a picture that exists is
 * hidden, or a web address is handed to the filesystem.
 */
describe("classifyImageSrc", () => {
  const document = "/notes/journal/today.md";

  it("leaves a web address alone", () => {
    expect(classifyImageSrc("https://example.com/a.png", document)).toEqual({
      kind: "direct",
      url: "https://example.com/a.png",
    });
    expect(classifyImageSrc("http://example.com/a.png", null)).toEqual({
      kind: "direct",
      url: "http://example.com/a.png",
    });
  });

  it("leaves data and blob addresses alone", () => {
    expect(classifyImageSrc("data:image/png;base64,AAAA", null).kind).toBe("direct");
    expect(classifyImageSrc("blob:http://localhost/abc", null).kind).toBe("direct");
  });

  it("reads a relative path from disk", () => {
    expect(classifyImageSrc("./shot.png", document)).toEqual({
      kind: "file",
      path: "./shot.png",
    });
    expect(classifyImageSrc("images/shot.png", document)).toEqual({
      kind: "file",
      path: "images/shot.png",
    });
    expect(classifyImageSrc("../shared/shot.png", document)).toEqual({
      kind: "file",
      path: "../shared/shot.png",
    });
  });

  // Nothing is relative to a document that has never been saved.
  it("cannot resolve a relative path with no document", () => {
    expect(classifyImageSrc("./shot.png", null)).toEqual({ kind: "unresolved" });
  });

  it("reads an absolute path from disk, saved document or not", () => {
    expect(classifyImageSrc("/pictures/shot.png", null)).toEqual({
      kind: "file",
      path: "/pictures/shot.png",
    });
  });

  it("treats a file URL as a path", () => {
    expect(classifyImageSrc("file:///pictures/shot.png", null)).toEqual({
      kind: "file",
      path: "file:///pictures/shot.png",
    });
  });

  it("has nothing to show for an empty address", () => {
    expect(classifyImageSrc("", document)).toEqual({ kind: "unresolved" });
    expect(classifyImageSrc("   ", document)).toEqual({ kind: "unresolved" });
  });

  // A Windows drive letter looks like a scheme, so the test pins which way it
  // is read: a single letter is not a scheme worth honouring.
  it("does not mistake a lone letter for a scheme", () => {
    expect(classifyImageSrc("C:/pictures/shot.png", document).kind).toBe("direct");
  });
});

describe("imageMimeType", () => {
  // A blob with no type will not render, so the extension has to carry it.
  it("names the common picture types", () => {
    expect(imageMimeType("./a.png")).toBe("image/png");
    expect(imageMimeType("./a.jpg")).toBe("image/jpeg");
    expect(imageMimeType("./a.jpeg")).toBe("image/jpeg");
    expect(imageMimeType("./a.gif")).toBe("image/gif");
    expect(imageMimeType("./a.webp")).toBe("image/webp");
    expect(imageMimeType("./a.svg")).toBe("image/svg+xml");
  });

  it("ignores case", () => {
    expect(imageMimeType("./A.PNG")).toBe("image/png");
  });

  it("ignores a query or a fragment", () => {
    expect(imageMimeType("./a.png?v=2")).toBe("image/png");
    expect(imageMimeType("./a.png#top")).toBe("image/png");
  });

  it("falls back rather than guessing", () => {
    expect(imageMimeType("./a.xyz")).toBe("application/octet-stream");
    expect(imageMimeType("./noextension")).toBe("application/octet-stream");
  });
});
