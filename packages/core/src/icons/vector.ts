/**
 * Data-driven vector icons: a compact path-command format replayed through the existing Ctx2D
 * primitives, so provider icon packs (AWS/Azure/GCP) render identically in the browser and headless.
 * Icons carry their own baked fills (multi-color brand art); the theme accent is not applied here.
 */
import type { Box } from '../model.js';
import type { Ctx2D } from '../renderer/context.js';

export interface VectorSubpath {
  fill: string;
  cmds: number[]; // flat opcode stream: 0=M(x,y) 1=L(x,y) 2=C(x1,y1,x2,y2,x,y) 3=Z
  fillRule?: 'nonzero' | 'evenodd';
}
export interface VectorIcon {
  vb: [number, number];
  sub: VectorSubpath[];
  needsChip?: boolean;
}

export const OP = { M: 0, L: 1, C: 2, Z: 3 } as const;

/** Replay a vector icon scaled to fit `box` (aspect-preserving, centered), filling own colors. */
export function drawVectorIcon(ctx: Ctx2D, icon: VectorIcon, box: Box): void {
  const [vw, vh] = icon.vb;
  if (vw <= 0 || vh <= 0) return;
  const scale = Math.min(box.w / vw, box.h / vh);
  const ox = box.x + (box.w - vw * scale) / 2;
  const oy = box.y + (box.h - vh * scale) / 2;
  const X = (x: number): number => ox + x * scale;
  const Y = (y: number): number => oy + y * scale;
  ctx.save();
  for (const sp of icon.sub) {
    ctx.beginPath();
    const c = sp.cmds;
    let i = 0;
    while (i < c.length) {
      const op = c[i++];
      if (op === OP.M) ctx.moveTo(X(c[i++]!), Y(c[i++]!));
      else if (op === OP.L) ctx.lineTo(X(c[i++]!), Y(c[i++]!));
      else if (op === OP.C)
        ctx.bezierCurveTo(X(c[i++]!), Y(c[i++]!), X(c[i++]!), Y(c[i++]!), X(c[i++]!), Y(c[i++]!));
      else if (op === OP.Z) ctx.closePath();
      else break;
    }
    ctx.fillStyle = sp.fill;
    ctx.fill(sp.fillRule);
  }
  ctx.restore();
}
