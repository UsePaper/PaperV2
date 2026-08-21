import { Slice } from "prosemirror-model";
import type { Node as ProseNode, ResolvedPos } from "prosemirror-model";
import { parseMarkdown } from "./parser";

/**
 * Block syntax that only appears in Markdown that was written as Markdown: a
 * heading, a fence, a list, a quote, a rule, or a table row.
 */
const BLOCK_SYNTAX = [
  /^ {0,3}#{1,6} /m,
  /^ {0,3}(?:```|~~~)/m,
  /^ {0,3}[-*+] +\S/m,
  /^ {0,3}\d+[.)] +\S/m,
  /^ {0,3}> /m,
  /^ {0,3}(?:[-*_] *){3,}$/m,
  /^ {0,3}\|.*\|/m,
];

/**
 * Whether text was meant as Markdown rather than as prose that happens to
 * contain punctuation.
 *
 * This only decides the case where the clipboard also carries HTML, which is
 * what a code editor or a web page puts there. Preferring HTML keeps the
 * formatting of a copied article; preferring the text keeps the structure of
 * copied Markdown, whose HTML is only ever its own syntax highlighting.
 */
export function looksLikeMarkdown(text: string): boolean {
  return BLOCK_SYNTAX.some((pattern) => pattern.test(text));
}

/**
 * A slice of the parsed text, opened so a single paragraph joins the sentence
 * it lands in rather than breaking it in two.
 */
export function markdownSlice(text: string): Slice {
  const doc: ProseNode = parseMarkdown(text);
  if (doc.childCount === 1 && doc.firstChild?.type.name === "paragraph") {
    return new Slice(doc.firstChild.content, 0, 0);
  }
  return new Slice(doc.content, 0, 0);
}

/** Code is text. Nothing pasted inside a code block is Markdown. */
export function isCodeContext($position: ResolvedPos): boolean {
  for (let depth = $position.depth; depth > 0; depth -= 1) {
    if ($position.node(depth).type.spec.code) return true;
  }
  return false;
}
