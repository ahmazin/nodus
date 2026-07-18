/**
 * `DrawApi` — the high-level painting surface handed to every `NodeUtil.draw`/`EdgeUtil.draw`.
 * Each helper is fully save/restore-wrapped so state never leaks between shapes. Types draw with
 * these primitives (or reach `api.ctx` for anything custom); they never touch device pixels/zoom.
 */

import type { Box, Vec2 } from '../model.js';
import { drawIcon } from '../icons/index.js';
import type { ResolvedTokens } from '../theme/index.js';
import type { Ctx2D, DrawableImage } from './context.js';

export interface ImageOpts {
  /** `'contain'` (default) letterboxes the whole image inside the box; `'cover'` fills and crops. */
  fit?: 'contain' | 'cover';
  opacity?: number;
}

export interface FillOpts {
  glow?: string | null;
  glowBlur?: number;
  opacity?: number;
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

export class DrawApi {
  constructor(
    readonly ctx: Ctx2D,
    readonly tokens: ResolvedTokens,
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

  private polyPath(points: Vec2[], close: boolean): void {
    const { ctx } = this;
    if (points.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y);
    if (close) ctx.closePath();
  }

  // ---- filled shapes ----

  fillRoundRect(b: Box, radius: number, color: string, opts: FillOpts = {}): this {
    const { ctx } = this;
    ctx.save();
    if (opts.opacity !== undefined) ctx.globalAlpha *= opts.opacity;
    if (opts.glow) {
      ctx.shadowColor = opts.glow;
      ctx.shadowBlur = opts.glowBlur ?? 14;
    }
    ctx.fillStyle = color;
    this.roundRectPath(b, radius);
    ctx.fill();
    ctx.restore();
    return this;
  }

  strokeRoundRect(b: Box, radius: number, color: string, opts: StrokeOpts = {}): this {
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
