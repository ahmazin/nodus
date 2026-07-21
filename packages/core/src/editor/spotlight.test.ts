/**
 * Spotlight/focus (S4): selecting a node dims + desaturates everything outside its connected subgraph,
 * and live-flow visuals collapse to the active edges. `focusSet()` is the single source of truth for
 * "what stays full-bright" — consumed by `paintStaticInto` (muted override), `staticPrefix` (cache-key
 * focus signature), and `drawFlowEdges` (flow collapse).
 *
 * THE risk this file guards against: the muted override is a STATIC-LAYER effect keyed off `selectedAtom`,
 * but the static layer's cache key (`staticPrefix` + `sceneIndex.version`) does not otherwise depend on
 * selection at all (selection lives in a separate atom the scene index never touches). Without folding a
 * focus signature into `staticPrefix`, selecting a different node changes neither the scene-index version
 * nor (absent this fix) the static prefix, so the offscreen cache (the real browser runtime path, via
 * `setOffscreenFactory`) would blit the SAME stale bitmap across a selection change — exactly the bug
 * class `motion-cache.test.ts` closed for `presentationEpoch`. The second `describe` block below drives
 * `editor.render()` with a real rasterizer and the cache enabled, and asserts painted pixels actually
 * change when the selection changes.
 */
import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { Editor, type Ctx2D } from '../index.js';
import type { OffscreenLayer } from '../renderer/layer-cache.js';

const offscreen = (w: number, h: number): OffscreenLayer => {
  const c = createCanvas(w, h);
  return { canvas: c as unknown as OffscreenLayer['canvas'], ctx: c.getContext('2d') as unknown as Ctx2D };
};

/** Sum of per-channel absolute differences between two RGBA pixel reads — 0 iff byte-identical. */
function pixelDiff(a: Uint8ClampedArray | Buffer, b: Uint8ClampedArray | Buffer): number {
  let d = 0;
  for (let i = 0; i < 4; i++) d += Math.abs(a[i]! - b[i]!);
  return d;
}

/** A—B connected by an edge, C isolated (no edge touches it). Mirrors the brief's fixture. */
function build(): { ed: Editor; a: ReturnType<Editor['createNode']>; b: ReturnType<Editor['createNode']>; c: ReturnType<Editor['createNode']>; e: NonNullable<ReturnType<Editor['connect']>> } {
  const ed = new Editor({ viewport: { w: 800, h: 600 } });
  const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 60, h: 40 });
  const b = ed.createNode({ type: 'rect', x: 200, y: 0, w: 60, h: 40 });
  const c = ed.createNode({ type: 'rect', x: 0, y: 200, w: 60, h: 40 });
  const e = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b });
  if (!e) throw new Error('connect() unexpectedly returned null');
  return { ed, a, b, c, e };
}

describe('focusSet', () => {
  it('is null with no selection or spotlight off', () => {
    const ed = new Editor({ viewport: { w: 800, h: 600 } });
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 60, h: 40 });
    expect(ed.focusSet()).toBeNull();
    ed.select([a]);
    expect(ed.focusSet()).not.toBeNull();
    ed.setSpotlight(false);
    expect(ed.focusSet()).toBeNull();
    // turning spotlight back on with the selection still live restores the focus set
    ed.setSpotlight(true);
    expect(ed.focusSet()).not.toBeNull();
  });

  it('includes selected node + incident edges + neighbors, excludes unconnected', () => {
    const { ed, a, b, c, e } = build();
    ed.select([a]);
    const f = ed.focusSet()!;
    expect(f).not.toBeNull();
    expect(f.has(a)).toBe(true);
    expect(f.has(e)).toBe(true);
    expect(f.has(b)).toBe(true);
    expect(f.has(c)).toBe(false);
  });

  it('a selected edge includes its own endpoints, excludes unconnected', () => {
    const { ed, a, b, c, e } = build();
    ed.select([e]);
    const f = ed.focusSet()!;
    expect(f).not.toBeNull();
    expect(f.has(e)).toBe(true);
    expect(f.has(a)).toBe(true);
    expect(f.has(b)).toBe(true);
    expect(f.has(c)).toBe(false);
  });

  it('deselecting clears the focus set back to null', () => {
    const { ed, a } = build();
    ed.select([a]);
    expect(ed.focusSet()).not.toBeNull();
    ed.clearSelection();
    expect(ed.focusSet()).toBeNull();
  });
});

