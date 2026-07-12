import { describe, expect, it } from 'vitest';
import { Editor, effect, type Ctx2D, type Id } from '../index.js';

/** Build an editor with one flowing edge; returns the editor and edge id. */
function build(): { ed: Editor; e: Id } {
  const ed = new Editor();
  const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
  const b = ed.createNode({ type: 'rect', x: 400, y: 0, w: 100, h: 100 });
  const e = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b })!;
  ed.setFlow([e], { style: 'dots', count: 3, speed: 70 });
  return { ed, e };
}

describe('flow runtime config', () => {
  it('exposes defaults', () => {
    const { ed } = build();
    expect(ed.flowConfig()).toEqual({
      enabled: true, paused: false, speedScale: 1, respectReducedMotion: true,
    });
  });

  it('setFlowConfig merges patches and clamps speedScale to >= 0', () => {
    const { ed } = build();
    ed.setFlowConfig({ paused: true });
    expect(ed.flowConfig().paused).toBe(true);
    expect(ed.flowConfig().enabled).toBe(true); // untouched by the patch
    ed.setFlowConfig({ speedScale: -5 });
    expect(ed.flowConfig().speedScale).toBe(0);
    ed.setFlowConfig({ maxFps: 30 });
    expect(ed.flowConfig().maxFps).toBe(30);
  });

  it('setFlowConfig keeps speedScale a finite number >= 0', () => {
    const { ed } = build();
    ed.setFlowConfig({ speedScale: -5 });
    expect(ed.flowConfig().speedScale).toBe(0);
    ed.setFlowConfig({ speedScale: undefined });               // explicit undefined must not poison it
    expect(Number.isFinite(ed.flowConfig().speedScale)).toBe(true);
    ed.setFlowConfig({ speedScale: Number.NaN });
    expect(Number.isFinite(ed.flowConfig().speedScale)).toBe(true);
  });

  it('sugar methods delegate to setFlowConfig', () => {
    const { ed } = build();
    ed.pauseFlow(); expect(ed.flowConfig().paused).toBe(true);
    ed.resumeFlow(); expect(ed.flowConfig().paused).toBe(false);
    ed.setFlowEnabled(false); expect(ed.flowConfig().enabled).toBe(false);
    ed.setFlowSpeedScale(2); expect(ed.flowConfig().speedScale).toBe(2);
  });

  it('isFlowAnimating gates on enabled, paused, and reduced-motion; hasFlow is unchanged', () => {
    const { ed } = build();
    expect(ed.hasFlow()).toBe(true);
    expect(ed.isFlowAnimating()).toBe(true);

    ed.setFlowEnabled(false);
    expect(ed.isFlowAnimating()).toBe(false);
    expect(ed.hasFlow()).toBe(true); // doc truth unchanged

    ed.setFlowEnabled(true); ed.pauseFlow();
    expect(ed.isFlowAnimating()).toBe(false);

    ed.resumeFlow(); ed.setReducedMotion(true);
    expect(ed.isFlowAnimating()).toBe(false); // respected by default

    ed.setFlowConfig({ respectReducedMotion: false });
    expect(ed.isFlowAnimating()).toBe(true); // host override
  });

  it('isFlowAnimating is false when no edge is flowing', () => {
    const ed = new Editor();
    expect(ed.isFlowAnimating()).toBe(false);
  });
});

/** A recording Ctx2D capturing packet-dot arc() calls (mirrors flow.test.ts). Implements the full
 *  Ctx2D surface as no-ops (paintRegion also paints the static scene, which needs more of the
 *  surface than paintFlow's marker-only path does) so it can stand in for a real canvas context. */
function mockCtx(): Ctx2D & { arcs: { x: number; y: number }[] } {
  const arcs: { x: number; y: number }[] = [];
  const noop = (): void => {};
  return {
    arcs,
    save: noop, restore: noop, scale: noop, translate: noop, rotate: noop,
    setTransform: noop, transform: noop,
    clearRect: noop, fillRect: noop, strokeRect: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arc: (x: number, y: number) => arcs.push({ x, y }),
    arcTo: noop, ellipse: noop, quadraticCurveTo: noop, bezierCurveTo: noop, rect: noop,
    fill: noop, stroke: noop, clip: noop,
    fillText: noop, strokeText: noop, measureText: () => ({ width: 0 }),
    setLineDash: noop,
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '', lineDashOffset: 0,
    font: '', textAlign: '', textBaseline: '', globalAlpha: 1,
    shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
  } as unknown as Ctx2D & { arcs: { x: number; y: number }[] };
}

