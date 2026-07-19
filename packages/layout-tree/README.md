# @nodus/layout-tree

A **dependency-free** tidy-tree `LayoutEngine` for [Nodus](../../README.md). Builds a hierarchy from
edge direction (source → target), places leaves along the main axis, and centres each parent over its
children. Ideal for org charts, mind maps, and file trees. Supports TB / BT / LR / RL direction and
tolerates disconnected or cyclic islands.

## Install

```bash
pnpm add @nodus/layout-tree @nodus/core
```

## Usage

```ts
import { treeLayout } from '@nodus/layout-tree';

editor.registerLayout(treeLayout);
await editor.layout('tree', { direction: 'TB' });
```

Options (`LayoutOptions`): `direction` (`'TB' | 'BT' | 'LR' | 'RL'`, default `'TB'`), `nodeGap` (gap
between siblings, default 34), `rankGap` (gap between depths, default 90). The engine id is `'tree'`.
`treeLayout` is also the default export.

## See also

- [`docs/EXTENDING.md`](../../docs/EXTENDING.md#3-layouts) — the layout extension axis.
- Sibling adapters: [`@nodus/layout-dagre`](../layout-dagre/README.md) ·
  [`@nodus/layout-force`](../layout-force/README.md) · [`@nodus/layout-elk`](../layout-elk/README.md).

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
