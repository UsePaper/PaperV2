/**
 * The settings model, and the single place that knows its shape. The Rust side
 * stores this as opaque JSON.
 *
 * Keep this list short. CLAUDE.md rules out a settings dialog with many
 * options, so a new entry needs a reason.
 */

import type { ViewMode } from "../editor/editor";

export type Theme = "system" | "light" | "dark";

export interface Settings {
  theme: Theme;
  /** A key from `BODY_FONTS`, not a raw font stack. */
  font: string;
  /** The editor text size in pixels. */
  fontSize: number;
  /** How wide the text column runs, in characters. */
  measure: number;
  /** The line height of the text, as a multiple of the type size. */
  leading: number;
  spellcheck: boolean;
  /** Whether the bar along the bottom of the window is shown. */
  statusbar: boolean;
  /** The mode a new window opens in. Windows already open are left alone. */
  defaultMode: ViewMode;
}

/**
 * The body fonts on offer, with the stack each one resolves to.
 *
 * Every one of them is bundled or is the system's own. The list used to name
 * faces like Georgia and Avenir, which do not exist on Linux: they all fell
 * back to the same font and the setting quietly did nothing.
 */
export const BODY_FONTS: ReadonlyArray<{ id: string; label: string; stack: string }> = [
  {
    id: "literata",
    label: "Literata",
    stack: '"Literata", serif',
  },
  {
    id: "lora",
    label: "Lora",
    stack: '"Lora", serif',
  },
  {
    id: "newsreader",
    label: "Newsreader",
    stack: '"Newsreader", serif',
  },
  {
    id: "source-serif",
    label: "Source Serif",
    stack: '"Source Serif 4", serif',
  },
  {
    id: "inter",
    label: "Inter",
    stack: '"Inter", sans-serif',
  },
  {
    id: "quattro",
    label: "iA Quattro",
    stack: '"iA Writer Quattro", monospace',
  },
  // Whatever this machine calls its own, which is a real answer everywhere.
  {
    id: "system",
    label: "System",
    stack: '-apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
  },
  {
    id: "mono",
    label: "Monospace",
    stack: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
  },
];

export const FONT_SIZE_RANGE = { min: 13, max: 24 } as const;

/**
 * Named widths, not a number: nobody picks 62 characters by eye, and the stored
 * value stays a number so an old file still parses.
 *
 * A `ch` is the width of a zero, not of an average letter, so these are not
 * character counts, and the same setting runs about a fifth wider in Lora than
 * in Source Serif. The number is the text: `--page-gutter` is added around it
 * in `base.css` rather than taken out of it, so a setting is the width it says.
 */
export const MEASURE_PRESETS = [
  { id: "narrow", label: "Narrow", chars: 58 },
  { id: "medium", label: "Medium", chars: 70 },
  { id: "wide", label: "Wide", chars: 84 },
] as const;

// The clamp has to clear the widest preset, or parsing would quietly squash it
// and two of the three settings would come out the same width.
export const MEASURE_RANGE = { min: 40, max: 120 } as const;

/** Named for the same reason as the widths: nobody wants to choose 1.62. */
export const LEADING_PRESETS = [
  { id: "tight", label: "Tight", height: 1.45 },
  { id: "normal", label: "Normal", height: 1.7 },
  { id: "relaxed", label: "Relaxed", height: 2 },
] as const;

export const LEADING_RANGE = { min: 1.2, max: 2.4 } as const;

/** The same list as `MODE_ORDER`, carrying the labels the sheet shows. */
export const DEFAULT_MODES: readonly ViewMode[] = ["editing", "presentation", "reading"];

/**
 * Reading has no caret and nothing to type into, so an empty window in it
 * offers nothing to read and no way to begin. Only that case is overridden.
 */
