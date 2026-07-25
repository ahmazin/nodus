---
layout: ../../layouts/DocsLayout.astro
title: Concepts
description: The architecture — one mutation channel, a signals substrate, a retained scene index, and four extension axes.
---

Nodus is a reactive record store (the single mutation channel) → a retained `RenderItem` scene index
(an rbush R-tree) → a layered Canvas-2D renderer, with all type-specific behavior in engine-owned
**registries**. The `Editor` is the façade that wires these together and hosts the tool manager, camera,
and history.

## One mutation channel

Every change goes through `store.apply(changes, { capture })`. It computes inverse deltas, updates
per-record signal atoms atomically, and notifies the scene index, history, and event bus through one
path. Editor helpers (`createNode`, `setStyle`, `setEdgeRouter`, `updateRecord`, …) are thin wrappers
over it.

`CapturePolicy` controls undo grouping:

| Policy          | Use for                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `'immediately'` | A discrete action — one undo entry.                                      |
| `'later'`       | Each `onChange` of a continuous gesture; call `editor.mark()` on release |
| `'never'`       | Changes that should not participate in undo.                            |

A continuous gesture (slider drag, color scrub) applies with `capture: 'later'` on each change, then
`editor.mark()` once on release — collapsing the whole gesture into a single undo entry.

**Edges own their endpoints** (`from`/`to` on the edge record); back-refs and routed polylines are
derived. Moving a node reflows its edges; deleting a node cascades its edges.

## Signals substrate

A tiny dependency-free reactive engine — `atom` / `computed` / `effect` / `reaction` / `transact`. The
rule everything depends on:

- Reading **`.get()`** inside a reactive context **registers a dependency**.
- **`.peek()`** reads **without** subscribing.
- `transact` batches writes and **rolls back the atom values** if the body throws. The rollback is
  values-only — it cannot un-notify listeners or rewind external side effects, which is why
  `store.apply` refuses to run inside a raw `transact()`. To group several edits into one undo
  entry, use the blessed **`editor.transaction(fn)`** instead.

In React, `useValue(fn)` re-runs `fn` and re-renders when any signal it read via `.get()` changes. A
panel that must react to document mutations reads `editor.sceneIndex.version.get()` inside `useValue`.

## Scene index & hit-testing

A retained `RenderItem` per record lives in an rbush R-tree. It drives viewport culling, marquee, paint
order (edges under nodes, then z), and **two-phase hit-testing**: an R-tree broad phase, then a
per-geometry narrow phase. Tolerances are in **world units**, so callers pass `px / camera.z`.

## The four extension axes

Type-specific behavior is data/objects registered on the editor — never a `switch`-on-type in the core:

- **Node / edge types** — a `NodeUtil` object (`getGeometry` is the single source for
  hit-test/bounds/cull, plus `getPorts` and `draw`); `editor.registerNodeType(util)`.
- **Routers** — resolve `edge.props.router` (`straight` / `orthogonal` / `bezier`) to a function that
  turns endpoints into a polyline.
- **Layouts** — `editor.registerLayout(engine)`, then `await editor.layout('dagre', { direction: 'LR' })`.
  Adapters: `@nodus/layout-{dagre,tree,force,elk}`.
- **Plugins** — `editor.use(plugin)`; a plugin registers types/tools/themes/layouts/overlays and can
  hook the store & event bus.

## Theming

Themes are **data**. `resolveTokens(theme, { state, overlay, focused }, type)` layers slices at draw
time: `base < byType[type] < states[state] < overlays[overlay] < focus`. Swapping the theme atom
re-skins every node in one frame.

## Git-native serialization

`@nodus/core` has **deterministic, canonical** serialization: the same diagram produces byte-identical
output, so diagrams stored as `*.nodus.json` get clean, line-by-line diffs, blame, review, and merge.
See the **[CLI →](/docs/cli)** for `fmt` / `render` / `diff` and diagrams-in-CI.
