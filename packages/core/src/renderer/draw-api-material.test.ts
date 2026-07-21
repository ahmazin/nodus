import { describe, expect, it } from 'vitest';
import { DrawApi } from './draw-api.js';
import { SVGContext } from './svg-context.js';
import type { Ctx2D } from './context.js';
import type { ResolvedTokens } from '../theme/index.js';

const tokens = { roughness: 0, fontSize: 12, fontScale: 1, fontFamily: 'sans', text: '#fff' } as unknown as ResolvedTokens;

/** A Ctx2D that records createLinearGradient calls, addColorStop calls, shadow property writes, and
 *  the last-written `fillStyle`/`strokeStyle` (which may be a plain color string, not a gradient). */
function recordingCtx(): {
  ctx: Ctx2D;
  grads: { coords: number[]; stops: [number, string][] }[];
  shadow: Record<string, unknown>;
  style: Record<string, unknown>;
} {
  const grads: { coords: number[]; stops: [number, string][] }[] = [];
  const shadow: Record<string, unknown> = {};
  const style: Record<string, unknown> = {};
  const ctx = new Proxy(
    {
      createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
        const g = { coords: [x0, y0, x1, y1], stops: [] as [number, string][] };
        grads.push(g);
        return { addColorStop: (o: number, c: string) => g.stops.push([o, c]) };
      },
    } as Record<string, unknown>,
    {
      get(t, p) {
        if (p in t) return (t as Record<string, unknown>)[p as string];
        return (..._a: unknown[]) => undefined; // no-op for every other Ctx2D method
      },
      set(_t, p, v) {
        if (typeof p === 'string' && p.startsWith('shadow')) shadow[p] = v;
        if (p === 'fillStyle' || p === 'strokeStyle') style[p] = v;
        return true;
      },
    },
  ) as unknown as Ctx2D;
  return { ctx, grads, shadow, style };
}

describe('DrawApi materials', () => {
  it('builds a top→bottom gradient across the box and adds stops in order', () => {
    const { ctx, grads } = recordingCtx();
    new DrawApi(ctx, tokens).fillRoundRect({ x: 10, y: 20, w: 40, h: 80 }, 6, '#000', {
      gradient: { stops: [{ at: 0, color: '#aaa' }, { at: 1, color: '#333' }] },
    });
    expect(grads).toHaveLength(1);
    // default angle 90° → vertical line down the box center (cx=30): (30,20)→(30,100)
    expect(grads[0]!.coords).toEqual([30, 20, 30, 100]);
    expect(grads[0]!.stops).toEqual([[0, '#aaa'], [1, '#333']]);
  });

  it('applies an offset drop shadow distinct from glow', () => {
    const { ctx, shadow } = recordingCtx();
    new DrawApi(ctx, tokens).fillRoundRect({ x: 0, y: 0, w: 10, h: 10 }, 2, '#000', {
      shadow: { color: '#0008', blur: 16, dx: 0, dy: 4 },
    });
    expect(shadow.shadowColor).toBe('#0008');
    expect(shadow.shadowBlur).toBe(16);
    expect(shadow.shadowOffsetX).toBe(0);
    expect(shadow.shadowOffsetY).toBe(4);
  });

  it('renders a gradient fill through the SVG context', () => {
    const ctx = new SVGContext();
    new DrawApi(ctx as unknown as Ctx2D, tokens).fillRoundRect({ x: 0, y: 0, w: 10, h: 10 }, 2, '#000', {
      gradient: { stops: [{ at: 0, color: '#fff' }, { at: 1, color: '#000' }] },
    });
    expect(ctx.toSVG(10, 10)).toContain('<linearGradient');
  });
});

describe('DrawApi materials — strokes & polygons', () => {
  it('gradient-strokes a clean polyline across its bounding box', () => {
    const { ctx, grads } = recordingCtx();
    new DrawApi(ctx, tokens).strokePolyline(
      [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      '#000',
      { gradient: { stops: [{ at: 0, color: '#f00' }, { at: 1, color: '#00f' }], angle: 0 } },
    );
    expect(grads).toHaveLength(1);
    // angle 0° (L→R) across bbox width 100, height 0 → (0,0)→(100,0)
    expect(grads[0]!.coords).toEqual([0, 0, 100, 0]);
  });

  it('falls back to the first stop color for a sketchy stroke', () => {
    const rough = { ...tokens, roughness: 2 } as unknown as ResolvedTokens;
    const ctx = new SVGContext();
    new DrawApi(ctx as unknown as Ctx2D, rough).strokeRoundRect({ x: 0, y: 0, w: 20, h: 20 }, 4, '#000', {
      gradient: { stops: [{ at: 0, color: '#abcdef' }, { at: 1, color: '#000000' }] },
    });
    const out = ctx.toSVG(20, 20);
    expect(out).toContain('stroke="#abcdef"');
    expect(out).not.toContain('<linearGradient');
  });

  it('gradient-fills an ellipse and a polygon', () => {
    const { ctx, grads } = recordingCtx();
    const api = new DrawApi(ctx, tokens);
    api.fillEllipse({ x: 0, y: 0, w: 40, h: 40 }, '#000', { gradient: { stops: [{ at: 0, color: '#fff' }, { at: 1, color: '#000' }] } });
    api.fillPolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }], '#000', { gradient: { stops: [{ at: 0, color: '#fff' }, { at: 1, color: '#000' }] } });
    expect(grads).toHaveLength(2);
  });
});

describe('DrawApi materials — zero-extent gradient parity (DOM↔SVG)', () => {
  it('a horizontal polyline stroked with the default vertical gradient paints the last stop color, not a degenerate gradient', () => {
    const { ctx, grads, style } = recordingCtx();
    // bbox height is 0; default angle (90°, top→bottom) projects to zero extent along that axis.
    new DrawApi(ctx, tokens).strokePolyline(
      [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      '#000',
      { gradient: { stops: [{ at: 0, color: '#f00' }, { at: 1, color: '#00f' }] } },
    );
    expect(grads).toHaveLength(0); // no degenerate createLinearGradient(cx,cy,cx,cy) call
    expect(style.strokeStyle).toBe('#00f'); // last stop — matches SVG's behavior on a zero-length gradient
  });

  it('a zero-height box filled with the default vertical gradient paints the last stop color, not a degenerate gradient', () => {
    const { ctx, grads, style } = recordingCtx();
    new DrawApi(ctx, tokens).fillRoundRect({ x: 10, y: 20, w: 40, h: 0 }, 0, '#000', {
      gradient: { stops: [{ at: 0, color: '#aaa' }, { at: 1, color: '#333' }] },
    });
    expect(grads).toHaveLength(0);
    expect(style.fillStyle).toBe('#333');
  });
});
