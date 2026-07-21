/**
 * Compact formatting for a live flow-rate metric, so the readout pill drawn at a flowing edge's
 * midpoint stays small (no units/locale — callers own that). Pure, no dependency on `FlowSpec`/
 * `FlowScale` (which carry no unit/format field of their own).
 */

/** Strip a trailing `.0` from a fixed-point string, e.g. `'3.0'` -> `'3'`, `'1.2'` unchanged. */
function trimTrailingZero(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/**
 * Compact numeric formatting: `>= 1e6` -> `'2.5M'`/`'3M'`, `>= 1e3` -> `'1.2k'`/`'1k'`, else the
 * rounded integer as a string. Negatives keep their sign; non-finite (`NaN`/`Infinity`) -> `''`
 * (the caller skips drawing the pill entirely rather than showing garbage text).
 */
export function formatRate(n: number): string {
  if (!Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${sign}${trimTrailingZero((abs / 1e6).toFixed(1))}M`;
  if (abs >= 1e3) return `${sign}${trimTrailingZero((abs / 1e3).toFixed(1))}k`;
  return `${sign}${Math.round(abs)}`;
}
