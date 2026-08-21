# CLAUDE.md

Instructions for Claude Code in the **PaperV2** repository. Read this file before you
change code.

---

## 1. What This Project Is

Paper is a minimal WYSIWYG Markdown editor for the desktop. It is a small alternative
to Typora.

**The product is called Paper. The repository is called PaperV2.** The second version
earned the plain name and the repository kept the working one, because renaming a
published repository breaks every link to it and the name is only ever seen by people
who are already reading the source. So `productName` is `Paper`, and the crate, the
package and the bundle identifier stay `paperv2`. Do not "fix" one to match the other:
the identifier in particular decides where the settings file lives, and changing it
abandons the user's settings and re-registers the file associations from nothing.

**One file per window. One editing pane.**

The user types Markdown. The application hides the syntax immediately and shows the
formatted result in the same place. There is no preview pane.

Windows are documents, the way a Mac document application works. A window holds one
file, its own dirty flag and its own undo history. Each one is a separate webview
running its own copy of the frontend, so the module level state in `src/file/state.ts`
and `src/editor/` is already per window and must stay that way. What is shared is the
settings file, and nothing else.

### Project Facts

| Item | Value |
|---|---|
| Product name | **Paper**. The name on the bundle, the menus and the window. |
| Repository | PaperV2 |
| Package name | `paperv2` |
| Bundle identifier | `com.rafi.paperv2` |
| Local path | `~/Projects/Rust/PaperV2` |
| Rust crate | `paperv2`, library target `paperv2_lib` |
| Package manager | **pnpm**. Do not use npm or yarn. |
| Scaffold | `create-tauri-app`, Vanilla + TypeScript template |

### Desktop Only

This is a desktop application. It is not a mobile application.

- Do not run `pnpm tauri android init` or `pnpm tauri ios init`.
- Do not add a `gen/android` or `gen/apple` folder.
- If a mobile folder is present, delete it.

### Deliberately Out of Scope

Do not add these. Do not suggest them. If a task needs one of them, stop and ask first.

- File tree, folder view, or workspace concept
- Tabs. A second document means a second window, not a tab bar.
- Focus mode or typewriter mode
- Outline panel or table of contents panel
- Math (KaTeX), diagrams (Mermaid), or charts
- Footnotes, definition lists, or admonitions
- Collaborative editing or any network feature, other than the update check in
  exception 5
- Telemetry, analytics, or auto update
- A theme gallery, or a settings dialog that grows past one screen

**Five exceptions:**

1. The source mode toggle stays. It shows the raw Markdown in a plain text area. It is
   a debug tool and a user escape hatch.
2. The settings sheet stays, at its current size: theme, font, text size, line width, line
   height, status bar, opens in, spellcheck. Eight settings in two groups, no tabs, no
   search. A ninth needs a reason. Line height earned its place because the size of the
   type, the width of the column and the space between the lines are the three things that
   decide how a page reads, and the first two were already here; a fixed 1.7 is generous
   for prose and cramped for nothing, which is a choice being made on the writer's behalf.
   It is offered as three named heights for the same reason the width is: nobody wants to
   pick 1.62. The status bar earned its place because the bar is the only chrome over the
   text that the user cannot otherwise dismiss, and an editor this plain should be able to
   show nothing but the page. Its specimen line is not a setting; it is there because the
   sheet covers the document, so the font and the size cannot be judged any other way.
   **Opens in** earned its place because the mode was the one preference the application
   could not keep: it belongs to a window, and every window started in editing, so anyone
   who reads or presents more than they type set it again on every launch and every new
   document. It decides what a window opens in and nothing more. It deliberately does not
   reach into windows already open, because the settings file is shared by all of them and
   a row that pulled a reader out of what they were doing to answer a choice made in
   another window would be worse than the papercut it fixes. One exception, in
   `startingMode`: a window with no file opens in editing however the row reads,
   because reading mode has no caret and nothing to type into, so a blank window in
   it offers nothing to read and no way to begin. Presentation keeps the keyboard and
   needs no such exception, and a file opened in reading mode is what was asked for.
   The footer carries a **Reset**, which is an action and not a ninth setting: it puts
   the eight back to their defaults after asking, because a sheet has no undo and the
   settings are cheap to set again but not to remember.
