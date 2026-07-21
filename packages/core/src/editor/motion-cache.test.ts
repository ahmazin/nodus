/**
 * Regression gate for a CRITICAL bug: the ephemeral presentation map (alpha/scale/dx/dy — used by
 * entrance animation, layout glide, and grab-lift spring-back) was INVISIBLE to the static-layer
 * cache's invalidation key. `paintStatic`'s cache key is `staticPrefix` (theme|camera|viewport|dpr)
 * plus `sceneIndex.version`; a presentation-only tween mutates neither the store nor the scene index,
 * so with the offscreen cache ON (the real browser runtime, via `editor.setOffscreenFactory`) two
 * animating frames shared an identical key and the cache blitted the SAME stale bitmap for the whole
 * tween — the animation never rendered, freezing the node at its seeded first frame until an unrelated
 * pan/zoom/select finally busted the key.
 *
 * `motion.test.ts`'s existing tween tests never enable the offscreen cache (`setOffscreenFactory` is
 * never called there), so they pass regardless of this bug — they only assert the PRESENTATION DATA
 * changes correctly, never that a cached render actually PAINTS it. This file closes that gap by
 * driving `editor.render()` with a real rasterizer (`@napi-rs/canvas`, same pattern as
 * `renderer/layer-cache.test.ts`) and a cache installed, and asserting the painted pixels actually
 * change across an animating tween.
 */
import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { Editor, type Ctx2D } from '../index.js';
import type { OffscreenLayer } from '../renderer/layer-cache.js';

const W = 400;
const H = 300;

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

describe('static-layer cache tracks presentation-only tweens (entrance/glide/lift)', () => {
  it('animateEntrance paints a visibly different node-center pixel across an animating frame, WITH the cache enabled', () => {
    const ed = new Editor({ viewport: { w: W, h: H } });
    ed.setOffscreenFactory(offscreen); // cache ON — the real browser runtime path
    // rect at (100,100,80,40) at the default camera (0,0,1) and dpr=1 → device center = (140,120)
    const id = ed.createNode({ type: 'rect', x: 100, y: 100, w: 80, h: 40 });
    const cx = 140;
    const cy = 120;

    ed.animateEntrance([id]); // seeds alpha 0 / scale 0.92 synchronously (before any render/tick)

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const c2d = ctx as unknown as Ctx2D;

    // Frame 1 (t=0): seeds the tween's clock baseline; alpha ≈ 0 — node is all but invisible, so the
    // center pixel reads as background/grid, not the node's fill.
    ed.render(c2d, W, H, 1, false, 0);
    const atStart = ctx.getImageData(cx, cy, 1, 1).data.slice();

    // Frame 2 (t=200ms): well into the 260ms entrance tween — alpha has risen well above 0. Under the
    // OLD code (no `presentationEpoch` folded into `staticPrefix`), this frame's static cache key is
    // IDENTICAL to frame 1's (no store mutation occurred — only the private `presentation` map
    // changed), so `paintStatic`'s drag fast path sees an empty dirty region (no changed `RenderItem`
    // references) and blits the SAME stale bitmap from frame 1 — `atMid` would equal `atStart` exactly,
    // failing the assertion below (RED under the old code; GREEN with the `presentationEpoch` fix).
    ed.render(c2d, W, H, 1, false, 200);
    const atMid = ctx.getImageData(cx, cy, 1, 1).data.slice();

    expect(ed.presentationFor(id)?.alpha).toBeGreaterThan(0.5); // sanity: the tween really did advance
    expect(pixelDiff(atStart, atMid)).toBeGreaterThan(10);

    // Frame 3 (t=400ms): past the tween's 260ms end — presentation clears, node reaches its true
    // resting appearance. Must NOT be frozen at the seeded first frame (`atStart`).
    ed.render(c2d, W, H, 1, false, 400);
    expect(ed.presentationFor(id)).toBeUndefined();
    const atRest = ctx.getImageData(cx, cy, 1, 1).data.slice();
    expect(pixelDiff(atRest, atStart)).toBeGreaterThan(10);

    // The resting frame must be a TRUE repaint at the final state, not a leftover mid-tween blit:
    // compare against a fresh, uncached, non-animated editor painting the identical resting scene.
    const reference = new Editor({ viewport: { w: W, h: H } });
    reference.createNode({ type: 'rect', x: 100, y: 100, w: 80, h: 40 });
    const refCanvas = createCanvas(W, H);
    const refCtx = refCanvas.getContext('2d');
    reference.render(refCtx as unknown as Ctx2D, W, H, 1, false, 0);
    const refPixel = refCtx.getImageData(cx, cy, 1, 1).data;
    expect(pixelDiff(atRest, refPixel)).toBe(0);
  });

  it('a static scene with NO presentation still caches/blits correctly (the epoch does not break normal caching)', () => {
    const ed = new Editor({ viewport: { w: W, h: H } });
    ed.setOffscreenFactory(offscreen);
    ed.createNode({ type: 'rect', x: 100, y: 100, w: 80, h: 40 });

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const c2d = ctx as unknown as Ctx2D;

    ed.render(c2d, W, H, 1, false, 0); // cold — one full repaint builds the bitmap
    const first = ctx.getImageData(140, 120, 1, 1).data.slice();
    // Repeated frames with nothing live (no tween, no store change) must reproduce the exact same
    // pixels — the presentationEpoch must stay constant (0) when no presentation is ever set, so these
    // frames share the SAME static prefix as frame 1 and take the incremental fast path with an empty
    // dirty region (no changed `RenderItem`), not a fresh full repaint each time.
    ed.render(c2d, W, H, 1, false, 50);
    ed.render(c2d, W, H, 1, false, 130);
    const later = ctx.getImageData(140, 120, 1, 1).data.slice();
    expect(pixelDiff(first, later)).toBe(0);
    expect(ed.layerCacheStats()?.fullPaints).toBe(1); // only the initial cold paint — epoch didn't drift
  });
});
