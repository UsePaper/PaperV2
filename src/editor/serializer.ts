import type { Mark, Node as ProseNode } from "prosemirror-model";
import { MarkdownSerializer } from "prosemirror-markdown";
import { schema, type CellAlign } from "./schema";

/**
 * The output style is fixed. See the table in CLAUDE.md section 6.
 * Changing a value here invalidates the round trip corpus, so do not.
 */
export const markdownSerializer = new MarkdownSerializer(
  {
    blockquote(state, node) {
      state.wrapBlock("> ", null, node, () => state.renderContent(node));
    },

    // Always a fence, always with the language name. Never indented code.
    code_block(state, node) {
      const runs = node.textContent.match(/`{3,}/gm);
      const fence = runs ? runs.sort().slice(-1)[0] + "`" : "```";
      state.write(fence + (node.attrs.params || "") + "\n");
      state.text(node.textContent, false);
      state.write("\n");
      state.write(fence);
      state.closeBlock(node);
    },

    // ATX, never setext.
    heading(state, node) {
      state.write(state.repeat("#", node.attrs.level as number) + " ");
      state.renderInline(node, false);
      state.closeBlock(node);
    },

    horizontal_rule(state, node) {
      state.write("---");
      state.closeBlock(node);
    },

    bullet_list(state, node) {
      state.renderList(node, "  ", () => "- ");
    },

    // Numbers increase. The prefix is padded so that a two digit marker keeps
    // its continuation lines indented to the same column.
    ordered_list(state, node) {
      const start = (node.attrs.order as number) ?? 1;
      const width = String(start + node.childCount - 1).length;
      const indent = state.repeat(" ", width + 2);
      state.renderList(node, indent, (i) => {
        const marker = String(start + i);
        return state.repeat(" ", width - marker.length) + marker + ". ";
      });
    },

    list_item(state, node) {
      state.renderContent(node);
    },

    /**
     * A pipe table, written the way it is almost always written by hand:
     * `| cell | cell |` with a bare `|---|---|` under the header, and colons
     * only where a column is actually aligned.
     */
    table(state, node) {
      const rows: string[][] = [];
      const aligns: CellAlign[] = [];

      node.forEach((row, _offset, rowIndex) => {
        const cells: string[] = [];
        row.forEach((cell, _cellOffset, cellIndex) => {
          if (rowIndex === 0) aligns[cellIndex] = cell.attrs.align as CellAlign;
          cells.push(cellText(cell));
        });
        rows.push(cells);
      });

      const width = aligns.length;
      const line = (cells: string[]) => {
        // A short row is padded out, because a pipe table is a rectangle.
        const padded = Array.from({ length: width }, (_, i) => cells[i] ?? "");
        return `| ${padded.join(" | ")} |`;
      };

      const lines = [line(rows[0] ?? []), `|${aligns.map(rule).join("|")}|`];
      for (const row of rows.slice(1)) lines.push(line(row));

      state.text(lines.join("\n"), false);
      state.closeBlock(node);
    },

    // Rows and cells are written by the table itself, which needs to see the
    // whole shape at once to line the columns up.
    table_row() {},
    table_cell() {},
    table_header() {},

    paragraph(state, node) {
      state.renderInline(node);
      state.closeBlock(node);
    },

    image(state, node) {
      const title = node.attrs.title
        ? ` "${(node.attrs.title as string).replace(/"/g, '\\"')}"`
        : "";
      state.write(
        "![" +
          state.esc((node.attrs.alt as string) || "") +
          "](" +
          (node.attrs.src as string).replace(/[()]/g, "\\$&") +
          title +
          ")",
      );
    },

    // A backslash at the line end, never two spaces. A trailing run of breaks
    // at the end of a block carries no meaning, so it is dropped.
    hard_break(state, node, parent, index) {
      for (let i = index + 1; i < parent.childCount; i++) {
        if (parent.child(i).type !== node.type) {
          state.write("\\\n");
          return;
        }
      }
    },

    /**
     * The author's own line wrapping, written back where it was.
     *
     * A break is given up when the text after it would open a block on its own
     * line. That cannot happen in a file we read, because the parser would have
     * made a block of it rather than a paragraph, but it can happen after
     * someone types one, and a space is a truer rendering of the break than a
     * line that comes back as a list.
     */
    soft_break(state, _node, parent, index) {
      const next = index + 1 < parent.childCount ? parent.child(index + 1) : null;
      const text = next?.isText ? (next.text ?? "") : "";
      state.write(BLOCK_OPENER.test(text) ? " " : "\n");
    },

    // The text of an autolink is its own URL, which must not be escaped.
    text(state, node) {
      state.text(node.text ?? "", autolinkMark(node) === null);
    },
  },
  {
    em: { open: "*", close: "*", mixable: true, expelEnclosingWhitespace: true },
    strong: {
      open: "**",
      close: "**",
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    // Inline links, never reference style. A bare URL whose text equals its
    // target is written as an autolink, which is how it was read.
    link: {
      open(_state, _mark, parent, index) {
        return isAutolinkAt(parent, index) ? "<" : "[";
      },
      close(_state, mark, parent, index) {
        // `index` points one past the last node the mark covered.
        if (isAutolinkAt(parent, index - 1)) return ">";
        const title = mark.attrs.title
          ? ` "${(mark.attrs.title as string).replace(/"/g, '\\"')}"`
          : "";
        return "](" + (mark.attrs.href as string).replace(/[()"]/g, "\\$&") + title + ")";
      },
      mixable: true,
    },
    code: {
      open(_state, _mark, parent, index) {
        return backticksFor(parent.child(index), -1);
      },
      close(_state, _mark, parent, index) {
        return backticksFor(parent.child(index - 1), 1);
      },
      escape: false,
    },
  },
);

/** Text that would start a block of its own if it began a line. */
const BLOCK_OPENER = /^\s*([-*+>]\s|#{1,6}(\s|$)|\d+[.)]\s|```|---|===)/;

/** The dashes under a column, carrying its alignment if it has one. */
function rule(align: CellAlign): string {
  switch (align) {
    case "left":
      return ":---";
    case "center":
      return ":---:";
    case "right":
      return "---:";
    default:
      return "---";
  }
}

/**
 * One cell, as a single line of Markdown.
 *
 * The cell is serialized as though it were a paragraph, then made safe to sit
 * between pipes: a pipe of its own would end the cell early, and a line break
 * would end the whole row.
 */
function cellText(cell: ProseNode): string {
  const paragraph = schema.node("paragraph", null, cell.content);
  const doc = schema.node("doc", null, [paragraph]);
  return markdownSerializer
    .serialize(doc)
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

/** Enough backticks to fence a code span that itself contains backticks. */
function backticksFor(node: ProseNode, side: number): string {
  const ticks = /`+/g;
  let len = 0;
  if (node.isText && node.text) {
    let match: RegExpExecArray | null;
    while ((match = ticks.exec(node.text))) len = Math.max(len, match[0].length);
  }
  let result = len > 0 && side > 0 ? " `" : "`";
  for (let i = 0; i < len; i++) result += "`";
  if (len > 0 && side < 0) result += " ";
  return result;
}

/** The link mark of a node whose text is exactly its own untitled URL. */
function autolinkMark(node: ProseNode): Mark | null {
  if (!node.isText || !node.text) return null;
  const mark = node.marks[node.marks.length - 1];
  if (!mark || mark.type.name !== "link") return null;
  if (mark.attrs.title || !/^\w+:/.test(mark.attrs.href as string)) return null;
  return mark.attrs.href === node.text ? mark : null;
}

/** True when the child at `index` is a whole autolink on its own. */
function isAutolinkAt(parent: ProseNode, index: number): boolean {
  if (index < 0 || index >= parent.childCount) return false;
  const mark = autolinkMark(parent.child(index));
  if (!mark) return false;
  return (
    index === parent.childCount - 1 || !mark.isInSet(parent.child(index + 1).marks)
  );
}

/**
 * A ProseMirror document to Markdown text, with LF line ends and a single
 * trailing newline. The file layer restores the original line ending style.
 */
export function serializeMarkdown(doc: ProseNode): string {
  const text = markdownSerializer.serialize(doc);
  return text.length === 0 ? "" : text + "\n";
}
