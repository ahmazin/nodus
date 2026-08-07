/**
 * Pure multi-touch gesture math (Blocker #6 — touch input). Runs under vitest's node environment (no
 * jsdom): these helpers are the DOM-free core the `<Nodus>` host maps onto the camera for pinch-zoom
 * and two-finger pan. Before `touch.ts` existed this math was nowhere, so the whole file is red on the
 * pre-change tree.
 */
import { describe, expect, it } from 'vitest';
import { centroid, pinchDelta, pinchSample, spread, TOUCH_HIT_TOL } from './touch.js';

describe('centroid', () => {
  it('averages the first two points', () => {
    expect(centroid([{ x: 0, y: 0 }, { x: 10, y: 20 }])).toEqual({ x: 5, y: 10 });
  });
  it('falls back to the sole point, then the origin', () => {
    expect(centroid([{ x: 7, y: 3 }])).toEqual({ x: 7, y: 3 });
    expect(centroid([])).toEqual({ x: 0, y: 0 });
  });
  it('ignores a third finger', () => {
    expect(centroid([{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 100, y: 100 }])).toEqual({ x: 2, y: 2 });
  });
});

describe('spread', () => {
  it('is the Euclidean distance between two fingers', () => {
    expect(spread({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('pinchDelta', () => {
  it('a symmetric spread from 100→200px about a fixed midpoint zooms 2× with no pan', () => {
    const prev = pinchSample([{ x: -50, y: 0 }, { x: 50, y: 0 }]); // dist 100, mid (0,0)
    const next = pinchSample([{ x: -100, y: 0 }, { x: 100, y: 0 }]); // dist 200, mid (0,0)
    const d = pinchDelta(prev, next);
    expect(d.factor).toBeCloseTo(2, 6);
    expect(d.panDx).toBe(0);
    expect(d.panDy).toBe(0);
  });
  it('a rigid two-finger slide pans without zooming (factor 1)', () => {
    const prev = pinchSample([{ x: 0, y: 0 }, { x: 100, y: 0 }]); // dist 100, mid (50,0)
    const next = pinchSample([{ x: 30, y: 15 }, { x: 130, y: 15 }]); // dist 100, mid (80,15)
    const d = pinchDelta(prev, next);
    expect(d.factor).toBeCloseTo(1, 6);
    expect(d.panDx).toBeCloseTo(30, 6);
    expect(d.panDy).toBeCloseTo(15, 6);
  });
  it('guards a zero/near-zero finger distance to factor 1 (no divide-by-zero blow-up)', () => {
    const prev = pinchSample([{ x: 5, y: 5 }, { x: 5, y: 5 }]); // dist 0
    const next = pinchSample([{ x: 5, y: 5 }, { x: 25, y: 5 }]); // dist 20
    expect(pinchDelta(prev, next).factor).toBe(1);
  });
});

describe('TOUCH_HIT_TOL', () => {
  it('is fatter than the 5px mouse radius', () => {
    expect(TOUCH_HIT_TOL).toBeGreaterThan(5);
  });
});
