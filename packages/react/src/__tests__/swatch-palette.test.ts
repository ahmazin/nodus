import { describe, expect, it } from 'vitest';
// The content swatch palette is mode-aware: the dark presets (esp. the trailing neutral #e9e9ee, which
// IS the dark UI text colour) read as near-white on the light canvas (#f7f7f3) and are unusable there.
// `swatchColors(mode)` mirrors flow-shared's flowAccent(mode) — a pure, exported mode dispatch we can
// assert directly. No jsdom needed; the DOM wiring is covered by the browser E2E drive.
import { swatchColors } from '../properties.js';

const DARK = ['#e5675e', '#f0a53e', '#4ac26b', '#c4f24e', '#35d0e0', '#7aa2ff', '#c99bff', '#e9e9ee'];
const LIGHT = ['#c0362c', '#b45309', '#15803d', '#3f6212', '#0e7490', '#1d4ed8', '#7c3aed', '#334155'];

/** The light canvas surface these swatches sit on. */
const LIGHT_CANVAS = '#f7f7f3';

/** WCAG relative luminance of a #rrggbb colour. */
function relLum(hex: string): number {
  const n = hex.replace('#', '');
  const chans = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = chans.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

/** WCAG contrast ratio between two colours (>= 4.5:1 is AA for normal text/UI). */
function contrast(a: string, b: string): number {
  const la = relLum(a);
  const lb = relLum(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

describe('swatchColors (mode-aware content palette)', () => {
  it('returns the dark palette for dark mode', () => {
    expect(swatchColors('dark')).toEqual(DARK);
  });

  it('returns the darkened light palette for light mode', () => {
    expect(swatchColors('light')).toEqual(LIGHT);
  });

  it('the two palettes differ (light is not a passthrough of dark)', () => {
    expect(swatchColors('light')).not.toEqual(swatchColors('dark'));
  });

  it("light palette's last entry is a visible dark neutral, not near-white", () => {
    const lightLast = swatchColors('light').at(-1)!;
    // The dark trailing neutral (#e9e9ee) is invisible on the light canvas — this is the bug the light
    // palette fixes; assert it fails AA so the regression is anchored to a real contrast failure.
    expect(contrast(swatchColors('dark').at(-1)!, LIGHT_CANVAS)).toBeLessThan(4.5);
    // The light replacement must be usable (>= 4.5:1) on that same surface.
    expect(contrast(lightLast, LIGHT_CANVAS)).toBeGreaterThanOrEqual(4.5);
  });

  it('every light swatch clears AA contrast on the light canvas', () => {
    for (const c of swatchColors('light')) {
      expect(contrast(c, LIGHT_CANVAS)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
