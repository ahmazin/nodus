/**
 * Image node (`diagram.image`) + a decode-once image cache. Renders a raster image (typically a
 * `data:` URI pasted or inserted onto the canvas) that participates in hit-test, bounds, culling and
 * PNG export like any other node. `naturalWidth`/`naturalHeight` are kept in props so aspect ratio
 * survives a resize even before/without a successful decode.
 *
 * Decoding is environment-pluggable:
 *  - In a browser the default decoder uses the global `Image` constructor. That decode is async, so
 *    the node paints a placeholder until pixels arrive, then the registered invalidator repaints.
 *  - Headless hosts (Node/Skia) register their own decoder via `setImageDecoder` — e.g.
 *    `@napi-rs/canvas`'s `Image`, whose `src = Buffer` decodes synchronously:
 *      setImageDecoder((src) => { const i = new Image();
 *        i.src = Buffer.from(src.slice(src.indexOf(',') + 1), 'base64'); return i; });
 * With no decoder available (plain Node, no host wiring) the node still renders a labelled placeholder
 * and never throws, so `pnpm verify:render` (Skia) stays safe.
 */

import { Rectangle2d, type NodeRecord, type NodeUtil } from '@nodus/core';

export interface ImageNodeProps {
  /** Image source — a `data:` URI (self-contained, canonical-serializable) or a URL. */
  src: string;
  /** Intrinsic pixel size, kept so aspect ratio survives resize even before/without decode. */
  naturalWidth: number;
  naturalHeight: number;
  /** Accessible description, also used as placeholder text before the image decodes. */
  alt?: string;
  /** How the image fills its (possibly differently-proportioned) box. Default `'contain'`. */
  fit?: 'contain' | 'cover';
}

/** A decoded image handle. Structurally matches `HTMLImageElement` / `ImageBitmap` / napi `Image`. */
interface DecodedImage {
  readonly width: number;
  readonly height: number;
}

/**
 * Decodes `src` into a `DecodedImage`. May return one whose `width` is still 0 while it decodes
 * asynchronously, calling `onReady` once the pixels land. Returns `undefined` if it cannot decode here.
 */
export type ImageDecoder = (src: string, onReady: () => void) => DecodedImage | undefined;

interface MutableImage extends DecodedImage {
  width: number;
  height: number;
  onload: (() => void) | null;
  decoding?: string;
  src: string;
}

function browserDecoder(): ImageDecoder | undefined {
  const ImageCtor = (globalThis as { Image?: new () => MutableImage }).Image;
  if (typeof ImageCtor !== 'function') return undefined;
  return (src, onReady) => {
    const img = new ImageCtor();
    img.onload = onReady;
    img.decoding = 'async';
    img.src = src;
    return img;
  };
}

let decoder: ImageDecoder | undefined = browserDecoder();
let invalidate: () => void = () => {};
const cache = new Map<string, DecodedImage | null>();

/** Register how image sources decode in this environment (headless hosts plug in Skia here). Passing
 *  `null` restores the browser default. Clears the decode cache so sources re-decode. */
export function setImageDecoder(next: ImageDecoder | null): void {
  decoder = next ?? browserDecoder();
  cache.clear();
}

/** Register a repaint trigger, called when an async decode completes (default: no-op). Hosts wire this
 *  to their frame loop so decoded images appear without needing an unrelated interaction. */
export function setImageInvalidator(fn: () => void): void {
  invalidate = fn;
}

/** Decoded image for `src`, or `undefined` until it is ready / if it cannot be decoded here. Decodes
 *  each distinct source at most once. */
export function getImage(src: string): DecodedImage | undefined {
  if (!src) return undefined;
  const cached = cache.get(src);
  if (cached !== undefined) return cached && cached.width > 0 ? cached : undefined;
  if (!decoder) {
    cache.set(src, null);
    return undefined;
  }
  const img = decoder(src, invalidate) ?? null;
  cache.set(src, img);
  return img && img.width > 0 ? img : undefined;
}

/** Drop cached decodes (mainly for tests / memory pressure). */
export function clearImageCache(): void {
  cache.clear();
}

/** Longest side of the default node size for a freshly-inserted image (keeps big images on-screen). */
const MAX_DEFAULT = 320;

function readProps(n: NodeRecord): ImageNodeProps {
  const p = n.props as Partial<ImageNodeProps>;
  const nw = typeof p.naturalWidth === 'number' && p.naturalWidth > 0 ? p.naturalWidth : 1;
  const nh = typeof p.naturalHeight === 'number' && p.naturalHeight > 0 ? p.naturalHeight : 1;
  return {
    src: typeof p.src === 'string' ? p.src : '',
    naturalWidth: nw,
    naturalHeight: nh,
    ...(typeof p.alt === 'string' ? { alt: p.alt } : {}),
    fit: p.fit === 'cover' ? 'cover' : 'contain',
  };
}

function defaultSize(p: Partial<ImageNodeProps>): { w: number; h: number } {
  const w = typeof p.naturalWidth === 'number' && p.naturalWidth > 0 ? p.naturalWidth : 1;
  const h = typeof p.naturalHeight === 'number' && p.naturalHeight > 0 ? p.naturalHeight : 1;
  const scale = Math.min(1, MAX_DEFAULT / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

export const imageNode: NodeUtil = {
  type: 'diagram.image',
  getDefaultProps: () => ({ src: '', naturalWidth: 1, naturalHeight: 1, fit: 'contain' }),
  getDefaultSize: (p) => defaultSize(p as Partial<ImageNodeProps>),
  getGeometry: (n) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  getPorts: () => [
    { id: 'in', kind: 'target', anchor: { x: 0.5, y: 0 } },
    { id: 'out', kind: 'source', anchor: { x: 0.5, y: 1 } },
    { id: 'l', kind: 'both', anchor: { x: 0, y: 0.5 } },
    { id: 'r', kind: 'both', anchor: { x: 1, y: 0.5 } },
  ],
  capabilities: { canResize: true, canRotate: true },
  draw: (api, n, t) => {
    const p = readProps(n);
    const box = { x: n.x, y: n.y, w: n.w, h: n.h };
    const img = getImage(p.src);
    if (img) {
      api.image(img, box, { fit: p.fit });
      return;
    }
    // Not decoded (or headless without a decoder): a neutral placeholder so the node stays visible,
    // selectable and exportable. Must never throw — keeps `verify:render` (Skia) safe.
    api.fillRoundRect(box, t.radius, t.fill);
    api.strokeRoundRect(box, t.radius, t.stroke, { width: t.strokeWidth, dash: [4, 4] });
    const label = p.alt && p.alt.length > 0 ? p.alt : 'Image';
    api.label(label, { x: n.x + n.w / 2, y: n.y + n.h / 2 }, { color: t.text, maxWidth: n.w - 12 });
  },
};
