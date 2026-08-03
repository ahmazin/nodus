---
layout: ../../layouts/DocsLayout.astro
title: Headless rendering
description: Build, mutate, and render a diagram to PNG in Node with no browser — the CreateCanvas injection recipe, the font and type-registration prerequisites, and the stable export contract.
---

`@nodus-dev/core` has zero framework or DOM dependencies, so you can build, mutate, lay out, and **render**
a scene entirely in Node — the path behind server-side PNG export and `nodus render`. The same drawing
code paints to a browser canvas or a native Skia canvas.

> **Pre-1.0 (0.x): this API may change before 1.0.** See [Versioning](/docs/versioning).

## Render a diagram to PNG

`editor.toPNG(create, opts?)` is the export entry point. You inject a **canvas factory** — Nodus never
imports a canvas backend itself — so the core stays DOM-free. In Node, back it with
[`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas):

```ts
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { Editor, type CreateCanvas } from '@nodus-dev/core';
import { installInfraPreset } from '@nodus-dev/preset-infra';

// 1. Load system fonts BEFORE painting (see the prerequisite below). @napi-rs/canvas's types omit
//    loadSystemFonts, so reach it through a narrow cast — the same as the `nodus` CLI does.
(GlobalFonts as { loadSystemFonts?: () => number }).loadSystemFonts?.();

// 2. Register the node/edge types the document uses.
const editor = new Editor();
installInfraPreset(editor);
editor.createNode({ type: 'infra.service', label: 'API', x: 0, y: 0 });

// 3. Inject the canvas factory and export.
const create: CreateCanvas = (w, h) => createCanvas(w, h) as unknown as ReturnType<CreateCanvas>;
const png: Uint8Array = await editor.toPNG(create, { pixelRatio: 2, background: true });
```

`ToPNGOptions` carries `pixelRatio`, `padding`, `background`, `grid`, and a world `bounds` region
(defaults to the content bounds).

## The two silent prerequisites

Both of these fail **quietly** — the render succeeds but comes out wrong — so they are the first thing
to check when a headless render is blank:

- **Fonts must be loaded first.** Without `GlobalFonts.loadSystemFonts()` (or an explicit
  `GlobalFonts.registerFromPath(...)`) before the first paint, text renders **blank** — the shapes
  draw but the labels don't.
- **Types must be registered.** A record whose `type` has no registered `NodeUtil`/`EdgeUtil` draws as
  **nothing**. Install the preset (or register your custom types) that the document's records use
  before rendering — loading a preset document into a bare `new Editor()` yields a partly empty canvas.

## The export contract

`CreateCanvas` / `ExportCanvas` are the stable injection contract — any object matching the structural
`ExportCanvas` shape works, so you are not tied to `@napi-rs/canvas`:

```ts
export interface ExportCanvas {
  getContext(type: '2d'): unknown;
  width: number;
  height: number;
  encode?(format: 'png'): Promise<Uint8Array> | Uint8Array;
  toBuffer?(mime: string): Uint8Array;
}
export type CreateCanvas = (w: number, h: number) => ExportCanvas;
```

`toPNG` uses `encode('png')` if present, else `toBuffer('image/png')`. For custom surfaces or preview
frames, drop down to `editor.paintRegion(ctx, region, ratio, opts)` — the same call `toPNG` builds on.

## Turnkey: the CLI

If you just want a file rendered, `@nodus-dev/cli` wraps all of the above — font loading, preset
auto-detection from record type prefixes, and the canvas factory:

```bash
pnpm nodus render architecture.nodus.json --out arch.png --preset infra --scale 2
```

See the [CLI reference](/docs/cli) for the full command set.

## Loading a document

Rehydrate a saved snapshot with `editor.loadSnapshot(snap, opts?)` — it runs migrations, seeds the
z-counter, and opens the first page (constructing an editor from raw `records` does not do all of
this, so prefer `loadSnapshot` for persisted documents).

`loadSnapshot` returns a **`LoadReport`** so a headless caller — a CI job, a server-side import — can
detect and log exactly what a load changed instead of silently accepting a repaired document:

```ts
const report = editor.loadSnapshot(snapshot);
// LoadReport:
//   droppedEdges: number       — edges removed because an endpoint node was missing
//   migrationErrors: number    — records dropped because a type migration threw
//   unmigrated: number         — records kept raw (newer type version, or type not registered)
//   repointedPageRefs: number  — records whose pageId was backfilled/repointed to the first page
//   issues: SerializationIssue[] — every non-fatal repair, each with a `code` and `message`
if (report.droppedEdges || report.migrationErrors || report.issues.length) {
  console.warn('load repaired the document', report);
}
```

The same report also rides on the `document:load` event
(`editor.on('document:load', (e) => e.report)`), and every repaired issue is additionally forwarded to
the `error` channel as a `warning` — so a UI host can surface them without polling the return value.

### A document newer than your library

If the snapshot's `schemaVersion` is **newer** than the library understands, `loadSnapshot` **throws**
a `NodusError` with code `'schema-too-new'` rather than silently downgrading the file — a git-native
format must never rewrite what it can't round-trip. Catch it and tell the user to upgrade:

```ts
import { isNodusError } from '@nodus-dev/core';

try {
  editor.loadSnapshot(snapshot);
} catch (e) {
  if (isNodusError(e) && e.code === 'schema-too-new') {
    console.error('This diagram was written by a newer Nodus — upgrade @nodus-dev/core to open it.');
  } else throw e;
}
```

## See also

- [CLI · nodus](/docs/cli) — `render` / `fmt` / `diff` over `*.nodus.json`.
- [Data schema](/docs/schema) — the snapshot format `loadSnapshot` reads.
- [Extending](/docs/extending) — registering the node/edge types a headless render needs.
