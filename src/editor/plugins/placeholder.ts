import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

/**
 * The hint shown in an empty document. It disappears on the first keystroke.
 *
 * This is a node decoration drawn with CSS, not a widget. A widget carries
 * `contenteditable="false"`, and when such an element is the only child of an
 * empty block the browser refuses to insert text into it at all, which leaves
 * the editor unusable from its starting state.
 */
export function placeholderPlugin(text: string): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { doc } = state;
        const first = doc.firstChild;
        const isEmpty =
          doc.childCount === 1 &&
          first !== null &&
          first.isTextblock &&
          first.content.size === 0;
        if (!isEmpty) return DecorationSet.empty;

        return DecorationSet.create(doc, [
          Decoration.node(0, first!.nodeSize, {
            class: "pm-placeholder",
            "data-placeholder": text,
          }),
        ]);
      },
    },
  });
}
