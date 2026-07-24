# @nodus/plugin-freehand

Freehand / sketch drawing for [Nodus](https://github.com/OWNER/nodus) — a pen tool plus a `freehand` stroke node
type, registered **entirely through the public plugin API**. It's the proof that a whole new
interaction and a new node type need zero core changes, and the canonical worked example for
[writing a plugin](https://nodus.dev/docs/extending#4-plugins). Each stroke is one undoable node; points are
stored relative to the node origin so a stroke moves and undoes like any other node.

## Install

```bash
pnpm add @nodus/plugin-freehand @nodus/core
```

> `@nodus/core` is a **peer dependency** — install it alongside so the plugin shares your app's single
> engine instance.

## Usage

```ts
import { installFreehand } from '@nodus/plugin-freehand';

installFreehand(editor);        // == editor.use(freehandPlugin)
editor.setTool('freehand');     // drag on the canvas to draw
```

Or install the plugin directly to keep the disposer:

```ts
import { freehandPlugin } from '@nodus/plugin-freehand';

const dispose = editor.use(freehandPlugin);
```

## Exports

`freehandPlugin` (the `Plugin`), `installFreehand(editor)`, the `FreehandTool` class (its
`configure({ width })` sets stroke width), and `freehandNodeUtil` (the `freehand` `NodeUtil`).

## See also

- [`docs/EXTENDING.md`](https://nodus.dev/docs/extending#4-plugins) — the plugin axis and the `EngineHost` surface.
- [`@nodus/core`](https://github.com/OWNER/nodus/tree/main/packages/core)

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
