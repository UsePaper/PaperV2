import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import {
  HighlightStyle,
  LanguageDescription,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import {
  Compartment,
  EditorState as CodeState,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration as CodeDecoration,
  type DecorationSet as CodeDecorationSet,
  EditorView as CodeView,
  keymap as codeKeymap,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { isDiagram, renderDiagram } from "./diagram";
import { exitCode, setBlockType } from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import type { Node as ProseNode } from "prosemirror-model";
import { Selection, TextSelection } from "prosemirror-state";
import type { DecorationSource, EditorView, NodeView } from "prosemirror-view";
import { schema } from "../schema";

/**
 * A CodeMirror 6 editor standing in for a code block.
 *
 * The two editors keep one document between them: CodeMirror owns the text on
 * screen, and every change it makes is forwarded to ProseMirror as an ordinary
 * transaction. Nothing here writes to the DOM of the outer editor, and the
 * history stays ProseMirror's, so one undo press behaves the same inside a code
 * block as outside it.
 */

/**
 * Colours live in the theme stylesheets with the rest of the palette, so this
 * only names the tokens. See `src/themes/`.
 */
const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, class: "tok-keyword" },
  { tag: [tags.controlKeyword, tags.moduleKeyword], class: "tok-keyword" },
  { tag: [tags.string, tags.special(tags.string)], class: "tok-string" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: "tok-comment" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], class: "tok-literal" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    class: "tok-function",
  },
  { tag: [tags.typeName, tags.className, tags.namespace], class: "tok-type" },
  { tag: [tags.propertyName, tags.attributeName], class: "tok-property" },
  { tag: [tags.operator, tags.punctuation, tags.separator], class: "tok-punct" },
  { tag: [tags.tagName, tags.angleBracket], class: "tok-tag" },
  { tag: tags.invalid, class: "tok-invalid" },
]);

/* Find highlights ----------------------------------------------------------

   The outer editor marks its matches with decorations, but a decoration cannot
   reach inside a node view: this element belongs to CodeMirror. ProseMirror
   hands the decorations that fall within the block to `update` instead, and
   they are redrawn here as CodeMirror's own. */

interface FindRange {
  from: number;
  to: number;
  current: boolean;
}

const setFindRanges = StateEffect.define<readonly FindRange[]>();

const findMatchMark = CodeDecoration.mark({ class: "find-match" });
const currentMatchMark = CodeDecoration.mark({ class: "find-match is-current" });

const findHighlights = StateField.define<CodeDecorationSet>({
  create: () => CodeDecoration.none,

  update(value, tr) {
    // Typing inside the block moves the matches with the text until the outer
    // editor recomputes them.
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setFindRanges)) continue;
      next = CodeDecoration.set(
        effect.value.map((range) =>
          (range.current ? currentMatchMark : findMatchMark).range(range.from, range.to),
        ),
        true,
      );
    }
    return next;
  },

  provide: (field) => CodeView.decorations.from(field),
});

/**
 * The matches inside this block, in CodeMirror's coordinates.
 *
 * ProseMirror has already moved these into the block's own space, so a position
 * here is an offset into its text. They are clamped anyway: a range that fell
 * outside would throw rather than simply look wrong.
 */
export function findRangesIn(inner: DecorationSource, length: number): FindRange[] {
  const ranges: FindRange[] = [];

  inner.forEachSet((set) => {
    for (const decoration of set.find()) {
      const from = Math.max(0, Math.min(decoration.from, length));
      const to = Math.max(0, Math.min(decoration.to, length));
      // A mark decoration must cover something.
      if (to > from) ranges.push({ from, to, current: decoration.spec?.current === true });
    }
  });

  ranges.sort((a, b) => a.from - b.from);
  return ranges;
}

/** The language named by the fence, if CodeMirror knows it. */
async function languageFor(params: string): Promise<Extension> {
  const name = params.trim().split(/\s+/)[0];
  if (!name) return [];

  const found = LanguageDescription.matchLanguageName(languages, name, true);
  if (!found) return [];

  try {
    // Each language is a chunk of its own, fetched the first time it is used.
    return await found.load();
  } catch {
    // An unknown or unreachable language is not worth an error: the code is
    // still perfectly editable without the colours.
    return [];
  }
}

export class CodeBlockView implements NodeView {
  readonly dom: HTMLElement;
  private node: ProseNode;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly cm: CodeView;
  /** Our own element around CodeMirror's. See the constructor. */
  private readonly codeWrap: HTMLElement;
  private readonly language = new Compartment();

  /** True while one editor is applying a change that came from the other. */
  private updating = false;
  /** Rises with each language request, so a slow load cannot land last. */
  private languageRequest = 0;
  /** The match the find bar is on, so the block scrolls only when it moves. */
  private currentMatch: string | null = null;
  /** Where a mermaid diagram is drawn, once there is one to draw. */
  private diagram: HTMLElement | null = null;
  /** Rises with each diagram request, so a slow render cannot land last. */
  private diagramRequest = 0;
  /** Editing shows the code; the other two show the picture. */
  private showingDiagram = false;

