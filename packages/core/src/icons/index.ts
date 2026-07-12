/**
 * Icon glyphs — small line-drawn vector icons node types can render (e.g. a database cylinder for
 * a db node). A global registry maps names to draw functions; `registerIcon` adds custom ones, and
 * `DrawApi.icon(name, box, color)` renders them. All icons draw within their given box in world units.
 */

import type { Box } from '../model.js';
import type { Ctx2D } from '../renderer/context.js';

/** Draw an icon inside the square `size`×`size` box at (`x`,`y`) in the given color. */
export type IconDraw = (ctx: Ctx2D, x: number, y: number, size: number, color: string) => void;

const registry = new Map<string, IconDraw>();

export function registerIcon(name: string, draw: IconDraw): void {
  registry.set(name, draw);
}
export function getIcon(name: string): IconDraw | undefined {
  return registry.get(name);
}
export function iconNames(): string[] {
  return [...registry.keys()];
}
export function drawIcon(ctx: Ctx2D, name: string, box: Box, color: string): void {
  const draw = registry.get(name);
  if (!draw) return;
  const size = Math.min(box.w, box.h);
  draw(ctx, box.x + (box.w - size) / 2, box.y + (box.h - size) / 2, size, color);
}

// ---- helpers ----
function stroked(ctx: Ctx2D, color: string, w: number, fn: () => void): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  fn();
  ctx.restore();
}

// ---- built-in icons (drawn on a 0..1 unit box scaled to `s`) ----

const server: IconDraw = (ctx, x, y, s, c) =>
  stroked(ctx, c, s * 0.08, () => {
    const p = s * 0.14;
    for (let i = 0; i < 2; i++) {
      const ty = y + p + i * (s - 2 * p) * 0.55;
      ctx.beginPath();
      ctx.rect(x + p, ty, s - 2 * p, (s - 2 * p) * 0.36);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + s - p * 1.8, ty + (s - 2 * p) * 0.18, s * 0.03, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

const database: IconDraw = (ctx, x, y, s, c) =>
  stroked(ctx, c, s * 0.08, () => {
    const rx = s * 0.34;
    const ry = s * 0.13;
    const cx = x + s / 2;
    const top = y + s * 0.16;
    const bot = y + s * 0.84;
    ctx.beginPath();
    ctx.ellipse(cx, top, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - rx, top);
    ctx.lineTo(cx - rx, bot);
    ctx.moveTo(cx + rx, top);
    ctx.lineTo(cx + rx, bot);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, bot, rx, ry, 0, 0, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, y + s * 0.5, rx, ry, 0, 0, Math.PI);
    ctx.stroke();
  });

const bolt: IconDraw = (ctx, x, y, s, c) =>
  stroked(ctx, c, s * 0.08, () => {
    ctx.beginPath();
    ctx.moveTo(x + s * 0.56, y + s * 0.12);
    ctx.lineTo(x + s * 0.32, y + s * 0.54);
    ctx.lineTo(x + s * 0.5, y + s * 0.54);
    ctx.lineTo(x + s * 0.44, y + s * 0.88);
    ctx.lineTo(x + s * 0.68, y + s * 0.44);
    ctx.lineTo(x + s * 0.5, y + s * 0.44);
    ctx.closePath();
    ctx.stroke();
  });

const queue: IconDraw = (ctx, x, y, s, c) =>
  stroked(ctx, c, s * 0.08, () => {
    for (let i = 0; i < 3; i++) {
      const ty = y + s * 0.2 + i * s * 0.22;
      ctx.beginPath();
      ctx.rect(x + s * 0.18, ty, s * 0.64, s * 0.14);
      ctx.stroke();
    }
  });

const balancer: IconDraw = (ctx, x, y, s, c) =>
  stroked(ctx, c, s * 0.08, () => {
    const cx = x + s * 0.28;
    const cy = y + s * 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.06, 0, Math.PI * 2);
    ctx.stroke();
    for (const ty of [0.22, 0.5, 0.78]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.06, cy);
      ctx.lineTo(x + s * 0.78, y + s * ty);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + s * 0.8, y + s * ty, s * 0.045, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

const globe: IconDraw = (ctx, x, y, s, c) =>
  stroked(ctx, c, s * 0.07, () => {
    const cx = x + s / 2;
    const cy = y + s / 2;
    const r = s * 0.36;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.45, r, 0, 0, Math.PI * 2);
    ctx.stroke();
  });

const cloud: IconDraw = (ctx, x, y, s, c) =>
  stroked(ctx, c, s * 0.08, () => {
    const cy = y + s * 0.62;
    ctx.beginPath();
    ctx.arc(x + s * 0.36, cy - s * 0.06, s * 0.16, Math.PI * 0.5, Math.PI * 1.5);
    ctx.arc(x + s * 0.48, cy - s * 0.2, s * 0.18, Math.PI * 1, Math.PI * 2);
    ctx.arc(x + s * 0.66, cy - s * 0.06, s * 0.16, Math.PI * 1.5, Math.PI * 0.5);
    ctx.closePath();
    ctx.stroke();
  });

const user: IconDraw = (ctx, x, y, s, c) =>
  stroked(ctx, c, s * 0.08, () => {
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s * 0.34, s * 0.16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s * 0.92, s * 0.3, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  });

const gear: IconDraw = (ctx, x, y, s, c) =>
  stroked(ctx, c, s * 0.08, () => {
    const cx = x + s / 2;
    const cy = y + s / 2;
    const r = s * 0.24;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.lineTo(cx + Math.cos(a) * r * 1.5, cy + Math.sin(a) * r * 1.5);
      ctx.stroke();
    }
  });

const code: IconDraw = (ctx, x, y, s, c) =>
  stroked(ctx, c, s * 0.09, () => {
    ctx.beginPath();
    ctx.moveTo(x + s * 0.4, y + s * 0.28);
    ctx.lineTo(x + s * 0.22, y + s * 0.5);
    ctx.lineTo(x + s * 0.4, y + s * 0.72);
    ctx.moveTo(x + s * 0.6, y + s * 0.28);
    ctx.lineTo(x + s * 0.78, y + s * 0.5);
    ctx.lineTo(x + s * 0.6, y + s * 0.72);
    ctx.stroke();
  });

const box3d: IconDraw = (ctx, x, y, s, c) =>
  stroked(ctx, c, s * 0.08, () => {
    const p = s * 0.2;
    ctx.beginPath();
    ctx.rect(x + p, y + p, s - 2 * p, s - 2 * p);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + p, y + p);
    ctx.lineTo(x + p * 1.6, y + p * 0.5);
    ctx.lineTo(x + s - p * 0.4, y + p * 0.5);
    ctx.lineTo(x + s - p, y + p);
    ctx.moveTo(x + s - p * 0.4, y + p * 0.5);
    ctx.lineTo(x + s - p * 0.4, y + s - p * 1.5);
    ctx.stroke();
  });

