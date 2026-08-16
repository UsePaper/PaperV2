# Getting started

This walks through the first run, end to end. It should take five minutes.

## Before you begin

You need Node 20 or newer. Check with `node --version`.

## 1. Install

```sh
npm install --global widget
```

If that fails with a permissions error, install it locally instead and run it with `npx`.

## 2. Make a file to count

```sh
printf 'one\ntwo\nthree\n' > widgets.txt
```

## 3. Run the count

```sh
widget count widgets.txt
```

You should see three lines of output and a summary:

```
one
two
three
3 widgets
```

## 4. Try the flags

- `--quiet` drops the summary
- `--json` prints the same result as JSON

> If the summary is missing and you did not pass `--quiet`, the file probably has no trailing newline. That is [a known bug](https://example.com/issues/12).

## Where to go next

Read the [API reference](https://example.com/docs/api), or run `widget --help`.
