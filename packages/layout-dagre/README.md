# @nodus/layout-dagre

A `LayoutEngine` adapter over [dagre](https://github.com/dagrejs/dagre)'s layered layout for
[Nodus](https://github.com/OWNER/nodus). Great for directed graphs with a clear flow direction (pipelines, DAGs,
dependency graphs). Converts dagre's centre-based coordinates to Nodus's world-space top-left. Bundles
`@dagrejs/dagre`.

## Install

```bash
pnpm add @nodus/layout-dagre @nodus/core
```

> `@nodus/core` is a **peer dependency** — install it alongside so the adapter shares your app's single
> engine instance (a duplicate core is two registries and won't interoperate).

## Usage

```ts
import { dagreLayout } from '@nodus/layout-dagre';

editor.registerLayout(dagreLayout);
await editor.layout('dagre', { direction: 'LR' });   // a whole layout is one undo entry
```

Options (`LayoutOptions`): `direction` (`'LR' | 'RL' | 'TB' | 'BT'`, default `'LR'`), `nodeGap` (gap
between nodes in a rank, default 44), `rankGap` (gap between ranks, default 90). The engine id is
`'dagre'`. `dagreLayout` is also the default export.

## See also

- [Extending Nodus → Layouts](https://nodus.dev/docs/extending#3-layouts) — the layout extension axis.
- Sibling adapters: [`@nodus/layout-tree`](https://github.com/OWNER/nodus/tree/main/packages/layout-tree) ·
  [`@nodus/layout-force`](https://github.com/OWNER/nodus/tree/main/packages/layout-force) ·
  [`@nodus/layout-elk`](https://github.com/OWNER/nodus/tree/main/packages/layout-elk).

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
