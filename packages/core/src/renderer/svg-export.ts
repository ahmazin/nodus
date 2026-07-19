/**
 * `renderSVG(editor, opts)` — vector export mirroring `editor.toPNG`, but emitting an SVG string
 * instead of rasterizing. It reuses the exact same `editor.paintRegion` pipeline, driven by an
 * `SVGContext` (a `Ctx2D` that records draw calls as markup). Region/padding/background/grid/flow
 * options match `ToPNGOptions` so callers can swap PNG for SVG with the same shape.
 *
 * Unlike PNG, SVG is resolution-independent, so `pixelRatio` defaults to 1: the output is authored in
 * world/CSS units (viewBox `0 0 w h`) rather than device pixels. Pass a higher ratio only if you want
 * the coordinate space pre-scaled.
 */

import type { Box } from '../model.js';
// Type-only import: erased at compile time, so this does not create a runtime cycle with the editor.
import type { Editor } from '../editor/index.js';
import { padBox } from '../geometry/index.js';
import { SVGContext } from './svg-context.js';

export interface RenderSVGOptions {
  /** Coordinate pre-scale. Default 1 — SVG is resolution-independent, so device pixels aren't needed. */
  pixelRatio?: number;
  /** World-unit padding added around the content bounds. Default 40 (matches `toPNG`). */
  padding?: number;
  /** Paint the theme's canvas fill as a background rect. Default true. */
  background?: boolean;
  /** Paint the dot grid. Default false. */
  grid?: boolean;
  /** World region to export (default: the whole content bounds). */
  bounds?: Box;
  /** Also emit a snapshot of flow markers (packets/dashes) at `time` ms. Default off. */
  flow?: boolean;
  time?: number;
}

/**
 * Render the editor's scene to a self-contained, deterministic SVG document string. Empty scenes
 * still produce a valid `<svg>` (a 100×100 padded region), matching `toPNG`'s empty-content fallback.
 */
export function renderSVG(editor: Editor, opts: RenderSVGOptions = {}): string {
  const bounds = opts.bounds ?? editor.sceneIndex.contentBounds() ?? { x: 0, y: 0, w: 100, h: 100 };
  const pad = opts.padding ?? 40;
  const region = padBox(bounds, pad);
  const ratio = opts.pixelRatio ?? 1;
  const w = Math.max(1, Math.ceil(region.w * ratio));
  const h = Math.max(1, Math.ceil(region.h * ratio));
  const ctx = new SVGContext();
  editor.paintRegion(ctx, region, ratio, {
    background: opts.background ?? true,
    grid: opts.grid ?? false,
    ...(opts.flow ? { flow: true, time: opts.time ?? 0 } : {}),
  });
  return ctx.toSVG(w, h);
}
