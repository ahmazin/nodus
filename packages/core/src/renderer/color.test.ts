import { describe, expect, it } from 'vitest';
import { parseHex, toHex, mix, shade } from './color.js';

describe('color helpers', () => {
  it('parses and re-emits hex', () => {
    expect(parseHex('#10b981')).toEqual([16, 185, 129]);
    expect(parseHex('nope')).toBeNull();
    expect(toHex([16, 185, 129])).toBe('#10b981');
  });
  it('mix interpolates endpoints', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
  it('shade lightens toward white and darkens toward black', () => {
    expect(shade('#808080', 0)).toBe('#808080');
    expect(shade('#808080', 1)).toBe('#ffffff');   // full lighten
    expect(shade('#808080', -1)).toBe('#000000');  // full darken
    // +14% lighten of mid-grey is brighter than the input, darken is dimmer
    expect(parseHex(shade('#808080', 0.14))![0]).toBeGreaterThan(128);
    expect(parseHex(shade('#808080', -0.14))![0]).toBeLessThan(128);
  });
  it('returns non-hex input unchanged', () => {
    expect(shade('rgba(0,0,0,0.5)', 0.2)).toBe('rgba(0,0,0,0.5)');
  });
});
