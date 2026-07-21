/**
 * Pure paint helpers. Each assumes a specific transform is already set on the context:
 * `fillBackground` (device px), `drawGrid` (CSS px), `paintItem` (world). Works with any `Ctx2D`.
 */

import type { ResolvedTokens, Theme } from '../theme/index.js';
import type { Box, Camera, EdgeRecord, FlowSpec, NodeRecord, Vec2 } from '../model.js';
import type { EdgeRegistry, NodeRegistry, NodeUtil } from '../registries/index.js';
import type { RenderItem } from '../scene-index/index.js';
import { DrawApi, hashId } from './draw-api.js';
import type { Ctx2D } from './context.js';
import { resolveTokensCached } from './token-cache.js';

// ---- per-item paint fault tolerance ----

type PaintErrorHandler = (err: unknown, record: NodeRecord | EdgeRecord) => void;

const seenPaintErrors = new Set<string>();

/**
 * Default handler: report the first error per `(record, version)` so a persistently-throwing `draw()`
 * doesn't spam the console at 60fps; a fresh edit (new version) reports again. Surfaced, never swallowed.
 */
const defaultPaintErrorHandler: PaintErrorHandler = (err, record) => {
  const key = `${record.id}@${record.version}`;
  if (seenPaintErrors.has(key)) return;
  if (seenPaintErrors.size > 1024) seenPaintErrors.clear();
  seenPaintErrors.add(key);
  console.error(`[nodus] skipped painting ${record.type} ${record.id}:`, err);
};

let paintErrorHandler: PaintErrorHandler = defaultPaintErrorHandler;

/** Override how per-item paint errors are surfaced (default: deduped `console.error`). `null` silences. */
export function setPaintErrorHandler(handler: PaintErrorHandler | null): void {
  paintErrorHandler = handler ?? (() => {});
  seenPaintErrors.clear();
}

/** A small dashed marker over the item's *cached* bounds — makes a skipped record visible without
 *  re-invoking its (possibly broken) geometry/draw code. Fully self-contained ctx state. */
function drawErrorPlaceholder(ctx: Ctx2D, aabb: Box): void {
  if (!Number.isFinite(aabb.x + aabb.y + aabb.w + aabb.h)) return;
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#ef4444';
  ctx.strokeRect(aabb.x, aabb.y, aabb.w, aabb.h);
  ctx.restore();
}

export function fillBackground(ctx: Ctx2D, theme: Theme, deviceW: number, deviceH: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, deviceW, deviceH);
  ctx.fillStyle = theme.canvas.fill;
  ctx.fillRect(0, 0, deviceW, deviceH);
}

/** Subtle parallax factor for ambient wash centers relative to camera pan — small enough that the
 *  wash reads as fixed background depth, not a tracking spotlight. */
const AMBIENT_PARALLAX_K = 0.04;

/**
 * Ambient background wash: soft radial color glows plus an inner vignette, drawn in device-px space
 * (identity transform, like `fillBackground` — caller sets it up first). Editor chrome only — never
 * called from `paintRegion`, so exported PNGs/SVGs stay clean. No-op when `theme.canvas.ambient` is
 * undefined. Wash centers drift opposite the camera pan by a small `AMBIENT_PARALLAX_K` factor, giving
 * a subtle parallax as the user pans — the wash feels like it sits behind the diagram, not glued to it.
 */
