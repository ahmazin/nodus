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

// paintFlowMarkers / drawFlowGlow never call fillText (they draw arcs/strokes) — the rate pill's
// `DrawApi.label()` is the ONLY path to ctx.fillText in the flow-paint pipeline. So counting fillText
// calls is an exact proxy for "was a pill drawn". Shared by both describe blocks below.
const withFillTextSpy = (ctx: ReturnType<typeof mockCtx>): { calls: number } => {
  const spy = { calls: 0 };
  const orig = ctx.fillText.bind(ctx);
  ctx.fillText = ((...args: Parameters<Ctx2D['fillText']>) => {
    spy.calls++;
    return orig(...args);
  }) as Ctx2D['fillText'];
  return spy;
};

describe('flow rate pill — no-value gate', () => {
  const build = () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const b = ed.createNode({ type: 'rect', x: 500, y: 0, w: 100, h: 100 });
    const e = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b })!;
    // Flow visuals enabled (dots), but NO scale and NO static `data` — so `flowMetrics.get(id) ?? flow.data`
    // is undefined and there is nothing for the pill to display.
    ed.setFlow([e], { style: 'dots' });
    return { ed, e };
  };

  it('draws NO pill for a flowing edge with no metric and no static data (never "undefined"/"NaN")', () => {
    const { ed } = build();
    const ctx = mockCtx();
    const spy = withFillTextSpy(ctx);
    ed.paintFlow(ctx, 1, 0);
    expect(spy.calls).toBe(0);
  });

  it('draws a pill once a live metric is set on the same edge — proving the gate discriminates', () => {
    const { ed, e } = build();
    ed.setFlowMetric(e, 42);
    const ctx = mockCtx();
    const spy = withFillTextSpy(ctx);
    ed.paintFlow(ctx, 1, 0);
    expect(spy.calls).toBeGreaterThan(0);
  });
});

describe('flow rate pill — zoom LOD gate', () => {
  // A numeric readout is unreadable clutter once zoomed way out, so the pill hides below zoom 0.55
  // (matching the node-glyph LOD in stencil.ts). The glow/marker layers are NOT gated — only the pill.
  const build = () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const b = ed.createNode({ type: 'rect', x: 500, y: 0, w: 100, h: 100 });
    const e = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b })!;
    ed.setFlow([e], { style: 'dots' });
    ed.setFlowMetric(e, 42); // gives the pill an actual value to render
    return { ed, e };
  };

  it('hides the pill below zoom 0.55, but still draws the packet markers', () => {
    const { ed } = build();
    ed.setCamera({ ...ed.camera, z: 0.3 });
    const ctx = mockCtx();
    const spy = withFillTextSpy(ctx);
    ed.paintFlow(ctx, 1, 0);
    expect(spy.calls).toBe(0);
    expect(ctx.arcs.length).toBeGreaterThan(0);
  });

  it('shows the pill at zoom exactly 0.55 (boundary is inclusive)', () => {
    const { ed } = build();
    ed.setCamera({ ...ed.camera, z: 0.55 });
    const ctx = mockCtx();
    const spy = withFillTextSpy(ctx);
    ed.paintFlow(ctx, 1, 0);
    expect(spy.calls).toBeGreaterThan(0);
  });

  it('shows the pill zoomed in above the threshold', () => {
    const { ed } = build();
    ed.setCamera({ ...ed.camera, z: 1 });
    const ctx = mockCtx();
    const spy = withFillTextSpy(ctx);
    ed.paintFlow(ctx, 1, 0);
    expect(spy.calls).toBeGreaterThan(0);
  });
});

describe('flow marker count is clamped (per-frame DoS guard)', () => {
  // `flow.count` is untrusted, author-controlled data that round-trips through *.nodus.json. The
  // marker pass draws one arc per count on EVERY animation frame, so a crafted `count: 5e8` (or a
  // non-finite value) would issue hundreds of millions of fills per frame and freeze the tab. The
  // sink clamps to this ceiling so the loop can never be driven unbounded (mirrors the module-local
  // MAX_FLOW_MARKERS in renderer/paint.ts).
  const MAX_FLOW_MARKERS = 10000;
  const build = (count: number) => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const b = ed.createNode({ type: 'rect', x: 500, y: 0, w: 100, h: 100 });
    const e = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b })!;
    ed.setFlow([e], { style: 'dots', count });
    return ed;
  };

  it('caps a hostile huge count at MAX_FLOW_MARKERS instead of drawing it verbatim', () => {
    const ed = build(500_000_000);
    const ctx = mockCtx();
    ed.paintFlow(ctx, 1, 0);
    expect(ctx.arcs.length).toBe(MAX_FLOW_MARKERS);
  });

  it('caps a non-finite (Infinity) count — which would otherwise loop forever', () => {
    const ed = build(Number.POSITIVE_INFINITY);
    const ctx = mockCtx();
    ed.paintFlow(ctx, 1, 0);
    expect(ctx.arcs.length).toBe(MAX_FLOW_MARKERS);
  });

  it('leaves a normal author-chosen count untouched (no behavior change below the cap)', () => {
    const ed = build(12);
    const ctx = mockCtx();
    ed.paintFlow(ctx, 1, 0);
    expect(ctx.arcs.length).toBe(12);
  });
});
