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