describe('static-layer cache tracks the spotlight focus signature (selection changes must invalidate)', () => {
  it('a non-focused node’s painted pixels differ across a selection change, WITH the offscreen cache enabled', () => {
    const W = 500;
    const H = 500;
    const ed = new Editor({ viewport: { w: W, h: H } });
    ed.setOffscreenFactory(offscreen); // cache ON — the real browser runtime path

    // A—B connected; C isolated and far enough away that only its own paint touches its center pixel.
    const a = ed.createNode({ type: 'rect', x: 100, y: 100, w: 80, h: 40 }); // center (140,120)
    const b = ed.createNode({ type: 'rect', x: 300, y: 100, w: 80, h: 40 }); // center (340,120)
    const c = ed.createNode({ type: 'rect', x: 100, y: 300, w: 80, h: 40 }); // center (140,320)
    ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b });

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const c2d = ctx as unknown as Ctx2D;
    const cCenter = { x: 140, y: 320 };

    // Frame 1: no selection — spotlight has nothing to focus (`focusSet()` is null), so C paints at its
    // normal, full-bright appearance. This seeds the static-layer cache's cold bitmap.
    ed.render(c2d, W, H, 1, false, 0);
    const basePixel = ctx.getImageData(cCenter.x, cCenter.y, 1, 1).data.slice();

    // Frame 2: select A. Neither the store nor `sceneIndex.version` changed — only `selectedAtom` did —
    // so under the OLD code (no focus signature in `staticPrefix`) this frame's cache key would be
    // IDENTICAL to frame 1's, and the cache would blit the SAME stale (un-muted) bitmap for C: this
    // assertion would fail (RED under the bug, GREEN with the `staticPrefix` fix).
    ed.select([a]);
    ed.render(c2d, W, H, 1, false, 0);
    const mutedPixel = ctx.getImageData(cCenter.x, cCenter.y, 1, 1).data.slice();
    expect(pixelDiff(basePixel, mutedPixel)).toBeGreaterThan(10);

    // Frame 3: change the selection to C itself. C is now IN focus (full-bright again), while A/B are
    // muted. Under the OLD code this frame would share frame 2's cache key too (same camera/theme/dpr,
    // no store mutation) and blit the SAME muted-for-C bitmap — `focusedPixel` would wrongly equal
    // `mutedPixel`. The fix's `|sl:...` signature changes between "a selected" and "c selected", forcing
    // a real repaint.
    ed.select([c]);
    ed.render(c2d, W, H, 1, false, 0);
    const focusedPixel = ctx.getImageData(cCenter.x, cCenter.y, 1, 1).data.slice();
    expect(pixelDiff(mutedPixel, focusedPixel)).toBeGreaterThan(10);
    // C selected ⇒ C is focused ⇒ paints with no muted override at all, same as the no-selection baseline.
    expect(pixelDiff(basePixel, focusedPixel)).toBe(0);

    // Frame 4: spotlight OFF while A is still selected — `focusSet()` back to null, so no muted override
    // anywhere and the focus signature drops out of `staticPrefix` too. Must reproduce the plain baseline.
    ed.setSpotlight(false);
    ed.select([a]);
    ed.render(c2d, W, H, 1, false, 0);
    const spotlightOffPixel = ctx.getImageData(cCenter.x, cCenter.y, 1, 1).data.slice();
    expect(pixelDiff(basePixel, spotlightOffPixel)).toBe(0);
  });

  it('no-selection frames still take the normal cache fast path (spotlight adds no overhead when idle)', () => {
    const W = 400;
    const H = 300;
    const ed = new Editor({ viewport: { w: W, h: H } });
    ed.setOffscreenFactory(offscreen);
    ed.createNode({ type: 'rect', x: 100, y: 100, w: 80, h: 40 });

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const c2d = ctx as unknown as Ctx2D;

    ed.render(c2d, W, H, 1, false, 0); // cold — one full repaint builds the bitmap
    const first = ctx.getImageData(140, 120, 1, 1).data.slice();
    // No selection ever made: `focusSet()` is null on every frame, so the focus signature never enters
    // `staticPrefix` and repeated frames share the same key — same invariant `motion-cache.test.ts` pins
    // for `presentationEpoch` staying constant when no presentation is ever set.
    ed.render(c2d, W, H, 1, false, 50);
    ed.render(c2d, W, H, 1, false, 130);
    const later = ctx.getImageData(140, 120, 1, 1).data.slice();
    expect(pixelDiff(first, later)).toBe(0);
    expect(ed.layerCacheStats()?.fullPaints).toBe(1);
  });
});
