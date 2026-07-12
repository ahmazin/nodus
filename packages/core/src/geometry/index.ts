/**
 * Geometry primitives. A `NodeUtil`/`EdgeUtil` returns one `Geometry2d` in *world* coordinates;
 * that single declaration then serves bounds, viewport culling, hit-testing, and snapping — so
 * arbitrary third-party types need no bespoke `hitTest`.
 */

import type { Box, Mat2D, Vec2 } from '../model.js';

// ---------- vector math ----------

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- box helpers ----------

export function boxCenter(b: Box): Vec2 {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function boxContains(b: Box, p: Vec2): boolean {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

export function boxIntersects(a: Box, b: Box): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

/** Does `outer` fully enclose `inner`? (used for enclosing marquee selection) */
export function boxEncloses(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function padBox(b: Box, pad: number): Box {
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

// ---------- matrix math (Canvas2D order: [a,b,c,d,e,f]) ----------

export const IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0];

export function matMul(m1: Mat2D, m2: Mat2D): Mat2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function applyMat(m: Mat2D, p: Vec2): Vec2 {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function invertMat(m: Mat2D): Mat2D {
  const det = m[0] * m[3] - m[1] * m[2];
  if (det === 0) return IDENTITY;
  const id = 1 / det;
  return [
    m[3] * id,
    -m[1] * id,
    -m[2] * id,
    m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}

// ---------- point/segment distance ----------

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

// ---------- Geometry2d ----------

export abstract class Geometry2d {
  /** World-space axis-aligned bounding box. */
  abstract bounds(): Box;
  /** Shortest distance from `p` to the shape's fill/stroke (0 if inside a filled shape). */
  abstract distanceToPoint(p: Vec2): number;
  /** Hit test with an optional tolerance (world units). */
  hitPoint(p: Vec2, tolerance = 0): boolean {
    return this.distanceToPoint(p) <= tolerance;
  }
  center(): Vec2 {
    return boxCenter(this.bounds());
  }
  /**
   * The point on the shape's boundary along the ray from its center toward `target`. Used to attach
   * `outline`-bound edges so they slide along the shape as it (or the other end) moves. Generic
   * binary search on the inside/outside boundary — works for any shape with a filled interior.
   */
  boundaryToward(target: Vec2): Vec2 {
    const c = this.center();
    const dx = target.x - c.x;
    const dy = target.y - c.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return c;
    // reach just past the bounding box along the ray, so [0,1] maps to a shape-scaled span (a huge
    // reach would make the crossing a microscopic fraction that a fixed-resolution scan steps over).
    const bb = this.bounds();
    const reach = Math.hypot(bb.w, bb.h) * 1.5 + 1;
    const fx = c.x + (dx / d) * reach;
    const fy = c.y + (dy / d) * reach;
    const at = (t: number): Vec2 => ({ x: c.x + (fx - c.x) * t, y: c.y + (fy - c.y) * t });
    const inside = (t: number): boolean => this.distanceToPoint(at(t)) === 0;
    // Scan from the far (outside) end inward to bracket the OUTERMOST outside->inside transition,
    // i.e. the boundary crossing facing `target`. Robust for concave fills; does not assume the
    // center is inside (which is false for L/star shapes) or that the interior is contiguous.
    const N = 256;
    let lo = -1;
    let hi = 1;
    let prev = inside(1); // far point: outside for any bounded shape
    for (let i = N - 1; i >= 0; i--) {
      const t = i / N;
      const cur = inside(t);
      if (cur && !prev) {
        lo = t;
        hi = (i + 1) / N;
        break;
      }
      prev = cur;
    }
    if (lo < 0) return c; // ray never enters the fill (open/degenerate) — attach at center
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (inside(mid)) lo = mid;
      else hi = mid;
    }
    return at(lo);
  }
}

export interface RectOpts {
  x: number;
  y: number;
  w: number;
  h: number;
  radius?: number;
}

export class Rectangle2d extends Geometry2d {
  constructor(readonly opts: RectOpts) {
    super();
  }
  override bounds(): Box {
    const { x, y, w, h } = this.opts;
    return { x, y, w, h };
  }
  override distanceToPoint(p: Vec2): number {
    const { x, y, w, h } = this.opts;
    // signed distance to an axis-aligned rectangle; negative inside -> clamp to 0
    const dx = Math.max(x - p.x, 0, p.x - (x + w));
    const dy = Math.max(y - p.y, 0, p.y - (y + h));
    return Math.hypot(dx, dy);
  }
}

export class Ellipse2d extends Geometry2d {
  constructor(readonly opts: RectOpts) {
    super();
  }
  override bounds(): Box {
    const { x, y, w, h } = this.opts;
    return { x, y, w, h };
  }
  override distanceToPoint(p: Vec2): number {
    const { x, y, w, h } = this.opts;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = w / 2;
    const ry = h / 2;
    if (rx <= 0 || ry <= 0) return Infinity;
    const nx = (p.x - cx) / rx;
    const ny = (p.y - cy) / ry;
    const inside = nx * nx + ny * ny <= 1;
    if (inside) return 0;
    // approximate outside distance via nearest bounding — good enough for picking tolerance
    const ang = Math.atan2(p.y - cy, p.x - cx);
    const ex = cx + rx * Math.cos(ang);
    const ey = cy + ry * Math.sin(ang);
    return dist(p, { x: ex, y: ey });
  }
}

export class Polygon2d extends Geometry2d {
  constructor(readonly points: Vec2[]) {
    super();
  }
  override bounds(): Box {
    return pointsBounds(this.points);
  }
  override distanceToPoint(p: Vec2): number {
    if (pointInPolygon(p, this.points)) return 0;
    return edgeDistance(p, this.points, true);
  }
}

/** An open polyline — the geometry of an edge. Distance is to the nearest segment. */
export class Polyline2d extends Geometry2d {
  constructor(
    readonly points: Vec2[],
    readonly width = 0,
  ) {
    super();
  }
  override bounds(): Box {
    return pointsBounds(this.points);
  }
  override distanceToPoint(p: Vec2): number {
    // a degenerate 1-point polyline has no segment: measure to the point itself (else edgeDistance
    // returns Infinity and the geometry can never be hit-tested or snapped)
    if (this.points.length === 1) {
      const q = this.points[0]!;
      return Math.max(0, Math.hypot(p.x - q.x, p.y - q.y) - this.width / 2);
    }
    return Math.max(0, edgeDistance(p, this.points, false) - this.width / 2);
  }
}

// ---------- polygon helpers ----------

function pointsBounds(points: Vec2[]): Box {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const intersect =
      a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

function edgeDistance(p: Vec2, points: Vec2[], closed: boolean): number {
  let min = Infinity;
  const n = points.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const d = distToSegment(p, a, b);
    if (d < min) min = d;
  }
  return min;
}
