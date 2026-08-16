import { toggleMark } from "prosemirror-commands";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { history, redo, undo } from "prosemirror-history";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { inputRulesPlugin } from "./inputrules";
import { baseKeymapPlugin, editorKeymap } from "./keymap";
import { CodeBlockView } from "./nodeviews/codeblock";
import { ImageView, type ResolveImage } from "./nodeviews/image";
import { parseMarkdown } from "./parser";
import {
  findKey,
  findPlugin,
  findSummaryOf,
  type FindSummary,
  type Match,
} from "./plugins/find";
import { markersPlugin } from "./plugins/markers";
import { placeholderPlugin } from "./plugins/placeholder";
import { schema } from "./schema";
import { serializeMarkdown } from "./serializer";

/**
 * How the document is being shown.
 *
 * `editing` is the working view: the syntax of whatever the caret is in shows,
 * so it can be seen and changed. `presentation` puts the syntax away but keeps
 * the keyboard, for showing a document to somebody while still being able to
 * fix a word. `reading` puts the keyboard away too: no caret, nothing to type
 * into, and the text still selectable so it can be quoted.
 */
export type ViewMode = "editing" | "presentation" | "reading";

export interface EditorOptions {
  /** Called after any transaction that changed the document. */
  onChange?: () => void;
  /**
   * Turns an image address into something the page can show. Supplied from
   * outside, because where a relative path points depends on the file the
   * document came from, and that belongs to the file layer.
   */
  resolveImage?: ResolveImage;
}

/** The editor view, plus the few operations the rest of the app needs. */
export class Editor {
  readonly view: EditorView;
  private readonly onChange?: () => void;
  private readonly resolveImage: ResolveImage;
  /** The live image views, so they can be looked up again. */
  private readonly images = new Set<ImageView>();
  private mode: ViewMode = "editing";

  constructor(mount: HTMLElement, options: EditorOptions = {}) {
    this.onChange = options.onChange;
    // Browser mode has no disk, so an unresolved address simply shows broken.
    this.resolveImage = options.resolveImage ?? (async () => null);
    this.view = new EditorView(mount, {
      state: this.createState(""),
      // Reading puts the keyboard away. The text can still be selected and
      // copied, which is most of what reading a document is for.
      editable: () => this.mode !== "reading",
      // A code block is a CodeMirror editor. See nodeviews/codeblock.ts.
      nodeViews: {
        code_block: (node, view, getPos, _decorations, innerDecorations) =>
          new CodeBlockView(node, view, getPos, innerDecorations),
        image: (node) => {
          const image: ImageView = new ImageView(node, this.resolveImage, () =>
            this.images.delete(image),
          );
          this.images.add(image);
          return image;
        },
      },
      dispatchTransaction: (tr) => {
        this.view.updateState(this.view.state.apply(tr));
        if (tr.docChanged) this.onChange?.();
      },
    });
  }

  private createState(markdown: string): EditorState {
    return EditorState.create({
      doc: parseMarkdown(markdown),
      plugins: [
        inputRulesPlugin,
        editorKeymap,
        baseKeymapPlugin,
        dropCursor(),
        gapCursor(),
        history(),
        findPlugin,
        markersPlugin(() => this.mode === "editing"),
        placeholderPlugin("Start writing."),
      ],
    });
  }

  /** Replaces the whole document. The undo history starts over. */
  setMarkdown(markdown: string): void {
    this.view.updateState(this.createState(markdown));
  }

  /**
   * The menu bar owns the same shortcuts as the editor keymap, and on macOS a
   * menu accelerator is consumed before the webview sees it. So the menu drives
   * these directly rather than relying on the keymap.
   */
  toggleMark(name: "strong" | "em" | "code"): void {
    toggleMark(schema.marks[name])(this.view.state, this.view.dispatch);
    this.focus();
  }

  undo(): void {
    undo(this.view.state, this.view.dispatch);
    this.focus();
  }

  redo(): void {
    redo(this.view.state, this.view.dispatch);
    this.focus();
  }

