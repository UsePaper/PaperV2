import { describe, expect, it } from "vitest";
import {
  BODY_FONTS,
  DEFAULT_SETTINGS,
  FONT_SIZE_RANGE,
  LEADING_PRESETS,
  LEADING_RANGE,
  MEASURE_PRESETS,
  MEASURE_RANGE,
  DEFAULT_MODES,
  fontStack,
  leadingPreset,
  measurePreset,
  parseSettings,
} from "../../src/settings/state";

/**
 * The settings file can be edited by hand or left over from an older build, so
 * parsing has to survive anything without leaving the app unusable.
 */
describe("parseSettings", () => {
  it("returns the defaults for a missing object", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("nonsense")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps the values it recognizes", () => {
    expect(
      parseSettings({
        theme: "dark",
        font: "literata",
        fontSize: 20,
        measure: 60,
        leading: 1.45,
        spellcheck: false,
        statusbar: false,
        defaultMode: "presentation",
      }),
    ).toEqual({
      theme: "dark",
      font: "literata",
      fontSize: 20,
      measure: 60,
      leading: 1.45,
      spellcheck: false,
      statusbar: false,
      defaultMode: "presentation",
    });
  });

  // The bar is on unless the file says otherwise, so a file written before the
  // setting existed keeps the window it had.
  it("shows the status bar when the field is missing or malformed", () => {
    expect(parseSettings({}).statusbar).toBe(true);
    expect(parseSettings({ statusbar: "off" }).statusbar).toBe(true);
    expect(parseSettings({ statusbar: 0 }).statusbar).toBe(true);
  });

  it("keeps a status bar the user turned off", () => {
    expect(parseSettings({ statusbar: false }).statusbar).toBe(false);
  });

  // The list used to carry fonts only macOS has. A settings file written then
  // still names one, and has to land somewhere sensible rather than nowhere.
  it("falls back for a font that is no longer offered", () => {
    for (const gone of ["georgia", "avenir", "helvetica", "serif"]) {
      expect(parseSettings({ font: gone }).font).toBe(DEFAULT_SETTINGS.font);
    }
  });

  // Line height is stored as the number, so a file written before the setting
  // existed reads back as the line height the app has always used.
  it("keeps the line height it has always had when the field is missing", () => {
    expect(parseSettings({}).leading).toBe(1.7);
    expect(parseSettings({ leading: "tall" }).leading).toBe(1.7);
  });

  it("clamps a line height that is out of range instead of dropping it", () => {
    expect(parseSettings({ leading: 99 }).leading).toBe(LEADING_RANGE.max);
    expect(parseSettings({ leading: 0.1 }).leading).toBe(LEADING_RANGE.min);
  });

  it("keeps a line height the user chose", () => {
    expect(parseSettings({ leading: 1.45 }).leading).toBe(1.45);
  });
});

describe("parseSettings, the default mode", () => {
  it("keeps each of the three modes", () => {
    for (const mode of DEFAULT_MODES) {
      expect(parseSettings({ defaultMode: mode }).defaultMode).toBe(mode);
    }
  });

  it("falls back for a mode that does not exist", () => {
    // The likely causes are a hand edited file and a mode removed by a later
    // build, and neither should leave a window with nothing to open in.
    expect(parseSettings({ defaultMode: "focus" }).defaultMode).toBe(
      DEFAULT_SETTINGS.defaultMode,
    );
    expect(parseSettings({ defaultMode: 2 }).defaultMode).toBe(
      DEFAULT_SETTINGS.defaultMode,
    );
    expect(parseSettings({ defaultMode: null }).defaultMode).toBe(
      DEFAULT_SETTINGS.defaultMode,
    );
  });

  it("supplies it for a file written before the setting existed", () => {
    const older = { theme: "dark", font: "lora", fontSize: 18 };
    expect(parseSettings(older).defaultMode).toBe(DEFAULT_SETTINGS.defaultMode);
  });

  it("opens in editing unless told otherwise", () => {
    expect(DEFAULT_SETTINGS.defaultMode).toBe("editing");
  });
});

describe("leadingPreset", () => {
  it("names each of the heights on offer", () => {
    for (const preset of LEADING_PRESETS) {
      expect(leadingPreset(preset.height).id).toBe(preset.id);
    }
  });

  // A stored number between two presets still has to light one of them up.
  it("names the closest height to anything in between", () => {
    expect(leadingPreset(1.5).id).toBe("tight");
    expect(leadingPreset(1.62).id).toBe("normal");
    expect(leadingPreset(2.4).id).toBe("relaxed");
  });

  it("falls back for a field it does not recognize", () => {
    const parsed = parseSettings({ theme: "solarized", font: "comic sans" });
    expect(parsed.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(parsed.font).toBe(DEFAULT_SETTINGS.font);
  });

  it("clamps a size that is out of range instead of dropping it", () => {
    expect(parseSettings({ fontSize: 900 }).fontSize).toBe(FONT_SIZE_RANGE.max);
    expect(parseSettings({ fontSize: 2 }).fontSize).toBe(FONT_SIZE_RANGE.min);
    expect(parseSettings({ measure: 5000 }).measure).toBe(MEASURE_RANGE.max);
    expect(parseSettings({ measure: 1 }).measure).toBe(MEASURE_RANGE.min);
  });

  it("ignores a value of the wrong type", () => {
    const parsed = parseSettings({ fontSize: "large", spellcheck: "yes" });
    expect(parsed.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(parsed.spellcheck).toBe(DEFAULT_SETTINGS.spellcheck);
  });

  it("survives a partial file from an older build", () => {
    expect(parseSettings({ theme: "light" })).toEqual({
      ...DEFAULT_SETTINGS,
      theme: "light",
    });
  });
});

describe("measurePreset", () => {
  it("matches each preset to its own name", () => {
    for (const preset of MEASURE_PRESETS) {
      expect(measurePreset(preset.chars).id).toBe(preset.id);
    }
  });

  it("snaps a value between presets to the nearer one", () => {
    const [narrow, medium] = MEASURE_PRESETS;
    const midpoint = (narrow.chars + medium.chars) / 2;
    expect(measurePreset(midpoint - 2).id).toBe(narrow.id);
    expect(measurePreset(midpoint + 2).id).toBe(medium.id);
  });

  // A settings file written before the widths were named holds a rem number.
  it("still names a width for a value from an older file", () => {
    expect(MEASURE_PRESETS.map((p) => p.id)).toContain(measurePreset(46).id);
  });
});

describe("fontStack", () => {
  it("resolves every offered font", () => {
    for (const entry of BODY_FONTS) {
      expect(fontStack(entry.id)).toBe(entry.stack);
    }
  });

  it("falls back to the first font for an unknown id", () => {
    expect(fontStack("nope")).toBe(BODY_FONTS[0].stack);
  });

  // Every option has to resolve to something real on every platform, which is
  // the whole reason the four bundled faces are here.
  it("offers only stacks that end in a generic family", () => {
    for (const entry of BODY_FONTS) {
      expect(entry.stack).toMatch(/(serif|sans-serif|monospace)\s*$/);
    }
  });
});
