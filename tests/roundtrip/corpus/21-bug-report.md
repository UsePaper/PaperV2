# Import drops the last row

## What happens

Importing a file with no trailing newline silently loses the final row.

## Steps

1. Create a file with three rows and no newline at the end.
2. Run `widget import rows.csv`.
3. Count the rows in the result.

## Expected

Three rows are imported.

## Actual

Two rows are imported. The third is discarded without a warning.

## Notes

The reader appears to treat the newline as a terminator rather than a separator:

```python
for line in handle:
    if not line.endswith("\n"):
        continue
    rows.append(parse(line))
```

That `continue` is the bug. It should be `rows.append(parse(line))` regardless.
