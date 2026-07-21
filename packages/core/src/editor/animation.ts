/**
 * A tiny, dependency-free tween engine — the generic animation substrate the editor uses to sustain
 * rAF the way flow does. It is *time-fed* (never reads `performance.now()`), so it stays headless and
 * deterministic: the host passes the paint timestamp into `step`. Under reduced motion every tween
 * snaps to its final value immediately (correct a11y, no ticking).
 */

export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;
export const easeOutCubic: Easing = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic: Easing = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export interface TweenSpec {
  from: number;
  to: number;
  durationMs: number;
  easing?: Easing;
  delayMs?: number;
  onTick: (value: number) => void;
  onDone?: () => void;
}

interface Tween extends TweenSpec {
  start: number | null; // seeded on first step
  done: boolean;
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

export class AnimationClock {
  private tweens = new Set<Tween>();

  /** Register a tween; returns a cancel fn that removes it without firing `onDone`. */
  add(spec: TweenSpec): () => void {
    const tw: Tween = { ...spec, start: null, done: false };
    this.tweens.add(tw);
    return () => {
      this.tweens.delete(tw);
    };
  }

  /** Invoke `onTick` inside a try/catch — a bad tween's callback must never abort `step()` for the
   *  rest of the frame's tweens (mirrors the renderer's per-item paint isolation). Returns `false` (and
   *  marks the tween done, so the sweep removes it) if the callback threw. */
  private safeTick(tw: Tween, value: number): boolean {
    try {
      tw.onTick(value);
      return true;
    } catch (err) {
      console.error('[nodus] animation callback threw:', err);
      tw.done = true;
      return false;
    }
  }

  /** Invoke `onDone` inside a try/catch, but only if the tween is still registered — a tween whose own
   *  final-frame `onTick` cancels itself (via the `add()` cancel fn) must NOT then fire `onDone`, since
   *  cancel's contract is "remove without firing onDone". */
  private safeDone(tw: Tween): void {
    if (!this.tweens.has(tw)) return; // self-cancelled during onTick
    try {
      tw.onDone?.();
    } catch (err) {
      console.error('[nodus] animation callback threw:', err);
    }
    tw.done = true;
  }

  /** Advance every active tween to `now`. Under `reducedMotion`, snap all to their final value. */
  step(now: number, reducedMotion: boolean): void {
    for (const tw of this.tweens) {
      if (tw.done) continue;
      if (reducedMotion) {
        if (!this.safeTick(tw, tw.to)) continue;
        this.safeDone(tw);
        continue;
      }
      if (tw.start == null) tw.start = now + (tw.delayMs ?? 0);
      const elapsed = now - tw.start;
      if (elapsed < 0) {
        this.safeTick(tw, tw.from); // still within delay
        continue;
      }
      const raw = tw.durationMs <= 0 ? 1 : clamp01(elapsed / tw.durationMs);
      const eased = (tw.easing ?? easeOutCubic)(raw);
      if (!this.safeTick(tw, tw.from + (tw.to - tw.from) * eased)) continue;
      if (raw >= 1) this.safeDone(tw);
    }
    for (const tw of this.tweens) if (tw.done) this.tweens.delete(tw);
  }

  isActive(): boolean {
    for (const tw of this.tweens) if (!tw.done) return true;
    return false;
  }
}
