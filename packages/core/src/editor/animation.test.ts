import { describe, expect, it, vi } from 'vitest';
import { AnimationClock, easeOutCubic, linear } from './animation.js';

describe('AnimationClock', () => {
  it('interpolates linearly between from and to over the duration', () => {
    const clock = new AnimationClock();
    const seen: number[] = [];
    clock.add({ from: 0, to: 100, durationMs: 100, easing: linear, onTick: (v) => seen.push(v) });
    clock.step(1000, false); // seeds start at t=1000 → value 0
    clock.step(1050, false); // half → 50
    clock.step(1100, false); // done → 100
    expect(seen[0]).toBeCloseTo(0);
    expect(seen[1]).toBeCloseTo(50);
    expect(seen[2]).toBeCloseTo(100);
    expect(clock.isActive()).toBe(false);
  });

  it('fires onDone exactly once and goes inactive', () => {
    const clock = new AnimationClock();
    const done = vi.fn();
    clock.add({ from: 0, to: 1, durationMs: 50, onTick: () => {}, onDone: done });
    clock.step(0, false);
    clock.step(50, false);
    clock.step(60, false);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('honors delayMs before starting', () => {
    const clock = new AnimationClock();
    const seen: number[] = [];
    clock.add({ from: 0, to: 10, durationMs: 100, delayMs: 100, easing: linear, onTick: (v) => seen.push(v) });
    clock.step(0, false);   // within delay → value pinned at from
    clock.step(50, false);  // still delayed
    clock.step(150, false); // 50ms into the tween → 5
    expect(seen[0]).toBeCloseTo(0);
    expect(seen[1]).toBeCloseTo(0);
    expect(seen[2]).toBeCloseTo(5);
  });

  it('snaps to final value immediately under reduced motion', () => {
    const clock = new AnimationClock();
    const seen: number[] = [];
    const done = vi.fn();
    clock.add({ from: 0, to: 100, durationMs: 1000, onTick: (v) => seen.push(v), onDone: done });
    clock.step(0, true);
    expect(seen).toEqual([100]);
    expect(done).toHaveBeenCalledTimes(1);
    expect(clock.isActive()).toBe(false);
  });

  it('cancel() stops ticks and deactivates', () => {
    const clock = new AnimationClock();
    const onTick = vi.fn();
    const cancel = clock.add({ from: 0, to: 1, durationMs: 100, onTick });
    clock.step(0, false);
    cancel();
    clock.step(50, false);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(clock.isActive()).toBe(false);
  });

  it('easeOutCubic starts fast and decelerates (monotonic, 0→1)', () => {
    expect(easeOutCubic(0)).toBeCloseTo(0);
    expect(easeOutCubic(1)).toBeCloseTo(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5); // decelerating → past halfway at t=0.5
  });

  it('isolates a throwing onTick — a second, well-behaved tween in the same step() still ticks', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const clock = new AnimationClock();
    clock.add({
      from: 0, to: 1, durationMs: 10, easing: linear,
      onTick: () => { throw new Error('boom'); },
    });
    const seen: number[] = [];
    clock.add({ from: 0, to: 1, durationMs: 10, easing: linear, onTick: (v) => seen.push(v) });

    clock.step(0, false);
    clock.step(20, false); // both tweens reach/exceed their duration

    expect(seen.length).toBeGreaterThan(0); // the good tween kept ticking despite the bad one
    expect(seen[seen.length - 1]).toBeCloseTo(1);
    expect(clock.isActive()).toBe(false); // the throwing tween was swept, not left dangling
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('a tween that cancels itself inside its final-frame onTick does not fire onDone', () => {
    const clock = new AnimationClock();
    const done = vi.fn();
    let cancel: () => void = () => {};
    cancel = clock.add({
      from: 0, to: 1, durationMs: 10, easing: linear,
      onTick: (v) => { if (v >= 1) cancel(); },
      onDone: done,
    });
    clock.step(0, false);
    clock.step(10, false); // final frame: onTick self-cancels before onDone would fire
    expect(done).not.toHaveBeenCalled();
    expect(clock.isActive()).toBe(false);
  });
});
