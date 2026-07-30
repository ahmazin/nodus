# Stability & versioning

This is the canonical statement of what you may rely on across Nodus releases, and how the public
API changes. It governs every `@ahmazin/*` package. The consumer-facing summary lives on the site at
[`/docs/versioning`](../apps/site/src/pages/docs/versioning.md); the release mechanics live in
[`RELEASING.md`](../RELEASING.md).

> **Every `@ahmazin/*` package is pre-1.0 (0.x). The public API may change before 1.0.**

## Semver under 0.x

Nodus follows [semantic versioning](https://semver.org), but the pre-1.0 (`0.MINOR.PATCH`) rules
shift the break boundary down one segment. Until a package reaches `1.0.0`:

| Bump | Example | Contract |
|---|---|---|
| **minor** | `0.4.2 → 0.5.0` | **May break.** Removed or changed public API, changed canonical bytes, behavioral changes. Read the CHANGELOG before upgrading. |
| **patch** | `0.4.2 → 0.4.3` | **Additive or fixes only.** New public API, bug fixes, docs. Never removes or changes existing public API, never changes canonical bytes. |

So within a `0.MINOR` line, patches are safe to take; crossing a minor is the upgrade you review. At
`1.0.0` this shifts up to normal semver (major = break, minor = additive, patch = fix).

## What "public API" means

The contract covers exactly what a package exports from its barrel (`@ahmazin/core`, `@ahmazin/react`,
each preset/layout/plugin). If you can import it by name from the package root, it is public and
carries the promise above.

- **`@internal` symbols carry no stability promise.** Anything tagged `@internal` in its TSDoc — or
  reachable only through a deep import path (`@ahmazin/core/src/...`) rather than the barrel — may
  change or vanish in any release, including a patch. Do not build on it.
- Type-level surface counts too: a type reachable from a public function signature is itself public.

Under Hyrum's Law everything observable eventually becomes a de-facto contract, so the surface is
kept deliberately narrow before 1.0 — narrowing it later is expensive; narrowing it now is free.

## Canonical serialization bytes are a breaking contract

`@ahmazin/core` serializes diagrams to **canonical** `*.nodus.json` — stable key order, normalized
numbers — so a diagram is a text artifact that diffs, reviews, and merges cleanly. That byte format
is the product's moat, so it is a **versioned contract**:

- **A change that alters canonical output is semver-breaking** (a minor bump under 0.x). The reason
  is fleet-wide: a byte change ships in an otherwise innocuous release, and then every adopter's
  committed diagrams fail `nodus fmt --check` in CI on files nobody touched.
- Byte-affecting changes land with regenerated golden fixtures and a changeset in the same PR — see
  [`RELEASING.md`](../RELEASING.md#canonical-byte-changes).
- The format itself (fields, what is and isn't serialized) is documented in
  [the data schema](../apps/site/src/pages/docs/schema.md).

`schemaVersion` migrations are the sanctioned way to evolve the format across a break: an older
library refuses (rather than silently downgrades) a document written by a newer one.

## Deprecation

Public API is removed on a schedule, never yanked out from under you:

1. **Mark it.** The symbol gets a `@deprecated` TSDoc tag that names the **replacement** and the
   **removal target**, so the deprecation is visible on hover in every editor and in the generated
   types:

   ```ts
   /**
    * @deprecated Use {@link setEdgeRouter} instead. Removed in 0.9.
    */
   setRouter(edgeId: Id, router: string): void;
   ```

2. **Keep it working.** A deprecated symbol keeps functioning for **at least one minor line**:
   something deprecated in `0.N` is removed no earlier than `0.(N+1)`. The removal itself is a
   breaking change and lands on a minor bump with a CHANGELOG entry.

Deprecations are also called out in the package CHANGELOG under the release that introduces them.

## See also

- [`RELEASING.md`](../RELEASING.md) — the changesets release flow and the canonical-byte-change rule.
- [`docs/EXTENDING.md`](./EXTENDING.md) — the extension guide (the four registry axes).
- [Data schema](../apps/site/src/pages/docs/schema.md) — the on-disk format these promises protect.
