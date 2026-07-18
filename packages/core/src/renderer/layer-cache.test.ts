/**
 * Correctness gate for the static-layer cache: with a REAL rasterizer (`@napi-rs/canvas`), the
 * layered render path must be pixel-identical to the direct full-paint across several scenes and
 * after every interaction (move, theme swap, zoom, select, and multi-frame flow animation). If the
 * blit ever diverged from a direct paint, these diffs would be non-zero.
 */
import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { Editor, defaultTheme, type Ctx2D, type Id, type Snapshot, type Theme } from '../index.js';
import type { OffscreenLayer } from './layer-cache.js';

const W = 400;
const H = 300;

const offscreen = (w: number, h: number): OffscreenLayer => {
  const c = createCanvas(w, h);
  return { canvas: c as unknown as OffscreenLayer['canvas'], ctx: c.getContext('2d') as unknown as Ctx2D };
};

/** A deterministic scene (shared by both editors so ids/z match exactly). */
function buildSnapshot(): Snapshot {
  const ed = new Editor();
  const a = ed.createNode({ type: 'rect', x: 40, y: 40, w: 120, h: 80, label: 'A' });
  const b = ed.createNode({ type: 'rect', x: 240, y: 130, w: 120, h: 80, label: 'B' });
  const c = ed.createNode({ type: 'rect', x: 130, y: 190, w: 150, h: 70, label: 'C' }); // overlaps A & B
  ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b });
  ed.connect({ kind: 'outline', nodeId: b }, { kind: 'outline', nodeId: c });
  return ed.toJSON();
}

function load(snap: Snapshot, withCache: boolean): Editor {
  const ed = new Editor();
  ed.loadSnapshot(snap);
  if (withCache) ed.setOffscreenFactory(offscreen);
  return ed;
}

/** Render `frames` (ms times) in sequence onto a fresh canvas and return its raw device pixels. */
function pixels(ed: Editor, frames: number[], interactive = false, dpr = 2): Uint8ClampedArray {
  const canvas = createCanvas(W * dpr, H * dpr);
  const ctx = canvas.getContext('2d');
  for (const t of frames) ed.render(ctx as unknown as Ctx2D, W, H, dpr, interactive, t);
  return ctx.getImageData(0, 0, W * dpr, H * dpr).data;
}

/** Max per-channel byte difference between two equal-length pixel buffers. */
function maxDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  expect(a.length).toBe(b.length);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    if (d > m) m = d;
  }
  return m;
}

/** Apply the same interaction to two editors, then assert their frames are pixel-identical. The
 *  layered editor renders twice per compare so a cache HIT (the 2nd frame) is exercised, not only the
 *  building miss. */
function expectIdentical(
  snap: Snapshot,
  op: (ed: Editor) => void,
  frames: number[],
  interactive = false,
): void {
  const direct = load(snap, false);
  const layered = load(snap, true);
  op(direct);
  op(layered);
  const pd = pixels(direct, frames, interactive);
  const pl = pixels(layered, frames, interactive);
  expect(maxDiff(pd, pl)).toBe(0);
}

describe('static-layer cache is pixel-identical to a direct paint', () => {
  const snap = buildSnapshot();
  const nid = (ed: Editor, i: number): Id => ed.store.nodes()[i]!.id;

  it('a static scene (repeated frames hit the cache)', () => {
    expectIdentical(snap, () => {}, [0, 0, 0]);
  });

  it('after moving a node (cache miss → repaint)', () => {
    expectIdentical(snap, (ed) => ed.updateNode(nid(ed, 0), { x: 90, y: 70 }), [0, 0]);
  });

  it('after a theme swap', () => {
    const alt: Theme = { ...defaultTheme, palette: { ...defaultTheme.palette, accent: '#e11d48' } };
    expectIdentical(snap, (ed) => ed.setTheme(alt), [0, 0]);
  });

  it('after a zoom (camera change)', () => {
    expectIdentical(snap, (ed) => ed.zoomBy(1.4, { x: 200, y: 150 }), [0, 0]);
  });

  it('after selecting a node (interactive chrome drawn over the cached layer)', () => {
    expectIdentical(snap, (ed) => ed.select([nid(ed, 1)]), [0, 0], true);
  });

  it('across flow-animation frames (static hit, markers animate on top)', () => {
    const withFlow = (ed: Editor): void => {
      const e = ed.store.edges()[0]!.id;
      ed.setFlow([e], { style: 'dots', count: 4, speed: 60 });
    };
    // identical time sequence on both so the flow clocks advance in lock-step
    expectIdentical(snap, withFlow, [0, 120, 260, 400]);
  });

  it('the layer cache reports a hit on an unchanged repeat frame', () => {
    const ed = load(snap, true);
    const canvas = createCanvas(W * 2, H * 2);
    const ctx = canvas.getContext('2d');
    // Render the same frame twice: the 2nd is a cache HIT (blit of the bitmap the 1st built).
    ed.render(ctx as unknown as Ctx2D, W, H, 2, false, 0);
    ed.render(ctx as unknown as Ctx2D, W, H, 2, false, 0);
    const a = ctx.getImageData(0, 0, W * 2, H * 2).data;
    const direct = pixels(load(snap, false), [0]);
    expect(maxDiff(a, direct)).toBe(0);
  });
});