export function drawAmbient(ctx: Ctx2D, theme: Theme, cam: Camera, deviceW: number, deviceH: number): void {
  const ambient = theme.canvas.ambient;
  if (!ambient) return;
  // guard a non-finite camera (NaN/Infinity pan or zoom) the same way `drawGrid` does — a bad parallax
  // offset must not corrupt the gradient centers or throw mid-frame.
  if (!Number.isFinite(cam.x + cam.y + cam.z)) return;
  if (!Number.isFinite(deviceW) || !Number.isFinite(deviceH) || deviceW <= 0 || deviceH <= 0) return;

  const diagonal = Math.hypot(deviceW, deviceH);
  const parallaxX = -cam.x * AMBIENT_PARALLAX_K;
  const parallaxY = -cam.y * AMBIENT_PARALLAX_K;

  ctx.save();
  for (const wash of ambient.washes) {
    const cx = wash.cx * deviceW + parallaxX;
    const cy = wash.cy * deviceH + parallaxY;
    const r = wash.r * diagonal;
    if (r <= 0) continue;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    gradient.addColorStop(0, wash.color);
    gradient.addColorStop(1, 'rgba(0,0,0,0)'); // fades to fully transparent — an additive glow, not a tint
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, deviceW, deviceH);
  }
  if (ambient.vignette) {
    const cx = deviceW / 2;
    const cy = deviceH / 2;
    const r = diagonal / 2;
    const vignette = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, `rgba(0,0,0,${ambient.vignette})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, deviceW, deviceH);
  }
  ctx.restore();
}

/** Dot grid, drawn in CSS-pixel space (caller sets transform to `[dpr,0,0,dpr,0,0]`). */
export function drawGrid(ctx: Ctx2D, theme: Theme, cam: Camera, cssW: number, cssH: number): void {
  const grid = theme.canvas.grid;
  if (!grid) return;
  // a non-finite camera (NaN/Infinity pan or zoom, e.g. from a bad host pan calc or corrupt restore)
  // would make the break conditions below always false → an infinite loop that freezes the tab
  if (!Number.isFinite(cam.x + cam.y + cam.z)) return;
  const step = grid.size * cam.z;
  if (step < 6) return; // too dense to be useful — skip
  ctx.save();
  ctx.fillStyle = grid.color;
  const startX = Math.floor(cam.x / grid.size) * grid.size;
  const startY = Math.floor(cam.y / grid.size) * grid.size;
  for (let wx = startX; ; wx += grid.size) {
    const sx = (wx - cam.x) * cam.z;
    if (sx > cssW) break;
    for (let wy = startY; ; wy += grid.size) {
      const sy = (wy - cam.y) * cam.z;
      if (sy > cssH) break;
      ctx.fillRect(sx - 0.6, sy - 0.6, 1.2, 1.2);
    }
  }
  ctx.restore();
}

/**
 * Draw a node, applying its `rotation` (radians, clockwise about the node's bounding-box center — the
 * frozen contract shared with hit-testing and the select tool) as a canvas transform around the util's
 * own axis-aligned `draw`. The transform is bracketed by its OWN `save`/`restore` in a `finally`, so a
 * throwing `draw()` can't leak the rotation onto the rest of the frame — and because that restore runs
 * *before* the exception reaches `paintItem`, the error placeholder there is drawn in the world
 * (un-rotated) frame. A zero, absent, or non-finite rotation draws with no transform (identity fast path).
 */
function paintNode(
  ctx: Ctx2D,
  api: DrawApi,
  node: NodeRecord,
  util: NodeUtil | undefined,
  tokens: ResolvedTokens,
): void {
  if (!util) return;
  const rot = node.rotation;
  if (!rot || !Number.isFinite(rot)) {
    util.draw(api, node, tokens);
    return;
  }
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  ctx.save();
  try {
    // rotate about the box center: shift the origin there, rotate, shift back (Canvas2D +y is down,
    // so a positive angle is clockwise — matches the contract with no sign flip).
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.translate(-cx, -cy);
    util.draw(api, node, tokens);
  } finally {
    ctx.restore();
  }
}

/** Optional per-item ephemeral paint modifier (see `Editor.presentationFor`). Kept structural — a
 *  local twin of the editor's `Presentation` — to avoid a renderer → editor import cycle. */
export interface ItemPresentation {
  alpha: number;
  scale: number;
  dx: number;
  dy: number;
}

/** Paint one scene item (caller sets the world transform). `present`, when non-identity, multiplies
 *  `globalAlpha` and applies a scale/offset about the item's `aabb` center before drawing; identity or
 *  omitted is the exact prior behavior (fast path) — layer-cache output is unchanged. */
export function paintItem(
  ctx: Ctx2D,
  item: RenderItem,
  nodes: NodeRegistry,
  edges: EdgeRegistry,
  theme: Theme,
  present?: ItemPresentation,
): void {
  const rec = item.record;
  let tokens: ResolvedTokens;
  try {
    tokens = resolveTokensCached(theme, rec);
  } catch (err) {
    // even token resolution can throw on a corrupt record/theme — skip the item, keep the frame.
    paintErrorHandler(err, rec);
    return;
  }
  // Per-shape jitter seed for the optional sketchy style (see DrawApi). A stable hash of the record id
  // means the hand-drawn wobble is identical every frame, reload, and headless export — never random,
  // never serialized. It is inert unless a resolved token carries roughness > 0.
  const api = new DrawApi(ctx, tokens, hashId(rec.id));
  ctx.save();
  try {
    ctx.globalAlpha *= tokens.opacity;
    if (present && (present.alpha !== 1 || present.scale !== 1 || present.dx !== 0 || present.dy !== 0)) {
      ctx.globalAlpha *= present.alpha;
      const cx = item.aabb.x + item.aabb.w / 2;
      const cy = item.aabb.y + item.aabb.h / 2;
      ctx.translate(cx + present.dx, cy + present.dy);
      ctx.scale(present.scale, present.scale);
      ctx.translate(-cx, -cy);
    }
    if (item.kind === 'node') {
      paintNode(ctx, api, rec as NodeRecord, nodes.get(rec.type), tokens);
    } else if (item.route) {
      edges.get(rec.type)?.draw(api, rec as EdgeRecord, tokens, item.route);
    }
  } catch (err) {
    // A single malformed record (NaN geometry, a throwing third-party draw()) must never abort the
    // whole frame — skip just this item, surface the error, and mark it so the gap isn't silent.
    paintErrorHandler(err, rec);
    drawErrorPlaceholder(ctx, item.aabb);
  } finally {
    // a throwing/early-returning draw() must not leak the save() and permanently dim globalAlpha for
    // every later item on the frame
    ctx.restore();
  }
}

// ---- interactive-layer helpers (world transform) ----

export function strokeWorldBox(
  ctx: Ctx2D,
  b: Box,
  color: string,
  width: number,
  dash?: number[],
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.restore();
}

export function fillHandle(ctx: Ctx2D, p: Vec2, size: number, fill: string, stroke: string): void {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(p.x - size / 2, p.y - size / 2, size, size);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function pointAtDistance(route: Vec2[], seg: number[], d: number): Vec2 {
  let acc = 0;
  for (let i = 0; i < seg.length; i++) {
    const len = seg[i]!;
    if (acc + len >= d) {
      const t = len === 0 ? 0 : (d - acc) / len;
      const a = route[i]!;
      const b = route[i + 1]!;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    acc += len;
  }
  return route[route.length - 1]!;
}

/** Draw animated flow markers (packets or marching dashes) along an edge's route with the given
 *  (already data-resolved) `flow` spec. `time` is ms; caller has set the world transform. */
export function paintFlowMarkers(ctx: Ctx2D, item: RenderItem, theme: Theme, time: number, flow: FlowSpec): void {
  const rec = item.record as EdgeRecord;
  const route = item.route;
  if (!flow || !route || route.length < 2) return;

  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    const l = Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.y - route[i - 1]!.y);
    seg.push(l);
    total += l;
  }
  if (total < 1) return;

  const tokens = resolveTokensCached(theme, rec);
  const color = flow.color ?? tokens.stroke;
  const speed = flow.speed ?? 70;
  const dir = flow.reverse ? -1 : 1;
  const t = time / 1000;

  ctx.save();
  if (flow.style === 'dash') {
    const dash = (flow.size ?? 6) * 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = flow.size ?? tokens.strokeWidth ?? 1.5;
    ctx.setLineDash([dash, dash]);
    ctx.lineDashOffset = -dir * t * speed;
    ctx.beginPath();
    ctx.moveTo(route[0]!.x, route[0]!.y);
    for (let i = 1; i < route.length; i++) ctx.lineTo(route[i]!.x, route[i]!.y);
    ctx.stroke();
  } else {
    const size = flow.size ?? 3;
    const count = Math.max(1, flow.count ?? Math.round(total / 90));
    const spacing = total / count;
    const advance = (((t * speed) % spacing) + spacing) % spacing;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 2.5;
    for (let k = 0; k < count; k++) {
      let d = advance + k * spacing;
      if (dir < 0) d = total - d;
      d = ((d % total) + total) % total;
      const p = pointAtDistance(route, seg, d);
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
