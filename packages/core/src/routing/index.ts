/**
 * Pluggable edge routing. A `Router` turns two endpoints (+ optional waypoints and node boxes)
 * into a polyline. Edges pick a router by id (`edge.props.router`); the scene index resolves it and
 * hands it to the edge type via the route context. Built-ins: straight, orthogonal, bezier.
 */

import type { Box, Vec2 } from '../model.js';
import { boxCenter, boxIntersects, distToSegment } from '../geometry/index.js';

export interface RouteContext {
  from: Vec2;
  to: Vec2;
  waypoints?: Vec2[];
  fromBox?: Box;
  toBox?: Box;
  /**
   * Node boxes the route should avoid slicing through, in world coords, ALREADY padded for
   * clearance by the caller (the scene index). Only the orthogonal router consults them. When
   * absent/empty every router behaves exactly as before.
   */
  obstacles?: Box[];
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

/**
 * True iff the axis-aligned segment a→b passes through the OPEN interior of `box` (strict: a segment
 * running along a box edge, or merely touching a corner, does NOT count). This is the predicate the
 * orthogonal avoidance grid uses to decide whether a candidate leg is usable — grid lines sit exactly
 * on the (already padded) box boundaries, so a boundary-hugging leg is intentionally allowed.
 */
export function segmentHitsBoxInterior(a: Vec2, b: Vec2, box: Box): boolean {
  const bx0 = box.x;
  const bx1 = box.x + box.w;
  const by0 = box.y;
  const by1 = box.y + box.h;
  if (bx1 - bx0 <= 0 || by1 - by0 <= 0) return false; // a degenerate box has no interior
  const horizontal = Math.abs(a.y - b.y) < 1e-9;
  const vertical = Math.abs(a.x - b.x) < 1e-9;
  if (horizontal && vertical) {
    // degenerate segment — a single point: strictly inside?
    return a.x > bx0 && a.x < bx1 && a.y > by0 && a.y < by1;
  }
  if (horizontal) {
    if (!(a.y > by0 && a.y < by1)) return false; // the constant y is on/outside the boundary
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    return Math.max(lo, bx0) < Math.min(hi, bx1); // positive-length overlap with the open x-span
  }
  if (vertical) {
    if (!(a.x > bx0 && a.x < bx1)) return false;
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    return Math.max(lo, by0) < Math.min(hi, by1);
  }
  // General (diagonal) segment — orthogonal routing never emits these, but keep the predicate honest:
  // Liang–Barsky clip; a positive-length clipped interval means it crosses the interior.
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q > 0; // parallel to this slab: inside only if strictly within
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, a.x - bx0)) return false;
  if (!clip(dx, bx1 - a.x)) return false;
  if (!clip(-dy, a.y - by0)) return false;
  if (!clip(dy, by1 - a.y)) return false;
  return t1 - t0 > 1e-9;
}

// Tuning for the orthogonal avoidance pass. The empty-obstacle path never touches any of this.
const TURN_PENALTY = 8; // small nudge toward fewer bends among equal-length routes
const MAX_ASTAR_OBSTACLES = 16; // grid cost is ~O((2*obstacles)^2); cap the obstacle count
const MAX_GRID_NODES = 2500; // hard ceiling on grid size; above it we degrade to the plain elbow
const SELECT_PAD = 40; // how far outside the a→b box an obstacle can sit and still be considered

/** Today's midpoint-X elbow for a single a→b leg: the points AFTER `a`, ending exactly at `b`. */
function elbowLeg(a: Vec2, b: Vec2): Vec2[] {
  if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) {
    const midX = a.x + (b.x - a.x) / 2;
    return [{ x: midX, y: a.y }, { x: midX, y: b.y }, b];
  }
  return [b];
}

/** Does the elbow polyline `[a, ...leg]` slice through any obstacle interior? */
function elbowHitsAny(a: Vec2, leg: Vec2[], obstacles: Box[]): boolean {
  let prev = a;
  for (const p of leg) {
    for (const box of obstacles) {
      if (segmentHitsBoxInterior(prev, p, box)) return true;
    }
    prev = p;
  }
  return false;
}

/** Obstacles relevant to routing a→b: those near the a→b box, nearest-first, capped for perf. */
function selectObstacles(a: Vec2, b: Vec2, obstacles: Box[]): Box[] {
  const region: Box = {
    x: Math.min(a.x, b.x) - SELECT_PAD,
    y: Math.min(a.y, b.y) - SELECT_PAD,
    w: Math.abs(a.x - b.x) + SELECT_PAD * 2,
    h: Math.abs(a.y - b.y) + SELECT_PAD * 2,
  };
  const near = obstacles.filter((box) => boxIntersects(region, box));
  if (near.length <= MAX_ASTAR_OBSTACLES) return near;
  // nearest to the a→b segment first, so the box that actually blocks the elbow is never dropped
  return near
    .map((box) => ({ box, d: distToSegment(boxCenter(box), a, b) }))
    .sort((p, q) => p.d - q.d)
    .slice(0, MAX_ASTAR_OBSTACLES)
    .map((e) => e.box);
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((p, q) => p - q);
}

