---
layout: ../../layouts/DocsLayout.astro
title: Versioning & stability
description: What you can rely on across Nodus releases — the synchronized 0.3.x line, 0.x semver rules, the public-API boundary, deprecations, and the canonical-byte contract.
---

Every `@nodus-dev/*` package is **pre-1.0** and published **in lockstep at one shared version** — the
current line is **`0.3.x`**. The public API may change before 1.0; this page is what you can rely on
in the meantime, and how to read a version bump.

## Synchronized versioning

The packages are designed to be used together, so they ship as a set at one shared version: a single
release bumps every publishable `@nodus-dev/*` package to the same number. There are no independent
per-package version lines.

- **Upgrade them together** — `@nodus-dev/core`, `@nodus-dev/react`, the presets, and the layout
  adapters at the same `0.MINOR`. Mixing lines (e.g. `core@0.3` with `react@0.2`) is unsupported.
- **Internal ranges track the line.** `@nodus-dev/react` and `@nodus-dev/preset-infra` peer-depend on
  `@nodus-dev/core`, and the published range is the current line (`^0.3.0`). Install `@nodus-dev/core`
  alongside them — see [Getting started](/docs).
- **Supported = the latest published minor.** Fixes land on the current `0.MINOR` line; before 1.0
  there is no back-port channel, so upgrade to the latest minor for fixes.

## Semver under 0.x

Nodus follows [semver](https://semver.org), with the pre-1.0 break boundary shifted down one segment.
Until the line hits `1.0.0`:

| Bump | Example | What it means for you |
|---|---|---|
| **minor** | `0.3.0 → 0.4.0` | **May break.** Removed/changed public API, changed canonical bytes, behavioral change. Read the CHANGELOG before upgrading. |
| **patch** | `0.3.0 → 0.3.1` | **Additive or fixes only.** New API, bug fixes, docs — never removes or changes existing public API, never changes canonical bytes. |

Take patches freely within a `0.MINOR` line; review the CHANGELOG when you cross a minor. At `1.0.0`
this becomes normal semver.

## What counts as public

The promise covers exactly what a package exports from its root (`@nodus-dev/core`, `@nodus-dev/react`, each
preset/layout/plugin). If you import it by name from the package, it is public.

- **`@internal` symbols carry no promise** — nor does anything reached through a deep
  `@nodus-dev/core/src/...` import instead of the barrel. Those can change in any release. Build on the
  barrel.
- A type reachable from a public function signature is itself public.

## Deprecations

Public API is removed on a schedule. A symbol on its way out gets a `@deprecated` TSDoc tag naming
the **replacement** and the **removal target**, visible on hover in your editor:

```ts
/** @deprecated Use setEdgeRouter instead. Removed in 0.5. */
setRouter(edgeId: Id, router: string): void;
```

A deprecated symbol keeps working for at least one minor line: deprecated in `0.N`, removed no
earlier than `0.(N+1)`. Removals land on a minor bump and are called out in the CHANGELOG.

## The canonical-byte contract

`@nodus-dev/core` writes diagrams as **canonical** `*.nodus.json` — stable key order, normalized numbers
— so they diff and review cleanly. That byte format is a versioned contract: **a change to canonical
output is treated as breaking** (a minor bump). Otherwise a stray byte change in a patch would make
every committed diagram in your repo fail `nodus fmt --check` in CI on files you never touched. The
format itself is documented in the [data schema](/docs/schema).

## Per-package CHANGELOGs

Each published package ships its own `CHANGELOG.md` with the notes for what changed in that package.
Because every package moves on the same shared version, a given version number means the same release
across the whole set — the per-package CHANGELOGs just tell you *what* changed where, not a different
version line to track.
