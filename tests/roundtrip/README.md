Every file in this folder is written in the canonical output style of
`src/editor/serializer.ts`. The suite asserts `serialize(parse(text)) === text`,
so a file that is merely valid Markdown is not enough: it must be the exact text
the serializer would write.

Files `01` to `16` take one element each. From `17` on they are whole documents
of the kind people actually keep: readmes, changelogs, notes, references. Real
documents combine things, and combinations are where the round trip breaks.

Things worth knowing before you add a file:

- A paragraph keeps the line breaks it was written with. The serializer never
  wraps a paragraph and never joins one: where the author ended a line, the
  file ends a line. Otherwise saving a file would rewrap every paragraph in it
  and turn a one word edit into a whole file diff.
- Text escapes are conservative. A bare `*` in prose is written back as `\*`,
  and so is a backtick that is not opening a code span.
- Brackets in a link or image target are escaped: `./a(1).md` is written
  `./a\(1\).md`. It reparses to the same target.
- An ordered list pads its markers so that continuation lines stay in one
  column, so a list running past nine opens with a leading space on the
  single digit markers. See `28-ordered-list-numbering.md`.

If a file you believe is canonical fails, check the second assertion first. When
`serialize(parse(text)) === text` fails but the document survives a second parse
unchanged, the serializer is canonicalising your text and the file is what needs
fixing. When both fail, the parser or the serializer is wrong. Fix the code, not
the assertion.

Add a file here for every parse defect that gets fixed.
