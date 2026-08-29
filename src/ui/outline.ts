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

/** Left alone this long, the panel puts itself away. */
const IDLE_MS = 5000;

/** A click got the reader where they were going; the panel leaves sooner. */
const CLICKED_MS = 3000;

/**
 * The headings of the document, flowing in over the right edge and floating
 * there the way the find bar does: opening it must not shift the text being
 * read. A click reveals its heading, centred; as the page scrolls, the entry
 * whose section is under the reader is marked. Five seconds without scrolling,
 * typing or a pointer over it — three, once a click has arrived somewhere —
 * and the panel withdraws on its own: it is a way of getting somewhere, not
 * chrome that stays.
 */
export function mountOutline(
  root: HTMLElement,
  target: OutlineTarget,
  scroller: HTMLElement,
  onOpenChange?: (open: boolean) => void,
): OutlineHandle {
  root.innerHTML = "";
  // Shown by class, not by `hidden`: the slide needs a closed state that can
  // still transition.
  root.hidden = false;
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
  let idleTimer: number | undefined;
  /** No withdrawing out from under the pointer that is about to click. */
  let hovered = false;

  function stayAwhile(): void {
    window.clearTimeout(idleTimer);
    if (!open || hovered) return;
    idleTimer = window.setTimeout(() => handle.close(), IDLE_MS);
  }

  root.addEventListener("pointerenter", () => {
    hovered = true;
    window.clearTimeout(idleTimer);
  });
  root.addEventListener("pointerleave", () => {
    hovered = false;
    stayAwhile();
  });

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
        // The shorter fuse, and it burns under the pointer too: the click
        // was the arrival.
        window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => handle.close(), CLICKED_MS);
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
  // During the hold the scroll is the click's own, and must not stretch the
  // click's shorter fuse back out to the idle one.
  scroller.addEventListener(
    "scroll",
    () => {
      if (!open || performance.now() < holdUntil) return;
      markActive();
      stayAwhile();
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
      root.classList.add("is-open");
      shape = null;
      handle.refresh();
      onOpenChange?.(true);
      stayAwhile();
    },

    close(): void {
      if (!open) return;
      open = false;
      window.clearTimeout(idleTimer);
      root.classList.remove("is-open");
      onOpenChange?.(false);
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
      // Typing is activity; the panel stays while the document moves.
      stayAwhile();
    },
  };

  return handle;
}
