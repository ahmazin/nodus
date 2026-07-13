import { describe, expect, it } from 'vitest';
import { drawVectorIcon, OP, type Ctx2D, type VectorIcon } from '../index.js';

function stubCtx() {
  const fills: string[] = [];
  const fillRules: (string | undefined)[] = [];
  const ops: string[] = [];
  const pts: number[] = [];
  const ctx = {
    save() {}, restore() {}, beginPath() { ops.push('begin'); },
    moveTo(x: number, y: number) { ops.push('M'); pts.push(x, y); },
    lineTo(x: number, y: number) { ops.push('L'); pts.push(x, y); },
    bezierCurveTo(...n: number[]) { ops.push('C'); pts.push(...n); },
    closePath() { ops.push('Z'); },
    fill(fillRule?: 'nonzero' | 'evenodd') {
      fills.push((ctx as unknown as { fillStyle: string }).fillStyle);
      fillRules.push(fillRule);
    },
    fillStyle: '',
  };
  return { ctx: ctx as unknown as Ctx2D, fills, fillRules, ops, pts };
}

const icon: VectorIcon = {
  vb: [10, 10],
  sub: [{ fill: '#ED7100', cmds: [OP.M, 0, 0, OP.L, 10, 0, OP.L, 10, 10, OP.Z] }],
};

describe('drawVectorIcon', () => {
  it('scales the viewBox into the box, centers, and fills each subpath in its own color', () => {
    const { ctx, fills, ops, pts } = stubCtx();
    drawVectorIcon(ctx, icon, { x: 100, y: 200, w: 20, h: 20 });
    expect(fills).toEqual(['#ED7100']);
    expect(ops).toEqual(['begin', 'M', 'L', 'L', 'Z']);
    // vb 10 -> box 20 => scale 2; origin (100,200); first point (0,0) -> (100,200)
    expect(pts.slice(0, 2)).toEqual([100, 200]);
    // point (10,0) -> (120,200)
    expect(pts.slice(2, 4)).toEqual([120, 200]);
  });

  it('preserves aspect ratio and centers on the shorter axis', () => {
    const { ctx, pts } = stubCtx();
    drawVectorIcon(ctx, icon, { x: 0, y: 0, w: 40, h: 20 }); // scale = min(4,2)=2; ox=(40-20)/2=10
    expect(pts.slice(0, 2)).toEqual([10, 0]);
  });

  it('passes fillRule through to ctx.fill so evenodd subpaths render holes correctly', () => {
    const { ctx, fillRules } = stubCtx();
    const compound: VectorIcon = {
      vb: [10, 10],
      sub: [
        { fill: '#000', cmds: [OP.M, 0, 0, OP.L, 10, 0, OP.L, 10, 10, OP.Z], fillRule: 'evenodd' },
        { fill: '#fff', cmds: [OP.M, 2, 2, OP.L, 8, 2, OP.L, 8, 8, OP.Z] },
      ],
    };
    drawVectorIcon(ctx, compound, { x: 0, y: 0, w: 10, h: 10 });
    expect(fillRules).toEqual(['evenodd', undefined]);
  });
});