/** Drop collinear interior vertices so a straight run across cells becomes one segment. */
function simplifyOrtho(pts: Vec2[]): Vec2[] {
  if (pts.length <= 2) return pts;
  const out: Vec2[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const c = pts[i]!;
    const d = pts[i + 1]!;
    const horizontalRun = Math.abs(a.y - c.y) < 1e-9 && Math.abs(c.y - d.y) < 1e-9;
    const verticalRun = Math.abs(a.x - c.x) < 1e-9 && Math.abs(c.x - d.x) < 1e-9;
    if (horizontalRun || verticalRun) continue; // c lies on the same axis-run — redundant
    out.push(c);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/** A tiny binary min-heap over node indices keyed by fScore (lazy-deletion friendly). */
class MinHeap {
  private readonly ids: number[] = [];
  private readonly keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= this.keys[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.ids[0]!;
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      const n = this.ids.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < n && this.keys[l]! < this.keys[smallest]!) smallest = l;
        if (r < n && this.keys[r]! < this.keys[smallest]!) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }
  private swap(i: number, j: number): void {
    const ti = this.ids[i]!;
    this.ids[i] = this.ids[j]!;
    this.ids[j] = ti;
    const tk = this.keys[i]!;
    this.keys[i] = this.keys[j]!;
    this.keys[j] = tk;
  }
}

/**
 * Orthogonal A* between `a` and `b` over a visibility grid whose lines are the endpoints' and the
 * (already padded) obstacles' edges. Returns the full point list `a … b` (all axis-aligned), or
 * `null` when no obstacle-free path exists (fully boxed in) or the grid would be too large.
 */
function avoidOrthogonal(a: Vec2, b: Vec2, obstacles: Box[]): Vec2[] | null {
  const xsSource = [a.x, b.x];
  const ysSource = [a.y, b.y];
  for (const box of obstacles) {
    xsSource.push(box.x, box.x + box.w);
    ysSource.push(box.y, box.y + box.h);
  }
  const xs = uniqueSorted(xsSource);
  const ys = uniqueSorted(ysSource);
  const nx = xs.length;
  const ny = ys.length;
  if (nx * ny > MAX_GRID_NODES) return null;
  const ia = xs.indexOf(a.x);
  const ja = ys.indexOf(a.y);
  const ib = xs.indexOf(b.x);
  const jb = ys.indexOf(b.y);
  const at = (i: number, j: number): number => j * nx + i;
  const start = at(ia, ja);
  const goal = at(ib, jb);
  if (start === goal) return [a];
  const n = nx * ny;
  const gScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const arriveDir = new Uint8Array(n); // 0 none, 1 horizontal, 2 vertical
  const closed = new Uint8Array(n);
  const h = (i: number, j: number): number => Math.abs(xs[i]! - b.x) + Math.abs(ys[j]! - b.y);
  gScore[start] = 0;
  const open = new MinHeap();
  open.push(start, h(ia, ja));
  const usable = (i0: number, j0: number, i1: number, j1: number): boolean => {
    const p1 = { x: xs[i0]!, y: ys[j0]! };
    const p2 = { x: xs[i1]!, y: ys[j1]! };
    for (const box of obstacles) if (segmentHitsBoxInterior(p1, p2, box)) return false;
    return true;
  };
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    const ci = cur % nx;
    const cj = (cur - ci) / nx;
    const neighbors: [number, number, number][] = [
      [ci - 1, cj, 1],
      [ci + 1, cj, 1],
      [ci, cj - 1, 2],
      [ci, cj + 1, 2],
    ];
    for (const [ni, nj, dir] of neighbors) {
      if (ni < 0 || ni >= nx || nj < 0 || nj >= ny) continue;
      const nIdx = at(ni, nj);
      if (closed[nIdx]) continue;
      if (!usable(ci, cj, ni, nj)) continue;
      const segLen = Math.abs(xs[ni]! - xs[ci]!) + Math.abs(ys[nj]! - ys[cj]!);
      const turn = arriveDir[cur] !== 0 && arriveDir[cur] !== dir ? TURN_PENALTY : 0;
      const tentative = gScore[cur]! + segLen + turn;
      if (tentative < gScore[nIdx]!) {
        gScore[nIdx] = tentative;
        cameFrom[nIdx] = cur;
        arriveDir[nIdx] = dir;
        open.push(nIdx, tentative + h(ni, nj));
      }
    }
  }
  if (cameFrom[goal] === -1) return null; // no obstacle-free route
  const path: Vec2[] = [];
  let c = goal;
  while (c !== -1) {
    const ci = c % nx;
    const cj = (c - ci) / nx;
    path.push({ x: xs[ci]!, y: ys[cj]! });
    if (c === start) break;
    c = cameFrom[c]!;
  }
  path.reverse();
  return simplifyOrtho(path);
}

/** Route one a→b leg: today's elbow on the fast path, an avoidance detour only when it's needed. */
function routeLeg(a: Vec2, b: Vec2, obstacles: Box[]): Vec2[] {
  const elbow = elbowLeg(a, b);
  if (obstacles.length === 0 || !elbowHitsAny(a, elbow, obstacles)) return elbow; // FAST PATH
  const path = avoidOrthogonal(a, b, selectObstacles(a, b, obstacles));
  if (!path || path.length < 2) return elbow; // no path / degenerate — fall back gracefully
  return path.slice(1); // drop the leading `a`, already present in the running output
}

export const orthogonalRouter: Router = {
  id: 'orthogonal',
  route(ctx) {
    const chain = [ctx.from, ...(ctx.waypoints ?? []), ctx.to];
    const obstacles = ctx.obstacles ?? [];
    const out: Vec2[] = [chain[0]!];
    for (let i = 1; i < chain.length; i++) {
      // Avoidance is applied PER leg between consecutive fixed points, so waypoints stay pass-through.
      out.push(...routeLeg(out[out.length - 1]!, chain[i]!, obstacles));
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
