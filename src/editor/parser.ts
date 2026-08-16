import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type { Node as ProseNode } from "prosemirror-model";
import { MarkdownParser } from "prosemirror-markdown";
import { schema, type CellAlign } from "./schema";

/**
 * CommonMark, plus pipe tables. Inline HTML is off, and so is linkify: both
 * would produce content the serializer cannot write back unchanged.
 *
 * Tables are not CommonMark, so the preset leaves the rule off. Without it a
 * table is read as an ordinary paragraph of several lines, and the line breaks
 * inside a paragraph become spaces, which flattens the whole table into one
 * line the moment the file is saved.
 */
const tokenizer = MarkdownIt("commonmark", { html: false, linkify: false }).enable("table");

/** The column alignment markdown-it records as an inline style on the cell. */
function cellAlign(token: Token): CellAlign {
  const style = token.attrGet("style") ?? "";
  const found = /text-align\s*:\s*(left|center|right)/.exec(style);
  return (found?.[1] as CellAlign) ?? null;
}

/** A list is tight when markdown-it hides the paragraph tokens inside it. */
function listIsTight(tokens: readonly Token[], index: number): boolean {
  for (let i = index + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== "list_item_open") return token.hidden;
  }
  return false;
}

export const markdownParser = new MarkdownParser(schema, tokenizer, {
  blockquote: { block: "blockquote" },
  paragraph: { block: "paragraph" },
  list_item: { block: "list_item" },
  bullet_list: {
    block: "bullet_list",
    getAttrs: (_tok, tokens, i) => ({ tight: listIsTight(tokens, i) }),
  },
  ordered_list: {
    block: "ordered_list",
    getAttrs: (tok, tokens, i) => ({
      order: +(tok.attrGet("start") ?? 1) || 1,
      tight: listIsTight(tokens, i),
    }),
  },
  heading: {
    block: "heading",
    getAttrs: (tok) => ({ level: +tok.tag.slice(1) }),
  },
  // An indented code block carries no language, so it normalizes to a fence.
  code_block: { block: "code_block", noCloseToken: true },
  fence: {
    block: "code_block",
    getAttrs: (tok) => ({ params: tok.info || "" }),
    noCloseToken: true,
  },
  hr: { node: "horizontal_rule" },

  // The head and body wrappers carry nothing a pipe table can express, so the
  // rows are taken straight out of them.
  table: { block: "table" },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: "table_row" },
  th: { block: "table_header", getAttrs: (tok) => ({ align: cellAlign(tok) }) },
  td: { block: "table_cell", getAttrs: (tok) => ({ align: cellAlign(tok) }) },

  image: {
    node: "image",
    getAttrs: (tok) => ({
      src: tok.attrGet("src"),
      title: tok.attrGet("title") || null,
      alt: tok.children?.[0]?.content || null,
    }),
  },
  hardbreak: { node: "hard_break" },
  // Without this the line break becomes a space and the wrapping is lost.
  softbreak: { node: "soft_break" },
  em: { mark: "em" },
  strong: { mark: "strong" },
  link: {
    mark: "link",
    getAttrs: (tok) => ({
      href: tok.attrGet("href"),
      title: tok.attrGet("title") || null,
    }),
  },
  code_inline: { mark: "code", noCloseToken: true },
});

/** Markdown text (LF, no BOM) to a ProseMirror document. */
export function parseMarkdown(text: string): ProseNode {
  return markdownParser.parse(text);
}
