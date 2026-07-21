import { describe, expect, it } from 'vitest';
import { formatCoords } from './status-bar.js';

describe('formatCoords', () => {
  it('rounds to integers with a separator', () => {
    expect(formatCoords({ x: 12.4, y: -7.8 })).toBe('12, -8');
  });
  it('shows a dash when null', () => {
    expect(formatCoords(null)).toBe('—');
  });
});
