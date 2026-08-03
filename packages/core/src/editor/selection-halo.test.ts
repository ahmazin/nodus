import { describe, expect, it } from 'vitest';
import { Editor, defaultTheme, type Ctx2D, type Theme } from '../index.js';

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

  it('keeps the halo shadowBlur a device-space constant (12), unaffected by camera zoom', () => {
    // shadowBlur is DEVICE-space (unaffected by the CTM) — see dirty-region.ts. Every other glow in
    // this codebase uses a raw constant (flow glow: 14, draw-api glows: 14/8), so the halo must too:
    // NOT `px(12)`, which would scale the bloom radius with zoom (balloon when zoomed out, shrink in).
    const ed = new Editor();
    const id = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 60 });
    ed.select([id]);

    const zoomedOut = recordingCtx();
    ed.setCamera({ ...ed.camera, z: 0.5 });
    ed.render(zoomedOut.ctx, 800, 600, 1, true, 0);
    const haloOut = zoomedOut.strokes.find((s) => s.shadowBlur > 0);

    const zoomedIn = recordingCtx();
    ed.setCamera({ ...ed.camera, z: 2 });
    ed.render(zoomedIn.ctx, 800, 600, 1, true, 0);
    const haloIn = zoomedIn.strokes.find((s) => s.shadowBlur > 0);

    expect(haloOut).toBeDefined();
    expect(haloIn).toBeDefined();
    expect(haloOut!.shadowBlur).toBe(12);
    expect(haloIn!.shadowBlur).toBe(12);
  });

  it("colors the halo with the selected node's OWN type color from theme.byType, not the global accent", () => {
    // A theme with a `byType` slice for the built-in 'rect' type whose glow (cyan) differs from the
    // global palette.accent (blue) — mirrors the byType-construction pattern in core.test.ts's "theme
    // token resolution" describe block, and the real `darkInfraTheme` in @nodus-dev/preset-infra
    // (states.accent there deliberately omits stroke/glow so byType wins for infra node colors; see
    // packages/preset-infra/src/theme.ts). Keying byType by 'rect' lets the node use the already-
    // registered built-in `rectNodeUtil` (packages/core/src/builtins/index.ts) — an unregistered type
    // never gets indexed by the scene index (`buildNode` returns null when `this.deps.nodes.get(type)`
    // misses), so the halo would never draw at all. The `accent` state slice below is cast the same
    // way (`as Theme['states'][string]`) to omit `stroke`/`glow`/`text` from `Object.keys`, so
    // `mergeTokens` never lets the state slice clobber the byType color — otherwise this test would
    // pass for the wrong reason (state's own glow, not the node's type color).
    const dbGlow = '#06b6d4'; // cyan — deliberately different from palette.accent below
    const globalAccent = '#3b82f6'; // blue
    const theme: Theme = {
      ...defaultTheme,
      name: 'byType-halo-test',
      palette: { ...defaultTheme.palette, accent: globalAccent },
      states: {
        ...defaultTheme.states,
        accent: { fill: '#12161c', strokeWidth: 1 } as Theme['states'][string],
      },
      byType: { rect: { stroke: dbGlow, text: dbGlow, glow: dbGlow } },
    };

    const ed = new Editor({ theme });
    const id = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 60 });
    ed.select([id]);

    const { ctx, strokes } = recordingCtx();
    ed.render(ctx, 800, 600, 1, true, 0);

    const halo = strokes.find((s) => s.shadowBlur > 0);
    expect(halo).toBeDefined();
    // The halo tracks the node's OWN type color...
    expect(halo!.shadowColor).toBe(dbGlow);
    expect(halo!.strokeStyle).toBe(dbGlow);
    // ...and must NOT fall back to the global accent (this is the discriminating assertion: it
    // passes under both old and new code only if the halo color happens to equal the accent, which
    // it deliberately does not here).
    expect(halo!.shadowColor).not.toBe(globalAccent);

    // The crisp selection stroke drawn on top stays the global accent — selection itself must always
    // read unambiguously, regardless of the selected node's type color.
    const crisp = strokes.find((s) => s.shadowBlur === 0 && s.strokeStyle === globalAccent);
    expect(crisp).toBeDefined();
    expect(crisp!.lineWidth).toBeCloseTo(1.5);
  });
});
