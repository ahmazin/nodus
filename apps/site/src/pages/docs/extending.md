---
layout: ../../layouts/DocsLayout.astro
title: Extending Nodus
description: The four registry axes — node/edge types, routers, layouts, and plugins (plus tools) — you extend the engine by registering data, never by forking the core.
---

Nodus is built to be customized. All type-specific behavior lives in engine-owned **registries**, so
you extend the engine by registering data and objects — never by forking the core or adding a
`switch`-on-type. There are four extension axes, plus tools for custom interactions.

> **Pre-1.0 (0.x): the extension API may change before 1.0.** See [Versioning](/docs/versioning).

## The one rule: route every change through the store

Every document change goes through a single channel — `store.apply(changes, { capture })` — or an
editor helper built on it (`createNode`, `connect`, `setStyle`, `updateRecord`, `setEdgeRouter`, …).
Never mutate a record in place: `apply` computes inverse deltas, updates the per-record signal atoms,
and notifies the scene index, history, and event bus through one path. Mutating directly skips all of
that and undo / rendering / events fall silently out of sync. The [Concepts](/docs/concepts) page
covers the store and the `CapturePolicy` that groups a continuous gesture into one undo entry.

## 1. Node / edge types

A node type is a single `NodeUtil` object; its `getGeometry` is the one declarative source the engine
uses for bounds, culling, hit-testing, and snapping. An edge type is an `EdgeUtil` whose `getRoute`
turns resolved endpoints into a polyline.

```ts
import { Rectangle2d, type NodeUtil } from '@nodus-dev/core';

const cylinder: NodeUtil = {
  type: 'cylinder',
  getDefaultProps: () => ({}),
  getGeometry: (n) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  draw: (api, n, tokens) => api.fillRoundRect({ x: n.x, y: n.y, w: n.w, h: n.h }, 8, tokens.fill),
};

editor.registerNodeType(cylinder);
```

Draw against the resolved theme **tokens** you're handed, never hard-coded colours — that is what
lets a theme swap re-skin every node in one frame. `@nodus-dev/preset-draw` is a small, complete worked
reference for both node and edge types.

## 2. Routers

A router turns two endpoints (plus optional waypoints) into a polyline; an edge picks one by id via
`edge.props.router`. Built-ins are `straight`, `orthogonal`, and `bezier`. Register a custom router on
`editor.routers`, then select it per edge with `editor.setEdgeRouter(edgeId, id)`.

## 3. Layouts

A layout engine implements `LayoutEngine` — an async `layout(graph, opts)` returning new top-left
positions per node id. Register it, then run it as one undo entry:

```ts
import { dagreLayout } from '@nodus-dev/layout-dagre';

editor.registerLayout(dagreLayout);
await editor.layout('dagre', { direction: 'LR' });
```

The reference adapters are the four `@nodus-dev/layout-*` packages (dagre, tree, force, elk).

## 4. Plugins

A plugin bundles any of the above — plus tools, overlays, and store/event hooks — behind one install
call. Its `register(host)` receives an `EngineHost` (the extension surface) and returns a disposer;
install with `editor.use(plugin)`. `@nodus-dev/plugin-freehand` is the full worked example: a pen tool
**and** a stroke node type, registered with zero core changes.

## Tools

A tool is the object behind an interaction mode (select, connect, a freehand pen). It implements
`ToolNode` and is registered with `editor.registerTool(tool)` — directly or bundled in a plugin — then
activated with `editor.setTool(id)`. The tool receives pointer and keyboard events in **world
coordinates** and drives the store through the same `apply` channel as everything else;
`@nodus-dev/plugin-freehand`'s `FreehandTool` is the canonical example (it uses `capture: 'later'` on each
pointer-move and calls `editor.mark()` on pointer-up, collapsing a whole stroke into one undo entry).

## Plugin lifecycle

`editor.use(plugin)` installs a plugin and returns a `Dispose` that removes everything it added. Three
guarantees make plugins safe to install, re-install, and remove:

