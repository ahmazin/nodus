/**
 * `DrawApi` — the high-level painting surface handed to every `NodeUtil.draw`/`EdgeUtil.draw`.
 * Each helper is fully save/restore-wrapped so state never leaks between shapes. Types draw with
 * these primitives (or reach `api.ctx` for anything custom); they never touch device pixels/zoom.
 */

import type { Box, Vec2 } from '../model.js';
import { drawIcon } from '../icons/index.js';
import type { ResolvedTokens } from '../theme/index.js';
import type { Ctx2D, CanvasGradientLike, DrawableImage } from './context.js';

export interface ImageOpts {
  /** `'contain'` (default) letterboxes the whole image inside the box; `'cover'` fills and crops. */
  fit?: 'contain' | 'cover';
  opacity?: number;
}

export interface GradientSpec {
  /** Ordered color stops; `at` in [0,1]. */
  stops: { at: number; color: string }[];
  /** Direction in degrees: 0 = left→right, 90 (default) = top→bottom. */
  angle?: number;
}
export interface ShadowSpec {
  color: string;
  blur: number;
  dx?: number;
  dy?: number;
}

export interface FillOpts {
  glow?: string | null;
  glowBlur?: number;
  opacity?: number;
  gradient?: GradientSpec;
  shadow?: ShadowSpec;
}
export interface StrokeOpts {
  width?: number;
  dash?: number[];
  glow?: string | null;
  glowBlur?: number;
  opacity?: number;
  cap?: 'butt' | 'round' | 'square';
  join?: 'round' | 'bevel' | 'miter';
}
export interface LabelOpts {
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  align?: 'left' | 'center' | 'right';
  baseline?: 'top' | 'middle' | 'bottom';
  maxWidth?: number;
  weight?: string;
}

