import type { FindSummary } from "../editor/plugins/find";

/** What the bar needs from the editor. Nothing here touches ProseMirror. */
export interface FindTarget {
  search(query: string): FindSummary;
  stepFind(direction: 1 | -1): FindSummary;
  findSummary(): FindSummary;
  replaceCurrent(replacement: string): FindSummary;
  replaceAll(replacement: string): FindSummary;
  endFind(): void;
  selectedText(): string;
}

export interface FindbarHandle {
  open(options?: { replace?: boolean }): void;
  close(): void;
  step(direction: 1 | -1): void;
  /** Call after the document changed, so the count stays honest. */
  refresh(): void;
  readonly isOpen: boolean;
}

/**
 * A small bar over the top right of the document, the way Safari and Xcode put
 * it. It floats rather than reserving a strip of its own: opening it must not
 * shift the text you are reading. Matches are centred when revealed, so the bar
 * cannot end up covering the one it just found.
 *
 * Replace is folded away until it is asked for, because finding is the common
 * case and this application shows nothing it does not need to.
 */
export function mountFindbar(root: HTMLElement, target: FindTarget): FindbarHandle {
  root.innerHTML = "";
  root.hidden = true;

  const findField = document.createElement("input");
  findField.type = "text";
  findField.className = "findbar-field";
  findField.placeholder = "Find";
  findField.setAttribute("aria-label", "Find");
  findField.spellcheck = false;

  const count = document.createElement("span");
  count.className = "findbar-count";
  // The count changes as you type, and a screen reader should hear it.
  count.setAttribute("aria-live", "polite");

  const previous = iconButton("‹", "Previous match", () => handle.step(-1));
  const next = iconButton("›", "Next match", () => handle.step(1));

  const disclosure = document.createElement("button");
  disclosure.type = "button";
  disclosure.className = "findbar-disclosure";
  disclosure.append(chevron());
  disclosure.setAttribute("aria-label", "Show replace");
  disclosure.setAttribute("aria-expanded", "false");
  disclosure.addEventListener("click", () => showReplace(!replaceShown));

  const done = document.createElement("button");
  done.type = "button";
  done.className = "findbar-done";
  done.textContent = "Done";
  done.addEventListener("click", () => handle.close());

  const findRow = document.createElement("div");
  findRow.className = "findbar-row";
  findRow.append(findField, count, previous, next, done);

  const replaceField = document.createElement("input");
  replaceField.type = "text";
  replaceField.className = "findbar-field";
  replaceField.placeholder = "Replace";
  replaceField.setAttribute("aria-label", "Replace");
  replaceField.spellcheck = false;

  const replaceOne = textButton("Replace", () => {
    show(target.replaceCurrent(replaceField.value));
  });
  const replaceEvery = textButton("All", () => {
    show(target.replaceAll(replaceField.value));
  });

  const replaceRow = document.createElement("div");
  replaceRow.className = "findbar-row findbar-row-replace";
  replaceRow.hidden = true;
  replaceRow.append(replaceField, replaceOne, replaceEvery);

  // The arrow is a column of its own rather than the first thing in the find
  // row, so the grid lines the replace field up with the find field. Nothing
  // here depends on knowing how wide the arrow happens to be.
  root.append(disclosure, findRow, replaceRow);

  let replaceShown = false;

  function showReplace(shown: boolean): void {
    replaceShown = shown;
    replaceRow.hidden = !shown;
    disclosure.setAttribute("aria-expanded", String(shown));
    disclosure.setAttribute("aria-label", shown ? "Hide replace" : "Show replace");
    disclosure.classList.toggle("is-expanded", shown);
  }

  function show(summary: FindSummary): void {
    if (!findField.value) {
      count.textContent = "";
      root.classList.remove("has-no-match");
      return;
    }
    const empty = summary.total === 0;
    count.textContent = empty ? "Not found" : `${summary.index + 1} of ${summary.total}`;
    root.classList.toggle("has-no-match", empty);
  }

  findField.addEventListener("input", () => show(target.search(findField.value)));

  findField.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    handle.step(event.shiftKey ? -1 : 1);
  });

  // Enter in the replace field replaces, which is what the shape of the row
  // promises.
  replaceField.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    show(target.replaceCurrent(replaceField.value));
  });

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    handle.close();
  });

  let open = false;

  const handle: FindbarHandle = {
    get isOpen(): boolean {
      return open;
    },

    open(options = {}): void {
      if (options.replace || !open) showReplace(options.replace ?? replaceShown);

      // A selection seeds the field, the way Use Selection for Find does.
      const selected = target.selectedText();
      if (selected && !selected.includes("\n")) findField.value = selected;

      open = true;
      root.hidden = false;
      show(target.search(findField.value));

      findField.focus();
      findField.select();
    },

    close(): void {
      if (!open) return;
      open = false;
      root.hidden = true;
      // Clears the highlights and puts the caret on the last match.
      target.endFind();
    },

    step(direction: 1 | -1): void {
      if (!open) return;
      show(target.stepFind(direction));
    },

    refresh(): void {
      if (!open) return;
      show(target.findSummary());
    },
  };

  return handle;
}

/**
 * Drawn rather than typed. A text arrowhead sits low in its em box, so flipping
 * one to point the other way lifts the ink off the line it was centred on.
 * This path is symmetric about the middle of its box, so the flip is still.
 */
function chevron(): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 10 10");
  svg.setAttribute("width", "10");
  svg.setAttribute("height", "10");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", "M2.5 3.75 L5 6.25 L7.5 3.75");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.4");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");

  svg.append(path);
  return svg;
}

function iconButton(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "findbar-step";
  button.textContent = glyph;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

function textButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "findbar-action";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}