3. Pipe tables are in, and are the one construct here that is not CommonMark. They
   were held back for version 2 and brought forward because the alternative was
   worse: with the table rule off, a table parses as an ordinary paragraph of several
   lines, and a line break inside a paragraph becomes a space, so saving a file
   flattened every table in it into one line. Real notes are full of tables, so the
   choice was to read them or to destroy them. There is no row or column editing and
   no way to insert one from the interface: a table is read, edited cell by cell, and
   written back.
4. There are three modes, and one button in the title bar steps through them. Reading
   mode was on this list, and came off it for a reason worth keeping: the promise at
   the top of this file is that the formatted result is shown in the same place as the
   text, so the editing view was always meant to be the reading view too. The syntax
   markers are the one thing that breaks that promise, because the caret turns a line
   back into source. Presentation puts the markers away and keeps the keyboard.
   Reading puts the keyboard away as well: no caret, nothing to type into, and the
   text still selectable so it can be quoted. Neither mode changes the layout, the
   typography, the chrome or what may be written to the file, and that is the line. A
   mode that reflows the page, or hides the bars, or centres the caret, is focus mode
   under another name and is still out.
5. **Check for Updates…** in the application menu asks GitHub for the latest release
   tag and says whether this build is behind it. It is the one network call the
   application makes, and the rule it bends is worth restating so it is not widened
   later. The objection to auto update was never the checking, it was the phoning
   home: a check on launch turns the release server's logs into an audience counter,
   which is telemetry whoever is holding it, and it makes the editor fail or hang on
   a network the user never asked it to use. Nothing happens here unless the user
   picks the menu item, so there is no background traffic, nothing to disable, and
   the failure of a check is a sentence in a dialog the user opened. It does not
   download, install, or restart anything: it reports, and offers to open the
   releases page. **An update check that runs by itself, on a timer or at launch, is
   the thing that was ruled out, and adding one is not a small change to this.**

---

## 2. Stack

| Layer | Technology |
|---|---|
| Shell | Tauri 2 (Rust) |
| Bundler | Vite |
| Language | TypeScript (strict mode) |
| UI | Plain TypeScript. No framework. |
| Editor engine | ProseMirror |
| Markdown | remark through Milkdown, or `prosemirror-markdown` |
| Code blocks | CodeMirror 6 inside a ProseMirror NodeView |
| Tests | Vitest |

**Do not add a UI framework.** The scaffold is the Vanilla template. Keep it that way.
ProseMirror owns the DOM of the editor. A framework re-render destroys the editor view
and causes defects that are hard to find. The application chrome is small. Plain DOM
code is enough for it.

**Do not add a CSS framework.** The themes are hand written CSS files. This is by
design. Typora themes are also only CSS.

**The writing fonts come with the application.** Literata, Lora, Newsreader, Source
Serif 4, Inter, iA Writer Quattro and JetBrains Mono live in `src/themes/fonts/`, as subset variable
woff2 where the family has one. The font setting used to name faces the system was
expected to have, which is true on macOS and false on Linux, where every serif choice
fell back to the same face and the setting quietly did nothing. Every font offered now
resolves to something real on every platform. All seven are under the SIL Open Font
License, whose one obligation is that the licence ships with the font: the text sits
beside the files. A new face has to clear the same bar, licence included.

---

## 3. Commands

All JavaScript commands use **pnpm**.

```bash
pnpm install              # install the JavaScript dependencies
pnpm dev                  # Vite only, in a browser, no file access
pnpm tauri dev            # the full application, with file access
pnpm tauri build          # make the release binary
pnpm typecheck            # tsc --noEmit
pnpm test                 # all Vitest tests
pnpm test:roundtrip       # the Markdown round trip suite only
```

```bash
cd src-tauri
cargo fmt                 # format the Rust code
cargo clippy -- -D warnings
cargo test
```

