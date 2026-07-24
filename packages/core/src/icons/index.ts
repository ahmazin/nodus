/**
 * Icon glyphs — small vector icons node types can render (e.g. a database cylinder for a db node).
 * A global registry maps names to draw functions; `registerIcon` adds custom ones, and
 * `DrawApi.icon(name, box, color, fill?)` renders them. Glyphs are drawn within their given box in
 * world units, so the same glyph reads as a tiny badge or a large stencil symbol.
 *
 * Each glyph takes a primary `color` (outlines / details) and an optional `fill` color for its solid
 * body (two-tone). When `fill` is omitted the body falls back to a translucent tint of `color`, so
 * single-color callers still get a filled look.
 */

import type { Box } from '../model.js';
import type { Ctx2D } from '../renderer/context.js';

/** Draw an icon inside the square `size`×`size` box at (`x`,`y`). `fill` tints the solid body. */
export type IconDraw = (ctx: Ctx2D, x: number, y: number, size: number, color: string, fill?: string) => void;

export interface IconMeta { needsChip?: boolean }

const registry = new Map<string, IconDraw>();
const iconMeta = new Map<string, IconMeta>();

export function registerIcon(name: string, draw: IconDraw, meta?: IconMeta): void {
  registry.set(name, draw);
  if (meta) iconMeta.set(name, meta);
  else iconMeta.delete(name);
}
export function getIconMeta(name: string): IconMeta | undefined {
  return iconMeta.get(name);
}
export function getIcon(name: string): IconDraw | undefined {
  return registry.get(name);
}
export function iconNames(): string[] {
  return [...registry.keys()];
}
/** Render a registered glyph centered in `box`. `color` is the outline, `fill` the body tint. */
export function drawIcon(ctx: Ctx2D, name: string, box: Box, color: string, fill?: string): void {
  const draw = registry.get(name);
  if (!draw) return;
  const size = Math.min(box.w, box.h);
  draw(ctx, box.x + (box.w - size) / 2, box.y + (box.h - size) / 2, size, color, fill);
}

/**
 * A per-editor icon registry. Private registrations (via {@link register}) are isolated to this
 * instance, while lookups fall through to the SHARED module-global built-in defaults — so two editors
 * can register different glyphs under the same name without clobbering each other, and both still
 * resolve the built-ins. `Editor.icons` is one of these; `DrawApi` resolves `icon()` through it.
 */
export class IconRegistry {
  private readonly local = new Map<string, IconDraw>();
  private readonly localMeta = new Map<string, IconMeta>();

  /** Register a glyph on THIS editor only (shadows a built-in of the same name for this editor). */
  register(name: string, draw: IconDraw, meta?: IconMeta): void {
    this.local.set(name, draw);
    if (meta) this.localMeta.set(name, meta);
    else this.localMeta.delete(name);
  }

  /** Remove a per-editor registration, restoring the shared default glyph (if any) for `name`. */
  unregister(name: string): void {
    this.local.delete(name);
    this.localMeta.delete(name);
  }

  /** Resolve a glyph: this editor's registration first, then the shared built-in default. */
  get(name: string): IconDraw | undefined {
    return this.local.get(name) ?? registry.get(name);
  }

  getMeta(name: string): IconMeta | undefined {
    // a local registration's meta is authoritative (even when it deliberately has none)
    return this.local.has(name) ? this.localMeta.get(name) : iconMeta.get(name);
  }

  names(): string[] {
    return [...new Set([...registry.keys(), ...this.local.keys()])];
  }

  /** Render a glyph centered in `box`, resolved per-editor (see {@link drawIcon} for the shared form). */
  draw(ctx: Ctx2D, name: string, box: Box, color: string, fill?: string): void {
    const draw = this.get(name);
    if (!draw) return;
    const size = Math.min(box.w, box.h);
    draw(ctx, box.x + (box.w - size) / 2, box.y + (box.h - size) / 2, size, color, fill);
  }
}

// ---- helpers ----

/** Stroke a path (built inside `fn`) with round caps/joins. */
function stroked(ctx: Ctx2D, color: string, w: number, fn: () => void): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  fn();
  ctx.restore();
}

/** Fill an arbitrary path built inside `fn` at reduced `alpha`. */
function filled(ctx: Ctx2D, color: string, alpha: number, fn: () => void): void {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  fn();
  ctx.restore();
}

/**
 * Build a path via `buildPath` (which must call `beginPath`), fill it at `alpha`, then stroke its
 * outline at full opacity. The current path survives save/restore, so both reuse it.
 */
