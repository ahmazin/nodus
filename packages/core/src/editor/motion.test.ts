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

  it('cancels the pending spring-back on a re-grab (no stale spring corrupts the still-held drag)', () => {
    // Regression test for: releaseLift() used to discard the spring-back's cancel fn, so a re-grab's
    // `this.liftCancels.get(id)?.()` could never find (and cancel) a still-running spring-back — only
    // settled grab tweens. The stale spring kept ticking on its own schedule and, once it reached its
    // own onDone, called clearPresentation() out from under the new grab — even though the drag was
    // still held (no pointerUp yet). This test re-grabs mid-spring, lets the NEW grab tween fully
    // settle (and get swept off the animation clock) *before* the OLD spring's own completion time,
    // in a separate `animClockStep` call — the only arrangement that actually surfaces the bug: if the
    // new grab tween were still ticking in the same step() call as the stale spring's onDone, its
    // onTick (which always calls setPresentation) would immediately paper over the clear within that
    // same synchronous call, masking the corruption. Hence re-grabbing at 30ms into the 180ms spring
    // (not e.g. 90ms/half) — the new 120ms grab tween needs to finish strictly before the spring's
    // fixed completion at now=300 (120 start + 180 duration).
    const { ed, id } = edWithNode();

    ed.pointerDown({ x: 140, y: 120 });
    ed.pointerMove({ x: 150, y: 120 });
    ed.animClockStep(0);
    ed.animClockStep(120); // grab tween fully settled at LIFT (1.03)
    expect(ed.presentationFor(id)?.scale).toBeCloseTo(1.03, 5);

    ed.pointerUp({ x: 150, y: 120 }); // spring-back tween registered (from 1.03 to 1, dur 180, start=120)
    ed.animClockStep(120); // seed the spring-back tween's baseline

    // advance the clock partway into the spring — clearly mid-decay (between 1 and LIFT), not yet settled.
    ed.animClockStep(150);
    const midDecay = ed.presentationFor(id)?.scale;
    expect(midDecay).toBeDefined();
    expect(midDecay!).toBeGreaterThan(1);
    expect(midDecay!).toBeLessThan(1.03);

    // re-grab before the spring-back completes: the pending spring should be cancelled outright, not
    // merely "raced" by a fresh grab tween.
    ed.pointerDown({ x: 150, y: 120 });
    ed.pointerMove({ x: 160, y: 120 });
    ed.animClockStep(150); // seed the new grab tween's baseline (same "now" as the re-grab)
    ed.animClockStep(270); // new grab tween settles at LIFT and is swept off the clock — 120ms later

    // the drag is STILL HELD (no pointerUp) when the stale spring's own schedule would complete
    // (120 + 180 = 300). With the spring properly cancelled at re-grab, this is a no-op. With the bug
    // (discarded cancel), the stale spring fires onDone here — with nothing left to override it — and
    // wipes the presentation entirely.
    ed.animClockStep(300);
    const stillHeld = ed.presentationFor(id);
    expect(stillHeld).toBeDefined();
    expect(stillHeld!.scale).toBeGreaterThan(1.02); // did NOT crater back to ~1 mid-drag
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

describe('startPanMomentum', () => {
  it('glides the camera by the total fling distance (vx*DECAY_MS) then stops', () => {
    const { ed } = edWithNode();
    const before = ed.camera;

    ed.startPanMomentum(1, 0); // 1 px/ms rightward fling
    ed.animClockStep(0); // seed the tween's clock baseline
    ed.animClockStep(320); // fully elapsed (DECAY_MS)

    const after = ed.camera;
    // panByScreen(dx, dy) shifts camera by (-dx/z, -dy/z); summed over the whole decay the residual
    // deltas telescope to exactly D = v * DECAY_MS screen px of total fling.
    expect(after.x - before.x).toBeCloseTo(-320, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('sums residual per-tick deltas (Dx*(p-last)) to exactly D across INTERMEDIATE ticks', () => {
    // Regression test for a plausible drift bug: swapping the residual `Dx*(p-last)` formula for the
    // absolute `Dx*p` would still pass a test that only samples progress 0 and 1 (both endpoints give
    // the same total either way — the bug only shows up once you sum more than one non-trivial tick).
    // Stepping through several intermediate progress points forces the sum to actually telescope.
    const { ed } = edWithNode();
    const before = ed.camera;

    ed.startPanMomentum(1, 0); // 1 px/ms rightward fling; D = 1 * 320 = 320 screen px
    ed.animClockStep(0); // seed the tween's clock baseline (start = 0)
    ed.animClockStep(107); // p1 = easeOutCubic(107/320)
    ed.animClockStep(213); // p2 = easeOutCubic(213/320)
    ed.animClockStep(320); // p3 = 1 (fully elapsed)

    const after = ed.camera;
    // Under the correct residual formula, sum_i Dx*(p_i - p_{i-1}) telescopes to Dx*(1-0) = Dx = 320
    // regardless of how many intermediate steps land in between. Under the buggy absolute-delta
    // formula (`Dx*p` per tick, i.e. NOT subtracting the previous progress), the same four ticks would
    // instead sum to Dx*(p1 + p2 + p3) ≈ 320 * (p1 + p2 + 1), which overshoots to roughly ~550-600+
    // screen px — comfortably outside this tolerance.
    expect(after.x - before.x).toBeCloseTo(-320, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('decelerates — the midpoint has covered some but not all of the fling distance', () => {
    const { ed } = edWithNode();
    const before = ed.camera;

    ed.startPanMomentum(1, 0);
    ed.animClockStep(0);
    ed.animClockStep(160); // halfway through DECAY_MS

    const mid = ed.camera;
    expect(mid.x).toBeLessThan(before.x); // already moving
    expect(mid.x).toBeGreaterThan(before.x - 320); // not yet at the full fling distance
  });

  it('under reduced motion, leaves the camera unchanged (no momentum, no teleport-by-D snap)', () => {
    const { ed } = edWithNode();
    ed.setReducedMotion(true);
    const before = ed.camera;

    ed.startPanMomentum(1, 0);
    ed.animClockStep(0);
    ed.animClockStep(320);

    expect(ed.camera).toEqual(before);
  });

  it('no-ops when the release velocity is below MIN_V', () => {
    const { ed } = edWithNode();
    const before = ed.camera;

    ed.startPanMomentum(0.01, 0.01); // hypot ≈ 0.014 < MIN_V (0.05)
    ed.animClockStep(0);
    ed.animClockStep(320);

    expect(ed.camera).toEqual(before);
  });

  it('cancelPanMomentum stops a still-gliding tween outright — no further residual deltas after it', () => {
    const { ed } = edWithNode();
    const before = ed.camera;

    ed.startPanMomentum(1, 0);
    ed.animClockStep(0);
    ed.animClockStep(160); // halfway through the glide — still moving
    const mid = ed.camera;
    expect(mid.x).toBeLessThan(before.x);
    expect(mid.x).toBeGreaterThan(before.x - 320);

    ed.cancelPanMomentum();
    ed.animClockStep(320); // would have been the glide's natural completion tick

    // Camera stayed exactly where the cancel caught it — the tween never resumes ticking.
    expect(ed.camera).toEqual(mid);
  });

  it('a new fling cancels a still-gliding one instead of stacking residual deltas on top of it', () => {
    // Regression test for: startPanMomentum used to discard the previous tween's cancel fn, so two
    // quick flings (or a fling followed by a fresh drag) would run BOTH tweens concurrently — the
    // stale one's leftover "tail" (its remaining not-yet-applied residual, still ticking toward its
    // own D) kept landing on top of the new gesture's glide, so the camera outran the cursor.
    const { ed } = edWithNode();

    ed.startPanMomentum(1, 0); // first fling: D = 320
    ed.animClockStep(0);
    ed.animClockStep(160); // halfway through the first glide — leaves a real leftover tail

    ed.startPanMomentum(1, 0); // second fling starts fresh — must cancel the first outright
    const atRestart = ed.camera; // snapshot right when the second glide takes over

    ed.animClockStep(160); // seed the second tween's baseline (same "now" as the restart)
    ed.animClockStep(480); // fully elapsed for the second tween alone (160 + 320)

    const after = ed.camera;
    // Isolate what happened AFTER the restart: with the first tween properly cancelled, only the
    // second tween's own deltas can land here, telescoping to exactly its D = 320. If the first
    // tween's cancel fn were discarded (the bug), its leftover tail (~172 screen px, the remainder of
    // its own D=320 after the 160ms partial tick) would ALSO fire within this same window, overshooting
    // to roughly -492 instead of -320 — comfortably outside this tolerance.
    expect(after.x - atRestart.x).toBeCloseTo(-320, 5);
  });
});

describe('animateEntrance', () => {
  it('starts a node at alpha 0/scale 0.92 and fades/clears after ~260ms', () => {
    const { ed, id } = edWithNode();

    ed.animateEntrance([id]);
    expect(ed.presentationFor(id)?.alpha).toBe(0);
    expect(ed.presentationFor(id)?.scale).toBeCloseTo(0.92, 5);

    ed.animClockStep(0); // seed the tween's clock baseline
    ed.animClockStep(260); // fully elapsed (durationMs)
    expect(ed.presentationFor(id)).toBeUndefined();
  });

  it('staggers a second id — just after start it is still held at alpha 0 (delayMs not yet elapsed)', () => {
    const { ed, id } = edWithNode();
    const id2 = ed.createNode({ type: 'rect', x: 300, y: 100, w: 80, h: 40 });

    ed.animateEntrance([id, id2], { stagger: 100 });
    ed.animClockStep(0); // seed both tweens' clock baseline (delayMs applies from here)

    ed.animClockStep(30); // well within id2's 100ms delay, but past id's start
    expect(ed.presentationFor(id)?.alpha).toBeGreaterThan(0); // first id has started easing in
    expect(ed.presentationFor(id2)?.alpha).toBe(0); // second id still held at its pre-delay value
  });

  it('under reduced motion, snaps to fully in (and clears) on the first step', () => {
    const { ed, id } = edWithNode();
    ed.setReducedMotion(true);

    ed.animateEntrance([id]);
    expect(ed.presentationFor(id)?.alpha).toBe(0); // set synchronously before any tick runs

    ed.animClockStep(0); // reduced-motion step snaps every tween straight to onDone
    expect(ed.presentationFor(id)).toBeUndefined();
  });
});
