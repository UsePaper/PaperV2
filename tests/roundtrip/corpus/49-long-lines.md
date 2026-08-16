The serializer never wraps, so a paragraph is one line however long it runs, and this sentence keeps going well past the width of any editor window in order to prove exactly that, because a wrapped line would come back joined and the round trip would fail on the very first comparison.

A long target: [the release notes for a version with a long name](https://example.com/projects/widget/releases/2024/03/version-1-2-0-with-a-very-long-slug#the-import-section).

A long code span: `widget count --json --limit 100 --order created --cursor abc123 notes.txt`.
