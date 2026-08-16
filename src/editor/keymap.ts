import {
  baseKeymap,
  chainCommands,
  exitCode,
  setBlockType,
  toggleMark,
} from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import { undoInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import {
  liftListItem,
  sinkListItem,
  splitListItem,
} from "prosemirror-schema-list";
import { TextSelection, type Command, type Plugin } from "prosemirror-state";
import { schema } from "./schema";

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

/** Puts a plain paragraph after a block that cannot be left with Enter. */
const insertParagraphAfter: Command = (state, dispatch) => {
  const { $head } = state.selection;
  if ($head.parent.type !== schema.nodes.code_block) return false;
  if (dispatch) {
    const after = $head.after($head.depth);
    const tr = state.tr.insert(after, schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

const bindings: { [key: string]: Command } = {
  "Mod-z": undo,
  "Mod-y": redo,
  "Shift-Mod-z": redo,

  "Mod-b": toggleMark(schema.marks.strong),
  "Mod-i": toggleMark(schema.marks.em),
  "Mod-e": toggleMark(schema.marks.code),

  "Shift-Mod-0": setBlockType(schema.nodes.paragraph),
  "Shift-Mod-1": setBlockType(schema.nodes.heading, { level: 1 }),
  "Shift-Mod-2": setBlockType(schema.nodes.heading, { level: 2 }),
  "Shift-Mod-3": setBlockType(schema.nodes.heading, { level: 3 }),
  "Shift-Mod-4": setBlockType(schema.nodes.heading, { level: 4 }),
  "Shift-Mod-5": setBlockType(schema.nodes.heading, { level: 5 }),
  "Shift-Mod-6": setBlockType(schema.nodes.heading, { level: 6 }),

  Enter: chainCommands(splitListItem(schema.nodes.list_item), baseKeymap.Enter),
  "Shift-Enter": chainCommands(exitCode, insertParagraphAfter, (
    state,
    dispatch,
  ) => {
    if (dispatch) {
      dispatch(
        state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView(),
      );
    }
    return true;
  }),
  "Mod-Enter": chainCommands(exitCode, insertParagraphAfter),

  Tab: sinkListItem(schema.nodes.list_item),
  "Shift-Tab": liftListItem(schema.nodes.list_item),

  // Backspace undoes the input rule that just fired before it deletes text, so
  // that "# " can be taken back without losing the heading text.
  Backspace: chainCommands(undoInputRule, baseKeymap.Backspace),
};

export const editorKeymap: Plugin = keymap(bindings);

/** The base bindings, which the ones above take precedence over. */
export const baseKeymapPlugin: Plugin = keymap(baseKeymap);

export const modifierLabel = isMac ? "⌘" : "Ctrl";
