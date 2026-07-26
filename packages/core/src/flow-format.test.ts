import { describe, expect, it } from 'vitest';
import { formatRate, formatRateWithUnit, parseRate } from './flow-format.js';

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

describe('formatRateWithUnit', () => {
  it('appends the unit after the compact value', () => {
    expect(formatRateWithUnit(1200, 'req/s')).toBe('1.2k req/s');
    expect(formatRateWithUnit(42, 'msg/s')).toBe('42 msg/s');
    expect(formatRateWithUnit(42)).toBe('42');
  });
  it('stays empty for non-finite even with a unit', () => {
    expect(formatRateWithUnit(NaN, 'req/s')).toBe('');
  });
});

describe('parseRate', () => {
  it('parses bare numbers', () => {
    expect(parseRate('350')).toEqual({ value: 350 });
    expect(parseRate('  0.5 ')).toEqual({ value: 0.5 });
    expect(parseRate('.5')).toEqual({ value: 0.5 });
    expect(parseRate('-12')).toEqual({ value: -12 });
  });
  it('applies k/M suffix multipliers', () => {
    expect(parseRate('1.2k')).toEqual({ value: 1200 });
    expect(parseRate('1.2K')).toEqual({ value: 1200 });
    expect(parseRate('2M')).toEqual({ value: 2_000_000 });
  });
  it('extracts the unit label, with or without a space', () => {
    expect(parseRate('350 req/s')).toEqual({ value: 350, unit: 'req/s' });
    expect(parseRate('1.2k req/s')).toEqual({ value: 1200, unit: 'req/s' });
    expect(parseRate('350req/s')).toEqual({ value: 350, unit: 'req/s' });
    expect(parseRate('2M msg/s')).toEqual({ value: 2_000_000, unit: 'msg/s' });
    expect(parseRate('99 %')).toEqual({ value: 99, unit: '%' });
  });
  it('a suffix letter glued to more letters reads as a unit, not a multiplier', () => {
    expect(parseRate('1.2kreq/s')).toEqual({ value: 1.2, unit: 'kreq/s' });
    expect(parseRate('3 kB/s')).toEqual({ value: 3, unit: 'kB/s' });
  });
  it('rejects garbage instead of persisting it', () => {
    expect(parseRate('')).toBeNull();
    expect(parseRate('req/s')).toBeNull();
    expect(parseRate('12 re"q')).toBeNull();
    expect(parseRate('12 ' + 'x'.repeat(40))).toBeNull();
    expect(parseRate('1e999')).toBeNull();
  });
});
