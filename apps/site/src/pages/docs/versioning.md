---
layout: ../../layouts/DocsLayout.astro
title: Versioning & stability
description: What you can rely on across Nodus releases — 0.x semver rules, the public-API boundary, deprecations, and the canonical-byte contract.
---

Every `@nodus/*` package is **pre-1.0 (0.x)**. The public API may change before 1.0 — this page is
what you can rely on in the meantime, and how to read a version bump.

## Semver under 0.x

Nodus follows [semver](https://semver.org), with the pre-1.0 break boundary shifted down one segment.
Until a package hits `1.0.0`:

| Bump | Example | What it means for you |
|---|---|---|
| **minor** | `0.4.2 → 0.5.0` | **May break.** Removed/changed public API, changed canonical bytes, behavioral change. Read the CHANGELOG before upgrading. |
| **patch** | `0.4.2 → 0.4.3` | **Additive or fixes only.** New API, bug fixes, docs — never removes or changes existing public API, never changes canonical bytes. |

Take patches freely within a `0.MINOR` line; review the CHANGELOG when you cross a minor. At `1.0.0`
this becomes normal semver.

## What counts as public

The promise covers exactly what a package exports from its root (`@nodus/core`, `@nodus/react`, each
preset/layout/plugin). If you import it by name from the package, it is public.

- **`@internal` symbols carry no promise** — nor does anything reached through a deep
  `@nodus/core/src/...` import instead of the barrel. Those can change in any release. Build on the
  barrel.
- A type reachable from a public function signature is itself public.

## Deprecations

Public API is removed on a schedule. A symbol on its way out gets a `@deprecated` TSDoc tag naming
the **replacement** and the **removal target**, visible on hover in your editor:

```ts
/** @deprecated Use setEdgeRouter instead. Removed in 0.9. */
setRouter(edgeId: Id, router: string): void;
```

A deprecated symbol keeps working for at least one minor line: deprecated in `0.N`, removed no
earlier than `0.(N+1)`. Removals land on a minor bump and are called out in the CHANGELOG.

## The canonical-byte contract

`@nodus/core` writes diagrams as **canonical** `*.nodus.json` — stable key order, normalized numbers
— so they diff and review cleanly. That byte format is a versioned contract: **a change to canonical
output is treated as breaking** (a minor bump). Otherwise a stray byte change in a patch would make
every committed diagram in your repo fail `nodus fmt --check` in CI on files you never touched. The
format itself is documented in the [data schema](/docs/schema).

## Per-package CHANGELOGs

Each published package ships a `CHANGELOG.md` so you can assess upgrade risk package-by-package rather
than for the whole monorepo at once.