export function startingMode(preference: ViewMode, hasFile: boolean): ViewMode {
  return !hasFile && preference === "reading" ? "editing" : preference;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  font: "system",
  fontSize: 17,
  measure: 70,
  leading: 1.7,
  spellcheck: true,
  statusbar: true,
  defaultMode: "editing",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Rebuilds a settings object from whatever was on disk. Anything missing or
 * out of range falls back to the default, so an old or hand edited file can
 * never leave the app unusable.
 */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS };
  const input = raw as Partial<Record<keyof Settings, unknown>>;

  const theme =
    input.theme === "light" || input.theme === "dark" || input.theme === "system"
      ? input.theme
      : DEFAULT_SETTINGS.theme;

  const font = BODY_FONTS.some((entry) => entry.id === input.font)
    ? (input.font as string)
    : DEFAULT_SETTINGS.font;

  const fontSize =
    typeof input.fontSize === "number" && Number.isFinite(input.fontSize)
      ? clamp(Math.round(input.fontSize), FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max)
      : DEFAULT_SETTINGS.fontSize;

  const measure =
    typeof input.measure === "number" && Number.isFinite(input.measure)
      ? clamp(Math.round(input.measure), MEASURE_RANGE.min, MEASURE_RANGE.max)
      : DEFAULT_SETTINGS.measure;

  const leading =
    typeof input.leading === "number" && Number.isFinite(input.leading)
      ? clamp(input.leading, LEADING_RANGE.min, LEADING_RANGE.max)
      : DEFAULT_SETTINGS.leading;

  const spellcheck =
    typeof input.spellcheck === "boolean"
      ? input.spellcheck
      : DEFAULT_SETTINGS.spellcheck;

  const statusbar =
    typeof input.statusbar === "boolean" ? input.statusbar : DEFAULT_SETTINGS.statusbar;

  const defaultMode = DEFAULT_MODES.includes(input.defaultMode as ViewMode)
    ? (input.defaultMode as ViewMode)
    : DEFAULT_SETTINGS.defaultMode;

  return { theme, font, fontSize, measure, leading, spellcheck, statusbar, defaultMode };
}

/** The named width closest to a stored number. */
export function measurePreset(chars: number): (typeof MEASURE_PRESETS)[number] {
  let closest: (typeof MEASURE_PRESETS)[number] = MEASURE_PRESETS[0];
  for (const preset of MEASURE_PRESETS) {
    if (Math.abs(preset.chars - chars) < Math.abs(closest.chars - chars)) {
      closest = preset;
    }
  }
  return closest;
}

/** The named line height closest to a stored number. */
export function leadingPreset(height: number): (typeof LEADING_PRESETS)[number] {
  let closest: (typeof LEADING_PRESETS)[number] = LEADING_PRESETS[0];
  for (const preset of LEADING_PRESETS) {
    if (Math.abs(preset.height - height) < Math.abs(closest.height - height)) {
      closest = preset;
    }
  }
  return closest;
}

export function fontStack(id: string): string {
  const found = BODY_FONTS.find((entry) => entry.id === id);
  return (found ?? BODY_FONTS[0]).stack;
}

let current: Settings = { ...DEFAULT_SETTINGS };

type Listener = (settings: Readonly<Settings>) => void;
const listeners = new Set<Listener>();

export function getSettings(): Readonly<Settings> {
  return current;
}

export function onSettingsChange(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

export function setSettings(next: Partial<Settings>): void {
  current = parseSettings({ ...current, ...next });
  for (const listener of listeners) listener(current);
}

/**
 * One change rather than eight, so the listeners run once. A whole object
 * rather than a merge, so a setting added later is not quietly left behind.
 */
export function resetSettings(): void {
  setSettings({ ...DEFAULT_SETTINGS });
}

/** Writes the settings onto the document. Themes are CSS variables only. */
export function applySettings(settings: Readonly<Settings>): void {
  const root = document.documentElement;

  // "system" means no explicit choice, which is what the dark theme's media
  // query already handles.
  if (settings.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", settings.theme);

  // The stylesheet hides the bar and closes the gap it left behind.
  if (settings.statusbar) root.removeAttribute("data-statusbar");
  else root.setAttribute("data-statusbar", "hidden");

  root.style.setProperty("--font-body", fontStack(settings.font));
  root.style.setProperty("--font-size", `${settings.fontSize}px`);
  // Characters, so the column keeps its measure when the font changes.
  root.style.setProperty("--measure", `${settings.measure}ch`);
  root.style.setProperty("--line-height", String(settings.leading));
}
