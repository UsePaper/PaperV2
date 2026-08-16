import { Schema } from "prosemirror-model";

/**
 * The single source of truth for node and mark types.
 *
 * Adding an entry here is only half of the change: the parser, the serializer
 * and the round trip corpus must move with it. See CLAUDE.md section 8 rule 5.
 *
 * The set below is CommonMark minus the constructs listed as out of scope,
 * plus pipe tables, which are not CommonMark but are written everywhere.
 */

/** How a column is aligned, from the colons in the row under the header. */
export type CellAlign = "left" | "center" | "right" | null;

/** The alignment markdown-it leaves behind, as `style="text-align:left"`. */
function alignOf(node: HTMLElement): CellAlign {
  const found = /text-align\s*:\s*(left|center|right)/.exec(node.getAttribute("style") ?? "");
  return (found?.[1] as CellAlign) ?? null;
}

function alignAttrs(align: unknown): Record<string, string> {
  return align ? { style: `text-align: ${align as string}` } : {};
}
export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },

    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0] as const,
    },

    blockquote: {
      content: "block+",
      group: "block",
      defining: true,
      parseDOM: [{ tag: "blockquote" }],
      toDOM: () => ["blockquote", 0] as const,
    },

    horizontal_rule: {
      group: "block",
      parseDOM: [{ tag: "hr" }],
      toDOM: () => ["hr"] as const,
    },

    heading: {
      attrs: { level: { default: 1 } },
      content: "inline*",
      group: "block",
      defining: true,
      parseDOM: [
        { tag: "h1", attrs: { level: 1 } },
        { tag: "h2", attrs: { level: 2 } },
        { tag: "h3", attrs: { level: 3 } },
        { tag: "h4", attrs: { level: 4 } },
        { tag: "h5", attrs: { level: 5 } },
        { tag: "h6", attrs: { level: 6 } },
      ],
      toDOM: (node) => [`h${node.attrs.level as number}`, 0] as const,
    },

    // `params` holds the fence info string, which is the language name.
    code_block: {
      attrs: { params: { default: "" } },
      content: "text*",
      marks: "",
      group: "block",
      code: true,
      defining: true,
      parseDOM: [
        {
          tag: "pre",
          preserveWhitespace: "full" as const,
          getAttrs: (node: HTMLElement) => ({
            params: node.getAttribute("data-params") ?? "",
          }),
        },
      ],
      toDOM: (node) =>
        [
          "pre",
          node.attrs.params ? { "data-params": node.attrs.params as string } : {},
          ["code", 0],
        ] as const,
    },

    ordered_list: {
      attrs: { order: { default: 1 }, tight: { default: true } },
      content: "list_item+",
      group: "block",
      parseDOM: [
        {
          tag: "ol",
          getAttrs: (node: HTMLElement) => ({
            order: node.hasAttribute("start") ? +node.getAttribute("start")! : 1,
            tight: node.hasAttribute("data-tight"),
          }),
        },
      ],
      toDOM: (node) => {
        const order = node.attrs.order as number;
        return [
          "ol",
          {
            ...(order === 1 ? {} : { start: String(order) }),
            ...(node.attrs.tight ? { "data-tight": "true" } : {}),
          },
          0,
        ] as const;
      },
    },

    bullet_list: {
      attrs: { tight: { default: true } },
      content: "list_item+",
      group: "block",
      parseDOM: [
        {
          tag: "ul",
          getAttrs: (node: HTMLElement) => ({
            tight: node.hasAttribute("data-tight"),
          }),
        },
      ],
      toDOM: (node) =>
        ["ul", node.attrs.tight ? { "data-tight": "true" } : {}, 0] as const,
    },

    list_item: {
      content: "paragraph block*",
      defining: true,
      parseDOM: [{ tag: "li" }],
      toDOM: () => ["li", 0] as const,
    },

    /* Tables are the GitHub pipe kind: a header row, then body rows, with one
       alignment for each column. There is no spanning and no nesting, because
       the Markdown has no way to write either. */

    table: {
      content: "table_row+",
      group: "block",
      // A selection cannot wander out of the table by accident, and a command
      // cannot merge it into what surrounds it.
      isolating: true,
      parseDOM: [{ tag: "table" }],
      toDOM: () => ["table", ["tbody", 0]] as const,
    },

    table_row: {
      content: "(table_cell | table_header)+",
      parseDOM: [{ tag: "tr" }],
      toDOM: () => ["tr", 0] as const,
    },

    table_cell: {
      content: "inline*",
      attrs: { align: { default: null } },
      isolating: true,
      parseDOM: [{ tag: "td", getAttrs: (node) => ({ align: alignOf(node) }) }],
      toDOM: (node) => ["td", alignAttrs(node.attrs.align), 0] as const,
    },

    table_header: {
      content: "inline*",
      attrs: { align: { default: null } },
      isolating: true,
      parseDOM: [{ tag: "th", getAttrs: (node) => ({ align: alignOf(node) }) }],
      toDOM: (node) => ["th", alignAttrs(node.attrs.align), 0] as const,
    },

    text: { group: "inline" },

    image: {
      inline: true,
      attrs: {
        src: {},
        alt: { default: null },
        title: { default: null },
      },
      group: "inline",
      draggable: true,
      parseDOM: [
        {
          tag: "img[src]",
          getAttrs: (node: HTMLElement) => ({
            src: node.getAttribute("src"),
            alt: node.getAttribute("alt"),
            title: node.getAttribute("title"),
          }),
        },
      ],
      toDOM: (node) => ["img", node.attrs] as const,
    },

    hard_break: {
      inline: true,
      group: "inline",
      selectable: false,
      parseDOM: [{ tag: "br" }],
      toDOM: () => ["br"] as const,
    },

    /**
     * Where the author wrapped a line inside a paragraph.
     *
     * Markdown reads such a break as a space, and so does this: it is drawn as
     * one, and the text reflows to the window like any other prose. It is kept
     * in the document only so that saving a file does not rewrap every
     * paragraph in it, which turns a one word edit into a whole file diff.
     */
    soft_break: {
      inline: true,
      group: "inline",
      selectable: false,
      parseDOM: [{ tag: "span[data-soft-break]" }],
      toDOM: () => ["span", { "data-soft-break": "" }, " "] as const,
    },
  },

  marks: {
    // `link` comes first so that it serializes outside em and strong.
    link: {
      attrs: { href: {}, title: { default: null } },
      inclusive: false,
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (node: HTMLElement) => ({
            href: node.getAttribute("href"),
            title: node.getAttribute("title"),
          }),
        },
      ],
      toDOM: (node) => ["a", node.attrs, 0] as const,
    },

    em: {
      parseDOM: [
        { tag: "i" },
        { tag: "em" },
        { style: "font-style=italic" },
        { style: "font-style=normal", clearMark: (m) => m.type.name === "em" },
      ],
      toDOM: () => ["em", 0] as const,
    },

    strong: {
      parseDOM: [
        { tag: "strong" },
        // A <b> with normal weight is how Google Docs marks up plain text.
        {
          tag: "b",
          getAttrs: (node: HTMLElement) => node.style.fontWeight !== "normal" && null,
        },
        {
          style: "font-weight=400",
          clearMark: (m) => m.type.name === "strong",
        },
        {
          style: "font-weight",
          getAttrs: (value: string) =>
            /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null,
        },
      ],
      toDOM: () => ["strong", 0] as const,
    },

    code: {
      code: true,
      parseDOM: [{ tag: "code" }],
      toDOM: () => ["code", 0] as const,
    },
  },
});

export type EditorSchema = typeof schema;
