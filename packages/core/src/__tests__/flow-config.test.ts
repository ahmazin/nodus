import { describe, expect, it } from 'vitest';
import { Editor, type Ctx2D, type Id } from '../index.js';

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

/** A recording Ctx2D capturing packet-dot arc() calls (mirrors flow.test.ts). */
function mockCtx(): Ctx2D & { arcs: { x: number; y: number }[] } {
  const arcs: { x: number; y: number }[] = [];
  const noop = (): void => {};
  return {
    arcs,
    save: noop, restore: noop, setTransform: noop, beginPath: noop, fill: noop, stroke: noop,
    moveTo: noop, lineTo: noop, setLineDash: noop, closePath: noop,
    arc: (x: number, y: number) => arcs.push({ x, y }),
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineDashOffset: 0, shadowColor: '', shadowBlur: 0,
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
    expect(huge.arcs).toEqual(ref.arcs);
  });
});
