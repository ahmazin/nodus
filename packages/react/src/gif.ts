/**
 * Animated GIF export — a raster fallback for the animated-SVG flow export
 * (`renderSVG(editor, { animateFlow: true })`). SVG animation doesn't play in some raster-only
 * destinations (notably GitHub READMEs), so this renders N frames of the diagram with the flow
 * snapshot advancing and encodes them into a looping GIF with `gifenc`.
 *
 * Region/ratio/bounds computation mirrors `renderPngBlob`/`toPNG` (`clipboard.ts`,
 * `packages/core/src/editor/index.ts`): pad the content bounds, clamp to the browser's max canvas
 * dimension, then drive `editor.paintRegion` into a canvas — except here we paint `frames` times with
 * `flow: true` and an advancing `time`, and encode the pixel grabs instead of a single PNG.
 */
import { padBox, type Box, type Ctx2D, type Editor } from '@nodus-dev/core';
// `gifenc` ships no type declarations (plain JS; no `types`/`typings` field, and no `@types/gifenc`
// package exists), so the bare import is a TS7016 error under `strict`. Neither ambient-declaration
// form fixes it: a full `declare module 'gifenc' { ... }` is rejected as an invalid "augmentation"
// (TS2665) because the specifier already resolves to a real (untyped) JS file, and even the shorthand
// `declare module 'gifenc';` hits the same TS2665 here for the same reason. Suppressing the one
// expected diagnostic and typing the bindings ourselves (below) is the smallest fix that doesn't touch
// any file outside this package.
// @ts-expect-error TS7016 — see note above; 'gifenc' has no shipped or `@types/*` declarations.
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

type RGBAData = Uint8Array | Uint8ClampedArray;
type GIFPalette = number[][];

interface GIFWriteFrameOptions {
  palette?: GIFPalette;
  first?: boolean;
  transparent?: boolean;
  transparentIndex?: number;
  delay?: number;
  repeat?: number;
  colorDepth?: number;
  dispose?: number;
}

interface GIFEncoderInstance {
  writeFrame(index: Uint8Array, width: number, height: number, opts?: GIFWriteFrameOptions): void;
  finish(): void;
  bytes(): Uint8Array;
  bytesView(): Uint8Array;
  writeHeader(): void;
  reset(): void;
  readonly buffer: ArrayBuffer;
}

const quantizeTyped = quantize as (rgba: RGBAData, maxColors: number, options?: Record<string, unknown>) => GIFPalette;
const applyPaletteTyped = applyPalette as (rgba: RGBAData, palette: GIFPalette, format?: string) => Uint8Array;
const GIFEncoderTyped = GIFEncoder as (opts?: { auto?: boolean; initialCapacity?: number }) => GIFEncoderInstance;

export interface FlowGIFOptions {
  /** Number of frames to render. Default: `round((loopMs / 1000) * fps)`. */
  frames?: number;
  /** Frames per second — also sets each frame's GIF `delay` (`round(1000 / fps)` ms). Default 12. */
  fps?: number;
  /** Total loop duration in ms that `time` advances across all frames. Default 2000. */
  loopMs?: number;
  /** Device-pixel scale, like `pixelRatio` in `ImageExportOptions`. Default 2 (crisp). */
  scale?: number;
  /** Explicit export region (world units), padded like content bounds. Default: content bounds. */
  bounds?: Box;
}

/** Max canvas dimension browsers accept (~Chromium/Firefox); larger throws on construct or getContext.
 *  Same cap `renderPngBlob` uses, so a big diagram degrades to a smaller export instead of crashing. */
const MAX_DIM = 16384;

/** Padding (world units) added around the export region — matches `renderPngBlob`'s default. */
const PADDING = 24;

/**
 * Render `opts.frames` (default derived from `fps`/`loopMs`) snapshots of the diagram with the flow
 * animation advancing, and encode them into a looping animated GIF.
 *
 * Each frame quantizes and applies its OWN color palette (rather than one palette shared across all
 * frames): the flow overlay recolors edges as it advances, so the dominant colors in a frame can shift
 * over the loop, and gifenc lets every frame after the first carry its own local color table while
 * still sharing one GIF stream/header. That's a small per-frame size cost for meaningfully better
 * fidelity than quantizing once (e.g. from just the first frame) and reusing that palette throughout.
 *
 * Note: the loop isn't perfectly seamless when edges animate at different flow speeds — each edge's
 * phase at `time = 0` and `time = loopMs` only lines up on a whole-cycle boundary for that edge's own
 * period, not necessarily for every edge at once. Acceptable for a raster fallback of the SVG export.
 */
export async function exportFlowGIF(editor: Editor, opts: FlowGIFOptions = {}): Promise<Blob> {
  const bounds = opts.bounds ?? editor.sceneIndex.contentBounds();
  if (!bounds) throw new Error('exportFlowGIF: nothing to export — the diagram is empty');
  const region = padBox(bounds, PADDING);

  const fps = opts.fps ?? 12;
  const loopMs = opts.loopMs ?? 2000;
  const frameCount = Math.max(1, opts.frames ?? Math.round((loopMs / 1000) * fps));

  // Clamp so neither dimension exceeds the browser cap — downscale the effective ratio rather than
  // throwing a RangeError on a huge diagram (same approach as `renderPngBlob`).
  const wanted = opts.scale ?? 2;
  const fit = Math.min(1, MAX_DIM / Math.max(1, region.w * wanted), MAX_DIM / Math.max(1, region.h * wanted));
  const ratio = wanted * fit;
  const w = Math.min(MAX_DIM, Math.max(1, Math.ceil(region.w * ratio)));
  const h = Math.min(MAX_DIM, Math.max(1, Math.ceil(region.h * ratio)));

  let canvas: HTMLCanvasElement | OffscreenCanvas;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(w, h);
  } else {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    canvas = c;
  }
  const raw = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!raw) throw new Error('exportFlowGIF: could not acquire a 2D canvas context');

  const gif = GIFEncoderTyped();
  const delay = Math.round(1000 / fps);

  for (let i = 0; i < frameCount; i++) {
    const time = (i / frameCount) * loopMs;
    editor.paintRegion(raw as unknown as Ctx2D, region, ratio, { background: true, flow: true, time });
    const { data } = raw.getImageData(0, 0, w, h);
    const palette = quantizeTyped(data, 256);
    const index = applyPaletteTyped(data, palette);
    gif.writeFrame(index, w, h, { palette, delay });
  }

  gif.finish(); // GIF loops by default (gifenc's default `repeat: 0` = forever)
  // `new Uint8Array(...)` re-copies into a plain `ArrayBuffer`-backed view: `gif.bytes()` types as
  // `Uint8Array<ArrayBufferLike>`, which (as of TS's newer typed-array generics) `BlobPart` doesn't
  // accept directly since `ArrayBufferLike` admits `SharedArrayBuffer`.
  return new Blob([new Uint8Array(gif.bytes())], { type: 'image/gif' });
}