/**
 * Stable 32-bit hash of a record id → the per-shape roughness seed. FNV-1a: dependency-free,
 * deterministic, and well-distributed for short id strings, so distinct ids get distinct-looking
 * jitter while the *same* id always hashes to the same seed (same wobble every frame / reload / export).
 */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    // 32-bit FNV prime multiply via imul; the >>>0 keeps it an unsigned 32-bit int.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * `mulberry32` — a tiny, fast, dependency-free seeded PRNG. Given the same 32-bit seed it emits the
 * exact same sequence in `[0, 1)`, which is what makes the sketchy jitter reproducible (NOT
 * `Math.random`). Returns a stateful generator; callers reseed per stroke pass for independence.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class DrawApi {
  /**
   * `seed` is the per-shape jitter seed (a hash of the record id, see `hashId`). It is threaded in by
   * `paintItem` and consumed only when a resolved token carries `roughness > 0`; at roughness 0 it is
   * ignored and every primitive paints its exact clean path.
   */
  constructor(
    readonly ctx: Ctx2D,
    readonly tokens: ResolvedTokens,
    readonly seed: number = 0,
  ) {}

  // ---- path construction ----

  private roundRectPath(b: Box, radius: number): void {
    const r = Math.max(0, Math.min(radius, Math.min(b.w, b.h) / 2));
    const { ctx } = this;
    const x2 = b.x + b.w;
    const y2 = b.y + b.h;
    ctx.beginPath();
    ctx.moveTo(b.x + r, b.y);
    ctx.arcTo(x2, b.y, x2, y2, r);
    ctx.arcTo(x2, y2, b.x, y2, r);
    ctx.arcTo(b.x, y2, b.x, b.y, r);
    ctx.arcTo(b.x, b.y, x2, b.y, r);
    ctx.closePath();
  }

  /** Build a linear gradient spanning `b` along `spec.angle` (deg; 90 = top→bottom). */
  private gradientFor(b: Box, spec: GradientSpec): CanvasGradientLike {
    const rad = ((spec.angle ?? 90) * Math.PI) / 180;
    // Snap near-zero trig noise (e.g. Math.cos(Math.PI/2) === 6.12e-17, not exactly 0) so cardinal
    // angles (0/90/180/270) yield exact axis-aligned endpoints instead of a sub-ULP diagonal drift.
    const dx = Math.abs(Math.cos(rad)) < 1e-10 ? 0 : Math.cos(rad);
    const dy = Math.abs(Math.sin(rad)) < 1e-10 ? 0 : Math.sin(rad);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    // half-extent of the axis-aligned box projected onto the direction (box support function)
    const proj = Math.abs(dx) * (b.w / 2) + Math.abs(dy) * (b.h / 2);
    const g = this.ctx.createLinearGradient(cx - dx * proj, cy - dy * proj, cx + dx * proj, cy + dy * proj);
    for (const s of spec.stops) g.addColorStop(s.at, s.color);
    return g;
  }

  /** Offset drop shadow (distinct from the symmetric `glow`). */
  private applyShadow(s: ShadowSpec): void {
    const { ctx } = this;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = s.blur;
    ctx.shadowOffsetX = s.dx ?? 0;
    ctx.shadowOffsetY = s.dy ?? 0;
  }

  private polyPath(points: Vec2[], close: boolean): void {
    const { ctx } = this;
    if (points.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y);
    if (close) ctx.closePath();
  }

  // ---- sketchy (hand-drawn) outlines ----

  /** The four corners of `b`. Corner radius is intentionally dropped in sketchy mode — sharp,
   *  slightly-overshot corners read as hand-drawn (matching the Excalidraw look). */
  private rectCorners(b: Box): Vec2[] {
    return [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
      { x: b.x, y: b.y + b.h },
    ];
  }

  /** Sample an ellipse into a polyline so it can be perturbed like any other outline. The sample count
   *  is a pure function of the size (deterministic), clamped for quality on tiny/huge shapes. */
  private ellipseSamples(b: Box): Vec2[] {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const rx = b.w / 2;
    const ry = b.h / 2;
    const n = Math.max(16, Math.min(64, Math.round((Math.abs(rx) + Math.abs(ry)) / 4)));
    const out: Vec2[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }
    return out;
  }

  /**
   * Trace `points` (optionally closed) into the current path as a hand-drawn line: each vertex is
   * nudged by a seeded offset and each segment is bowed with a `quadraticCurveTo` whose control point
   * is the segment midpoint pushed along its normal. `rng` is a seeded generator (see `mulberry32`),
   * so the whole trace is a pure function of the seed + geometry — identical on every repaint/export.
   */
  private sketchTrace(points: Vec2[], close: boolean, rng: () => number, amp: number, bow: number): void {
    const { ctx } = this;
    if (points.length === 0) return;
    const jitter = (): number => (rng() - 0.5) * 2 * amp;
    const v = points.map((p) => ({ x: p.x + jitter(), y: p.y + jitter() }));
    const seq = close ? [...v, v[0]!] : v;
    ctx.beginPath();
    ctx.moveTo(seq[0]!.x, seq[0]!.y);
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1]!;
      const c = seq[i]!;
      const mx = (a.x + c.x) / 2;
      const my = (a.y + c.y) / 2;
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const off = (rng() - 0.5) * 2 * bow;
      // push the control point along the segment normal so the line bows rather than kinks
      ctx.quadraticCurveTo(mx + (-dy / len) * off, my + (dx / len) * off, c.x, c.y);
    }
    if (close) ctx.closePath();
  }

  /**
   * Stroke an outline in hand-drawn style: two overlapping passes with distinct seeds (the
   * characteristic "double stroke"). Shares all stroke state (width/dash/glow/opacity) with the clean
   * path so only the geometry differs. Deterministic: seeded solely from `this.seed`.
   */
  private sketchStroke(points: Vec2[], close: boolean, color: string, opts: StrokeOpts, rough: number): this {
    const { ctx } = this;
    ctx.save();
    if (opts.opacity !== undefined) ctx.globalAlpha *= opts.opacity;
    if (opts.glow) {
      ctx.shadowColor = opts.glow;
      ctx.shadowBlur = opts.glowBlur ?? 14;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = opts.width ?? 1;
    ctx.lineCap = opts.cap ?? 'round';
    ctx.lineJoin = opts.join ?? 'round';
    if (opts.dash) ctx.setLineDash(opts.dash);
    const r = Math.min(Math.max(rough, 0), 6);
    const amp = r * 1.0;
    const bow = r * 0.8;
    for (let pass = 0; pass < 2; pass++) {
      // distinct sub-seed per pass → the two strokes diverge; both are pure functions of this.seed
      const rng = mulberry32((this.seed ^ Math.imul(pass + 1, 0x9e3779b1)) >>> 0);
      this.sketchTrace(points, close, rng, amp, bow);
      ctx.stroke();
    }
    ctx.restore();
    return this;
  }

  // ---- filled shapes ----

  fillRoundRect(b: Box, radius: number, color: string, opts: FillOpts = {}): this {
    const { ctx } = this;
    ctx.save();
    if (opts.opacity !== undefined) ctx.globalAlpha *= opts.opacity;
    if (opts.shadow) this.applyShadow(opts.shadow);
    else if (opts.glow) {
      ctx.shadowColor = opts.glow;
      ctx.shadowBlur = opts.glowBlur ?? 14;
    }
    ctx.fillStyle = opts.gradient ? this.gradientFor(b, opts.gradient) : color;
    this.roundRectPath(b, radius);
    ctx.fill();
    ctx.restore();
    return this;
  }

  strokeRoundRect(b: Box, radius: number, color: string, opts: StrokeOpts = {}): this {
    const rough = this.tokens.roughness ?? 0;
    if (rough > 0) return this.sketchStroke(this.rectCorners(b), true, color, opts, rough);
    const { ctx } = this;
    ctx.save();
    if (opts.opacity !== undefined) ctx.globalAlpha *= opts.opacity;
    if (opts.glow) {
      ctx.shadowColor = opts.glow;
      ctx.shadowBlur = opts.glowBlur ?? 14;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = opts.width ?? 1;
    if (opts.dash) ctx.setLineDash(opts.dash);
    this.roundRectPath(b, radius);
    ctx.stroke();
    ctx.restore();
    return this;
  }

  fillEllipse(b: Box, color: string, opts: FillOpts = {}): this {
    const { ctx } = this;
    ctx.save();
    if (opts.opacity !== undefined) ctx.globalAlpha *= opts.opacity;
    if (opts.glow) {
      ctx.shadowColor = opts.glow;
      ctx.shadowBlur = opts.glowBlur ?? 14;
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return this;
  }

  strokeEllipse(b: Box, color: string, opts: StrokeOpts = {}): this {
    const rough = this.tokens.roughness ?? 0;
    if (rough > 0) return this.sketchStroke(this.ellipseSamples(b), true, color, opts, rough);
    const { ctx } = this;
    ctx.save();
    if (opts.opacity !== undefined) ctx.globalAlpha *= opts.opacity;
    if (opts.glow) {
      ctx.shadowColor = opts.glow;
      ctx.shadowBlur = opts.glowBlur ?? 14;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = opts.width ?? 1;
    if (opts.dash) ctx.setLineDash(opts.dash);
    ctx.beginPath();
    ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return this;
  }

  fillPolygon(points: Vec2[], color: string, opts: FillOpts = {}): this {
    const { ctx } = this;
    ctx.save();
    if (opts.opacity !== undefined) ctx.globalAlpha *= opts.opacity;
    if (opts.glow) {
      ctx.shadowColor = opts.glow;
      ctx.shadowBlur = opts.glowBlur ?? 14;
    }
    ctx.fillStyle = color;
    this.polyPath(points, true);
    ctx.fill();
    ctx.restore();
    return this;
  }

  strokePolyline(points: Vec2[], color: string, opts: StrokeOpts = {}): this {
    const rough = this.tokens.roughness ?? 0;
    if (rough > 0) return this.sketchStroke(points, false, color, opts, rough);
    const { ctx } = this;
    ctx.save();
    if (opts.opacity !== undefined) ctx.globalAlpha *= opts.opacity;
    if (opts.glow) {
      ctx.shadowColor = opts.glow;
      ctx.shadowBlur = opts.glowBlur ?? 14;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = opts.width ?? 1;
    ctx.lineCap = opts.cap ?? 'round';
    ctx.lineJoin = opts.join ?? 'round';
    if (opts.dash) ctx.setLineDash(opts.dash);
    this.polyPath(points, false);
    ctx.stroke();
    ctx.restore();
    return this;
  }

  /** Draw a filled triangular arrowhead whose tip is at `tip`, pointing along `angle` (radians). */
  arrowhead(tip: Vec2, angle: number, size: number, color: string, opts: FillOpts = {}): this {
    const spread = 0.42;
    const a = { x: tip.x - size * Math.cos(angle - spread), y: tip.y - size * Math.sin(angle - spread) };
    const b = { x: tip.x - size * Math.cos(angle + spread), y: tip.y - size * Math.sin(angle + spread) };
    return this.fillPolygon([tip, a, b], color, opts);
  }

  // ---- text ----

  label(text: string, at: Vec2, opts: LabelOpts = {}): this {
    const { ctx, tokens } = this;
    ctx.save();
    const size = (opts.fontSize ?? tokens.fontSize) * (opts.fontSize ? 1 : tokens.fontScale);
    const family = opts.fontFamily ?? tokens.fontFamily;
    const weight = opts.weight ? `${opts.weight} ` : '';
    ctx.font = `${weight}${size}px ${family}`;
    ctx.fillStyle = opts.color ?? tokens.text;
    ctx.textAlign = opts.align ?? 'center';
    ctx.textBaseline = opts.baseline ?? 'middle';
    ctx.fillText(text, at.x, at.y, opts.maxWidth);
    ctx.restore();
    return this;
  }

  /** Draw a registered icon glyph inside `box`. `color` is the outline; `fill` tints the body. */
  icon(name: string, box: Box, color: string, fill?: string): this {
    drawIcon(this.ctx, name, box, color, fill);
    return this;
  }

  /**
   * Draw a decoded image to fill `box`, honoring `fit`:
   *  - `'contain'` (default) letterboxes the whole image inside the box (no crop);
   *  - `'cover'` scales to fill and crops the overflow (clipped to the box).
   * No-op when the image has not decoded yet (`width`/`height` still 0) — callers paint a placeholder.
   */
  image(img: DrawableImage, box: Box, opts: ImageOpts = {}): this {
    const { ctx } = this;
    const iw = img.width;
    const ih = img.height;
    if (!(iw > 0) || !(ih > 0)) return this;
    ctx.save();
    if (opts.opacity !== undefined) ctx.globalAlpha *= opts.opacity;
    // Clip to the box so 'cover' crops cleanly and a non-integer aspect never bleeds outside the node.
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    const scale =
      opts.fit === 'cover' ? Math.max(box.w / iw, box.h / ih) : Math.min(box.w / iw, box.h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(img, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh);
    ctx.restore();
    return this;
  }

  measureLabel(text: string, fontSize?: number, fontFamily?: string): number {
    const { ctx, tokens } = this;
    ctx.save();
    const size = fontSize ?? tokens.fontSize;
    ctx.font = `${size}px ${fontFamily ?? tokens.fontFamily}`;
    const w = ctx.measureText(text).width;
    ctx.restore();
    return w;
  }
}
