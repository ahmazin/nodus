---
layout: ../../layouts/DocsLayout.astro
title: CLI · nodus
description: Canonicalize, render, and semantically diff diagram files — the tooling that makes diagrams code-reviewable.
---

Because `@nodus-dev/core` serializes deterministically, diagrams are just `*.nodus.json` text files. The
`nodus` CLI is what turns that into a git-native workflow — **diagrams you can code-review.**

## Running it

The CLI ships as `@nodus-dev/cli`. Inside this repo it runs from source:

```bash
pnpm nodus <command> [...]     # e.g. pnpm nodus fmt diagrams/*.nodus.json
```

```
nodus fmt <file...> [--check]                         Canonicalize diagram files (verify only, with --check)
nodus render <file> [--out f.png] [--preset infra|draw|diagrams] [--scale n] [--no-bg] [--grid]
nodus diff <a> <b> [--json]                           Semantic diff between two diagram files
nodus drift <...>                                      Reconcile a diagram against its source of truth
```

## fmt

Rewrites diagram files into **canonical** form — stable key order, normalized numbers — so version
control produces clean, minimal diffs. With `--check` it writes nothing and exits non-zero if any file
is not already canonical, which is the CI gate:

```bash
pnpm nodus fmt "diagrams/**/*.nodus.json"          # canonicalize in place
pnpm nodus fmt "diagrams/**/*.nodus.json" --check  # verify only (CI)
```

## render

Rasterizes a diagram to PNG headlessly (Skia — no browser), using the same renderer the editor uses:

```bash
pnpm nodus render architecture.nodus.json --out architecture.png --preset infra --scale 2
```

Flags: `--out <file>`, `--preset infra|draw|diagrams`, `--scale <n>`, `--no-bg`, `--grid`.

## diff

A **semantic** diff between two diagram files — reports which nodes and edges changed, not byte noise:

```bash
pnpm nodus diff HEAD~1:architecture.nodus.json architecture.nodus.json   # working tree vs a git rev
pnpm nodus diff a.nodus.json b.nodus.json --json                         # machine-readable
```

## Diagrams in CI

`.github/workflows/diagrams.yml` enforces canonical form on any PR that touches `*.nodus.json`
(`nodus fmt --check`) and posts rendered previews to the PR — so a diagram change reviews exactly like a
code change. Keep serialization output canonical or the diff CI (and `canonical.test.ts`) will fail.
