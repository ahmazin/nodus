/**
 * `colorForValue` must never emit an invalid CSS color for a non-finite metric. `resolveFlow` guards
 * finiteness before it ever calls `colorForValue`, so this only bites *direct external callers* — but
 * for them a NaN metric on a `gradient` scale used to interpolate straight into `#NaNNaNNaN` (an invalid
 * color): NaN compares false against every stop, slips past the endpoint clamps, and poisons the lerp.
 * Regression: a non-finite input yields a valid hex drawn from the scale's own stops.
 */
import { describe, expect, it } from 'vitest';
import { colorForValue } from './flow.js';
import type { FlowScale } from './model.js';

const HEX = /^#[0-9a-f]{6}$/i;

describe('colorForValue — non-finite metric guard', () => {
  const gradientScale: FlowScale = {
    domain: [0, 100],
    colors: [
      { at: 0, color: '#00ff00' },
      { at: 100, color: '#ff0000' },
    ],
    gradient: true,
  };

  it('returns a valid hex (never #NaNNaNNaN) for NaN on a gradient scale', () => {
    const c = colorForValue(gradientScale, NaN);
    expect(c).not.toBe('#NaNNaNNaN');
    expect(c).toMatch(HEX);
  });

  it('returns a valid hex for ±Infinity on a gradient scale', () => {
    expect(colorForValue(gradientScale, Infinity)).toMatch(HEX);
    expect(colorForValue(gradientScale, -Infinity)).toMatch(HEX);
  });

  it('leaves finite resolution unchanged (endpoints + blended midpoint)', () => {
    expect(colorForValue(gradientScale, 0)).toBe('#00ff00');
    expect(colorForValue(gradientScale, 100)).toBe('#ff0000');
    expect(colorForValue(gradientScale, 50)).toMatch(HEX);
  });
});