Run `pnpm typecheck` and `pnpm test` before you report a task as complete.

The scaffold does not include the `typecheck`, `test`, and `test:roundtrip` scripts. Add
them to `package.json` in the first task that needs them.

---

## 4. Clean Up the Scaffold First

`create-tauri-app` leaves demonstration code in the repository. Remove it before you
build a feature.

| File | Action |
|---|---|
| `src/main.ts` | Delete the `greet` form code. Keep the entry point. |
| `index.html` | Delete the logo markup and the demonstration form. |
| `src/styles.css` | Delete it. The themes replace it. See section 5. |
| `src/assets/` | Delete the template logos. |
| `src-tauri/src/lib.rs` | Delete the `greet` command. Keep `run()`. |
| `src-tauri/tauri.conf.json` | Keep native decorations. Set the window size. See section 7. |

Do this once. Do not leave the demonstration code beside real code.

---

## 5. Repository Layout

This is the target layout. The scaffold does not have it yet. Build it as you go.

```
PaperV2/
  package.json
  pnpm-lock.yaml           pnpm only. Never commit package-lock.json.
  vite.config.ts
  tsconfig.json
  index.html

  src/
    main.ts                application entry point
    editor/
      schema.ts            the ProseMirror schema. The single source of node types.
      parser.ts            Markdown text -> ProseMirror document
      serializer.ts        ProseMirror document -> Markdown text
      inputrules.ts        the live syntax rules, for example "# " -> heading
      keymap.ts            the key bindings
      editor.ts            builds and holds the EditorView
      plugins/
        markers.ts         shows the syntax markers at the caret. Decorations only.
        placeholder.ts     the empty document hint
      nodeviews/
        codeblock.ts       the CodeMirror 6 NodeView
        image.ts           the image NodeView
    file/
      bridge.ts            the invoke() calls to Rust. The only file that calls invoke.
      state.ts             the current path, the dirty flag, the mtime
    settings/
      state.ts             the settings model, defaults, defensive parsing
    ui/
      titlebar.ts          the document name in the native title bar area
      settings.ts          the settings sheet
      findbar.ts           find and replace
      statusbar.ts         the word count and the file state
    themes/
      base.css             the layout and the editor structure
      light.css            the light theme
      dark.css             the dark theme
      fonts.css            the @font-face rules for the bundled faces
      fonts/               the font files, and the licence each one ships under

  src-tauri/
    Cargo.toml             crate paperv2, library paperv2_lib
    tauri.conf.json        the window configuration and the bundle configuration
    capabilities/default.json   the permissions. See section 7.
    src/
      main.rs              calls paperv2_lib::run(). Do not add logic here.
      lib.rs               registers the commands, the menu and the plugins
      menu.rs              the native menu bar. Emits ids, runs nothing.
      commands/
        fs.rs              read_file, write_file_atomic
        dialog.rs          open_dialog, save_as_dialog
        settings.rs        read_settings, write_settings
        window.rs          new_window, initial_path, close_all_windows
        chrome.rs          titlebar_metrics, measured from AppKit
        watch.rs           the external file change watcher

  tests/
    roundtrip/
      corpus/              approximately 50 real .md files
      roundtrip.test.ts    the round trip suite. See section 6.
    editor/
      inputrules.test.ts   the live syntax rules, driven through the real view
      markers.test.ts      the marker decorations
      editable.test.ts     guards that every empty block stays typeable
    settings/
      state.test.ts        the defensive settings parsing
```

---

## 6. The Round Trip Rule

**This is the most important rule in the repository.**

The Markdown text on disk is the source of truth. The ProseMirror document is a view of
that text. Every parse and serialize cycle must be stable:

```
parse(serialize(parse(text))) === parse(text)
```

And for the corpus files, the stronger rule applies:

```
serialize(parse(text)) === text
```

### Fixed Serializer Style

Do not change these values. The corpus depends on them.