// ===========================================================================
// Drag fast path (dirty-region repaint) — the same pixel-identity gate, but for
// the case a plain version-keyed cache can't help: an active drag bumps the scene
// version every frame, so each frame is a MISS. The dirty-region path repaints
// only the changed sub-region over the retained bitmap; it must still be
// byte-for-byte identical to a direct full paint, on a real rasterizer, every frame.
// ===========================================================================

/**
 * Drive a multi-frame gesture: apply each step to a direct (no cache) and a layered (cache) editor,
 * render a frame after each on its own canvas, and assert the two are pixel-identical every frame. A
 * settle frame is rendered first so the layered editor holds a resident bitmap — hence the gesture
 * frames exercise the incremental region path, which is asserted to have actually run.
 */
function expectIdenticalGesture(
  snap: Snapshot,
  steps: Array<(ed: Editor) => void>,
  opts: { interactive?: boolean; dpr?: number; times?: number[]; setup?: (ed: Editor) => void } = {},
): Editor {
  const dpr = opts.dpr ?? 2;
  const interactive = opts.interactive ?? false;
  const direct = load(snap, false);
  const layered = load(snap, true);
  // one-time setup applied to BOTH editors before any frame (e.g. zoom / select / set flow), so the
  // static params (camera) are established once and held constant across the gesture — which is what
  // lets the drag frames take the incremental path instead of a per-frame full repaint.
  opts.setup?.(direct);
  opts.setup?.(layered);
  const dcanvas = createCanvas(W * dpr, H * dpr);
  const lcanvas = createCanvas(W * dpr, H * dpr);
  const dctx = dcanvas.getContext('2d');
  const lctx = lcanvas.getContext('2d');
  const read = (ctx: typeof dctx): Uint8ClampedArray =>
    ctx.getImageData(0, 0, W * dpr, H * dpr).data;

  const dc2d = dctx as unknown as Ctx2D;
  const lc2d = lctx as unknown as Ctx2D;

  // settle frame at t=times[0] (or 0): establishes the layered cache's bitmap + last-static snapshot.
  const t0 = opts.times?.[0] ?? 0;
  direct.render(dc2d, W, H, dpr, interactive, t0);
  layered.render(lc2d, W, H, dpr, interactive, t0);
  expect(maxDiff(read(dctx), read(lctx))).toBe(0);

  steps.forEach((step, i) => {
    step(direct);
    step(layered);
    const t = opts.times?.[i + 1] ?? 0;
    direct.render(dc2d, W, H, dpr, interactive, t);
    layered.render(lc2d, W, H, dpr, interactive, t);
    expect(maxDiff(read(dctx), read(lctx)), `gesture frame ${i}`).toBe(0);
  });

  // the drag frames must have gone through the region path, not silently fallen back to full repaints.
  expect(layered.layerCacheStats()?.regionPaints ?? 0).toBeGreaterThan(0);
  return layered;
}

/** Deterministic z-order scene: three rects with distinct z (creation order). `mid` (middle z) is the
 *  mover — dragging it into the overlap must keep `low` (z below) under it and `high` (z above) over it. */
function buildZScene(): Snapshot {
  const ed = new Editor();
  ed.createNode({ type: 'rect', x: 60, y: 120, w: 150, h: 95, label: 'LOW' }); // z0 (lowest)
  ed.createNode({ type: 'rect', x: 175, y: 55, w: 95, h: 60, label: 'MID' }); //  z1 (mover)
  ed.createNode({ type: 'rect', x: 205, y: 120, w: 150, h: 95, label: 'HIGH' }); // z2 (highest)
  return ed.toJSON();
}

