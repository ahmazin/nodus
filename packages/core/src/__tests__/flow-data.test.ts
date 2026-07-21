import { describe, expect, it } from 'vitest';
import { Editor, colorForValue, resolveFlow, type Ctx2D, type FlowScale } from '../index.js';

describe('resolveFlow (metric → visuals)', () => {
  const scale: FlowScale = {
    domain: [0, 1],
    speed: [10, 100],
    count: [1, 5],
    size: [2, 6],
    colors: [
      { at: 0, color: '#ef4444' },
      { at: 0.5, color: '#f59e0b' },
      { at: 0.8, color: '#22c55e' },
    ],
  };

  it('interpolates speed/count/size across the domain', () => {
    expect(resolveFlow({ scale }, 0).speed).toBe(10);
    expect(resolveFlow({ scale }, 1).speed).toBe(100);
    expect(resolveFlow({ scale }, 0.5).speed).toBeCloseTo(55, 5);
    expect(resolveFlow({ scale }, 1).count).toBe(5);
    expect(resolveFlow({ scale }, 0).count).toBe(1);
  });

  it('clamps out-of-domain metrics', () => {
    expect(resolveFlow({ scale }, -5).speed).toBe(10);
    expect(resolveFlow({ scale }, 99).speed).toBe(100);
  });

  it('picks stepped threshold colors by default', () => {
    expect(colorForValue(scale, 0.1)).toBe('#ef4444'); // below amber → red band
    expect(colorForValue(scale, 0.6)).toBe('#f59e0b'); // in amber band
    expect(colorForValue(scale, 0.9)).toBe('#22c55e'); // in green band
  });

  it('blends colors when gradient is set', () => {
    const g: FlowScale = { domain: [0, 1], colors: [{ at: 0, color: '#000000' }, { at: 1, color: '#ffffff' }], gradient: true };
    expect(colorForValue(g, 0.5)).toBe('#808080'); // midpoint grey
  });

  it('returns the base spec unchanged with no scale or a non-finite metric', () => {
    expect(resolveFlow({ speed: 42 }, 0.5)).toEqual({ speed: 42 });
    expect(resolveFlow({ scale, speed: 42 }, Number.NaN).speed).toBe(42);
    expect(resolveFlow({ scale, speed: 42 }, undefined).speed).toBe(42); // no live/static value
  });

  it('falls back to the static data value when no live metric is given', () => {
    expect(resolveFlow({ scale, data: 1 }, undefined).speed).toBe(100);
  });
});

function mockCtx(): Ctx2D & { arcs: { x: number; color: string }[] } {
  const arcs: { x: number; color: string }[] = [];
  const noop = (): void => {};
  const ctx = {
    arcs,
    save: noop, restore: noop, setTransform: noop, beginPath: noop, fill: noop, stroke: noop,
    moveTo: noop, lineTo: noop, setLineDash: noop, closePath: noop, arcTo: noop, fillText: noop,
    measureText: () => ({ width: 0 }),
    arc: (x: number) => arcs.push({ x, color: (ctx as { fillStyle: string }).fillStyle }),
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineDashOffset: 0, shadowColor: '', shadowBlur: 0,
    globalAlpha: 1, font: '', textAlign: 'center', textBaseline: 'middle',
  };
  return ctx as unknown as Ctx2D & { arcs: { x: number; color: string }[] };
}

describe('live metrics drive edge flow', () => {
  const build = () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const b = ed.createNode({ type: 'rect', x: 500, y: 0, w: 100, h: 100 });
    const e = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b })!;
    ed.setFlow([e], {
      style: 'dots',
      scale: { domain: [0, 1], speed: [5, 120], colors: [{ at: 0, color: '#ef4444' }, { at: 0.7, color: '#22c55e' }] },
    });
    return { ed, e };
  };

  it('the live metric changes packet color (threshold) without touching the document', () => {
    const { ed, e } = build();
    const before = ed.toJSON();

    ed.setFlowMetric(e, 0.1); // low → red
    const lo = mockCtx();
    ed.paintFlow(lo, 1, 0);
    expect(lo.arcs[0]!.color).toBe('#ef4444');

    ed.setFlowMetric(e, 0.9); // high → green
    const hi = mockCtx();
    ed.paintFlow(hi, 1, 0);
    expect(hi.arcs[0]!.color).toBe('#22c55e');

    // metric updates are ephemeral: the serialized document is byte-identical
    expect(JSON.stringify(ed.toJSON())).toBe(JSON.stringify(before));
  });

  it('a higher metric makes packets travel faster', () => {
    const { ed, e } = build();
    const displacement = (metric: number): number => {
      ed.setFlowMetric(e, metric);
      const t0 = mockCtx();
      ed.paintFlow(t0, 1, 0);
      const t1 = mockCtx();
      ed.paintFlow(t1, 1, 100); // 0.1s later
      return Math.abs(t1.arcs[0]!.x - t0.arcs[0]!.x);
    };
    expect(displacement(1)).toBeGreaterThan(displacement(0.05));
  });
});
