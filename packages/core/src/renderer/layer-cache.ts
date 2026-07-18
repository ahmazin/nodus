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

export class StaticLayerCache {
  private layer: OffscreenLayer | null = null;
  private key: string | null = null;
  private w = 0;
  private h = 0;
  /** Object → identity id, for keying on theme identity. */
  readonly idOf = identity();

  constructor(private readonly create: CreateOffscreen) {}

  /**
   * Ensure the cached static layer matches `key` at device size `dw×dh` — repainting it via `paint`
   * on a miss — then blit it 1:1 onto `target`. `paint(ctx)` must render the static frame exactly as
   * the direct path would. Returns true on a cache HIT (blit only), false on a MISS (repaint + blit).
   */
  draw(target: Ctx2D, key: string, dw: number, dh: number, paint: (ctx: Ctx2D) => void): boolean {
    const hit = this.layer !== null && this.key === key && this.w === dw && this.h === dh;
    if (!hit) {
      if (this.layer === null || this.w !== dw || this.h !== dh) {
        this.layer = this.create(dw, dh);
        this.w = dw;
        this.h = dh;
      }
      const lctx = this.layer.ctx;
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, dw, dh);
      paint(lctx);
      this.key = key;
    }
    // 1:1 blit at device resolution — the source is exactly dw×dh, so there is no scaling/resample.
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.drawImage(this.layer!.canvas, 0, 0, dw, dh);
    return hit;
  }

  /** Force the next `draw` to repaint (e.g. if a host swaps the theme by mutation rather than swap). */
  invalidate(): void {
    this.key = null;
  }
}
