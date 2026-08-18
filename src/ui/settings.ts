import type { ViewMode } from "../editor/editor";
import { MODE_LABEL } from "./titlebar";
import {
  BODY_FONTS,
  DEFAULT_MODES,
  FONT_SIZE_RANGE,
  LEADING_PRESETS,
  MEASURE_PRESETS,
  fontStack,
  leadingPreset,
  getSettings,
  measurePreset,
  setSettings,
  type Settings,
  type Theme,
} from "../settings/state";

export interface SettingsPanel {
  open(): void;
  close(): void;
  toggle(): void;
  readonly isOpen: boolean;
}

const PREVIEW_TEXT = "The quick brown fox jumps over the lazy dog.";

/**
 * A sheet of grouped rows, the way macOS lays settings out.
 *
 * Five of the seven settings change how text looks, and the sheet covers the
 * document while it is open, so it carries its own specimen line. Without it
 * you would be choosing a font and a size blind.
 *
 * Keep this short. See CLAUDE.md section 1.
 */
export function mountSettings(root: HTMLElement): SettingsPanel {
  root.innerHTML = "";
  root.hidden = true;

  const sheet = document.createElement("div");
  sheet.className = "settings-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Settings");

  const heading = document.createElement("h2");
  heading.className = "settings-heading";
  heading.textContent = "Settings";

  const theme = segmented<Theme>(
    "Theme",
    [
      { value: "system", label: "System" },
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
    ],
    (value) => setSettings({ theme: value }),
  );

  // Each option is drawn in the font it names, so the choice is visible.
  const font = fontSelect((value) => setSettings({ font: value }));

  const size = sizeSlider((value) => setSettings({ fontSize: value }));

  const width = segmented(
    "Line width",
    MEASURE_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
    (value) => {
      const preset = MEASURE_PRESETS.find((entry) => entry.id === value);
      if (preset) setSettings({ measure: preset.chars });
    },
  );

  const leading = segmented(
    "Line height",
    LEADING_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
    (value) => {
      const preset = LEADING_PRESETS.find((entry) => entry.id === value);
      if (preset) setSettings({ leading: preset.height });
    },
  );

  const statusbar = switchRow("Status bar", (value) =>
    setSettings({ statusbar: value }),
  );

  // Named "Opens in" rather than "Default mode" because the difference that
  // matters is when it takes effect: the next window, not this one.
  const opensIn = segmented<ViewMode>(
    "Opens in",
    DEFAULT_MODES.map((value) => ({ value, label: MODE_LABEL[value] })),
    (value) => setSettings({ defaultMode: value }),
  );

  const spellcheck = switchRow("Spellcheck", (value) =>
    setSettings({ spellcheck: value }),
  );

  const preview = document.createElement("p");
  preview.className = "settings-preview";
  preview.textContent = PREVIEW_TEXT;

  // Every change lands at once, so this only dismisses the sheet.
  const done = document.createElement("button");
  done.type = "button";
  done.className = "settings-done";
  done.textContent = "Done";
  done.addEventListener("click", () => panel.close());

  const footer = document.createElement("div");
  footer.className = "settings-footer";
  footer.append(done);

  sheet.append(
    heading,
    groupTitle("Appearance"),
    group(theme.row, font.row, size.row, width.row, leading.row, statusbar.row),
    groupTitle("Editing"),
    group(opensIn.row, spellcheck.row),
    preview,
    footer,
  );
  root.append(sheet);

  // Clicking the backdrop, but not the sheet itself, closes the panel.
  root.addEventListener("click", (event) => {
    if (event.target === root) panel.close();
  });

  function show(settings: Readonly<Settings>): void {
    theme.set(settings.theme);
    font.set(settings.font);
    size.set(settings.fontSize);
    width.set(measurePreset(settings.measure).id);
    leading.set(leadingPreset(settings.leading).id);
    statusbar.set(settings.statusbar);
    opensIn.set(settings.defaultMode);
    spellcheck.set(settings.spellcheck);
  }

  /**
   * The sheet animates both ways, so it has to stay in the DOM while it leaves.
   * `hidden` goes back on only once the transition has run.
   */
  let open = false;
  let closeTimer: number | undefined;
  let previousFocus: HTMLElement | null = null;

  /** Reads a duration from CSS, so the timing lives in one place. */
  function durationMs(property: string): number {
    const raw = getComputedStyle(root).getPropertyValue(property).trim();
    if (raw.endsWith("ms")) return Number.parseFloat(raw);
    if (raw.endsWith("s")) return Number.parseFloat(raw) * 1000;
    return 0;
  }

  const panel: SettingsPanel = {
    get isOpen(): boolean {
      return open;
    },

    open(): void {
      if (open) return;
      open = true;
      window.clearTimeout(closeTimer);

      previousFocus = document.activeElement as HTMLElement | null;
      show(getSettings());
      root.hidden = false;
      // Force a reflow between leaving `display: none` and the class, or the
      // transition has no start value to move from.
      void root.offsetHeight;
      root.classList.add("is-open");
      done.focus();
    },

    close(): void {
      if (!open) return;
      open = false;
      root.classList.remove("is-open");

      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(() => {
        root.hidden = true;
      }, durationMs("--sheet-close"));

      // Hand the caret back, so typing carries on where it left off.
      previousFocus?.focus();
      previousFocus = null;
    },

    toggle(): void {
      if (open) panel.close();
      else panel.open();
    },
  };

  return panel;
}

