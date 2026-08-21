/**
 * Mermaid diagrams, rendered in presentation and reading but never in editing.
 *
 * The block stays a fenced `code_block` in the document and on disk, so the
 * round trip is untouched: this only changes what is drawn in place of the
 * code. Editing keeps the code, because a diagram has nothing to type into.
 */

/** The fence language that gets drawn rather than shown. */
export const DIAGRAM_LANGUAGE = "mermaid";

export function isDiagram(language: string): boolean {
  return language.trim().split(/\s+/)[0]?.toLowerCase() === DIAGRAM_LANGUAGE;
}

/**
 * Mermaid drawn in the page's own colours.
 *
 * Mermaid ships a handful of themes and none of them is this one, so the
 * `base` theme is handed the palette instead. Reading the values off the
 * document rather than repeating them here means a diagram follows the theme
 * and the font the reader chose, and cannot drift from the rest of the page.
 */
function paperTheme(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;

  const text = token("--text", "#1c1c1a");
  const muted = token("--text-muted", "#6b6b66");
  const surface = token("--surface", "#ffffff");
  const border = token("--control-border", "#c9c9c3");
  const page = token("--background", "#fdfdfc");

  return {
    // The block behind it is already a surface; a second one boxes the picture.
    background: "transparent",
    fontFamily: token("--font-body", "serif"),
    fontSize: "14px",

    primaryColor: surface,
    primaryTextColor: text,
    primaryBorderColor: border,
    secondaryColor: page,
    secondaryTextColor: text,
    secondaryBorderColor: border,
    tertiaryColor: page,
    tertiaryTextColor: text,
    tertiaryBorderColor: border,

    mainBkg: surface,
    nodeBorder: border,
    nodeTextColor: text,
    textColor: text,
    lineColor: muted,

    clusterBkg: page,
    clusterBorder: border,
    // Without this an edge label wears a white box, which in the dark theme
    // is a torch shining out of the diagram.
    edgeLabelBackground: page,
    titleColor: text,
  };
}

/** Ids have to be unique per render, and mermaid puts them in the markup. */
let nextId = 0;

/**
 * The SVG for a diagram, or null when mermaid cannot read it.
 *
 * Loaded on demand: mermaid is several times the size of the rest of the
 * frontend, and a document without a diagram in it should never pay for that.
 */
export async function renderDiagram(source: string): Promise<string | null> {
  try {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: paperTheme(),
      securityLevel: "strict",
    });
    const { svg } = await mermaid.render(`paper-diagram-${(nextId += 1)}`, source);
    return svg;
  } catch {
    // A half-written diagram is the normal case while one is being written,
    // not an error worth interrupting anyone over.
    return null;
  }
}