function solid(
  ctx: Ctx2D,
  stroke: string,
  fill: string,
  w: number,
  alpha: number,
  buildPath: () => void,
): void {
  buildPath();
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

/** A small filled dot (status light, hub, punch). */
function dot(ctx: Ctx2D, color: string, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Default body-fill alpha for two-tone glyphs. */
const BODY = 0.2;

// ---- built-in icons (drawn on a 0..1 unit box scaled to `s`) ----

const server: IconDraw = (ctx, x, y, s, c, f) => {
  const fc = f ?? c;
  const p = s * 0.15;
  const w = s - 2 * p;
  const uh = (s - 2 * p - s * 0.12) / 2;
  for (let i = 0; i < 2; i++) {
    const ty = y + p + i * (uh + s * 0.12);
    solid(ctx, c, fc, s * 0.06, BODY, () => {
      ctx.beginPath();
      ctx.rect(x + p, ty, w, uh);
    });
    stroked(ctx, c, s * 0.05, () => {
      ctx.beginPath();
      ctx.moveTo(x + p + s * 0.09, ty + uh / 2);
      ctx.lineTo(x + p + s * 0.34, ty + uh / 2);
      ctx.stroke();
    });
    dot(ctx, c, x + s - p - s * 0.1, ty + uh / 2, s * 0.04);
  }
};

const database: IconDraw = (ctx, x, y, s, c, f) => {
  const fc = f ?? c;
  const rx = s * 0.32;
  const ry = s * 0.115;
  const cx = x + s / 2;
  const top = y + s * 0.22;
  const bot = y + s * 0.78;
  filled(ctx, fc, BODY, () => {
    ctx.beginPath();
    ctx.rect(cx - rx, top, rx * 2, bot - top);
    ctx.fill();
  });
  filled(ctx, fc, 0.32, () => {
    ctx.beginPath();
    ctx.ellipse(cx, top, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  stroked(ctx, c, s * 0.06, () => {
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
    ctx.ellipse(cx, top, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, y + s * 0.5, rx, ry, 0, 0, Math.PI);
    ctx.stroke();
  });
};

const bolt: IconDraw = (ctx, x, y, s, c, f) => {
  const fc = f ?? c;
  solid(ctx, c, fc, s * 0.06, 0.22, () => {
    ctx.beginPath();
    ctx.moveTo(x + s * 0.56, y + s * 0.1);
    ctx.lineTo(x + s * 0.3, y + s * 0.54);
    ctx.lineTo(x + s * 0.48, y + s * 0.54);
    ctx.lineTo(x + s * 0.42, y + s * 0.9);
    ctx.lineTo(x + s * 0.7, y + s * 0.42);
    ctx.lineTo(x + s * 0.5, y + s * 0.42);
    ctx.closePath();
  });
};

const queue: IconDraw = (ctx, x, y, s, c, f) => {
  const fc = f ?? c;
  for (let i = 0; i < 3; i++) {
    const ty = y + s * 0.22 + i * s * 0.21;
    solid(ctx, c, fc, s * 0.055, BODY, () => {
      ctx.beginPath();
      ctx.rect(x + s * 0.18, ty, s * 0.64, s * 0.13);
    });
  }
};

const balancer: IconDraw = (ctx, x, y, s, c, f) => {
  const fc = f ?? c;
  const hx = x + s * 0.24;
  const hy = y + s * 0.5;
  const hr = s * 0.1;
  const ex = x + s * 0.78;
  stroked(ctx, c, s * 0.055, () => {
    for (const ty of [0.24, 0.5, 0.76]) {
      ctx.beginPath();
      ctx.moveTo(hx + hr, hy);
      ctx.lineTo(ex - s * 0.06, y + s * ty);
      ctx.stroke();
    }
  });
  for (const ty of [0.24, 0.5, 0.76]) {
    solid(ctx, c, fc, s * 0.05, 0.9, () => {
      ctx.beginPath();
      ctx.arc(ex, y + s * ty, s * 0.06, 0, Math.PI * 2);
    });
  }
  solid(ctx, c, fc, s * 0.055, 0.9, () => {
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI * 2);
  });
};

const globe: IconDraw = (ctx, x, y, s, c, f) => {
  const fc = f ?? c;
  const cx = x + s / 2;
  const cy = y + s / 2;
  const r = s * 0.36;
  solid(ctx, c, fc, s * 0.055, 0.16, () => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  });
  stroked(ctx, c, s * 0.045, () => {
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.45, r, 0, 0, Math.PI * 2);
    ctx.stroke();
  });
};

const cloud: IconDraw = (ctx, x, y, s, c, f) => {
  const fc = f ?? c;
  solid(ctx, c, fc, s * 0.06, BODY, () => {
    const cy = y + s * 0.6;
    ctx.beginPath();
    ctx.arc(x + s * 0.34, cy - s * 0.04, s * 0.16, Math.PI * 0.5, Math.PI * 1.5);
    ctx.arc(x + s * 0.48, cy - s * 0.22, s * 0.19, Math.PI * 1.05, Math.PI * 1.9);
    ctx.arc(x + s * 0.66, cy - s * 0.06, s * 0.16, Math.PI * 1.5, Math.PI * 0.5);
    ctx.closePath();
  });
};

const user: IconDraw = (ctx, x, y, s, c, f) => {
  const fc = f ?? c;
  solid(ctx, c, fc, s * 0.06, 0.85, () => {
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s * 0.34, s * 0.15, 0, Math.PI * 2);
  });
  solid(ctx, c, fc, s * 0.06, 0.85, () => {
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s * 0.95, s * 0.3, Math.PI * 1.15, Math.PI * 1.85);
    ctx.closePath();
  });
};

