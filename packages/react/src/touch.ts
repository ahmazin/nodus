/**
 * Pure multi-touch gesture math for the `<Nodus>` host. Kept dependency- and DOM-free so it unit-tests
 * under vitest's node environment (no jsdom). The host (`nodus-host.tsx`) tracks live pointers by
 * `pointerId`, feeds the first two into these helpers, and maps the result onto the camera API
 * (`panByScreen` + `zoomBy`). One-finger gestures never reach here — they stay tool gestures (marquee /
 * drag) so touch matches the mouse; two fingers pinch-zoom and pan.
 */

/** A pointer position in canvas-local screen pixels. */
export interface TouchPoint {
  x: number;
  y: number;
}

/** A two-finger sample: the distance between the fingers and their midpoint. */
export interface PinchSample {
  dist: number;
  mid: TouchPoint;
}

/** Hit-test tolerance (screen px) for touch input — fatter than the 5px mouse radius so a fingertip
 *  lands on thin edges / small nodes. The host passes this as `PointerMods.tolerance` for touch. */
export const TOUCH_HIT_TOL = 12;

/** Midpoint of the first two points (the pinch/pan anchor). Falls back to the sole point, or origin. */
export function centroid(pts: readonly TouchPoint[]): TouchPoint {
  const a = pts[0];
  const b = pts[1];
  if (!a) return { x: 0, y: 0 };
  if (!b) return { x: a.x, y: a.y };
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Euclidean distance between two points. */
export function spread(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Build a {@link PinchSample} from the first two live pointers. */
export function pinchSample(pts: readonly TouchPoint[]): PinchSample {
  const a = pts[0] ?? { x: 0, y: 0 };
  const b = pts[1] ?? a;
  return { dist: spread(a, b), mid: centroid(pts) };
}

/**
 * The camera delta between two pinch samples: `factor` is the multiplicative zoom (next/prev finger
 * distance, guarded to 1 when either distance is ~0), and `panDx`/`panDy` is the midpoint translation
 * in screen px. A pure spread with a fixed midpoint yields `factor≠1, pan≈0`; a rigid two-finger slide
 * yields `factor≈1, pan≠0`.
 */
export function pinchDelta(prev: PinchSample, next: PinchSample): { factor: number; panDx: number; panDy: number } {
  const factor = prev.dist > 0.01 && next.dist > 0.01 ? next.dist / prev.dist : 1;
  return { factor, panDx: next.mid.x - prev.mid.x, panDy: next.mid.y - prev.mid.y };
}
