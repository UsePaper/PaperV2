# Widget

A small tool for counting widgets in a file.

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](https://example.com/ci)

## Install

```sh
npm install widget
```

## Usage

Run it against a file:

```sh
widget count notes.txt
```

The output is one line for every widget it found.

## Options

- `--quiet` hides the summary
- `--json` prints machine readable output
- `--limit N` stops after `N` widgets

## Licence

MIT. See [LICENCE](./LICENCE) for the text.