- **Idempotent by `plugin.id`.** Installing the same id twice — a React StrictMode double-invoke, an
  HMR reload — does not double-register: the second `use()` warns and returns the *existing* disposer.
  `editor.installedPlugins()` lists the installed ids.
- **Reversible.** Every `EngineHost` register/subscribe call returns its own `Dispose`, and the host
  records them, so the disposer `use()` hands back unwinds the plugin's entire footprint — node/edge
  types, tools, routers, layouts, overlays, event and store subscriptions, commands — in **reverse**
  registration order, then runs the plugin's own returned disposer. Calling it twice is a no-op.
- **Fail-safe install.** If `register()` throws, the error is emitted on the observable `error` channel
  (tagged with the plugin id) and re-thrown as `Plugin "<id>" failed to install: …`; whatever the
  plugin registered before throwing keeps working, so the editor is never left half-installed.

```ts
export interface Plugin {
  id: string;
  register(host: EngineHost): Dispose | void;
}

const dispose = editor.use(myPlugin);
editor.installedPlugins();   // ['my-plugin', …]
dispose();                   // unwinds everything myPlugin registered, in reverse order
```

### The `EngineHost` boundary — two tiers

`register(host)` receives an `EngineHost` — a **stable** surface with a deliberate escape hatch:

- **`EngineHost` itself is the stable public API** to build against: `registerNodeType`,
  `registerEdgeType`, `registerTool`, `registerRouter`, `registerLayout`, `addOverlay`, `setTheme`,
  `on` (event bus), `onChange` (raw store changes), `onBeforeChange` (a before-apply interceptor that
  transforms or vetoes changes), and `registerCommand`. Each register/subscribe call returns a
  `Dispose` — tools and routers unregister with the same parity as node types (a `registerTool`
  disposer removes the tool, resetting to `select` if it was active; a `registerRouter` disposer
  unregisters the router).
- **`host.editor` is an escape hatch** to the full `Editor` for advanced needs, with **no stability
  promise** — members tagged `@internal` (host-wiring internals) may change between minor versions.
  Prefer the stable surface; reach into `editor` only when you must.

## Commands

The engine has a **command registry** — the single home for named actions (undo, delete, zoom-to-fit,
your own) — so hosts, the command palette (⌘K), and menus invoke one canonical action instead of each
rebinding it. A command is `{ id, label, run(editor, args?), enabled?(editor) }`.

```ts
const dispose = editor.registerCommand({
  id: 'export.png',
  label: 'Export as PNG',
  run: (editor) => savePng(editor),
  enabled: (editor) => editor.store.nodes().length > 0,
});

editor.commands.list();                           // every registered command
editor.commands.isEnabled('export.png', editor);  // safe to poll — unknown id → false, never throws
await editor.execute('export.png');               // unknown id → NodusError('unknown-command')
```

`editor.registerCommand` returns a `Dispose`; an unknown id passed to `execute` is a programmer error
(throws `NodusError('unknown-command')`), while a known-but-disabled command is a benign no-op. Plugins
contribute commands through `host.registerCommand(cmd)` (same registry, auto-removed on teardown), and
the core installs a default set via `installDefaultCommands(editor)` unless you opt out with
`new Editor({ builtins: false })`.

## Registration is validated

The engine validates a util at **registration** and throws a clear, contextual error rather than
crashing cryptically later — a non-object util, a missing/empty `type`, or a `NodeUtil` without
`getGeometry`/`draw` is rejected immediately. A plugin whose `register()` throws is surfaced on the
editor's observable `error` channel (with which plugin) and never leaves a half-installed disposer
behind.

## See also

- [Concepts](/docs/concepts) — the store, signals, scene index, and the four axes in depth.
- [Headless rendering](/docs/headless) — build and render a scene with no browser.
- Reference packages: `@nodus-dev/preset-infra`, `@nodus-dev/preset-draw`, the `@nodus-dev/layout-*` adapters, and
  `@nodus-dev/plugin-freehand`.
