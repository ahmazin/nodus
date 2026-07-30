# @ahmazin/layout-force

A force-directed `LayoutEngine` for [Nodus](https://github.com/ahmazin/nodus), built on
[d3-force](https://github.com/d3/d3-force) with rectangular collision. Tuned for general graphs where
hierarchy isn't meaningful (networks, clusters, relationship maps). Runs the simulation to convergence
synchronously inside the async call, then returns world-space top-left positions. Bundles `d3-force`.

## Install

```bash
pnpm add @ahmazin/layout-force @ahmazin/core
```

> `@ahmazin/core` is a **peer dependency** — install it alongside so the adapter shares your app's single
> engine instance (a duplicate core is two registries and won't interoperate).

## Usage

```ts
import { forceLayout } from '@ahmazin/layout-force';

editor.registerLayout(forceLayout);
await editor.layout('force', { linkDistance: 150, charge: -700, iterations: 320 });
```

Options: `linkDistance` (default 150), `charge` (many-body strength, default −700), `iterations`
(simulation ticks, default 320), plus the shared `LayoutOptions` fields. Nodes marked `fixed` in the
graph are pinned. The engine id is `'force'`. `forceLayout` is also the default export.

## See also

- [Extending Nodus → Layouts](https://nodus.dev/docs/extending#3-layouts) — the layout extension axis.
- Sibling adapters: [`@ahmazin/layout-dagre`](https://github.com/ahmazin/nodus/tree/main/packages/layout-dagre) ·
  [`@ahmazin/layout-tree`](https://github.com/ahmazin/nodus/tree/main/packages/layout-tree) ·
  [`@ahmazin/layout-elk`](https://github.com/ahmazin/nodus/tree/main/packages/layout-elk).

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