| Element | Style |
|---|---|
| Headings | ATX (`# Title`). Never setext. |
| Emphasis | `*text*` |
| Strong | `**text**` |
| Bullet list | `- item` |
| Ordered list | `1. item`, and the numbers increase |
| Code fence | Three backticks, with the language name |
| Thematic break | `---` |
| Link | Inline `[text](url)`. Never reference style. |
| Line ends | LF in memory. The original style on save. |
| Hard break | Backslash at the line end, not two spaces. |
| Soft wrap | The author's own line breaks inside a paragraph are written back where they were. A paragraph is never rewrapped and never joined. |
| Table row | `\| cell \| cell \|`, one space inside each pipe |
| Table rule | `\|---\|---\|`, no padding, colons only where a column is aligned |

### Rules for the Test Suite

1. Never delete a corpus file to make a test pass.
2. Never loosen an assertion to make a test pass. Fix the parser or the serializer.
3. Add a corpus file for every parse defect you fix.
4. `pnpm test:roundtrip` must pass before any commit that touches `src/editor/`.

---

## 7. Tauri 2 Notes

### Permissions Are Explicit

Tauri 2 blocks everything by default. A command fails at runtime if it has no permission
entry.

If a plugin call fails and the error mentions "not allowed" or "forbidden", add the
permission to `src-tauri/capabilities/default.json`. Do not work around it in the
frontend.

### Opening Files From The System

`bundle.fileAssociations` in `tauri.conf.json` declares the Markdown types, and
`commands/window.rs::open_paths` handles the request.

- **The association only exists in a bundled app.** `pnpm tauri dev` runs an unbundled
  binary that Launch Services cannot see, so a double click will never reach it. Test
  with `pnpm tauri build --bundles app`, then `lsregister -f` the result.
- macOS delivers the file as `RunEvent::Opened`, not as an argument. Windows and Linux
  use `argv`. Both paths are wired in `lib.rs`.
- At launch the event arrives **before** the window from the config exists, so the path
  is stashed under the `main` label for that window to claim. Opening a second window
  for it would leave an empty one beside the document.
- `pnpm tauri build` with the default targets fails on the DMG step in a sandbox.
  `--bundles app` is enough for testing the association.

### Plugins in Use

- `tauri-plugin-dialog` for the open and save dialogs
- The `notify` crate for the external file change watcher, when it is built

The file read and write are our own commands on `std::fs` in `src-tauri/src/commands/`,
not `tauri-plugin-fs`. All of it runs in Rust, so the plugin would only add a
permission surface the frontend never uses.

Do not add more Tauri plugins without a reason. Each one adds size and permissions.

Add a Rust dependency with `cargo add` inside `src-tauri`. Add the matching JavaScript
package with `pnpm add`. The two versions must match.

### IPC

- Call Rust with `invoke` from `@tauri-apps/api/core`.
- Send events from Rust with `emit`. Receive them with `listen`.
- **All `invoke` calls live in `src/file/bridge.ts`.** No other file calls `invoke`.
  This keeps the browser only mode (`pnpm dev`) working with a stub bridge.
- Do not use the `window.__TAURI__` global. `withGlobalTauri` is off.

### The Linux Webview

Tauri uses WebKitGTK on Linux. Its `contenteditable` support is weaker than Chromium.
Expect defects in the caret position, the selection, and the IME input.

- Test any change to `src/editor/` on Linux before you call it complete.
- Do not use a browser only API without a check. Examples: the `Highlight` API, some
  `Selection` methods, and newer CSS features.
- If a feature fails on WebKitGTK only, write the workaround with a comment that names
  the engine.

### The Window Chrome Is Native

The window keeps its system frame. `decorations` is `true`, with
`titleBarStyle: "Overlay"` and `hiddenTitle: true` for macOS. The buttons, the rounded
corners, the shadow and the resize edges all come from the system. Do not draw them.

**Do not guess the chrome measurements.** Two published figures are wrong on current
macOS: the title bar band is 32pt, not 28, and the traffic lights are 14pt wide ending
at 69pt, not 12pt ending at 72. `commands/chrome.rs` reads both from AppKit and
`ui/titlebar.ts` applies them. The values in the stylesheet are fallbacks for the moment
before the measurement lands.

