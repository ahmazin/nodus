/**
 * Static-layer cache for the render loop.
 *
 * The editor paints a frame as: static (background + grid + every visible item, in true paint order)
 * → flow markers → overlays → interactive chrome. Only the STATIC pass touches every visible node, so
 * it is the expensive part; yet the host re-emits whole frames for reasons that don't change the
 * static layer at all — hover, marquee, selection, a connect-draft line, and every flow-animation
 * frame. This cache renders the static pass once into an offscreen bitmap and blits it on subsequent
 * frames whose *static inputs* are unchanged.
 *
 * Correctness: `paintStatic` is a pure function of `(theme identity, camera, viewport, dpr,
 * sceneIndex.version)`. The cache key is exactly those inputs, so a cache HIT blits the very bitmap a
 * direct paint would have produced, and any static-affecting change (edit, move, pan, zoom, theme
 * swap, viewport/dpr change) misses the key and repaints. The blit is 1:1 at device resolution (no
 * scale), so it is pixel-identical to the direct paint. This is proven by `layer-cache.test.ts`,
 * which diffs layered vs. direct output across scenes and interactions with a real rasterizer.
 *
 * The cache is OPT-IN: the editor only builds one when a host injects an offscreen-canvas factory
 * (`editor.setOffscreenFactory`). With no factory (headless default, plain tests) the editor paints
 * directly, exactly as before.
 */

import type { Box } from '../model.js';
import type { Ctx2D, DrawableImage } from './context.js';

/** An offscreen drawing surface: a canvas-like object (has width/height) plus its 2D context. */
export interface OffscreenLayer {
  readonly canvas: DrawableImage;
  readonly ctx: Ctx2D;
}

/** Allocate an offscreen surface of the given device pixel size. Host-provided so the core stays
 *  DOM-free (browser: an OffscreenCanvas / `<canvas>`; headless: `@napi-rs/canvas`). */
export type CreateOffscreen = (w: number, h: number) => OffscreenLayer;

/** Assigns a stable small integer to each distinct object, so a theme/object can be part of a string
 *  cache key by identity (themes are swapped by replacing the object, never mutated in place). */
function identity(): (obj: object) => number {
  const ids = new WeakMap<object, number>();
  let next = 1;
  return (obj: object): number => {
    let id = ids.get(obj);
    if (id === undefined) {
      id = next++;
      ids.set(obj, id);
    }
    return id;
  };
}

/** Cheap render-loop counters (do not affect output). Lets a host/test confirm which path ran. */
export interface LayerCacheStats {
  /** Frames served by a 1:1 blit of an unchanged bitmap (static inputs identical). */
  hits: number;
  /** Frames that repainted the whole static pass into the layer (cold, or a non-drag static change). */
  fullPaints: number;
  /** Frames that repainted only a dirty sub-region over the retained bitmap (the drag fast path). */
  regionPaints: number;
}

export class StaticLayerCache {
  private layer: OffscreenLayer | null = null;
  /** Scratch buffer for the drag fast path: the changed items are painted UNCLIPPED here, then the dirty
   *  sub-rects are copied back to `layer`. Same device size as `layer`; reallocated on resize. */
  private scratch: OffscreenLayer | null = null;
  private key: string | null = null;
  private w = 0;
  private h = 0;
  /** Object → identity id, for keying on theme identity. */
  readonly idOf = identity();
  /** Path counters — diagnostic only, never read by the paint itself. */
  readonly stats: LayerCacheStats = { hits: 0, fullPaints: 0, regionPaints: 0 };

  constructor(private readonly create: CreateOffscreen) {}

  /**
   * Ensure the cached static layer matches `key` at device size `dw×dh` — repainting it via `paint`
   * on a miss — then blit it 1:1 onto `target`. `paint(ctx)` must render the static frame exactly as
   * the direct path would. Returns true on a cache HIT (blit only), false on a MISS (repaint + blit).
   */
  draw(target: Ctx2D, key: string, dw: number, dh: number, paint: (ctx: Ctx2D) => void): boolean {
    const hit = this.layer !== null && this.key === key && this.w === dw && this.h === dh;
    if (hit) {
      this.stats.hits++;
    } else {
      if (this.layer === null || this.w !== dw || this.h !== dh) {
        this.layer = this.create(dw, dh);
        this.scratch = null; // stale size — reallocated lazily by the next `repaint`
        this.w = dw;
        this.h = dh;
      }
      const lctx = this.layer.ctx;
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, dw, dh);
      paint(lctx);
      this.key = key;
      this.stats.fullPaints++;
    }
    // 1:1 blit at device resolution — the source is exactly dw×dh, so there is no scaling/resample.
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.drawImage(this.layer!.canvas, 0, 0, dw, dh);
    return hit;
  }

  /** True iff a resident, non-invalidated layer of exactly this device size is available to repaint
   *  incrementally over — the precondition the caller checks before calling `repaint`. */
  hasValidLayer(dw: number, dh: number): boolean {
    return this.layer !== null && this.key !== null && this.w === dw && this.h === dh;
  }

  /**
   * Drag fast path: refresh only `dirtyRects` of the previously-composited layer, then blit 1:1.
   *
   * `paint` renders the static frame — background, grid, and the changed items — into a SCRATCH buffer,
   * UNCLIPPED. The dirty sub-rects are then copied from scratch back onto the layer. Why not clip the
   * paint directly onto the layer? A clip whose edge falls on an anti-aliased feature (a node's
   * stroke→fill transition) does not reproduce that pixel exactly — the clipped stroke rasterizes
   * differently at the boundary row. Painting unclipped keeps every item's anti-aliasing natural; the
   * only boundary is then the copy rectangle, and a 1:1 integer sub-rect blit is an exact byte copy.
   *
   * Pixel-identical to a full repaint by construction: `dirtyRects` are integer device rects, and within
   * each one the scratch equals a full direct paint (every item touching the rect is in the painted
   * subset — see `planDirtyRegion`), so the copy carries exactly those pixels; everything outside stays as
   * the last frame left it (already equal to a direct paint). An empty `dirtyRects` leaves the layer as-is.
   *
   * Precondition: `hasValidLayer(this.w, this.h)`. `paint` must clear+fill the whole context it is given
   * (the standard static paint does) so the scratch carries no stale content from a previous frame.
   */
  repaint(target: Ctx2D, key: string, dirtyRects: Box[], paint: (ctx: Ctx2D) => void): void {
    const layer = this.layer!;
    if (dirtyRects.length > 0) {
      if (this.scratch === null) this.scratch = this.create(this.w, this.h);
      paint(this.scratch.ctx); // full, unclipped: bg + grid + changed items, into scratch
      const lctx = layer.ctx;
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const r of dirtyRects) {
        // clear then 1:1 copy so the result is exactly the scratch pixels (independent of source alpha)
        lctx.clearRect(r.x, r.y, r.w, r.h);
        lctx.drawImage(this.scratch.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
      }
    }
    this.key = key;
    this.stats.regionPaints++;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.drawImage(layer.canvas, 0, 0, this.w, this.h);
  }

  /** Force the next `draw` to repaint (e.g. if a host swaps the theme by mutation rather than swap). */
  invalidate(): void {
    this.key = null;
  }
}
