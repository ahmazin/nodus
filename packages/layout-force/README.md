# @nodus/layout-force

A force-directed `LayoutEngine` for [Nodus](../../README.md), built on
[d3-force](https://github.com/d3/d3-force) with rectangular collision. Tuned for general graphs where
hierarchy isn't meaningful (networks, clusters, relationship maps). Runs the simulation to convergence
synchronously inside the async call, then returns world-space top-left positions. Bundles `d3-force`.

## Install

```bash
pnpm add @nodus/layout-force @nodus/core
```

## Usage

```ts
import { forceLayout } from '@nodus/layout-force';

editor.registerLayout(forceLayout);
await editor.layout('force', { linkDistance: 150, charge: -700, iterations: 320 });
```

Options: `linkDistance` (default 150), `charge` (many-body strength, default −700), `iterations`
(simulation ticks, default 320), plus the shared `LayoutOptions` fields. Nodes marked `fixed` in the
graph are pinned. The engine id is `'force'`. `forceLayout` is also the default export.

## See also

- [`docs/EXTENDING.md`](../../docs/EXTENDING.md#3-layouts) — the layout extension axis.
- Sibling adapters: [`@nodus/layout-dagre`](../layout-dagre/README.md) ·
  [`@nodus/layout-tree`](../layout-tree/README.md) · [`@nodus/layout-elk`](../layout-elk/README.md).

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
