# Extending Nodus

Nodus is built to be customized. All type-specific behavior lives in engine-owned **registries**, so
you extend the engine by registering data and objects — never by forking the core or adding a
`switch`-on-type. There are **four extension axes**:

1. [Node / edge types](#1-node--edge-types) — teach the engine a new shape or connector.
2. [Routers](#2-routers) — control how an edge turns endpoints into a polyline.
3. [Layouts](#3-layouts) — plug in an auto-layout engine.
4. [Plugins](#4-plugins) — bundle types, tools, themes, overlays, and store/event hooks behind one
   install call.

Everything here rides on `@ahmazin/core`'s public API. The reference implementations named below ship
in this monorepo — read their source (they are small) when you want a complete, working example.

> **Stability: pre-1.0 (0.x) — the public API may change before 1.0.**

---

## The one rule: route every change through the store

Before the axes, the rule they all depend on. Every document change goes through a single channel —
`store.apply(changes, { capture })` — or one of the editor helpers built on it (`createNode`,
`connect`, `setStyle`, `updateRecord`, `addRecords`, `setEdgeRouter`, …). Do **not** mutate a record
in place: `apply` computes inverse deltas, updates the per-record signal atoms atomically, and
notifies the scene index, history, and event bus through one path. Mutating a record directly skips
all of that, and undo / rendering / events silently fall out of sync.

```ts
// Good — one undo entry, index + events updated:
editor.updateRecord(nodeId, { label: 'renamed' });

// Bad — bypasses the channel; undo and the renderer never learn about it:
node.label = 'renamed';
```

### Grouping continuous gestures — `CapturePolicy`

`apply` takes a `capture` policy that controls undo grouping:

- `'immediately'` — a discrete action; one undo entry (the default for the editor helpers).
- `'later'` — a step in a continuous gesture (a slider drag, a colour scrub, a freehand stroke).
  Apply with `capture: 'later'` on each change, then call `editor.mark()` **once** on release/blur.
  The whole gesture collapses into a single undo entry.
- `'never'` — do not record history for this change.

`@ahmazin/plugin-freehand`'s `FreehandTool` is the canonical example: it creates the stroke node with
`{ capture: 'later' }`, updates it on every pointer-move with `{ capture: 'later' }`, and calls
`editor.mark()` on pointer-up — so an entire sketched stroke is one undo.

---

## 1. Node / edge types

A node type is a single `NodeUtil` object. Its `getGeometry` is the **one declarative source** the
engine uses for bounds, viewport culling, hit-testing, and snapping — you write geometry once, and
everything else derives from it.

```ts
export interface NodeUtil<P extends Record<string, unknown> = Record<string, unknown>> {
  readonly type: string;                        // unique key, e.g. 'cylinder'
  getDefaultProps(): P;
  getDefaultSize?(props: P): { w: number; h: number };
  getGeometry(node: NodeRecord): Geometry2d;    // the single source for hit-test/bounds/cull/snap
  getPorts?(node: NodeRecord): Port[];          // named connection anchors (0..1 within the box)
  draw(api: DrawApi, node: NodeRecord, tokens: ResolvedTokens): void;
  readonly capabilities?: Partial<NodeCapabilities>;  // canConnect / canResize / canEdit / canRotate / multiline
}
```

A complete, minimal custom node — geometry, ports, and a `draw`, then register it:

```ts
import { Rectangle2d, type NodeUtil } from '@ahmazin/core';

const cylinderNode: NodeUtil = {
  type: 'cylinder',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 120, h: 60 }),
  getGeometry: (n) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  getPorts: () => [
    { id: 'in', kind: 'target', anchor: { x: 0, y: 0.5 } },
    { id: 'out', kind: 'source', anchor: { x: 1, y: 0.5 } },
  ],
  draw: (api, n, tokens) => {
    const box = { x: n.x, y: n.y, w: n.w, h: n.h };
    api.fillRoundRect(box, 8, tokens.fill, { glow: tokens.glow ?? undefined });
    api.strokeRoundRect(box, 8, tokens.stroke, { width: tokens.strokeWidth });
    if (n.label) api.label(n.label, { x: n.x + n.w / 2, y: n.y + n.h / 2 });
  },
};

editor.registerNodeType(cylinderNode);
// now usable anywhere:
editor.createNode({ type: 'cylinder', x: 40, y: 40, label: 'Blob store' });
```

Draw against the **resolved theme tokens** you're handed (`tokens.fill`, `tokens.stroke`,
`tokens.glow`, `tokens.strokeWidth`, …), never hard-coded colours — that is what lets a theme swap
re-skin every node in one frame. Available geometry classes: `Rectangle2d`, `Ellipse2d`,
`Polygon2d`, `Polyline2d` (all implement `Geometry2d`, i.e. `hitPoint`, `bounds`).

### Edge types

An edge type is an `EdgeUtil`. `getRoute` turns resolved endpoints (and any waypoints + a resolved
router) into a polyline; `draw` paints it.

```ts
export interface EdgeUtil<P extends Record<string, unknown> = Record<string, unknown>> {
  readonly type: string;
  getDefaultProps?(): P;
  getRoute(edge: EdgeRecord, ctx: EdgeRouteContext): Vec2[];  // ctx: from/to, optional waypoints, router
  readonly hitWidth?: number;                                 // hit tolerance (world units) around the polyline
  draw(api: DrawApi, edge: EdgeRecord, tokens: ResolvedTokens, route: Vec2[]): void;
}

editor.registerEdgeType(myEdgeUtil);
```

Delegate `getRoute` to the router the context hands you so per-edge router choice keeps working:

```ts
getRoute(_edge, ctx) {
  const router = ctx.router ?? straightRouter;   // straightRouter is exported by @ahmazin/core
  return router.route({ from: ctx.from, to: ctx.to, waypoints: ctx.waypoints, endGap: 6 });
}
```

`@ahmazin/preset-draw` (`rectShape` / `ellipseShape` / `diamondShape` / `textNode`, `lineEdge` /
`arrowEdge`) is a small, complete worked reference for both node and edge types.

### Migrating a custom shape

When you change a custom type's `props` shape, add an up-migration so old documents keep loading.
Each migration is a `{ id, migrate }` object — a stable string `id` plus a pure `(props) => props`
step; the type's version is `migrations.length`.

```ts
const boxUtil: NodeUtil = {
  type: 'box',
  getDefaultProps: () => ({ radius: 4 }),
  getGeometry: (n) => rectGeometry(n),
  draw: (api, n, t) => { /* … */ },
  // v0 stored { r }; v1 renamed it to { radius }.
  migrations: [{ id: 'rename-r-to-radius', migrate: (p) => ({ radius: p.r }) }],
};
```

The `id` sequence is **append-only**: a step's id may never change, reorder, or be removed once
published — you only append new steps. The engine enforces this at registration and throws
`NodusError('invalid-migrations')` if a re-registration's ids don't extend the prior sequence, or if a
step isn't a `{ id, migrate }` object. On load, a record written at version `v` runs steps
`v … length-1`. The version each type was written at is stored once per document in `typeVersions`
(canonical, minimal-diff). A migration that throws drops only that record
(`RestoreResult.migrationErrors`); a document written by a newer client is kept raw and never
downgraded (`RestoreResult.unmigrated`).

---

## 2. Routers

A router turns two endpoints (plus optional waypoints and node boxes) into a polyline. Edges pick one
by id via `edge.props.router`; the scene index resolves it and passes it to the edge type through the
route context. Built-ins are `straight`, `orthogonal`, and `bezier` (registered by
`defaultRouters()` on every editor).

```ts
export interface Router {
  readonly id: string;
  route(ctx: RouteContext): Vec2[];   // ctx: from, to, waypoints?, fromBox?, toBox?, endGap?
}
```

Register a custom router with `editor.registerRouter` (or `host.registerRouter` inside a plugin), then
select it per edge:

```ts
const stepRouter: Router = {
  id: 'step',
  route: ({ from, to }) => [from, { x: to.x, y: from.y }, to],
};

editor.registerRouter(stepRouter);      // returns a Dispose that unregisters it
editor.setEdgeRouter(edgeId, 'step');   // sets edge.props.router = 'step', one undo entry
```

An unset `edge.props.router` falls back to the edge util's default router. `endGap` trims the target
end so an arrowhead sits in the gap.

---

## 3. Layouts

A layout engine implements `LayoutEngine` — an async `layout(graph, opts)` that returns new
world-space top-left positions per node id. Async-first, so synchronous engines (dagre, tree) and
asynchronous ones (elk, force) share one signature.

```ts
export interface LayoutEngine {
  readonly id: string;
  readonly supportsIncremental?: boolean;
  layout(graph: LayoutGraph, opts?: LayoutOptions): Promise<LayoutResult>;
}
```

Register it, then run it. A whole layout applies as one undo entry:

```ts
import { dagreLayout } from '@ahmazin/layout-dagre';

editor.registerLayout(dagreLayout);
await editor.layout('dagre', { direction: 'LR' });   // direction / rankGap / nodeGap + engine-specific keys
```

`LayoutOptions` carries `direction` (`'LR' | 'RL' | 'TB' | 'BT'`), `rankGap`, and `nodeGap`, plus an
open index signature for engine-specific keys (force reads `linkDistance` / `charge` / `iterations`;
elk reads `algorithm` / `workerUrl`). The reference adapters are the four `@ahmazin/layout-*` packages
(`layout-dagre`, `layout-tree`, `layout-force`, `layout-elk`) — each is a single small `LayoutEngine`
you can read end to end.

---

## 4. Plugins

A plugin bundles any of the above (plus tools, overlays, and store/event hooks) behind one install
call. Its `register(host)` receives an `EngineHost` — the public extension surface — and returns a
disposer.

```ts
export interface Plugin {
  id: string;
  register(host: EngineHost): Dispose | void;
}

export interface EngineHost {
  registerNodeType(util: NodeUtil): Dispose;
  registerEdgeType(util: EdgeUtil): Dispose;
  registerTool(tool: ToolNode): Dispose;
  registerRouter(router: Router): Dispose;
  registerLayout(engine: LayoutEngine): Dispose;
  setTheme(theme: Theme): void;
  addOverlay(overlay: OverlayLayer): Dispose;   // a canvas layer painted each frame in world space
  on(type: string, handler: (event: NodusEvent) => void): Dispose;   // event bus (narrows by key)
  onChange(handler: StoreListener): Dispose;     // raw store changes (constraints, snapping)
  onBeforeChange(fn: BeforeApply): Dispose;      // transform / veto changes before they commit
  registerCommand(cmd: Command): Dispose;        // contribute a command to the registry
  readonly editor: Editor;                       // escape hatch — see the two tiers below
}
```

**Every register/subscribe call returns a `Dispose`**, and the host records them, so the disposer
`editor.use(plugin)` hands back unwinds the plugin's whole footprint in reverse order (installing the
same `plugin.id` twice is idempotent — the second `use()` returns the existing disposer).

The surface is **two-tier**: `EngineHost` itself (the `register*` / `on*` / `setTheme` methods) is the
**stable** public API to build against, while `host.editor` is an **escape hatch** to the full `Editor`
with **no stability promise** — members tagged `@internal` may change between minor versions. Prefer
the stable surface; reach into `editor` only when you must.

Install with `editor.use(plugin)`:

```ts
import { freehandPlugin } from '@ahmazin/plugin-freehand';

const dispose = editor.use(freehandPlugin);   // adds the 'freehand' node type + pen tool
editor.setTool('freehand');                   // switch the tool on
// ... later: dispose();
```

`@ahmazin/plugin-freehand` is the full worked example: a whole new interaction (a pen tool) **and** a
new node type (the stroke), registered through the plugin API with zero core changes.

---

## Registration is validated — extensions fail fast

The engine validates a util **at registration** and throws a clear, contextual error instead of
crashing cryptically later:

- Registering a node/edge type that is not an object, or whose `type` is missing / not a non-empty
  string, throws immediately (`Cannot register node type: 'type' must be a non-empty string …`).
- A `NodeUtil` missing `getGeometry` or `draw`, or an `EdgeUtil` missing `getRoute` or `draw` (or
  where those aren't functions), throws at registration
  (`Cannot register node type "cylinder": 'getGeometry' must be a function.`).
- `registerLayout` throws unless the engine has a non-empty string `id` and a `layout` function.
- A plugin whose `register()` throws is surfaced on the editor's observable `error` event channel
  **with context** (which plugin) and rethrown as `Plugin "<id>" failed to install: …`. The failed
  plugin never leaves a half-installed disposer behind, so the editor is not corrupted.

Re-registering an existing `type` (or layout `id`) is allowed — presets legitimately override
built-ins — but it fires an observable, non-fatal override notice on the same `error` channel, so
accidental clobbering stays visible.

---

## See also

- [`README.md`](../README.md) — project overview and quick start.
- [`packages/core/README.md`](../packages/core/README.md) — the full architecture and the mutation /
  signals / scene-index model these axes build on.
- Reference implementations: `@ahmazin/preset-infra`, `@ahmazin/preset-diagrams`, `@ahmazin/preset-draw`,
  `@ahmazin/layout-*`, `@ahmazin/plugin-freehand`.
</content>
</invoke>
