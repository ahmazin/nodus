# @nodus/layout-elk

An [ELK](https://github.com/kieler/elkjs) (Eclipse Layout Kernel) `LayoutEngine` for
[Nodus](https://github.com/OWNER/nodus), via `elkjs`. Supports ELK's layered, orthogonal, and nested algorithms —
the highest-quality routing of the four adapters. Uses the bundled ELK build (async, runs everywhere
including Node); in a browser you can offload the work to a Web Worker.

## Install

```bash
pnpm add @nodus/layout-elk @nodus/core
```

> `@nodus/core` is a **peer dependency** — install it alongside so the adapter shares your app's single
> engine instance (a duplicate core is two registries and won't interoperate).

## Usage

```ts
import { elkLayout, createElkLayout } from '@nodus/layout-elk';

editor.registerLayout(elkLayout);
await editor.layout('elk', { direction: 'LR', algorithm: 'layered' });
```

Options (`ElkLayoutOptions extends LayoutOptions`): `direction` (`'LR' | 'RL' | 'TB' | 'BT'`),
`algorithm` (`'layered'` default, `'force'`, `'mrtree'`, `'stress'`, `'radial'`, …), `nodeGap`,
`rankGap`, and (browser-only) `workerUrl` to run layout off the main thread. `createElkLayout(defaults?)`
builds an engine with baked-in defaults (e.g. a fixed `workerUrl`); `elkLayout` is the default layered
engine and the default export. The engine id is `'elk'`.

## See also

- [Extending Nodus → Layouts](https://nodus.dev/docs/extending#3-layouts) — the layout extension axis.
- Used as the default layout by [`@nodus/from-mermaid`](https://github.com/OWNER/nodus/tree/main/packages/from-mermaid).
- Sibling adapters: [`@nodus/layout-dagre`](https://github.com/OWNER/nodus/tree/main/packages/layout-dagre) ·
  [`@nodus/layout-tree`](https://github.com/OWNER/nodus/tree/main/packages/layout-tree) ·
  [`@nodus/layout-force`](https://github.com/OWNER/nodus/tree/main/packages/layout-force).

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
