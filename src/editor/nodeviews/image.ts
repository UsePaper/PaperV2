import type { Node as ProseNode } from "prosemirror-model";
import type { NodeView } from "prosemirror-view";

/**
 * Shows the picture a document points at.
 *
 * Without this an image only appears when its address is a full URL. A relative
 * path is relative to the file it was written in, and the webview's origin is
 * the application rather than that folder, so the browser asks for the wrong
 * place and gets nothing. Those are read from disk instead.
 */

/** How an image address can be turned into something the page can show. */
export type ImageSource =
  /** Already loadable as it stands. */
  | { kind: "direct"; url: string }
  /** Has to be read from disk first. */
  | { kind: "file"; path: string }
  /** Nothing can be loaded: an unsaved document, or an empty address. */
  | { kind: "unresolved" };

/** Loads an address, or returns null when it cannot be shown. */
export type ResolveImage = (src: string) => Promise<string | null>;

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** Schemes the browser can already fetch on its own. */
const DIRECT_SCHEMES = ["http:", "https:", "data:", "blob:"];

/**
 * Decides where an image has to come from. Kept apart from the DOM so the rule
 * can be checked directly: getting it wrong either hides a picture that exists
 * or sends a web address to the filesystem.
 */
export function classifyImageSrc(src: string, documentPath: string | null): ImageSource {
  const trimmed = src.trim();
  if (!trimmed) return { kind: "unresolved" };

  if (HAS_SCHEME.test(trimmed)) {
    const scheme = trimmed.slice(0, trimmed.indexOf(":") + 1).toLowerCase();
    if (DIRECT_SCHEMES.includes(scheme)) return { kind: "direct", url: trimmed };
    // A file URL names a path, and anything else is left to the browser.
    if (scheme === "file:") return { kind: "file", path: trimmed };
    return { kind: "direct", url: trimmed };
  }

  // An absolute path does not need the document, a relative one does.
  if (trimmed.startsWith("/")) return { kind: "file", path: trimmed };
  return documentPath ? { kind: "file", path: trimmed } : { kind: "unresolved" };
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff",
};

/**
 * A blob with no type will not render, and the bytes off disk carry none, so
 * the extension is all there is to go on.
 */
export function imageMimeType(path: string): string {
  const clean = path.split(/[?#]/)[0];
  const extension = clean.slice(clean.lastIndexOf(".") + 1).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

export class ImageView implements NodeView {
  readonly dom: HTMLElement;
  private readonly image: HTMLImageElement;
  private readonly caption: HTMLElement;
  private node: ProseNode;
  private readonly resolve: ResolveImage;

  /** Revoked when this view goes, or the address it was made for changes. */
  private objectUrl: string | null = null;
  /** Rises with each load, so a slow read cannot land after a newer one. */
  private request = 0;

  constructor(node: ProseNode, resolve: ResolveImage, private readonly onDestroy?: () => void) {
    this.node = node;
    this.resolve = resolve;

    this.dom = document.createElement("span");
    this.dom.className = "pm-image";

    this.image = document.createElement("img");
    this.image.addEventListener("error", () => this.showBroken());
    this.image.addEventListener("load", () => {
      this.dom.classList.remove("is-loading", "is-broken");
    });

    // Stands in for the picture when there is none to show, so the document
    // does not simply go quiet about it.
    this.caption = document.createElement("span");
    this.caption.className = "pm-image-fallback";

    this.dom.append(this.image, this.caption);
    this.applyAttributes();
    void this.load();
  }

  private applyAttributes(): void {
    const alt = (this.node.attrs.alt as string | null) ?? "";
    const title = (this.node.attrs.title as string | null) ?? "";

    this.image.alt = alt;
    if (title) this.image.title = title;
    else this.image.removeAttribute("title");

    this.caption.textContent = alt || (this.node.attrs.src as string);
  }

  private async load(): Promise<void> {
    const request = (this.request += 1);
    const src = this.node.attrs.src as string;

    this.dom.classList.add("is-loading");
    this.dom.classList.remove("is-broken");

    const url = await this.resolve(src);
    // A newer address, or a destroyed view, wins over this one.
    if (request !== this.request) {
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
      return;
    }

    if (!url) {
      this.showBroken();
      return;
    }

    this.releaseUrl();
    if (url.startsWith("blob:")) this.objectUrl = url;
    this.image.src = url;
  }

  private showBroken(): void {
    this.dom.classList.remove("is-loading");
    this.dom.classList.add("is-broken");
  }

  private releaseUrl(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;

    const addressChanged = node.attrs.src !== this.node.attrs.src;
    this.node = node;
    this.applyAttributes();
    if (addressChanged) void this.load();
    return true;
  }

  /** The image is a leaf: nothing inside it belongs to the outer editor. */
  ignoreMutation(): boolean {
    return true;
  }

  /**
   * Looks the picture up again. A relative address means nothing until the
   * document has a folder, so saving an untitled file, or saving one somewhere
   * else, changes where the same address points.
   */
  reload(): void {
    void this.load();
  }

  destroy(): void {
    this.request += 1;
    this.releaseUrl();
    this.onDestroy?.();
  }
}
