import { describe, expect, it } from 'vitest';
import { Editor, type Ctx2D } from '../index.js';

/** Tracks just the four ctx properties the selection halo cares about (shadowBlur, shadowColor,
 *  strokeStyle, lineWidth), with a real save/restore stack so nested `ctx.save()/restore()` pairs
 *  (as used by `strokeWorldBox` and the halo block) behave like the real Canvas API. Every other
 *  property/method is a permissive no-op, mirroring the proven `mockCtx` pattern used to drive a
 *  full `render()` in render-perf.test.ts. */
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

describe('selection halo', () => {
  it('draws a glowing accent halo under the crisp accent stroke for a selected node', () => {
    const ed = new Editor();
    const id = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 60 });
    ed.select([id]);

    const { ctx, strokes } = recordingCtx();
    ed.render(ctx, 800, 600, 1, true, 0);

    const accent = '#3b82f6';

    // The halo: a stroke with shadowBlur > 0, in the accent color, per the S1 brief
    // (ctx.shadowColor = accent; ctx.shadowBlur = px(12); strokeWorldBox(ctx, box, accent, px(2))).
    const halo = strokes.find((s) => s.shadowBlur > 0);
    expect(halo).toBeDefined();
    expect(halo!.shadowColor).toBe(accent);
    expect(halo!.strokeStyle).toBe(accent);
    expect(halo!.lineWidth).toBeCloseTo(2);

    // The crisp selection stroke drawn on top: no shadow, thinner (px(1.5) vs the halo's px(2)).
    const crisp = strokes.find((s) => s.shadowBlur === 0 && s.strokeStyle === accent);
    expect(crisp).toBeDefined();
    expect(crisp!.lineWidth).toBeCloseTo(1.5);

    // The halo must be drawn UNDER the crisp stroke — i.e. emitted first.
    expect(strokes.indexOf(halo!)).toBeLessThan(strokes.indexOf(crisp!));
  });
});
