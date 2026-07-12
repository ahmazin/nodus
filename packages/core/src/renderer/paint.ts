/**
 * Pure paint helpers. Each assumes a specific transform is already set on the context:
 * `fillBackground` (device px), `drawGrid` (CSS px), `paintItem` (world). Works with any `Ctx2D`.
 */

import { resolveTokens, type Theme } from '../theme/index.js';
import type { Box, Camera, EdgeRecord, FlowSpec, NodeRecord, Vec2 } from '../model.js';
import type { EdgeRegistry, NodeRegistry } from '../registries/index.js';
import type { RenderItem } from '../scene-index/index.js';
import { DrawApi } from './draw-api.js';
import type { Ctx2D } from './context.js';

export function fillBackground(ctx: Ctx2D, theme: Theme, deviceW: number, deviceH: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, deviceW, deviceH);
  ctx.fillStyle = theme.canvas.fill;
  ctx.fillRect(0, 0, deviceW, deviceH);
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

/** Paint one scene item (caller sets the world transform). */
export function paintItem(
  ctx: Ctx2D,
  item: RenderItem,
  nodes: NodeRegistry,
  edges: EdgeRegistry,
  theme: Theme,
): void {
  const rec = item.record;
  const tokens = resolveTokens(theme, rec.visual, rec.type, rec.style);
  const api = new DrawApi(ctx, tokens);
  ctx.save();
  try {
    ctx.globalAlpha *= tokens.opacity;
    if (item.kind === 'node') {
      nodes.get(rec.type)?.draw(api, rec as NodeRecord, tokens);
    } else if (item.route) {
      edges.get(rec.type)?.draw(api, rec as EdgeRecord, tokens, item.route);
    }
  } finally {
    // a throwing draw() (malformed record, NaN geometry) must not leak the save() and permanently
    // dim globalAlpha for every later item on the frame
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

  const tokens = resolveTokens(theme, rec.visual, rec.type, rec.style);
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
