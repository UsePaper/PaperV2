import type { Mark, Node as ProseNode } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

/**
 * Shows the Markdown syntax the caret is standing in, and nothing else.
 *
 * The block's own prefix, the hashes of a heading for instance, shows whenever
 * the caret is anywhere in that block. An inline marker shows only for the run
 * the caret is actually inside: revealing every mark in the block turned one
 * click into a line full of syntax, which is what the markers exist to spare
 * the reader.
 *
 * Every marker here is a widget decoration. This plugin must never touch the
 * document. See CLAUDE.md section 8 rule 2.
 */

function marker(pos: number, text: string, side: number): Decoration {
  return Decoration.widget(
    pos,
    () => {
      const span = document.createElement("span");
      span.className = "pm-marker";
      span.textContent = text;
      return span;
    },
    // The key lets ProseMirror reuse the DOM instead of redrawing on every
    // keystroke, and stops the widget from ever being counted as a selection.
    { side, key: `${text}@${pos}@${side}`, ignoreSelection: true, marks: [] },
  );
}

/** The text that opens a mark, or null when the mark has no inline syntax. */
function openMarkerFor(mark: Mark): string | null {
  switch (mark.type.name) {
    case "em":
      return "*";
    case "strong":
      return "**";
    case "code":
      return "`";
    case "link":
      return "[";
    default:
      return null;
  }
}

function closeMarkerFor(mark: Mark): string | null {
  if (mark.type.name === "link") {
    const title = mark.attrs.title ? ` "${mark.attrs.title as string}"` : "";
    return `](${mark.attrs.href as string}${title})`;
  }
  return openMarkerFor(mark);
}

/** The syntax that precedes a block, for example the hashes of a heading. */
function blockPrefix(node: ProseNode): string | null {
  if (node.type.name === "heading") {
    return "#".repeat(node.attrs.level as number) + " ";
  }
  return null;
}

function markerDecorations(doc: ProseNode, headPos: number): Decoration[] {
  const $head = doc.resolve(headPos);

  // Walk out to the innermost textblock. A caret in a code block gets nothing:
  // the code is already shown as source.
  const block = $head.parent;
  if (!block.isTextblock || block.type.spec.code) return [];

  const contentStart = $head.start($head.depth);
  const decorations: Decoration[] = [];

  const prefix = blockPrefix(block);
  if (prefix) {
    if (block.content.size === 0) {
      // A widget carries `contenteditable="false"`. As the only child of an
      // empty block it stops the browser from inserting text, so an empty
      // heading would be impossible to type into. Draw it with CSS instead.
      decorations.push(
        Decoration.node(contentStart - 1, contentStart - 1 + block.nodeSize, {
          class: "pm-block-marker",
          "data-marker": prefix,
        }),
      );
    } else {
      decorations.push(marker(contentStart, prefix, -1));
    }
  }

  // Only the active block is scanned, so this stays cheap on a large file.
  // See CLAUDE.md section 8 rule 3.
  block.forEach((child, childOffset, index) => {
    const from = contentStart + childOffset;

    for (const mark of child.marks) {
      // A run can cover several children, where a mark inside it splits them.
      // It is handled once, at the child that opens it.
      const previous = index > 0 ? block.child(index - 1) : null;
      if (previous && mark.isInSet(previous.marks)) continue;

      let end = childOffset + child.nodeSize;
      for (let i = index + 1; i < block.childCount; i++) {
        const sibling = block.child(i);
        if (!mark.isInSet(sibling.marks)) break;
        end += sibling.nodeSize;
      }
      const to = contentStart + end;

      // Only the run the caret is in, counting either edge of it as inside.
      // Showing every run in the block turns a click into a whole line of
      // syntax, which is the thing the markers exist to keep out of the way.
      if (headPos < from || headPos > to) continue;

      const open = openMarkerFor(mark);
      if (open) decorations.push(marker(from, open, -1));
      const close = closeMarkerFor(mark);
      if (close) decorations.push(marker(to, close, 1));
    }
  });

  return decorations;
}

/**
 * `isEnabled` is asked on every draw, so the markers can be put away without
 * rebuilding the editor. In presentation mode they never appear, and the caret
 * sits on the text without turning it back into source.
 */
export function markersPlugin(isEnabled: () => boolean = () => true): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        if (!isEnabled()) return DecorationSet.empty;

        const decorations = markerDecorations(state.doc, state.selection.$head.pos);
        return decorations.length
          ? DecorationSet.create(state.doc, decorations)
          : DecorationSet.empty;
      },
    },
  });
}