const lock: IconDraw = (ctx, x, y, s, c) =>
  stroked(ctx, c, s * 0.08, () => {
    ctx.beginPath();
    ctx.rect(x + s * 0.28, y + s * 0.44, s * 0.44, s * 0.36);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + s * 0.5, y + s * 0.42, s * 0.14, Math.PI, Math.PI * 2);
    ctx.stroke();
  });

const fn: IconDraw = (ctx, x, y, s, c) =>
  stroked(ctx, c, s * 0.09, () => {
    // a lambda: two strokes meeting
    ctx.beginPath();
    ctx.moveTo(x + s * 0.28, y + s * 0.26);
    ctx.lineTo(x + s * 0.42, y + s * 0.26);
    ctx.lineTo(x + s * 0.7, y + s * 0.74);
    ctx.moveTo(x + s * 0.5, y + s * 0.48);
    ctx.lineTo(x + s * 0.3, y + s * 0.74);
    ctx.stroke();
  });

const bucket: IconDraw = (ctx, x, y, s, c) =>
  stroked(ctx, c, s * 0.08, () => {
    ctx.beginPath();
    ctx.ellipse(x + s / 2, y + s * 0.28, s * 0.28, s * 0.1, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + s * 0.22, y + s * 0.28);
    ctx.lineTo(x + s * 0.34, y + s * 0.78);
    ctx.lineTo(x + s * 0.66, y + s * 0.78);
    ctx.lineTo(x + s * 0.78, y + s * 0.28);
    ctx.stroke();
  });

/** Register the built-in icon set. Called once at module load. */
export function installDefaultIcons(): void {
  const defs: Record<string, IconDraw> = {
    server, database, cache: bolt, queue, balancer, globe, cloud, user, gear, code, box: box3d, lock, function: fn, bucket,
  };
  for (const [name, dfn] of Object.entries(defs)) registry.set(name, dfn);
}

installDefaultIcons();
