# @nodus/preset-draw

Plain whiteboard shapes for [Nodus](https://github.com/OWNER/nodus) — the "dumb shapes" preset. Rectangle, ellipse,
and diamond nodes, a multi-line text node, `line` / `arrow` edges, a `LineTool`, and `R / E / L / A /
T` keyboard shortcuts. Everything styles off each element's own style bag (right-click → Style, or a
properties panel), so shapes are neutral by default and coloured per element. Use it for a general
whiteboard/drawing surface.

## Install

```bash
pnpm add @nodus/preset-draw @nodus/core
```

> `@nodus/core` is a **peer dependency** — install it alongside so the preset shares your app's single
> engine instance.

## Usage

```ts
import { Editor } from '@nodus/core';
import { installDrawTools, drawShortcut } from '@nodus/preset-draw';

const editor = new Editor();
installDrawTools(editor);   // registers draw.* node/edge types + the line tool

// create a rectangle directly:
editor.createNode({ type: 'draw.rect', x: 40, y: 40, label: 'Box' });

// or wire keyboard shortcuts (returns true if the key was handled):
window.addEventListener('keydown', (e) => drawShortcut(editor, e.key));
// R rect · E ellipse · D diamond · T text · L line · A arrow · V select
```

## Exports

Node types `rectShape` / `ellipseShape` / `diamondShape` / `textNode` (types `draw.rect`,
`draw.ellipse`, `draw.diamond`, `draw.text`), edge types `lineEdge` / `arrowEdge` (`draw.line`,
`draw.arrow`), the `LineTool`, the util arrays `drawNodeUtils` / `drawEdgeUtils`, and the helpers
`installDrawTools(editor)` and `drawShortcut(editor, key)`.

## See also

- [Extending Nodus](https://nodus.dev/docs/extending) — this package is a compact reference for authoring
  node **and** edge types.
- [`@nodus/core`](https://github.com/OWNER/nodus/tree/main/packages/core) · [`@nodus/react`](https://github.com/OWNER/nodus/tree/main/packages/react)

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