  constructor(
    node: ProseNode,
    view: EditorView,
    getPos: () => number | undefined,
    innerDecorations?: DecorationSource,
    private readonly onDestroy?: () => void,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // Our own element around CodeMirror's. CodeMirror rewrites the class list
    // of its `dom` whenever it reconfigures, so a class added to it there is
    // dropped the moment a language finishes loading.
    this.dom = document.createElement("div");
    this.dom.className = "pm-codeblock";

    // A second wrapper, and it earns its place: CodeMirror injects
    // `display: flex !important` onto its own editor element, so no rule of
    // ours can hide it to make room for a diagram. This one it does not touch.
    this.codeWrap = document.createElement("div");
    this.codeWrap.className = "pm-code";
    this.dom.append(this.codeWrap);

    this.cm = new CodeView({
      parent: this.codeWrap,
      state: CodeState.create({
        doc: node.textContent,
        extensions: [
          codeKeymap.of([
            ...this.escapeKeymap(),
            indentWithTab,
            ...defaultKeymap,
          ]),
          syntaxHighlighting(highlightStyle),
          indentUnit.of("  "),
          // The column is already narrow, so wrapping beats a second scrollbar
          // inside the page.
          CodeView.lineWrapping,
          this.language.of([]),
          findHighlights,
          CodeView.updateListener.of((update) => {
            if (update.docChanged || update.selectionSet) this.forwardUpdate();
          }),
        ],
      }),
    });

    this.setLanguage(node.attrs.params as string);
    if (innerDecorations) this.showFindMatches(innerDecorations);
  }

  /**
   * Draws the diagram instead of the code, or puts the code back.
   *
   * The CodeMirror editor is hidden rather than torn down, so switching modes
   * does not lose the caret, the selection or the undo history inside it.
   */
  setDiagramMode(drawing: boolean): void {
    const wanted = drawing && isDiagram(this.dom.dataset.language ?? "");
    if (wanted === this.showingDiagram) {
      if (wanted) void this.drawDiagram();
      return;
    }

    this.showingDiagram = wanted;
    this.dom.classList.toggle("is-diagram", wanted);
    if (wanted) void this.drawDiagram();
    else this.diagram?.replaceChildren();
  }

  private async drawDiagram(): Promise<void> {
    const request = (this.diagramRequest += 1);
    const source = this.node.textContent;

    if (!this.diagram) {
      this.diagram = document.createElement("div");
      this.diagram.className = "pm-diagram";
      this.dom.append(this.diagram);
    }

    const svg = await renderDiagram(source);
    // A later edit, a mode change, or a destroyed view wins over this one.
    if (request !== this.diagramRequest || !this.showingDiagram) return;

    if (svg) {
      this.diagram.innerHTML = svg;
      this.dom.classList.remove("is-unreadable");
    } else {
      // Nothing to draw yet. The code is shown instead, which is the only
      // useful thing to say about a diagram that does not parse.
      this.diagram.replaceChildren();
      this.dom.classList.add("is-unreadable");
    }
  }

  /**
   * Redraws the outer editor's find matches as CodeMirror's own, and brings the
   * current one into view when it moves here. The block itself does the
   * scrolling: only CodeMirror knows where a line inside it sits, so scrolling
   * the block into view from outside would stop at its top edge.
   */
  private showFindMatches(inner: DecorationSource): void {
    const ranges = findRangesIn(inner, this.cm.state.doc.length);
    const effects: StateEffect<unknown>[] = [setFindRanges.of(ranges)];

    const current = ranges.find((range) => range.current) ?? null;
    const key = current ? `${current.from}:${current.to}` : null;
    if (key !== this.currentMatch) {
      this.currentMatch = key;
      if (current) {
        effects.push(CodeView.scrollIntoView(current.from, { y: "center" }));
      }
    }

    this.cm.dispatch({ effects });
  }

  private setLanguage(params: string): void {
    const request = (this.languageRequest += 1);
    this.dom.dataset.language = params.trim().split(/\s+/)[0] || "";

    void languageFor(params).then((extension) => {
      // A later fence, or a destroyed view, wins over this one.
      if (request !== this.languageRequest) return;
      this.cm.dispatch({ effects: this.language.reconfigure(extension) });
    });
  }

  /** CodeMirror changed. Carry it into the outer document. */
  private forwardUpdate(): void {
    if (this.updating || !this.cm.hasFocus) return;

    const start = this.getPos();
    if (start === undefined) return;

    let offset = start + 1;
    const { main } = this.cm.state.selection;
    const selectionFrom = offset + main.from;
    const selectionTo = offset + main.to;
    const outer = this.view.state.selection;

    if (
      selectionFrom === outer.from &&
      selectionTo === outer.to &&
      this.cm.state.doc.toString() === this.node.textContent
    ) {
      return;
    }

    const tr = this.view.state.tr;

    // Only what actually changed is written, so a keystroke does not replace
    // the whole block and undo stays fine grained. The insert lands at the same
    // position the delete opened up, since everything before it is untouched.
    const before = this.node.textContent;
    const after = this.cm.state.doc.toString();
    if (before !== after) {
      const { from, toBefore, toAfter } = diffRange(before, after);
      if (toBefore > from) tr.delete(offset + from, offset + toBefore);
      if (toAfter > from) tr.insert(offset + from, schema.text(after.slice(from, toAfter)));
    }

    tr.setSelection(TextSelection.create(tr.doc, selectionFrom, selectionTo));
    this.updating = true;
    try {
      this.view.dispatch(tr);
    } finally {
      this.updating = false;
    }
  }

