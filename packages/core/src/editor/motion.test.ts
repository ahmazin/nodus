import { describe, expect, it } from 'vitest';
import { Editor, type Ctx2D } from '../index.js';

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
