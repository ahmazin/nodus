# @nodus-dev/layout-elk

An [ELK](https://github.com/kieler/elkjs) (Eclipse Layout Kernel) `LayoutEngine` for
[Nodus](https://github.com/ahmazin/nodus), via `elkjs`. Supports ELK's layered, orthogonal, and nested algorithms —
the highest-quality routing of the four adapters. Uses the bundled ELK build (async, runs everywhere
including Node); in a browser you can offload the work to a Web Worker.

## Install

```bash
pnpm add @nodus-dev/layout-elk @nodus-dev/core
```

> `@nodus-dev/core` is a **peer dependency** — install it alongside so the adapter shares your app's single
> engine instance (a duplicate core is two registries and won't interoperate).

> **License note:** this adapter pulls in **[elkjs](https://github.com/kieler/elkjs)** as a normal,
> transitively-installed dependency, redistributed **unmodified** under the
> **[EPL-2.0](https://www.eclipse.org/legal/epl-2.0/)**. `@nodus-dev/layout-elk`'s own code is MIT (see the
> root [`NOTICE`](https://github.com/ahmazin/nodus/blob/mainline/NOTICE)). If your project must avoid
> EPL-licensed code, the other three layout adapters are **fully MIT**:
> [`@nodus-dev/layout-dagre`](https://github.com/ahmazin/nodus/tree/mainline/packages/layout-dagre),
> [`@nodus-dev/layout-tree`](https://github.com/ahmazin/nodus/tree/mainline/packages/layout-tree), and
> [`@nodus-dev/layout-force`](https://github.com/ahmazin/nodus/tree/mainline/packages/layout-force).

## Usage

```ts
import { elkLayout, createElkLayout } from '@nodus-dev/layout-elk';

editor.registerLayout(elkLayout);
await editor.layout('elk', { direction: 'LR', algorithm: 'layered' });
```

Options (`ElkLayoutOptions extends LayoutOptions`): `direction` (`'LR' | 'RL' | 'TB' | 'BT'`),
`algorithm` (`'layered'` default, `'force'`, `'mrtree'`, `'stress'`, `'radial'`, …), `nodeGap`,
`rankGap`, and (browser-only) `workerUrl` to run layout off the main thread. `createElkLayout(defaults?)`
builds an engine with baked-in defaults (e.g. a fixed `workerUrl`); `elkLayout` is the default layered
engine and the default export. The engine id is `'elk'`.

## See also

- [Extending Nodus → Layouts](https://ahmazin.github.io/nodus/docs/extending#3-layouts) — the layout extension axis.
- Used as the default layout by [`@nodus-dev/from-mermaid`](https://github.com/ahmazin/nodus/tree/mainline/packages/from-mermaid).
- Sibling adapters: [`@nodus-dev/layout-dagre`](https://github.com/ahmazin/nodus/tree/mainline/packages/layout-dagre) ·
  [`@nodus-dev/layout-tree`](https://github.com/ahmazin/nodus/tree/mainline/packages/layout-tree) ·
  [`@nodus-dev/layout-force`](https://github.com/ahmazin/nodus/tree/mainline/packages/layout-force).

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
