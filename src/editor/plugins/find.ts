import type { Node as ProseNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

/**
 * Finds every occurrence of the search text and marks it.
 *
 * Every highlight here is a decoration. This plugin must never touch the
 * document; only the replace commands in `editor.ts` do that. See CLAUDE.md
 * section 8 rule 2.
 *
 * The Custom Highlight API would be the natural fit and is deliberately not
 * used: WebKitGTK is the weakest of the three engines here, and decorations
 * work everywhere. See CLAUDE.md section 7.
 */

export interface Match {
  from: number;
  to: number;
}

export interface FindState {
  query: string;
  matches: readonly Match[];
  /** Index into `matches`, or -1 when there is nothing to step through. */
  current: number;
}

/** What the find bar shows: "index of total". */
export interface FindSummary {
  total: number;
  /** Zero based, or -1 when nothing matched. */
  index: number;
}

export const findKey = new PluginKey<FindState>("find");

const EMPTY: FindState = { query: "", matches: [], current: -1 };

/** A new search, or a step through the results already found. */
export type FindMeta = { query: string } | { step: 1 | -1 };

/**
 * Every occurrence of `query`, matched without regard to case.
 *
 * Each text block is searched on its own, so a match can never straddle a
 * block boundary and report a range that spans one.
 */
export function findMatches(doc: ProseNode, query: string): Match[] {
  const matches: Match[] = [];
  if (!query) return matches;

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;

    // An inline leaf stands in as a single character so that an offset into
    // this string is also an offset into the block. A space, because the leaf
    // that turns up most often is the author's line wrapping, and a phrase
    // written across two lines should still be findable as one.
    const text = node.textBetween(0, node.content.size, undefined, " ");
    const lowered = text.toLowerCase();

    // Lower casing can make a string longer, and that would slide every
    // position after the character that grew. Rather than report a range that
    // is off by one, those blocks are matched exactly.
    const aligned = lowered.length === text.length;
    const haystack = aligned ? lowered : text;
    const needle = aligned ? query.toLowerCase() : query;
    if (!needle) return false;

    const start = pos + 1;
    let at = haystack.indexOf(needle);
    while (at !== -1) {
      matches.push({ from: start + at, to: start + at + needle.length });
      at = haystack.indexOf(needle, at + needle.length);
    }
    return false;
  });

  return matches;
}

/** Wraps around at either end, which is what a find bar is expected to do. */
function wrap(index: number, length: number): number {
  if (length === 0) return -1;
  return ((index % length) + length) % length;
}

export function findSummaryOf(state: FindState | undefined): FindSummary {
  if (!state) return { total: 0, index: -1 };
  return { total: state.matches.length, index: state.current };
}

export const findPlugin = new Plugin<FindState>({
  key: findKey,

  state: {
    init: () => EMPTY,

    apply(tr, value) {
      const meta = tr.getMeta(findKey) as FindMeta | undefined;

      if (meta && "query" in meta) {
        const matches = findMatches(tr.doc, meta.query);
        return { query: meta.query, matches, current: matches.length ? 0 : -1 };
      }

      if (meta && "step" in meta) {
        return { ...value, current: wrap(value.current + meta.step, value.matches.length) };
      }

      // Only while a search is running, so an ordinary keystroke never pays for
      // a whole document scan. See CLAUDE.md section 8 rule 3.
      if (tr.docChanged && value.query) {
        const matches = findMatches(tr.doc, value.query);
        return { ...value, matches, current: wrap(value.current, matches.length) };
      }

      return value;
    },
  },

  props: {
    decorations(state) {
      const found = findKey.getState(state);
      if (!found?.matches.length) return DecorationSet.empty;

      return DecorationSet.create(
        state.doc,
        found.matches.map((match, index) =>
          Decoration.inline(
            match.from,
            match.to,
            { class: index === found.current ? "find-match is-current" : "find-match" },
            // A code block draws its own highlights, and reads which one is
            // the current match from here rather than from the class name.
            { current: index === found.current },
          ),
        ),
      );
    },
  },
});