const gear: IconDraw = (ctx, x, y, s, c, f) => {
  const fc = f ?? c;
  const cx = x + s / 2;
  const cy = y + s / 2;
  const r = s * 0.22;
  const teeth = 8;
  const ro = r * 1.5;
  solid(ctx, c, fc, s * 0.05, BODY, () => {
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const rr = i % 2 === 0 ? ro : r;
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  });
  stroked(ctx, c, s * 0.05, () => {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
    ctx.stroke();
  });
};

const code: IconDraw = (ctx, x, y, s, c) =>
  stroked(ctx, c, s * 0.085, () => {
    ctx.beginPath();
    ctx.moveTo(x + s * 0.4, y + s * 0.26);
    ctx.lineTo(x + s * 0.2, y + s * 0.5);
    ctx.lineTo(x + s * 0.4, y + s * 0.74);
    ctx.moveTo(x + s * 0.6, y + s * 0.26);
    ctx.lineTo(x + s * 0.8, y + s * 0.5);
    ctx.lineTo(x + s * 0.6, y + s * 0.74);
    ctx.stroke();
  });

const box3d: IconDraw = (ctx, x, y, s, c, f) => {
  const fc = f ?? c;
  const p = s * 0.22;
  const d = s * 0.12;
  stroked(ctx, c, s * 0.05, () => {
    ctx.beginPath();
    ctx.rect(x + p + d, y + p - d, s - 2 * p, s - 2 * p);
    ctx.stroke();
  });
  solid(ctx, c, fc, s * 0.06, 0.22, () => {
    ctx.beginPath();
    ctx.rect(x + p, y + p, s - 2 * p, s - 2 * p);
  });
  stroked(ctx, c, s * 0.045, () => {
    ctx.beginPath();
    ctx.moveTo(x + p, y + p);
    ctx.lineTo(x + p + d, y + p - d);
    ctx.moveTo(x + s - p, y + p);
    ctx.lineTo(x + s - p + d, y + p - d);
    ctx.moveTo(x + s - p, y + s - p);
    ctx.lineTo(x + s - p + d, y + s - p - d);
    ctx.stroke();
  });
};

const lock: IconDraw = (ctx, x, y, s, c, f) => {
  const fc = f ?? c;
  solid(ctx, c, fc, s * 0.06, 0.22, () => {
    ctx.beginPath();
    ctx.rect(x + s * 0.28, y + s * 0.44, s * 0.44, s * 0.34);
  });
  stroked(ctx, c, s * 0.06, () => {
    ctx.beginPath();
    ctx.arc(x + s * 0.5, y + s * 0.44, s * 0.14, Math.PI, Math.PI * 2);
    ctx.stroke();
  });
  dot(ctx, c, x + s * 0.5, y + s * 0.6, s * 0.035);
};

const fn: IconDraw = (ctx, x, y, s, c) =>
  stroked(ctx, c, s * 0.09, () => {
    // a lambda: two strokes meeting
    ctx.beginPath();
    ctx.moveTo(x + s * 0.28, y + s * 0.26);
    ctx.lineTo(x + s * 0.44, y + s * 0.26);
    ctx.lineTo(x + s * 0.7, y + s * 0.76);
    ctx.moveTo(x + s * 0.52, y + s * 0.46);
    ctx.lineTo(x + s * 0.3, y + s * 0.76);
    ctx.stroke();
  });

const bucket: IconDraw = (ctx, x, y, s, c, f) => {
  const fc = f ?? c;
  solid(ctx, c, fc, s * 0.06, BODY, () => {
    ctx.beginPath();
    ctx.moveTo(x + s * 0.24, y + s * 0.3);
    ctx.lineTo(x + s * 0.34, y + s * 0.78);
    ctx.lineTo(x + s * 0.66, y + s * 0.78);
    ctx.lineTo(x + s * 0.76, y + s * 0.3);
    ctx.closePath();
  });
  solid(ctx, c, fc, s * 0.055, 0.32, () => {
    ctx.beginPath();
    ctx.ellipse(x + s * 0.5, y + s * 0.3, s * 0.26, s * 0.09, 0, 0, Math.PI * 2);
  });
};

/** Register the built-in icon set. Called once at module load. */
export function installDefaultIcons(): void {
  const defs: Record<string, IconDraw> = {
    server, database, cache: bolt, queue, balancer, globe, cloud, user, gear, code, box: box3d, lock, function: fn, bucket,
  };
  for (const [name, dfn] of Object.entries(defs)) registry.set(name, dfn);
}

installDefaultIcons();
