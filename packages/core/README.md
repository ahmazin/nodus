# @nodus/core

The Nodus diagram engine — an Excalidraw-class, **headless** editor engine for TypeScript with
**zero framework or DOM dependencies**. It owns the full pipeline: *model → layout → render →
interact* on a Canvas-2D surface, and renders identically in the browser (DOM canvas) and headless
(Skia via `@napi-rs/canvas`). All type-specific behavior lives in engine-owned **registries**, so you
extend the engine with data and objects rather than by forking it.

`@nodus/core` is the substrate. Node/edge types, layouts, and themes ship as separate packages
(`@nodus/preset-*`, `@nodus/layout-*`, `@nodus/icons-cloud`).

## Install

```bash
pnpm add @nodus/core
```

Pair it with a React binding (`@nodus/react`) for the browser, or drive it headlessly for export,
tests, and CI.

## Quickstart

A bare `Editor` comes with built-in `rect` / `line` / `group` types registered, so you can build a
graph immediately:

```ts
import { Editor } from '@nodus/core';

const editor = new Editor();

const a = editor.createNode({ type: 'rect', x: 40, y: 40, label: 'Web' });
const b = editor.createNode({ type: 'rect', x: 320, y: 160, label: 'DB' });

// edges own their endpoints; ports are named (rect exposes 'in' / 'out')
editor.connect(
  { kind: 'node', nodeId: a, portId: 'out' },
  { kind: 'node', nodeId: b, portId: 'in' },
);

editor.undo(); // one entry — removes the edge
editor.redo();
```

Auto-layout is pluggable — register an engine, then run it (a whole layout collapses into one undo
entry):

```ts
import { dagreLayout } from '@nodus/layout-dagre';

editor.registerLayout(dagreLayout);
await editor.layout('dagre', { direction: 'LR' });
```

Serialize to a canonical, diff-friendly snapshot and back:

```ts
const snapshot = editor.toJSON(); // deterministic key order, normalized numbers
editor.loadSnapshot(snapshot);
```

## Architecture

A reactive record store (the single mutation channel) → a retained `RenderItem` scene index (an
rbush R-tree) → a layered Canvas-2D renderer, with all type-specific behavior in registries. The
`Editor` is the façade that wires these together and hosts the tool manager, camera, and history.

### One mutation channel — `store.apply(changes, { capture })`

Every change goes through the store. `apply` computes inverse deltas, updates per-record signal
atoms atomically, and notifies the scene index, history, and event bus through one path. Editor
helpers (`createNode`, `connect`, `setStyle`, `updateRecord`, …) are thin wrappers over it — prefer
them over mutating records in place, so undo, the scene index, and events stay in sync.

`CapturePolicy` = `'immediately' | 'later' | 'never'` controls undo grouping. A discrete action uses
`'immediately'` (one undo entry). A continuous gesture (slider drag, color scrub) applies with
`capture: 'later'` on each change, then calls `editor.mark()` once on release — collapsing the whole
gesture into a single undo entry.

- **Edges own their endpoints** (`from` / `to` on the edge record); back-refs and routed polylines
  are derived. Moving a node reflows its edges; deleting a node cascades its edges.
- **Three distinct version counters**, kept separate: `record.version` (diff/cache keys), the
  scene-index `version` atom (render invalidation), and `schemaVersion` (serialization migration).

### Signals substrate — `.get()` subscribes, `.peek()` does not

A tiny dependency-free reactive engine (`atom` / `computed` / `effect` / `reaction` / `transact`).
The one rule everything depends on: reading `.get()` inside a reactive context registers a
dependency; `.peek()` reads without subscribing. `transact` batches writes and **rolls all of them
back** if the body throws.

### Scene index & hit-testing

`SceneIndex` keeps a retained `RenderItem` per record in an rbush R-tree. It drives viewport
culling, marquee, paint order (edges under nodes, then z), and **two-phase hit-testing**: an R-tree
broad phase, then a per-geometry narrow phase. Tolerances are in **world units**, so callers pass
`px / camera.z`.

### Rendering & theming

The renderer draws through a `Ctx2D` abstraction, so the same code paints to a DOM canvas or a Skia
canvas. `editor.paintRegion(ctx, region, ratio, opts)` is the export/preview entry (used by PNG
export and headless render). Themes are **data**: `resolveTokens(theme, { state, overlay, focused },
type)` layers slices at draw time (`base < byType < states < overlays < focus`). Swapping the theme
atom re-skins every node in one frame; `Theme.appearance` (`'light' | 'dark'`) is the single source
of truth for light/dark, so DOM chrome and the canvas re-skin together. `defaultTheme` /
`defaultLightTheme` ship in core.

## The four extension axes

Type-specific behavior is registered on the editor — never a `switch`-on-type in the core:

1. **Node / edge types** — a `NodeUtil` object (`getGeometry` is the single source for
   hit-test/bounds/cull, plus `getPorts` and `draw`); `editor.registerNodeType(util)`.
2. **Routers** — resolve `edge.props.router` (`straight` / `orthogonal` / `bezier`) to a function
   that turns endpoints into a polyline; unset falls back to the util's default.
3. **Layouts** — `editor.registerLayout(engine)` then `await editor.layout(id, opts)`. Adapters live
   in `@nodus/layout-{dagre,tree,force,elk}`.
4. **Plugins** — `editor.use(plugin)`; a plugin gets an `EngineHost` to register
   types/tools/themes/layouts/overlays and to hook the store and event bus.

## Git-native serialization

Serialization is deterministic and canonical — stable key order, normalized numbers — so diagrams
stored as `*.nodus.json` produce clean, reviewable diffs. `serializeRecords` / `restore` are the
programmatic entry points; the `nodus` CLI (in `@nodus/cli`) wraps them with `fmt` / `render` /
`diff`. When changing serialization, keep the output canonical or the diff CI and `canonical.test.ts`
will fail.

## License

MIT.