**Every window needs the capability.** `capabilities/default.json` lists
`["main", "doc-*"]`. A new window whose label does not match gets no permissions and
fails at runtime.

- `src/ui/titlebar.ts` only paints the document name into the transparent title bar
  area. On macOS that bar reserves room for the traffic lights.
- The drag area needs `data-tauri-drag-region`.
- Any button inside the drag area needs `-webkit-app-region: no-drag` in its CSS.

### The Menu Bar

The menu is native, built in `src-tauri/src/menu.rs`. Rust owns no actions: a click
emits the item id on the `menu` event and the frontend runs it, through the single
`runCommand` switch in `src/main.ts`.

- **The menu bar is shared by every window, so an item is emitted only to the focused
  one.** A plain `emit` would broadcast, and one press of Save would write every open
  document. Use `emit_to` with the focused window's label.

- A menu accelerator is consumed before the webview sees it, so any shortcut in the
  menu must work through `runCommand`, not only through the ProseMirror keymap.
- `pnpm dev` in a browser has no menu, so `src/main.ts` registers the same shortcuts
  on `keydown` when `hasFileAccess()` is false. Keep the two lists in step.

---

## 8. Rules for the Editor Code

1. **Never change the document outside a transaction.** Use `view.dispatch(tr)` only.
   Never edit the DOM of the editor by hand.

2. **Markers are decorations, never text.** `src/editor/plugins/markers.ts` shows the
   syntax markers with widget decorations. If a change to that file changes the
   document, the change is wrong.

3. **Compute the marker decorations for the active node only.** Do not scan the whole
   document on each transaction. A large file becomes slow.

4. **One transaction for each user action.** An input rule removes the characters and
   applies the mark. Both steps go in one transaction, so one undo press reverses both.

5. **The clipboard speaks Markdown, in both directions.** Text pasted in is
   parsed, and text copied out is serialized, so a heading keeps its hashes on
   the way to another application. `clipboardTextParser` alone is not enough:
   a clipboard that also carries HTML never reaches it, and the HTML a code
   editor writes is syntax colouring wrapped around Markdown source. So
   `handlePaste` reads the plain text first and prefers it whenever it carries
   block syntax. Prose without that syntax still goes the HTML route, which is
   what keeps the formatting of an article copied from a web page.

6. **`schema.ts` is the single source of truth for node types.** If you add a node, you
   must update the parser, the serializer, and the corpus in the same change.

7. **Do not add a node type without a request.** See section 1.

---

## 9. Rules for the File Code

1. Read files as UTF-8. Remove the BOM if it is present.
2. Change CRLF to LF in memory. Write back the original style.
3. **Write with the atomic command only.** Write to a temporary file, then rename it.
   Never write the target file directly. This prevents data loss.
4. Store the mtime after each read and each write. Compare it before a write. If it is
   different, the file changed on disk. Ask the user.
5. If the file changes on disk and the buffer is clean, reload it without a question.
   If the buffer is dirty, ask the user.
6. Keep the dirty flag in `src/file/state.ts`. Nothing else owns it.

---

## 10. Code Style

- TypeScript strict mode is on. Do not use `any`. Do not use `@ts-ignore`.
- Prefer named exports. Avoid default exports.
- Keep functions short. One function does one thing.
- Write comments for the reason, not for the action. The code shows the action.
- Rust: `cargo fmt` and `cargo clippy -- -D warnings` must be clean.
- Do not add a dependency without a strong reason. This project stays small.

---

## 11. Before You Report Work as Complete

1. `pnpm typecheck` passes.
2. `pnpm test` passes, and the round trip suite is included.
3. `cargo clippy -- -D warnings` is clean, if you changed Rust code.
4. You tested the change in `pnpm tauri dev`, not only in the browser.
5. You did not add a dependency, a node type, or a feature from the out of scope list.
6. You did not create a `package-lock.json` or a `yarn.lock`.