  /** The outer document changed. Carry it into CodeMirror. */
  update(
    node: ProseNode,
    _decorations: readonly unknown[],
    innerDecorations: DecorationSource,
  ): boolean {
    if (node.type !== this.node.type) return false;

    const languageChanged = node.attrs.params !== this.node.attrs.params;
    this.node = node;
    if (this.updating) return true;

    const current = this.cm.state.doc.toString();
    const next = node.textContent;
    if (current !== next) {
      const { from, toBefore, toAfter } = diffRange(current, next);
      this.updating = true;
      try {
        this.cm.dispatch({
          changes: { from, to: toBefore, insert: next.slice(from, toAfter) },
        });
      } finally {
        this.updating = false;
      }
    }

    if (languageChanged) this.setLanguage(node.attrs.params as string);
    // After the text is in step, so a match cannot point past the end of it.
    this.showFindMatches(innerDecorations);
    return true;
  }

  /**
   * Leaving the block by walking off either end, so the arrow keys do not trap
   * the caret inside it.
   */
  private escapeKeymap() {
    const escape = (unit: "line" | "char", direction: -1 | 1): boolean => {
      const { main } = this.cm.state.selection;
      if (!main.empty) return false;

      const edge =
        unit === "line" ? this.cm.state.doc.lineAt(main.head) : { from: main.from, to: main.to };
      const atEdge = direction < 0 ? edge.from === 0 : edge.to === this.cm.state.doc.length;
      if (!atEdge) return false;

      const start = this.getPos();
      if (start === undefined) return false;

      const target = start + (direction < 0 ? 0 : this.node.nodeSize);
      const selection = Selection.near(this.view.state.doc.resolve(target), direction);
      this.view.dispatch(this.view.state.tr.setSelection(selection).scrollIntoView());
      this.view.focus();
      return true;
    };

    return [
      { key: "ArrowUp", run: () => escape("line", -1) },
      { key: "ArrowLeft", run: () => escape("char", -1) },
      { key: "ArrowDown", run: () => escape("line", 1) },
      { key: "ArrowRight", run: () => escape("char", 1) },

      // The history belongs to the outer editor, so one undo press reverses
      // the last thing typed wherever it was typed.
      { key: "Mod-z", run: () => undo(this.view.state, this.view.dispatch) },
      { key: "Shift-Mod-z", run: () => redo(this.view.state, this.view.dispatch) },
      { key: "Mod-y", run: () => redo(this.view.state, this.view.dispatch) },

      {
        key: "Mod-Enter",
        run: () => {
          if (!exitCode(this.view.state, this.view.dispatch)) return false;
          this.view.focus();
          return true;
        },
      },

      // Backspace at the very start turns the fence back into a paragraph,
      // which is the only way out of an empty block once the input rule has
      // fired and CodeMirror owns the keyboard.
      {
        key: "Backspace",
        run: () => {
          const { main } = this.cm.state.selection;
          if (!main.empty || main.from !== 0) return false;

          const start = this.getPos();
          if (start === undefined) return false;

          this.view.dispatch(
            this.view.state.tr.setSelection(
              TextSelection.create(this.view.state.doc, start + 1),
            ),
          );
          setBlockType(schema.nodes.paragraph)(this.view.state, this.view.dispatch);
          this.view.focus();
          return true;
        },
      },
    ];
  }

  setSelection(anchor: number, head: number): void {
    this.cm.focus();
    this.updating = true;
    try {
      this.cm.dispatch({ selection: { anchor, head } });
    } finally {
      this.updating = false;
    }
  }

  selectNode(): void {
    this.cm.focus();
  }

  /** CodeMirror handles everything inside its own DOM. */
  stopEvent(): boolean {
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.diagramRequest += 1;
    this.onDestroy?.();
    // Stops a language that is still loading from touching a dead view.
    this.languageRequest += 1;
    this.cm.destroy();
  }
}

/**
 * The one stretch that differs between two strings, as a common prefix and a
 * common suffix. Replacing only that keeps the caret still and the undo history
 * fine grained, where replacing the whole block would not.
 */
export function diffRange(
  before: string,
  after: string,
): { from: number; toBefore: number; toAfter: number } {
  let from = 0;
  const shortest = Math.min(before.length, after.length);
  while (from < shortest && before.charCodeAt(from) === after.charCodeAt(from)) from += 1;

  let tail = 0;
  while (
    tail < shortest - from &&
    before.charCodeAt(before.length - tail - 1) === after.charCodeAt(after.length - tail - 1)
  ) {
    tail += 1;
  }

  return { from, toBefore: before.length - tail, toAfter: after.length - tail };
}
