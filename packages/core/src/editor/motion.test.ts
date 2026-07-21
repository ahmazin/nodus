import { describe, expect, it } from 'vitest';
import { Editor, type Ctx2D } from '../index.js';
import type { NodeRecord } from '../model.js';

function edWithNode() {
  const ed = new Editor({ viewport: { w: 800, h: 600 } });
  const id = ed.createNode({ type: 'rect', x: 100, y: 100, w: 80, h: 40 });
  return { ed, id };
}

/** Tracks the ctx properties the selection halo cares about (shadowBlur, shadowColor, strokeStyle,
 *  lineWidth), with a real save/restore stack so nested `ctx.save()/restore()` pairs (as used by
 *  `strokeWorldBox` and the halo block) behave like the real Canvas API. Copied from the proven
 *  pattern in `selection-halo.test.ts`. */
function recordingCtx(): {
  ctx: Ctx2D;
  strokes: Array<{ shadowBlur: number; shadowColor: string; strokeStyle: unknown; lineWidth: number }>;
} {
  const strokes: Array<{ shadowBlur: number; shadowColor: string; strokeStyle: unknown; lineWidth: number }> = [];
  let cur = { shadowBlur: 0, shadowColor: '', strokeStyle: '' as unknown, lineWidth: 0 };
  const stack: Array<typeof cur> = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'save')
          return () => {
            stack.push({ ...cur });
          };
        if (prop === 'restore')
          return () => {
            const s = stack.pop();
            if (s) cur = s;
          };
        if (prop === 'strokeRect')
          return () => {
            strokes.push({ ...cur });
          };
        if (prop === 'measureText') return () => ({ width: 0 });
        if (prop === 'shadowBlur') return cur.shadowBlur;
        if (prop === 'shadowColor') return cur.shadowColor;
        if (prop === 'strokeStyle') return cur.strokeStyle;
        if (prop === 'lineWidth') return cur.lineWidth;
        return () => {};
      },
      set: (_t, prop, value) => {
        if (prop === 'shadowBlur') cur.shadowBlur = value as number;
        else if (prop === 'shadowColor') cur.shadowColor = value as string;
        else if (prop === 'strokeStyle') cur.strokeStyle = value;
        else if (prop === 'lineWidth') cur.lineWidth = value as number;
        return true;
      },
    },
  );
  return { ctx: ctx as unknown as Ctx2D, strokes };
}

describe('hasAnimatedSelection', () => {
  it('is false with nothing selected, true with a selection, false under reduced motion', () => {
    const { ed, id } = edWithNode();
    expect(ed.hasAnimatedSelection()).toBe(false);
    ed.select([id]);
    expect(ed.hasAnimatedSelection()).toBe(true);
    ed.setReducedMotion(true);
    expect(ed.hasAnimatedSelection()).toBe(false);
  });
});

describe('SelectTool — grab-lift + spring-back', () => {
  it('lifts scale above 1 mid-drag, then springs back to 1 and clears presentation after release', () => {
    const { ed, id } = edWithNode(); // rect at (100,100,80,40) -> center (140,120)
    const rec = ed.store.peek(id) as NodeRecord;
    const [origX, origY] = [rec.x, rec.y];

    expect(ed.presentationFor(id)).toBeUndefined();

    // grab: pointer down on the node body, then move past the drag threshold to start translating.
    ed.pointerDown({ x: 140, y: 120 });
    ed.pointerMove({ x: 150, y: 120 });

    // seed the grab tween's clock baseline, then advance halfway through its 120ms duration.
    ed.animClockStep(0);
    ed.animClockStep(60);
    const lifted = ed.presentationFor(id)?.scale;
    expect(lifted).toBeDefined();
    expect(lifted!).toBeGreaterThan(1);
    expect(lifted!).toBeLessThanOrEqual(1.03);

    // release: the spring-back tween starts (from the current lifted scale, back to 1 over 180ms).
    ed.pointerUp({ x: 150, y: 120 });

    // committed position moved exactly by the drag delta — the lift is presentation-only.
    const after = ed.store.peek(id) as NodeRecord;
    expect(after.x).toBeCloseTo(origX + 10, 5);
    expect(after.y).toBeCloseTo(origY, 5);

    // seed the spring-back tween's clock baseline, then advance past its 180ms duration.
    ed.animClockStep(60);
    ed.animClockStep(260);
    expect(ed.presentationFor(id)).toBeUndefined();
  });

  it('cancels the pending spring-back on a re-grab (fresh grab tween wins)', () => {
    const { ed, id } = edWithNode();

    ed.pointerDown({ x: 140, y: 120 });
    ed.pointerMove({ x: 150, y: 120 });
    ed.animClockStep(0);
    ed.animClockStep(120); // grab tween fully settled at LIFT (1.03)
    expect(ed.presentationFor(id)?.scale).toBeCloseTo(1.03, 5);

    ed.pointerUp({ x: 150, y: 120 }); // spring-back tween registered (from 1.03 to 1)
    ed.animClockStep(120); // seed the spring-back tween's baseline

    // re-grab before the spring-back completes: the pending spring is superseded by a new grab tween.
    ed.pointerDown({ x: 150, y: 120 });
    ed.pointerMove({ x: 160, y: 120 });
    ed.animClockStep(120);
    ed.animClockStep(180);
    const midRegrab = ed.presentationFor(id)?.scale;
    expect(midRegrab).toBeDefined();
    expect(midRegrab!).toBeGreaterThan(1);
  });
});

describe('selection halo pulse', () => {
  it('breathes with time when selected and motion is not reduced', () => {
    const { ed, id } = edWithNode();
    ed.select([id]);

    const a = recordingCtx();
    ed.render(a.ctx, 800, 600, 1, true, 0);
    const haloA = a.strokes.find((s) => s.shadowBlur > 0);

    const b = recordingCtx();
    ed.render(b.ctx, 800, 600, 1, true, 250);
    const haloB = b.strokes.find((s) => s.shadowBlur > 0);

    expect(haloA).toBeDefined();
    expect(haloB).toBeDefined();
    expect(haloA!.shadowBlur).not.toBe(haloB!.shadowBlur);
  });

  it('is a static constant across time under reduced motion', () => {
    const { ed, id } = edWithNode();
    ed.select([id]);
    ed.setReducedMotion(true);

    const a = recordingCtx();
    ed.render(a.ctx, 800, 600, 1, true, 0);
    const haloA = a.strokes.find((s) => s.shadowBlur > 0);

    const b = recordingCtx();
    ed.render(b.ctx, 800, 600, 1, true, 250);
    const haloB = b.strokes.find((s) => s.shadowBlur > 0);

    expect(haloA).toBeDefined();
    expect(haloB).toBeDefined();
    expect(haloA!.shadowBlur).toBe(12);
    expect(haloB!.shadowBlur).toBe(12);
  });
});
