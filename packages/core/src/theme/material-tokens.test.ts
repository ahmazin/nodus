import { describe, expect, it } from 'vitest';
import { resolveTokens, type Theme } from './index.js';

function themeWith(slice: Partial<Theme['states']['solid']>): Theme {
  // minimal theme; reuse defaults where possible
  const base = {
    palette: { accent: '#10b981' },
    typography: { fontFamily: 'sans', size: 12, lineHeight: 1.3 },
    radii: { node: 6 },
    canvas: { fill: '#000', grid: { color: '#111', size: 24 } },
    states: { solid: { fill: '#123456', stroke: '#abcdef', strokeWidth: 1.5, text: '#fff', ...slice } },
    overlays: {},
    focus: {},
  } as unknown as Theme;
  return base;
}

describe('material tokens', () => {
  it('resolveTokens carries glass/shadow/strokeGradient through', () => {
    const t = resolveTokens(
      themeWith({ glass: 0.16, shadow: { color: '#0006', blur: 16, dy: 4 } }),
      { state: 'solid' },
    );
    expect(t.glass).toBe(0.16);
    expect(t.shadow).toEqual({ color: '#0006', blur: 16, dy: 4 });
  });
  it('defaults material fields to undefined when unset', () => {
    const t = resolveTokens(themeWith({}), { state: 'solid' });
    expect(t.glass).toBeUndefined();
    expect(t.shadow).toBeUndefined();
    expect(t.strokeGradient).toBeUndefined();
  });
});
