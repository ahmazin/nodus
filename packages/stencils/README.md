# @nodus-dev/stencils

Reusable **stencils** (element-group fragments) and **templates** (starting diagrams) for
[Nodus](https://github.com/ahmazin/nodus), plus a canonical, git-diffable (de)serializer for stencil libraries.
Depends only on [`@nodus-dev/core`](https://github.com/ahmazin/nodus/tree/main/packages/core) — no framework, no DOM.

- A **stencil** is a small group of records you drop onto the canvas as a unit (a labeled box, a
  note, a decision shape). Its origin sits near `(0, 0)` so it can be pasted anywhere.
- A **template** is a whole starting document — a `Snapshot` you open fresh (blank, 3-tier web app,
  CI/CD pipeline).

## Install

```bash
pnpm add @nodus-dev/stencils @nodus-dev/core
```

> `@nodus-dev/core` is a **peer dependency** — install it alongside so stencils share your app's single
> engine instance.

## Usage

```ts
import {
  builtinStencils,
  builtinTemplates,
  serializeLibrary,
  parseLibrary,
} from '@nodus-dev/stencils';
import { restore } from '@nodus-dev/core';

// Open a template as a new document.
const template = builtinTemplates.find((t) => t.id === 'three-tier-web')!;
const { records } = restore(template.snapshot);
editor.store.apply(records.map((record) => ({ op: 'add', record })), { capture: 'immediately' });

// Drop a stencil fragment (translate its near-origin records to the drop point yourself).
const box = builtinStencils.stencils.find((s) => s.id === 'box')!;

// Persist a custom library in canonical, diff-stable form, then load it back.
const text = serializeLibrary(builtinStencils); // sorted keys, trailing newline
const lib = parseLibrary(text);
```

## API

| Export | Description |
| --- | --- |
| `Stencil`, `StencilLibrary`, `Template` | The content types (see [`src/types.ts`](https://github.com/ahmazin/nodus/blob/main/packages/stencils/src/types.ts)). |
| `serializeLibrary(lib)` | `StencilLibrary` → canonical JSON text (`stableStringify` + trailing newline). Byte-stable per input. |
| `parseLibrary(json)` | JSON text → `StencilLibrary`. Throws only on non-library input (invalid JSON, or a top level missing string `name` / array `stencils`); silently drops individual malformed stencils. |
| `builtinStencils` | A `StencilLibrary` of single-node starters: `Box`, `Note`, `Decision`, `Terminal`. |
| `builtinTemplates` | Starter `Template`s: `Blank`, `3-Tier Web App`, `CI/CD Pipeline`. |

All built-in content is authored from the core `rect` node and `line` edge types, so it renders on a
bare `@nodus-dev/core` editor with no extra registrations, and every fragment `restore()`s with
`droppedEdges === 0`.

## Serialization contract

`serializeLibrary` routes through the engine's `stableStringify`: object keys are emitted in sorted
order, `undefined`-valued keys are dropped, and array order is preserved. Output is deterministic and
diff-friendly — the same contract the core uses for `*.nodus.json`. `parseLibrary(serializeLibrary(x))`
round-trips any well-formed library.

## See also

- [Extending Nodus](https://nodus.dev/docs/extending) — the engine's extension axes.
- [`@nodus-dev/core`](https://github.com/ahmazin/nodus/tree/main/packages/core) — records, `Snapshot`, `restore`, `stableStringify`.

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
