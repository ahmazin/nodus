import { describe, expect, it } from 'vitest';
// Import the pure helper + defaults from the JSX-free shared module via a relative path
// (matches the core tests' `../index.js` convention; a bare `@nodus/react` specifier resolving to
// a .tsx source crashes tsc under moduleResolution:Bundler).
import { buildRampCss, DEFAULT_FLOW, DEFAULT_SCALE } from '../flow-shared.js';

describe('buildRampCss', () => {
  it('emits one CSS stop per color at normalized positions (gradient)', () => {
    expect(
      buildRampCss([{ at: 0, color: '#00ff00' }, { at: 50, color: '#ffff00' }, { at: 100, color: '#ff0000' }], [0, 100], true),
    ).toBe('linear-gradient(90deg, #00ff00 0%, #ffff00 50%, #ff0000 100%)');
  });

  it('emits doubled boundaries with 0%/100% bookends (stepped)', () => {
    expect(
      buildRampCss([{ at: 0, color: '#22c55e' }, { at: 50, color: '#f59e0b' }, { at: 80, color: '#ef4444' }], [0, 100], false),
    ).toBe('linear-gradient(90deg, #22c55e 0%, #22c55e 50%, #f59e0b 50%, #f59e0b 80%, #ef4444 80%, #ef4444 100%)');
  });

  it('sorts stops ascending by at before building', () => {
    expect(
      buildRampCss([{ at: 80, color: '#ef4444' }, { at: 0, color: '#22c55e' }, { at: 50, color: '#f59e0b' }], [0, 100], true),
    ).toBe('linear-gradient(90deg, #22c55e 0%, #f59e0b 50%, #ef4444 80%)');
  });

  it('clamps out-of-domain stop positions to [0,100]%', () => {
    expect(
      buildRampCss([{ at: -20, color: '#00ff00' }, { at: 150, color: '#ff0000' }], [0, 100], true),
    ).toBe('linear-gradient(90deg, #00ff00 0%, #ff0000 100%)');
  });

  it('renders a single stop as a solid fill and no stops as transparent', () => {
    expect(buildRampCss([{ at: 40, color: '#2dd4bf' }], [0, 100], true)).toBe('linear-gradient(90deg, #2dd4bf 0%, #2dd4bf 100%)');
    expect(buildRampCss([], [0, 100], true)).toBe('transparent');
  });

  it('guards a zero-width domain', () => {
    expect(buildRampCss([{ at: 5, color: '#111111' }, { at: 5, color: '#222222' }], [5, 5], true)).toBe('linear-gradient(90deg, #111111 0%, #222222 0%)');
  });
});

describe('flow defaults', () => {
  it('DEFAULT_FLOW is dots at speed 70 size 3', () => {
    expect(DEFAULT_FLOW).toEqual({ style: 'dots', speed: 70, size: 3 });
  });
  it('DEFAULT_SCALE spans [0,100] with three threshold stops', () => {
    expect(DEFAULT_SCALE.domain).toEqual([0, 100]);
    expect(DEFAULT_SCALE.colors).toEqual([
      { at: 0, color: '#22c55e' },
      { at: 60, color: '#f59e0b' },
      { at: 85, color: '#ef4444' },
    ]);
  });
});