  /**
   * The empty transaction is what redraws, since the mode lives outside the
   * document: it makes the view ask for the decorations and for `editable`
   * again.
   */
  setMode(mode: ViewMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.view.dispatch(this.view.state.tr);
  }

  /**
   * Looks every picture up again. A relative address is relative to the file
   * the document came from, so it means something different once the document
   * is saved, or saved somewhere else.
   */
  refreshImages(): void {
    for (const image of this.images) image.reload();
  }

  setSpellcheck(enabled: boolean): void {
    this.view.setProps({
      attributes: { spellcheck: enabled ? "true" : "false" },
    });
  }

  getMarkdown(): string {
    return serializeMarkdown(this.view.state.doc);
  }

  /* Find and replace ------------------------------------------------------ */

  /** Starts or updates a search. An empty query clears the highlights. */
  search(query: string): FindSummary {
    this.view.dispatch(this.view.state.tr.setMeta(findKey, { query }));
    this.revealCurrent();
    return this.findSummary();
  }

  stepFind(direction: 1 | -1): FindSummary {
    this.view.dispatch(this.view.state.tr.setMeta(findKey, { step: direction }));
    this.revealCurrent();
    return this.findSummary();
  }

  findSummary(): FindSummary {
    return findSummaryOf(findKey.getState(this.view.state));
  }

  replaceCurrent(replacement: string): FindSummary {
    const match = this.currentMatch();
    if (!match) return this.findSummary();

    // `insertText` keeps the marks already at that spot, so replacing a word
    // inside emphasis leaves the emphasis alone.
    this.view.dispatch(this.view.state.tr.insertText(replacement, match.from, match.to));
    this.revealCurrent();
    return this.findSummary();
  }

  replaceAll(replacement: string): FindSummary {
    const matches = findKey.getState(this.view.state)?.matches ?? [];
    if (!matches.length) return this.findSummary();

    const tr = this.view.state.tr;
    // Back to front, so replacing one match cannot shift the range of the next
    // one. It is a single transaction, so one undo takes the lot back. See
    // CLAUDE.md section 8 rule 4.
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      tr.insertText(replacement, matches[index].from, matches[index].to);
    }
    this.view.dispatch(tr);
    return this.findSummary();
  }

  /**
   * Ends the search and hands the caret back, sitting on whatever was found
   * last, so closing the bar leaves you where you were looking.
   */
  endFind(): void {
    const match = this.currentMatch();
    const tr = this.view.state.tr.setMeta(findKey, { query: "" });
    if (match) tr.setSelection(TextSelection.create(tr.doc, match.from, match.to));
    this.view.dispatch(tr);
    this.focus();
  }

  /** Seeds the find field, the way a selection does on macOS. */
  selectedText(): string {
    const { from, to, empty } = this.view.state.selection;
    return empty ? "" : this.view.state.doc.textBetween(from, to, " ");
  }

  private currentMatch(): Match | null {
    const found = findKey.getState(this.view.state);
    if (!found || found.current < 0) return null;
    return found.matches[found.current] ?? null;
  }

  /**
   * Brings the current match into view without moving the selection: the find
   * field holds the focus while you step, and setting the selection here would
   * pull the caret, and the keyboard, back into the document.
   */
  private revealCurrent(): void {
    const match = this.currentMatch();
    if (!match) return;

    const { node } = this.view.domAtPos(match.from);
    const element = node instanceof HTMLElement ? node : node.parentElement;
    // Centred, so the floating bar cannot be covering the match it just found.
    element?.scrollIntoView({ block: "center" });
  }

  /** Words in the document, counting the text of every block. */
  wordCount(): number {
    let words = 0;
    this.view.state.doc.descendants((node) => {
      if (node.isText && node.text) {
        const matched = node.text.match(/\S+/g);
        if (matched) words += matched.length;
      }
      return true;
    });
    return words;
  }

  focus(): void {
    // Nothing to focus while reading, and asking for it would put a caret back.
    if (this.mode === "reading") return;
    this.view.focus();
  }

  destroy(): void {
    this.view.destroy();
  }
}

export { schema };
