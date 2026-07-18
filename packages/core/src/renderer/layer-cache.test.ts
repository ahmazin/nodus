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
