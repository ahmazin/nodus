/**
 * Dirty-region planning for the static-layer cache's DRAG fast path.
 *
 * The `StaticLayerCache` blits a cached bitmap of the whole static pass on frames whose static inputs
 * are unchanged (hover/selection/marquee/flow). But an *active drag* bumps `sceneIndex.version` every
 * frame, so the static key misses and a naive cache full-repaints every visible item each frame. This
 * module computes the small region that actually changed, so a drag frame repaints only the items in
 * that region (over the retained previous bitmap) instead of the whole scene.
 *
 * Correctness (pixel-identity) rests on three facts, all exploited below:
 *
 *  1. **Object identity is the change signal.** `SceneIndex.applyChanges` rebuilds a *new* `RenderItem`
 *     for any add/update (and for every edge that reflows when an endpoint node moves). So an item whose
 *     `RenderItem` reference is unchanged between two frames painted the exact same static pixels; a
 *     changed reference (or an appeared/disappeared id) is the complete set of what moved.
 *
 *  2. **Draw stays within `aabb` + a bounded bleed.** A node/edge `draw()` may paint slightly outside
 *     its geometry `aabb` — a centred stroke (half its width, world-scaled) and a glow (`shadowBlur`,
 *     which Canvas-2D applies in *device* space, so a constant margin). `staticPaintBleed` bounds both.
 *     The same assumption already underpins the scene index's viewport culling.
 *
 *  3. **A 1:1 integer sub-rect blit is byte-exact.** The dirty rects are rounded *outward* to whole
 *     device pixels. The changed items are painted UNCLIPPED into a scratch buffer (so their
 *     anti-aliasing is natural — a clip whose edge crosses a stroke/fill transition would *not*
 *     reproduce that pixel), then each dirty rect is copied 1:1 from scratch to the composited layer.
 *     Within each rect the scratch equals a full direct paint, so the copy is identical; everything
 *     outside is carried over unchanged from the previous frame.
 *
 * Everything here is pure and framework-free so it can be unit-tested directly.
 */

import type { Box, Camera, Id } from '../model.js';
import type { RenderItem } from '../scene-index/index.js';

/** A device-pixel rectangle with integer, canvas-clamped edges. Shares `Box`'s shape. */
export type DeviceRect = Box;

/**
 * Device-space padding added around each item's `aabb` when computing dirty rects, so the region
 * provably covers everything the item draws. Two terms:
 *  - a **constant** for the glow (`shadowBlur` is device-space, unaffected by the CTM; the builtin
 *    blur of 12 bleeds ~21px — measured — so 32 clears it with headroom);
 *  - a **world-scaled** term (`× z·dpr`) for the centred stroke half-width and edge arrowheads, which
 *    do scale with zoom.
 * Generous by design: a larger region is always still pixel-identical (it only redraws more), so this
 * trades a little repaint work for a wide safety margin. A custom type whose `draw` bleeds further than
 * this (e.g. a very large shadow) would need the constant widened — the layer-cache tests would catch it.
 */
export function staticPaintBleed(cam: Camera, dpr: number): number {
  return 32 + 8 * cam.z * dpr;
}

/**
 * Map a world-space `aabb` to a device rect: pad by `bleed`, round *outward* to integer device pixels,
 * and clamp to the `dw×dh` canvas. Returns `null` if the padded rect falls entirely outside the canvas
 * (nothing to repaint there) or if the box is non-finite (a corrupt record — the caller bails to a full
 * paint, which tolerates such records via the per-item paint guard).
 */
export function deviceRectOf(
  aabb: Box,
  cam: Camera,
  dpr: number,
  bleed: number,
  dw: number,
  dh: number,
): DeviceRect | null {
  const s = cam.z * dpr;
  const x0 = (aabb.x - cam.x) * s - bleed;
  const y0 = (aabb.y - cam.y) * s - bleed;
  const x1 = (aabb.x + aabb.w - cam.x) * s + bleed;
  const y1 = (aabb.y + aabb.h - cam.y) * s + bleed;
  if (!Number.isFinite(x0 + y0 + x1 + y1)) return null;
  let lx = Math.floor(x0);
  let ly = Math.floor(y0);
  let hx = Math.ceil(x1);
  let hy = Math.ceil(y1);
  if (lx < 0) lx = 0;
  if (ly < 0) ly = 0;
  if (hx > dw) hx = dw;
  if (hy > dh) hy = dh;
  if (hx <= lx || hy <= ly) return null;
  return { x: lx, y: ly, w: hx - lx, h: hy - ly };
}

