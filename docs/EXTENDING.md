# Extending Nodus

Nodus is built to be customized. All type-specific behavior lives in engine-owned **registries**, so
you extend the engine by registering data and objects — never by forking the core or adding a
`switch`-on-type. There are **four extension axes**: node/edge **types**, edge **routers**,
**layouts**, and **plugins** (which bundle any of the above plus tools, themes, overlays, and
store/event hooks behind one install call).

The one rule they all depend on: **route every change through the store** —
`store.apply(changes, { capture })` or an editor helper built on it (`createNode`, `connect`,
`setStyle`, `updateRecord`, `setEdgeRouter`, …). Never mutate a record in place, or undo, the scene
index, and events fall out of sync.

> **The full, canonical extension guide** — with worked examples for all four axes, custom-shape
> migrations, and registration validation — lives at
> **[/docs/extending](https://ahmazin.github.io/nodus/docs/extending)**
> (source: [`apps/site/src/pages/docs/extending.md`](../apps/site/src/pages/docs/extending.md)).
