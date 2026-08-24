# PaperV2

[![CI](https://github.com/UsePaper/PaperV2/actions/workflows/ci.yml/badge.svg)](https://github.com/UsePaper/PaperV2/actions/workflows/ci.yml)

A minimal WYSIWYG Markdown editor for the desktop. One window, one file, one
editing pane. You type Markdown, the syntax hides itself, and the formatted
result stays in place. There is no preview pane.

## Running it

```bash
pnpm install
pnpm tauri dev
```

`pnpm dev` runs the editor in a plain browser. File access is stubbed there, so
use `pnpm tauri dev` for anything that touches disk.

## From the terminal

```bash
paper notes.md
```

The file opens in Paper. One that does not exist yet is created empty, so the
same command starts a new note; a file already open is raised rather than
opened twice. With no file, `paper` brings Paper forward.

Install it from **Paper → Install Command Line Tool…**. That links the command
into `/usr/local/bin`, which belongs to root, so macOS asks for your password;
the sheet is the system's own and Paper never sees what you type. Remove it
again with `rm /usr/local/bin/paper`.

The command is a shell script that hands the paths to Launch Services, which is
the route a double click in Finder takes: a running Paper takes the file and no
second copy starts. It ships inside the bundle, so the menu item only makes a
link, and to put that link somewhere else you can make it yourself:

```bash
ln -s /Applications/Paper.app/Contents/Resources/paper ~/.local/bin/paper
```

From a checkout, link `scripts/paper` instead. It is the same file, and it falls
back to whichever Paper is installed.

macOS only. Elsewhere the binary takes its files as arguments already, so
`paperv2 notes.md` is the whole of it.

## Checks

```bash
pnpm typecheck
pnpm test
pnpm test:roundtrip
```

```bash
cd src-tauri && cargo fmt && cargo clippy -- -D warnings
```

## Keys

| Key | Action |
|---|---|
| `Mod-O` | Open a file |
| `Mod-S` | Save |
| `Mod-Shift-S` | Save as |
| `Mod-/` | Toggle the raw Markdown source |
| `Mod-B` / `Mod-I` / `Mod-E` | Strong, emphasis, code |
| `Mod-Shift-1` … `Mod-Shift-6` | Heading levels |
| `Mod-Shift-0` | Back to a paragraph |

## How it holds together

The Markdown text on disk is the source of truth; the ProseMirror document is a
view of it. `tests/roundtrip` holds that line: every corpus file must serialize
back to itself byte for byte. See `CLAUDE.md` for the rules that govern changes
here.

## Licence

MIT. See [LICENSE](LICENSE).

Bundled fonts keep their own licences, which sit beside them in
`src/themes/fonts/`. All of them are the SIL Open Font License.

## Releasing

See [docs/RELEASING.md](docs/RELEASING.md).
