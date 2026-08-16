import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import type { MarkType } from "prosemirror-model";
import type { Plugin } from "prosemirror-state";
import { schema } from "./schema";

/**
 * Applies a mark and removes the syntax that triggered it, in one transaction,
 * so that a single undo press reverses both. See CLAUDE.md section 8 rule 4.
 */
function markInputRule(pattern: RegExp, markType: MarkType): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const marker = match[1];
    const text = match[2];
    if (!marker || !text) return null;

    // The document holds `match[0]` minus the character being typed, and the
    // pattern may swallow the character in front of the opening marker. So the
    // offsets are measured forward from the start of the marker, and the
    // closing run is whatever is left between the content and the caret.
    const markerStart = start + match[0].indexOf(marker);
    const textStart = markerStart + marker.length;
    const textEnd = textStart + text.length;

    const tr = state.tr;
    // Delete the closing run first so the opening offsets stay valid.
    tr.delete(textEnd, end);
    tr.delete(markerStart, textStart);
    tr.addMark(markerStart, markerStart + text.length, markType.create());
    // Stop the mark from continuing on to what the user types next.
    tr.removeStoredMark(markType);
    return tr;
  });
}

const headingRule = textblockTypeInputRule(
  /^(#{1,6})\s$/,
  schema.nodes.heading,
  (match) => ({ level: match[1].length }),
);

const codeFenceRule = textblockTypeInputRule(
  /^```([a-zA-Z0-9+#-]*)[\s\n]$/,
  schema.nodes.code_block,
  (match) => ({ params: match[1] ?? "" }),
);

const blockquoteRule = wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote);

const bulletListRule = wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list);

const orderedListRule = wrappingInputRule(
  /^(\d+)\.\s$/,
  schema.nodes.ordered_list,
  (match) => ({ order: +match[1] }),
  (match, node) => node.childCount + (node.attrs.order as number) === +match[1],
);

const horizontalRuleRule = new InputRule(
  /^(?:---|___|\*\*\*)$/,
  (state, _match, start, end) =>
    state.tr.replaceWith(start, end, schema.nodes.horizontal_rule.create()),
);

/**
 * The inline rules fire on the closing character. The opening run may not be
 * preceded by a word character, which is what keeps snake_case names intact.
 */
export const inputRulesPlugin: Plugin = inputRules({
  rules: [
    headingRule,
    codeFenceRule,
    blockquoteRule,
    bulletListRule,
    orderedListRule,
    horizontalRuleRule,
    markInputRule(/(?:^|[^*])(\*\*)([^*]+)\*\*$/, schema.marks.strong),
    markInputRule(/(?:^|[^_])(__)([^_]+)__$/, schema.marks.strong),
    markInputRule(/(?:^|[^*])(\*)([^*]+)\*$/, schema.marks.em),
    markInputRule(/(?:^|[^\w_])(_)([^_]+)_$/, schema.marks.em),
    markInputRule(/(?:^|[^`])(`)([^`]+)`$/, schema.marks.code),
  ],
});