describe('drag fast path is pixel-identical to a direct paint', () => {
  const nid = (ed: Editor, i: number): Id => ed.store.nodes()[i]!.id;

  it('single-node drag (region repaint each frame) matches a direct full paint', () => {
    const snap = buildSnapshot();
    // move node A along a path, including over the overlap with C
    const path = [
      { x: 70, y: 60 },
      { x: 110, y: 110 },
      { x: 150, y: 160 },
      { x: 180, y: 175 },
      { x: 150, y: 120 },
    ];
    expectIdenticalGesture(
      snap,
      path.map((p) => (ed: Editor) => ed.updateNode(nid(ed, 0), p)),
    );
  });

  it('z-order trap: a mid-z mover stays under a higher-z node and over a lower-z node', () => {
    const snap = buildZScene();
    // drag MID (z1) down into the region where it overlaps both LOW (z0) and HIGH (z2)
    const path = [
      { x: 175, y: 80 },
      { x: 170, y: 110 },
      { x: 165, y: 135 },
      { x: 160, y: 150 },
      { x: 175, y: 145 },
    ];
    expectIdenticalGesture(
      snap,
      path.map((p) => (ed: Editor) => ed.updateNode(nid(ed, 1), p)),
    );
  });

  it('multi-select drag (two nodes move per frame)', () => {
    const snap = buildZScene();
    // move LOW and HIGH together each frame — two changed items → two dirty rects. Positions are
    // ABSOLUTE per frame (a shared running offset would be advanced once per editor and desync them).
    const frames = [
      { lo: { x: 70, y: 112 }, hi: { x: 215, y: 112 } },
      { lo: { x: 82, y: 118 }, hi: { x: 227, y: 118 } },
      { lo: { x: 76, y: 130 }, hi: { x: 221, y: 130 } },
      { lo: { x: 62, y: 126 }, hi: { x: 207, y: 126 } },
    ];
    expectIdenticalGesture(
      snap,
      frames.map((f) => (ed: Editor) => {
        ed.updateNode(nid(ed, 0), f.lo);
        ed.updateNode(nid(ed, 2), f.hi);
      }),
    );
  });

  it('drag with a flow edge present (static edge reflows in-region, markers animate on top)', () => {
    const snap = buildSnapshot();
    // drag B (both edges A→B and B→C reflow); advance the flow clock in lock-step across frames
    const path = [
      { x: 250, y: 120 },
      { x: 230, y: 100 },
      { x: 210, y: 90 },
      { x: 240, y: 140 },
    ];
    expectIdenticalGesture(
      snap,
      path.map((p) => (ed: Editor) => ed.updateNode(nid(ed, 1), p)),
      {
        times: [0, 120, 260, 400, 520],
        setup: (ed) => ed.setFlow([ed.store.edges()[0]!.id], { style: 'dots', count: 4, speed: 60 }),
      },
    );
  });

  it('drag a node off the viewport edge (culled → old footprint cleared)', () => {
    const snap = buildSnapshot();
    // walk node A rightward until it leaves the 400×300 viewport entirely, then a step fully outside
    const path = [
      { x: 200, y: 40 },
      { x: 320, y: 40 },
      { x: 420, y: 40 }, // partly past the right edge
      { x: 620, y: 40 }, // fully outside → item culled → disappeared-clear path
      { x: 620, y: 260 },
    ];
    expectIdenticalGesture(
      snap,
      path.map((p) => (ed: Editor) => ed.updateNode(nid(ed, 0), p)),
    );
  });

  it('drag while zoomed and while selected (interactive chrome over an in-region repaint)', () => {
    const snap = buildZScene();
    // zoom + select ONCE (held constant during the drag → camera stable → region path runs), then drag
    // the selected node. Selection handles are drawn by the (uncached) interactive pass over the blit.
    const path = [
      { x: 175, y: 90 },
      { x: 165, y: 120 },
      { x: 160, y: 145 },
      { x: 180, y: 130 },
    ];
    expectIdenticalGesture(
      snap,
      path.map((p) => (ed: Editor) => ed.updateNode(nid(ed, 1), p)),
      {
        interactive: true,
        setup: (ed) => {
          ed.zoomBy(1.35, { x: 200, y: 150 });
          ed.select([nid(ed, 1)]);
        },
      },
    );
  });
});