/* Building blocks ---------------------------------------------------------- */

function groupTitle(text: string): HTMLElement {
  const title = document.createElement("h3");
  title.className = "settings-group-title";
  title.textContent = text;
  return title;
}

function group(...rows: HTMLElement[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "settings-group";
  box.append(...rows);
  return box;
}

function row(label: string): { row: HTMLElement; control: HTMLElement } {
  const element = document.createElement("div");
  element.className = "settings-row";

  const name = document.createElement("span");
  name.className = "settings-label";
  name.textContent = label;

  const control = document.createElement("div");
  control.className = "settings-control";

  element.append(name, control);
  return { row: element, control };
}

/** A row of exclusive choices, which is what macOS uses instead of a menu. */
function segmented<T extends string>(
  label: string,
  options: ReadonlyArray<{ value: T; label: string }>,
  onChange: (value: T) => void,
): { row: HTMLElement; set: (value: T) => void } {
  const built = row(label);

  const bar = document.createElement("div");
  bar.className = "segmented";
  bar.setAttribute("role", "radiogroup");
  bar.setAttribute("aria-label", label);

  const buttons = options.map((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "segment";
    button.textContent = option.label;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", "false");
    button.addEventListener("click", () => {
      select(option.value);
      onChange(option.value);
    });
    bar.append(button);
    return { value: option.value, button };
  });

  function select(value: T): void {
    for (const entry of buttons) {
      entry.button.setAttribute("aria-checked", String(entry.value === value));
    }
  }

  built.control.append(bar);
  return { row: built.row, set: select };
}

function fontSelect(onChange: (value: string) => void): {
  row: HTMLElement;
  set: (value: string) => void;
} {
  const built = row("Font");
  const element = document.createElement("select");
  element.setAttribute("aria-label", "Font");

  for (const entry of BODY_FONTS) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.label;
    option.style.fontFamily = entry.stack;
    element.append(option);
  }

  element.addEventListener("change", () => {
    // The closed popup shows the chosen font too, not just the open list.
    element.style.fontFamily = fontStack(element.value);
    onChange(element.value);
  });

  built.control.append(element);
  return {
    row: built.row,
    set: (value) => {
      element.value = value;
      element.style.fontFamily = fontStack(value);
    },
  };
}

/** The small and large A are the standard text size affordance. */
function sizeSlider(onChange: (value: number) => void): {
  row: HTMLElement;
  set: (value: number) => void;
} {
  const built = row("Text size");

  const small = document.createElement("span");
  small.className = "size-hint size-hint-small";
  small.textContent = "A";
  small.setAttribute("aria-hidden", "true");

  const large = document.createElement("span");
  large.className = "size-hint size-hint-large";
  large.textContent = "A";
  large.setAttribute("aria-hidden", "true");

  const element = document.createElement("input");
  element.type = "range";
  element.min = String(FONT_SIZE_RANGE.min);
  element.max = String(FONT_SIZE_RANGE.max);
  element.step = "1";
  element.setAttribute("aria-label", "Text size");

  element.addEventListener("input", () => {
    const value = Number(element.value);
    element.title = `${value}px`;
    onChange(value);
  });

  built.control.append(small, element, large);
  return {
    row: built.row,
    set: (value) => {
      element.value = String(value);
      element.title = `${value}px`;
    },
  };
}

function switchRow(
  label: string,
  onChange: (value: boolean) => void,
): { row: HTMLElement; set: (value: boolean) => void } {
  const built = row(label);
  const element = document.createElement("input");
  element.type = "checkbox";
  element.className = "switch";
  element.setAttribute("aria-label", label);
  element.addEventListener("change", () => onChange(element.checked));
  built.control.append(element);
  return { row: built.row, set: (value) => (element.checked = value) };
}
