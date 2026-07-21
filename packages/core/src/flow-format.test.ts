import { describe, expect, it } from 'vitest';
import { formatRate } from './flow-format.js';

describe('formatRate', () => {
  it('formats compactly', () => {
    expect(formatRate(42)).toBe('42');
    expect(formatRate(1200)).toBe('1.2k');
    expect(formatRate(1000)).toBe('1k');
    expect(formatRate(2_500_000)).toBe('2.5M');
    expect(formatRate(0)).toBe('0');
    expect(formatRate(-350)).toBe('-350');
  });
  it('handles non-finite', () => {
    expect(formatRate(NaN)).toBe('');
    expect(formatRate(Infinity)).toBe('');
  });
});