/** Do two device rects overlap? (Touching edges do not count — they share no pixel.) */
export function rectsIntersect(a: DeviceRect, b: DeviceRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Do two device rects overlap OR touch (share an edge/corner)? Used by `mergeRects` so the result is
 *  strictly disjoint — no two rects even abut — which is what makes clipping to them one-at-a-time exact. */
function overlapOrTouch(a: DeviceRect, b: DeviceRect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/**
 * Merge a set of device rects into a disjoint set (no two overlap or touch) by repeatedly replacing any
 * overlapping/touching pair with their bounding box. This keeps the copy-back cheap — one 1:1 blit per
 * rect with no region blitted twice — and, because the repaint set is recomputed against the *merged*
 * rects, any item a merge's bounding box now covers is included in the paint, so the scratch stays
 * complete inside every rect. A merged box only ever *grows* the region, so coverage — and thus
 * correctness — is preserved. O(n²) in the (tiny) rect count.
 */
export function mergeRects(rects: readonly DeviceRect[]): DeviceRect[] {
  const out = rects.map((r) => ({ ...r }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (overlapOrTouch(out[i]!, out[j]!)) {
          const a = out[i]!;
          const b = out[j]!;
          const x = Math.min(a.x, b.x);
          const y = Math.min(a.y, b.y);
          const w = Math.max(a.x + a.w, b.x + b.w) - x;
          const h = Math.max(a.y + a.h, b.y + b.h) - y;
          out[i] = { x, y, w, h };
          out.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return out;
}

/** The outcome of planning a drag frame. */
export interface DirtyPlan {
  /** Integer, device-pixel, canvas-clamped rects whose UNION is the region to repaint. */
  rects: DeviceRect[];
  /** Visible items (in the supplied paint order) whose padded device rect touches the region. */
  repaint: RenderItem[];
  /** Sum of `rects` areas (overlaps double-counted): a conservative upper bound used to bail to a
   *  full paint when the "dirty" region is most of the canvas (nothing gained by going incremental). */
  area: number;
}

/**
 * Diff the previous frame's visible set (`prev`, keyed by id → the `RenderItem` painted then) against
 * the current visible set (`current`, already in paint order) to produce the region a drag frame must
 * repaint, plus which items to repaint in it.
 *
 * A dirty rect is added for every item that changed (its reference differs), appeared, or disappeared —
 * using both its old and new footprint — so the union covers every pixel that could differ from the
 * previous frame. The repaint set is every current item whose footprint touches that union, so overlaps
 * (the z-order trap: a static item that must stay above/below a moving one) are redrawn in true paint
 * order within the region.
 *
 * Returns `null` to signal "cannot plan — do a full paint" (a changed item has a non-finite footprint).
 * An empty plan (`rects: []`) is valid and means nothing visible changed: the retained bitmap is already
 * correct and the caller repaints nothing.
 */
export function planDirtyRegion(
  prev: Map<Id, RenderItem>,
  current: RenderItem[],
  cam: Camera,
  dpr: number,
  dw: number,
  dh: number,
): DirtyPlan | null {
  const bleed = staticPaintBleed(cam, dpr);
  const rects: DeviceRect[] = [];
  const curIds = new Set<Id>();

  for (const it of current) {
    curIds.add(it.id);
    const before = prev.get(it.id);
    if (before === it) continue; // same object → identical static pixels, nothing to do
    // changed or newly-appeared: its current footprint is dirty
    const rc = deviceRectOf(it.aabb, cam, dpr, bleed, dw, dh);
    if (rc === null && !isFiniteBox(it.aabb)) return null; // corrupt geometry → full paint
    if (rc) rects.push(rc);
    if (before) {
      // moved/restyled: the old footprint must be cleared too
      const rb = deviceRectOf(before.aabb, cam, dpr, bleed, dw, dh);
      if (rb === null && !isFiniteBox(before.aabb)) return null;
      if (rb) rects.push(rb);
    }
  }

  // disappeared (culled out of view / deleted): clear where they were
  for (const [id, before] of prev) {
    if (curIds.has(id)) continue;
    const rb = deviceRectOf(before.aabb, cam, dpr, bleed, dw, dh);
    if (rb === null && !isFiniteBox(before.aabb)) return null;
    if (rb) rects.push(rb);
  }

  // Collapse to a strictly-disjoint set: the caller clips to each one separately (single-rect clips are
  // byte-exact), and disjointness means no pixel is painted twice.
  const disjoint = mergeRects(rects);

  let area = 0;
  for (const r of disjoint) area += r.w * r.h;

  const repaint: RenderItem[] = [];
  if (disjoint.length > 0) {
    for (const it of current) {
      const r = deviceRectOf(it.aabb, cam, dpr, bleed, dw, dh);
      if (r && disjoint.some((d) => rectsIntersect(r, d))) repaint.push(it);
    }
  }

  return { rects: disjoint, repaint, area };
}

function isFiniteBox(b: Box): boolean {
  return Number.isFinite(b.x + b.y + b.w + b.h);
}
