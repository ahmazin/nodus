---
layout: ../../layouts/DocsLayout.astro
title: Performance & scaling
description: The measured render envelope, how the render path scales, the known camera-pan cliff, and the tuning knobs — history.limit, flowConfig.maxFps, and setOffscreenFactory.
---

Nodus's render path is engineered for scale — R-tree culling, a retained layer cache, and
dirty-region repaint keep **interaction** cost proportional to what's *visible*, not to the whole
document. This page documents the measured envelope, the one known cliff, and the knobs you can turn.

## Measured envelope

These numbers are produced by the committed benchmark (`pnpm bench`, headless via `@napi-rs/canvas`)
so the claims match reproducible measurements rather than adjectives.

> Numbers are hardware- and date-dependent — regenerate on your own machine with `pnpm bench`.
> Baseline below measured on Node v22 (`frames=8`, `hitQueries=5000`, `reflowSteps=200`). The
> **Render** rows are the deliberately-worst-case *cache-free* `paintRegion` full-scene export path,
> **not** the interactive layer-cached `render()` path (see "How the render path scales").

| Scenario | N = 500 | N = 2000 |
|---|---|---|
| Build (create nodes + edges) | ~40 ms | ~67 ms |
| Render — full-scene export (cold) | ~133 ms | ~384 ms |
| Render — full-scene export (warm) | ~95 ms | ~330 ms |
| Drag reflow (per gesture step) | ~0.09 ms | ~0.14 ms |
| Hit-test (per query) | ~3.2 µs | ~1.7 µs |

Hit-testing is **single-digit microseconds** and drag reflow **well under a millisecond** at 2000
nodes — the interaction paths are fast because they are `O(visible)`, not `O(N)`. The benchmark also
asserts structural layer-cache invariants: a cold frame is one full static paint, idle and drag
frames take the incremental region-repaint path (no full repaint), and a **camera pan forces a full
static repaint** — the one known cliff, documented below.

## How the render path scales

A frame paints in layers: **static** (background + grid + every visible item in paint order) → flow
markers → overlays → interactive chrome. Only the static pass touches every visible node, so that's
the expensive part — and three mechanisms keep it cheap:

- **R-tree culling.** The rbush scene index answers "what's in the viewport?" and "what's under the
  cursor?" without scanning the whole document — so hit-testing and viewport queries are
  `O(visible + log N)`, not `O(N)`.
- **Retained layer cache.** The static pass is rendered once into an offscreen bitmap and **blitted**
  on subsequent frames whose static inputs are unchanged — hover, marquee, selection, a connect-draft
  line, and every flow-animation frame reuse the cached bitmap instead of repainting the scene.
- **Dirty-region drag repaint.** Dragging repaints only the sub-region that actually changed over the
  retained bitmap, not the whole canvas.

The net effect: as long as the camera doesn't move, cost tracks what's on screen and what you're
touching — not the document size.

## The known cliff: camera pan/zoom

There is one documented limit. **Any camera change (pan or zoom) invalidates the cache key and forces
a full `O(N)` static repaint.** With a whole large scene visible this is the slow path — an internal
probe measured roughly **175 ms/frame at 2000 nodes fully visible** (to be confirmed by `pnpm bench`),
which is exactly the zoom-to-fit navigation a large imported estate produces.

Two things keep this from being worse, and one is on the roadmap:

- **The rAF loop is frame-capped.** `flowConfig.maxFps` defaults to **30**, so even on the slow path
  the loop doesn't spin the CPU trying to hit 60 — navigation stays responsive rather than locking up.
- **Pan fast path (roadmap).** Blitting the retained layer at the new offset and repainting only the
  exposed edge strips would make pan interactive at 2000 nodes. It's on the *Now* list, gated on
  proving it stays pixel-identical to a direct paint; if that can't be proven cleanly it's deferred and
  this cliff stays documented rather than hidden. **Zoom LOD** (dropping labels/detail below a zoom
  threshold) is a *Later* follow-up.

There is **no CI performance gate yet** — the bench exists to measure and to catch regressions once
it's wired in; it does not currently block merges.

## Tuning knobs

### `history.limit` — bound undo memory

Undo history defaults to **500 entries**. Pass `Infinity` to opt out (unbounded), or a smaller number
for memory-tight hosts:

```ts
const editor = new Editor({ history: { limit: 200 } });   // cap at 200 undo entries
const unlimited = new Editor({ history: { limit: Infinity } }); // opt out of the cap
```

### `flowConfig.maxFps` and `animateSelection` — idle CPU

The animation loop is capped at `maxFps` (default **30**). If you don't want the selection halo to
keep the loop alive at all, disable it — the halo then renders static and the loop can idle when
nothing else animates:

```ts
editor.setFlowConfig({ maxFps: 30, animateSelection: false });
```

### `setOffscreenFactory` — the layer cache for non-React hosts

The retained layer cache is **opt-in**: the engine only builds one when a host injects an
offscreen-canvas factory. **`@nodus-dev/react` wires this for you automatically.** If you're driving
the engine from a **vanilla / non-React host**, you must provide the factory yourself, or every frame
full-repaints:

```ts
import { Editor } from '@nodus-dev/core';

const editor = new Editor();
// ...register node/edge types and drive your own render loop against a <canvas>...

// Give the engine an offscreen surface so it can cache the static layer and blit
// it on frames that don't change it (hover, marquee, selection, flow animation):
editor.setOffscreenFactory((w, h) => {
  const canvas = new OffscreenCanvas(w, h); // or document.createElement('canvas')
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
});
```

Confirm it's engaged with `editor.layerCacheStats()` — `hits` should climb on repeated static frames
(hover/selection), and `regionPaints` should increment during a drag.

## Bundle budgets

Gzipped size budgets for the published `@nodus-dev/core` and `@nodus-dev/react` builds are enforced by
`size-limit`. The committed numbers are recorded here once measured — _to be generated by the size
job_.

## Recommendations

- **Node ceiling.** Interaction stays smooth at documents in the low thousands of nodes as long as you
  aren't holding the whole scene zoomed-out and panning — that's the cliff above.
- **Prefer working zoomed-in.** Pan/zoom cost is `O(visible)` only while the *whole* scene isn't on
  screen; working at a normal editing zoom keeps navigation cheap.
- **Non-React hosts: set the offscreen factory.** It's the single biggest win for a vanilla
  integration — without it you forfeit the entire layer cache.
- **Respect reduced motion.** The engine already disables halo/flow animation under
  `prefers-reduced-motion`; don't override it.

## See also

- [Headless rendering](/docs/headless) — the render path and the `CreateCanvas` injection contract.
- [Support matrix](/docs/support-matrix) · [Concepts](/docs/concepts) — the scene index and signals
  the render path builds on.
