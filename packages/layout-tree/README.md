# @ahmazin/layout-tree

A **dependency-free** tidy-tree `LayoutEngine` for [Nodus](https://github.com/ahmazin/nodus). Builds a hierarchy from
edge direction (source → target), places leaves along the main axis, and centres each parent over its
children. Ideal for org charts, mind maps, and file trees. Supports TB / BT / LR / RL direction and
tolerates disconnected or cyclic islands.

## Install

```bash
pnpm add @ahmazin/layout-tree @ahmazin/core
```

> `@ahmazin/core` is a **peer dependency** — install it alongside so the adapter shares your app's single
> engine instance (a duplicate core is two registries and won't interoperate).

## Usage

```ts
import { treeLayout } from '@ahmazin/layout-tree';

editor.registerLayout(treeLayout);
await editor.layout('tree', { direction: 'TB' });
```

Options (`LayoutOptions`): `direction` (`'TB' | 'BT' | 'LR' | 'RL'`, default `'TB'`), `nodeGap` (gap
between siblings, default 34), `rankGap` (gap between depths, default 90). The engine id is `'tree'`.
`treeLayout` is also the default export.

## See also

- [Extending Nodus → Layouts](https://nodus.dev/docs/extending#3-layouts) — the layout extension axis.
- Sibling adapters: [`@ahmazin/layout-dagre`](https://github.com/ahmazin/nodus/tree/main/packages/layout-dagre) ·
  [`@ahmazin/layout-force`](https://github.com/ahmazin/nodus/tree/main/packages/layout-force) ·
  [`@ahmazin/layout-elk`](https://github.com/ahmazin/nodus/tree/main/packages/layout-elk).

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
