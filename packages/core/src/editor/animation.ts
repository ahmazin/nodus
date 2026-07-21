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

  /** Advance every active tween to `now`. Under `reducedMotion`, snap all to their final value. */
  step(now: number, reducedMotion: boolean): void {
    for (const tw of this.tweens) {
      if (tw.done) continue;
      if (reducedMotion) {
        tw.onTick(tw.to);
        tw.onDone?.();
        tw.done = true;
        continue;
      }
      if (tw.start == null) tw.start = now + (tw.delayMs ?? 0);
      const elapsed = now - tw.start;
      if (elapsed < 0) {
        tw.onTick(tw.from); // still within delay
        continue;
      }
      const raw = tw.durationMs <= 0 ? 1 : clamp01(elapsed / tw.durationMs);
      const eased = (tw.easing ?? easeOutCubic)(raw);
      tw.onTick(tw.from + (tw.to - tw.from) * eased);
      if (raw >= 1) {
        tw.onDone?.();
        tw.done = true;
      }
    }
    for (const tw of this.tweens) if (tw.done) this.tweens.delete(tw);
  }

  isActive(): boolean {
    for (const tw of this.tweens) if (!tw.done) return true;
    return false;
  }
}