describe('flow config affects paintFlow rendering', () => {
  it('enabled:false draws nothing', () => {
    const { ed } = build();
    ed.setFlowEnabled(false);
    const c = mockCtx();
    ed.paintFlow(c, 1, 0);
    ed.paintFlow(c, 1, 100);
    expect(c.arcs).toHaveLength(0);
  });

  it('paused freezes markers in place across advancing time', () => {
    const { ed } = build();
    // establish a non-zero clock position, then pause
    ed.paintFlow(mockCtx(), 1, 0);
    ed.paintFlow(mockCtx(), 1, 50);
    ed.pauseFlow();
    const a = mockCtx(); ed.paintFlow(a, 1, 100);
    const b = mockCtx(); ed.paintFlow(b, 1, 900);
    expect(a.arcs.length).toBeGreaterThan(0);
    expect(b.arcs).toEqual(a.arcs); // identical — frozen despite 800ms passing
  });

  it('paused then resumed continues from the frozen phase (no jump-forward)', () => {
    const { ed } = build();
    ed.paintFlow(mockCtx(), 1, 0);
    ed.paintFlow(mockCtx(), 1, 50);
    const beforePause = mockCtx(); ed.paintFlow(beforePause, 1, 50);
    ed.pauseFlow();
    ed.paintFlow(mockCtx(), 1, 5000); // long pause, no motion
    ed.resumeFlow();
    const afterResume = mockCtx(); ed.paintFlow(afterResume, 1, 5000);
    // resumes from where it froze (dt=0 this frame), not jumped forward by ~5s
    expect(afterResume.arcs).toEqual(beforePause.arcs);
  });

  it('speedScale advances the animation faster', () => {
    const mk = (scale: number) => {
      const { ed } = build();
      ed.setFlowSpeedScale(scale);
      ed.paintFlow(mockCtx(), 1, 0); // prime prevTime at t=0
      const c = mockCtx();
      ed.paintFlow(c, 1, 40); // 40ms < adaptive clamp, integrated fully
      return c.arcs[0]!.x;
    };
    // packets move along +x; larger scale => further along after the same 40ms
    expect(mk(3)).not.toBeCloseTo(mk(1), 1);
  });

  it('respects reduced-motion by freezing, and honors the host override', () => {
    const { ed } = build();
    ed.paintFlow(mockCtx(), 1, 0);
    ed.setReducedMotion(true);
    const a = mockCtx(); ed.paintFlow(a, 1, 100);
    const b = mockCtx(); ed.paintFlow(b, 1, 800);
    expect(a.arcs.length).toBeGreaterThan(0);
    expect(b.arcs).toEqual(a.arcs); // frozen

    ed.setFlowConfig({ respectReducedMotion: false });
    const c = mockCtx(); ed.paintFlow(c, 1, 1200);
    expect(c.arcs).not.toEqual(a.arcs); // animates again (override)
  });

  it('clamps a large dt gap to maxDt (64ms) so the clock does not leap', () => {
    // Editor A: prime at t=0, then a 10s gap. The adaptive clamp caps this frame's
    // advance at maxDt=64ms, so flowClock lands at exactly 64.
    const { ed } = build();
    ed.paintFlow(mockCtx(), 1, 0);
    const huge = mockCtx(); ed.paintFlow(huge, 1, 10000);
    // Editor B: reference driven to exactly flowClock=64 (a clean 64ms frame).
    const { ed: ed2 } = build();
    ed2.paintFlow(mockCtx(), 1, 0);
    const ref = mockCtx(); ed2.paintFlow(ref, 1, 64);
    // Identical: both advanced the clock by exactly 64ms. Fails if the clamp were
    // removed (unclamped A would reach flowClock=10000 ≠ 64) or miscalculated.
    expect(huge.arcs.length).toBeGreaterThan(0);
    expect(huge.arcs).toEqual(ref.arcs);
  });
});

describe('flow config affects the snapshot path (paintRegion)', () => {
  const region = { x: -50, y: -50, w: 600, h: 200 };

  it('enabled:false suppresses flow in snapshots', () => {
    const { ed } = build();
    ed.setFlowEnabled(false);
    const c = mockCtx();
    ed.paintRegion(c, region, 1, { flow: true, time: 100 });
    expect(c.arcs).toHaveLength(0);
  });

  it('draws flow when enabled, and speedScale shifts the static phase', () => {
    const { ed } = build();
    const c1 = mockCtx();
    ed.paintRegion(c1, region, 1, { flow: true, time: 100 });
    expect(c1.arcs.length).toBeGreaterThan(0);

    ed.setFlowSpeedScale(2);
    const c2 = mockCtx();
    ed.paintRegion(c2, region, 1, { flow: true, time: 100 });
    // effective time doubles => different packet positions
    expect(c2.arcs).not.toEqual(c1.arcs);
  });

  it('snapshot does not disturb the live flow clock', () => {
    const { ed } = build();
    ed.paintFlow(mockCtx(), 1, 0);
    const live1 = mockCtx(); ed.paintFlow(live1, 1, 40);
    ed.paintRegion(mockCtx(), region, 1, { flow: true, time: 999999 }); // stateless
    const live2 = mockCtx(); ed.paintFlow(live2, 1, 80);
    const live3ref = (() => { const { ed: e2 } = build(); e2.paintFlow(mockCtx(),1,0); e2.paintFlow(mockCtx(),1,40); const m = mockCtx(); e2.paintFlow(m,1,80); return m; })();
    expect(live2.arcs).toEqual(live3ref.arcs); // live clock advanced purely by paintFlow calls
  });
});

describe('setViewport and the render-loop idle invariant', () => {
  it('setViewport does not notify observers when dimensions are unchanged (lets the rAF loop idle so maxFps can throttle)', () => {
    const ed = new Editor();
    ed.setViewport(800, 600);
    let runs = 0;
    const stop = effect(() => { ed.viewportAtom.get(); runs++; }); // runs once on subscribe
    expect(runs).toBe(1);
    ed.setViewport(800, 600);       // same dims -> must NOT notify
    expect(runs).toBe(1);
    ed.setViewport(1024, 768);      // changed -> must notify
    expect(runs).toBe(2);
    stop();
  });
});
