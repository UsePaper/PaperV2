import type { OutlineEntry } from "../editor/editor";

/** What the panel needs from the editor. Nothing here touches ProseMirror. */
export interface OutlineTarget {
  outline(): OutlineEntry[];
  revealHeading(pos: number): void;
  headingTop(pos: number): number | null;
}

export interface OutlineHandle {
  toggle(): void;
  close(): void;
  /** Call after the document changed, so the list stays honest. */
  refresh(): void;
  readonly isOpen: boolean;
}

/** A heading past this line into the page counts as the section being read. */
const ACTIVE_BAND = 100;

/**
 * The headings of the document, floating over the left edge the way the find
 * bar floats over the right, and for the same reason: opening it must not
 * shift the text being read. A click reveals its heading, centred; as the
 * page scrolls, the entry whose section is under the reader is marked.
 */
export function mountOutline(
  root: HTMLElement,
  target: OutlineTarget,
  scroller: HTMLElement,
): OutlineHandle {
  root.innerHTML = "";
  root.hidden = true;
  root.setAttribute("aria-label", "Outline");

  let open = false;
  let entries: OutlineEntry[] = [];
  let buttons: HTMLButtonElement[] = [];
  /** What the list was built from, so typing prose does not rebuild it.
      Null means not built at all, which no document, however empty, equals. */
  let shape: string | null = null;
  /** Scroll events are ignored until this time, so the scroll a click causes
      cannot immediately take the mark off the entry that was clicked: a
      heading near the end of the document can never reach the top. */
  let holdUntil = 0;

  function render(): void {
    root.innerHTML = "";
    buttons = [];

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "outline-empty";
      empty.textContent = "No headings";
      root.append(empty);
      return;
    }

    entries.forEach((entry, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "outline-item";
      item.dataset.level = String(entry.level);
      item.textContent = entry.text || "—";
      // Read at click time: edits above a heading move its position. The
      // clicked entry is marked directly: a centred reveal leaves the
      // heading below the band, so the scan would mark an earlier one.
      // The reader's next real scroll takes over.
      item.addEventListener("click", () => {
        target.revealHeading(entries[index].pos);
        setActive(index);
        holdUntil = performance.now() + 200;
      });
      buttons.push(item);
      root.append(item);
    });
  }

  function setActive(active: number): void {
    buttons.forEach((button, index) =>
      button.classList.toggle("is-active", index === active),
    );
  }

  /** The last heading already past the top of the page is the section read. */
  function markActive(): void {
    const top = scroller.getBoundingClientRect().top + ACTIVE_BAND;
    let active = -1;
    for (let index = 0; index < entries.length; index += 1) {
      const y = target.headingTop(entries[index].pos);
      if (y === null) continue;
      if (y > top) break;
      active = index;
    }
    setActive(active);
  }

  // Plain reads and one class toggle, cheap enough to run on every scroll
  // event; a frame-aligned throttle here starves in throttled webviews.
  scroller.addEventListener(
    "scroll",
    () => {
      if (open && performance.now() >= holdUntil) markActive();
    },
    { passive: true },
  );

  const handle: OutlineHandle = {
    get isOpen(): boolean {
      return open;
    },

    toggle(): void {
      if (open) {
        handle.close();
        return;
      }
      open = true;
      root.hidden = false;
      shape = null;
      handle.refresh();
    },

    close(): void {
      open = false;
      root.hidden = true;
    },

    refresh(): void {
      if (!open) return;
      entries = target.outline();
      const next = entries.map((entry) => `${entry.level} ${entry.text}`).join("\n");
      if (next !== shape) {
        shape = next;
        render();
      }
      markActive();
    },
  };

  return handle;
}
