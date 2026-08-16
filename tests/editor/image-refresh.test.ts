// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "../../src/editor/editor";

/**
 * A relative image address means nothing until the document has a folder, so
 * the same address points somewhere new the moment the file is saved, or saved
 * somewhere else. The pictures already on screen have to be looked up again.
 */

function mount(): HTMLElement {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

/** Lets the resolve promise inside the node view settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function imageElement(): HTMLElement {
  const found = document.querySelector(".pm-image");
  if (!found) throw new Error("no image view was built");
  return found as HTMLElement;
}

describe("refreshImages", () => {
  it("looks a picture up again once the document has a folder", async () => {
    // Stands in for the file layer: nothing resolves until there is a folder.
    let folder: string | null = null;

    const editor = new Editor(mount(), {
      resolveImage: async (src) => (folder ? `${folder}/${src}` : null),
    });
    editor.setMarkdown("![The icon](shot.png)\n");
    await settle();

    // Unsaved: there is nowhere for a relative address to point.
    expect(imageElement().classList.contains("is-broken")).toBe(true);

    folder = "http://example.test/notes";
    editor.refreshImages();
    await settle();

    expect(imageElement().classList.contains("is-broken")).toBe(false);
    expect(imageElement().querySelector("img")?.getAttribute("src")).toBe(
      "http://example.test/notes/shot.png",
    );

    editor.destroy();
  });

  it("moves a picture when the document is saved somewhere else", async () => {
    let folder = "http://example.test/first";

    const editor = new Editor(mount(), {
      resolveImage: async (src) => `${folder}/${src}`,
    });
    editor.setMarkdown("![The icon](shot.png)\n");
    await settle();

    expect(imageElement().querySelector("img")?.getAttribute("src")).toBe(
      "http://example.test/first/shot.png",
    );

    folder = "http://example.test/second";
    editor.refreshImages();
    await settle();

    expect(imageElement().querySelector("img")?.getAttribute("src")).toBe(
      "http://example.test/second/shot.png",
    );

    editor.destroy();
  });

  // The set of live views must not keep the ones the document has thrown away,
  // or refreshing would reach into detached elements for the life of the window.
  it("forgets a picture the document no longer holds", async () => {
    let resolved = 0;

    const editor = new Editor(mount(), {
      resolveImage: async (src) => {
        resolved += 1;
        return `http://example.test/${src}`;
      },
    });

    editor.setMarkdown("![One](one.png)\n");
    await settle();
    editor.setMarkdown("Now there is no picture at all.\n");
    await settle();

    const before = resolved;
    editor.refreshImages();
    await settle();

    expect(resolved).toBe(before);
    editor.destroy();
  });
});
