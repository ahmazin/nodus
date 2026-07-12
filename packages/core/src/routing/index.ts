/**
 * Pluggable edge routing. A `Router` turns two endpoints (+ optional waypoints and node boxes)
 * into a polyline. Edges pick a router by id (`edge.props.router`); the scene index resolves it and
 * hands it to the edge type via the route context. Built-ins: straight, orthogonal, bezier.
 */

import type { Box, Vec2 } from '../model.js';

export interface RouteContext {
  from: Vec2;
  to: Vec2;
  waypoints?: Vec2[];
  fromBox?: Box;
  toBox?: Box;
  /** trim distance at the target end so an arrowhead sits in the gap */
  endGap?: number;
}

export interface Router {
  readonly id: string;
  route(ctx: RouteContext): Vec2[];
}

function trimEnd(points: Vec2[], gap: number): Vec2[] {
  if (gap <= 0 || points.length < 2) return points;
  // Walk backward from the end, consuming whole segments shorter than the remaining gap, so the
  // arrowhead gap is honored even when the final segment is short (a short last elbow leg).
  const pts = points.slice();
  let remaining = gap;
  while (pts.length >= 2) {
    const b = pts[pts.length - 1]!;
    const a = pts[pts.length - 2]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d === 0) {
      pts.pop(); // drop a zero-length tail segment
      continue;
    }
    if (d > remaining) {
      pts[pts.length - 1] = { x: b.x - (dx / d) * remaining, y: b.y - (dy / d) * remaining };
      return pts;
    }
    remaining -= d;
    pts.pop(); // whole segment consumed; keep trimming from the previous vertex
  }
  return pts;
}

export const straightRouter: Router = {
  id: 'straight',
  route(ctx) {
    const pts = [ctx.from, ...(ctx.waypoints ?? []), ctx.to];
    return trimEnd(pts, ctx.endGap ?? 0);
  },
};

export const orthogonalRouter: Router = {
  id: 'orthogonal',
  route(ctx) {
    const chain = [ctx.from, ...(ctx.waypoints ?? []), ctx.to];
    const out: Vec2[] = [chain[0]!];
    for (let i = 1; i < chain.length; i++) {
      const a = out[out.length - 1]!;
      const b = chain[i]!;
      if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) {
        // insert a mid elbow: horizontal to the midpoint x, then vertical
        const midX = a.x + (b.x - a.x) / 2;
        out.push({ x: midX, y: a.y }, { x: midX, y: b.y });
      }
      out.push(b);
    }
    return trimEnd(out, ctx.endGap ?? 0);
  },
};

/** Cubic bezier sampled to a polyline (so hit-testing/geometry stay simple). */
export const bezierRouter: Router = {
  id: 'bezier',
  route(ctx) {
    const pts = [ctx.from, ...(ctx.waypoints ?? []), ctx.to];
    const trimmed = trimEnd(pts, ctx.endGap ?? 0);
    if (trimmed.length === 2) {
      const [p0, p3] = trimmed as [Vec2, Vec2];
      const dx = (p3.x - p0.x) * 0.5;
      const c1 = { x: p0.x + dx, y: p0.y };
      const c2 = { x: p3.x - dx, y: p3.y };
      return sampleCubic(p0, c1, c2, p3, 18);
    }
    // multi-point: catmull-rom-ish smoothing through the points
    return smoothThrough(trimmed, 10);
  },
};

function sampleCubic(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const x = u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x;
    const y = u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y;
    out.push({ x, y });
  }
  return out;
}

function smoothThrough(points: Vec2[], perSeg: number): Vec2[] {
  if (points.length < 3) return points;
  const out: Vec2[] = [points[0]!];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    for (let j = 1; j <= perSeg; j++) {
      const t = j / perSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

export class RouterRegistry {
  private readonly map = new Map<string, Router>();
  register(r: Router): void {
    this.map.set(r.id, r);
  }
  get(id: string | undefined): Router | undefined {
    return id ? this.map.get(id) : undefined;
  }
  list(): Router[] {
    return [...this.map.values()];
  }
}

export function defaultRouters(): Router[] {
  return [straightRouter, orthogonalRouter, bezierRouter];
}
