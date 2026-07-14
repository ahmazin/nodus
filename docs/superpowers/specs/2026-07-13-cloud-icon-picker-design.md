# Cloud Icon Picker — Design

**Date:** 2026-07-13
**Status:** Approved (design)

## Goal

Let a user browse the curated cloud-service icons (`@nodus/icons-cloud`, 92 AWS/Azure/GCP glyphs),
search them, and place one on the canvas by dragging it to an exact spot. Replaces the placeholder
3-item `<select>` + "Add icon" button in the browser demo.

## Non-goals (YAGNI)

Favorites/recents, category accordions, multi-select, keyboard-arrow grid navigation, and any
non-cloud icon browsing. The component is generic over a catalog prop, but only the cloud catalog
is wired now.

## Architecture

A new reusable component in `@nodus/react`:

```
<CloudIconPicker editor={Editor} catalog={IconCatalogEntry[]} />
```

It renders a single **toolbar button** ("Cloud ▾") that toggles a **popover** containing a search
box, provider filter chips, and a scrollable grid of icon previews. It is self-contained: the button
and popover are one unit the host drops into its toolbar (like `Properties`/`CommandPalette`).

Three collaborating pieces, each independently understandable:

1. **`cloudIconCatalog`** (`@nodus/icons-cloud`) — the data. Exported array derived from `ALLOWLIST`,
   the single source of truth. `@nodus/react` never imports `@nodus/icons-cloud`; the catalog arrives
   as a prop, keeping the component reusable for any icon set.

2. **canvas registry** (`@nodus/react`, internal) — the DOM link. A module-level
   `WeakMap<Editor, HTMLCanvasElement>`. The `<Nodus>` host registers its canvas on mount; the picker
   reads it to map a drop point to world coordinates. The core `Editor` stays headless (no DOM ref).

3. **`CloudIconPicker`** (`@nodus/react`) — the UI: button, popover, search/filter, preview grid,
   and the pointer-drag placement.

## Data types

```ts
// @nodus/icons-cloud
export interface IconCatalogEntry {
  name: string;      // 'aws:lambda'  (registry key + node props.icon)
  provider: 'aws' | 'azure' | 'gcp';
  service: string;   // 'lambda'
  category: string;  // 'compute' | 'database' | ...
}
export const cloudIconCatalog: IconCatalogEntry[]; // one entry per ALLOWLIST entry
```

`@nodus/react` declares its **own** structurally-compatible `IconCatalogEntry` interface and takes
`catalog` as a prop, so it carries no build- or runtime dependency on `@nodus/icons-cloud`. The
`cloudIconCatalog` value is structurally assignable to it.

## Behavior

### Previews
Each tile renders a `<canvas>` sized `S×S` (× devicePixelRatio) and calls the registry draw fn:
`getIcon(entry.name)?.(ctx, pad, pad, S − 2*pad, previewColor)`. Cloud icons carry baked colors, so
`previewColor` is only a fallback for monochrome glyphs. Tiles show the preview + the `service` label.

### Search & filter
- A **pure** `filterCatalog(catalog, query, provider)` returns matches. `query` is lowercased and
  matched as a substring against `name + service + category + provider`. `provider` is `'all'` or a
  specific provider. Empty query + `'all'` returns the full catalog.
- The popover has a text input (auto-focused on open) and provider chips: All / AWS / Azure / GCP.
- The grid scrolls (capped max-height); result count is shown.

### Placement (pointer drag)
- **pointerdown** on a tile: `setPointerCapture(pointerId)`, mark drag active for `entry`, spawn a
  `position:fixed` ghost (the same preview, `pointer-events:none`) that follows the pointer.
- **pointermove**: reposition the ghost at the cursor.
- **pointerup**: read `canvas = canvasRegistry.get(editor)`. If present and the drop point is within
  `canvas.getBoundingClientRect()`, compute
  `world = editor.screenToWorld({ x: clientX − rect.left, y: clientY − rect.top })` and
  `editor.createNode({ type: 'icon', props: { icon: entry.name }, x: world.x − w/2, y: world.y − h/2 })`
  using the `icon` node util's default size. Otherwise discard (no node). Remove the ghost. The
  popover stays open for repeated placement.
- A tile **click without meaningful movement** (pointer moved < 4px between down and up) falls back to
  add-at-viewport-center, so the feature is usable without dragging.

### Popover lifecycle
Toggled by the button. Closes on Escape and on pointerdown outside the popover (but not while a drag
is in flight). Search text and provider filter reset on close (kept simple).

## Files

- `packages/icons-cloud/src/catalog.ts` (new) + barrel export — `cloudIconCatalog`, `IconCatalogEntry`.
- `packages/react/src/canvas-registry.ts` (new) — `registerCanvas`/`getCanvas` over a `WeakMap`.
- `packages/react/src/index.tsx` (modify) — register the canvas on mount.
- `packages/react/src/cloud-icon-picker.tsx` (new) — the component + `filterCatalog`.
- `packages/react/src/index.tsx` barrel (modify) — export `CloudIconPicker`, `filterCatalog`.
- `examples/browser/src/main.tsx` (modify) — replace placeholder select/button with `<CloudIconPicker>`.

## Error handling & edge cases

- No canvas registered (picker used without a mounted `<Nodus>`): drop is a no-op; click-to-center
  also no-ops safely.
- Drop outside canvas bounds: discarded, no node created.
- Unknown icon name in catalog (draw fn missing): tile renders an empty preview; drop still creates a
  node whose glyph resolves later. `installCloudIcons()` must run before the catalog is used.
- devicePixelRatio changes / high-DPI: preview canvas sized by dpr, matching the host's approach.

## Testing

- `@nodus/icons-cloud`: assert `cloudIconCatalog` has one entry per `ALLOWLIST` entry with matching
  `name/provider/service/category` (fold into the existing integrity test).
- `@nodus/react`: unit-test `filterCatalog` (query substring, provider filter, empty query).
- Browser E2E (playwright-core, matching existing checks): open picker → type a query → the grid
  filters → drag a tile onto the canvas → a new `icon` node exists at ~the drop point.

## Verification gate

`pnpm typecheck && pnpm test && pnpm verify:render`, plus the browser E2E and a manual drag in the
running demo.
