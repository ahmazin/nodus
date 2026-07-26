/**
 * Compact formatting + parsing for a flow-rate metric, so the readout pill drawn at a flowing
 * edge's midpoint stays small and a human can TYPE a rate the way they'd say it ("350 req/s",
 * "1.2k req/s"). Pure — no dependency on `FlowSpec`/`FlowScale`.
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

/** `formatRate` plus a trailing unit label when one is set: `(1200, 'req/s')` -> `'1.2k req/s'`. */
export function formatRateWithUnit(n: number, unit?: string): string {
  const base = formatRate(n);
  if (!base) return '';
  return unit ? `${base} ${unit}` : base;
}

/** A parsed human rate: the numeric value (suffix multipliers applied) and the unit label, if any. */
export interface ParsedRate {
  value: number;
  unit?: string;
}

// Unit labels are free text but bounded and conservative: letters/digits plus the separators real
// units use (req/s, msg·s⁻¹ is out of scope — '/', '%', '.', '-', '_' cover the practical set).
// Anything else (control chars, emoji, quotes) rejects the whole input rather than storing it.
const UNIT_RE = /^[A-Za-z0-9/%._-]{1,24}$/;

/**
 * Parse a human-typed rate: a number with an optional `k`/`K` (×1e3) or `M` (×1e6) suffix and an
 * optional unit label — `'350'`, `'1.2k'`, `'350 req/s'`, `'1.2k req/s'`, `'2M msg/s'`.
 * Returns `null` for anything unparseable (empty, non-numeric, bad unit charset, non-finite), so
 * callers can reject the edit instead of persisting garbage. The suffix binds only when it stands
 * alone (`'1.2k req/s'`), never mid-word (`'1.2kreq/s'` reads as value 1.2, unit `'kreq/s'`).
 */
export function parseRate(input: string): ParsedRate | null {
  const m = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([kKM](?![A-Za-z0-9]))?\s*(.*)$/.exec(input.trim());
  if (!m) return null;
  const mult = m[2] === 'M' ? 1e6 : m[2] ? 1e3 : 1;
  const value = Number(m[1]) * mult;
  if (!Number.isFinite(value)) return null;
  const rawUnit = (m[3] ?? '').trim();
  if (!rawUnit) return { value };
  if (!UNIT_RE.test(rawUnit)) return null;
  return { value, unit: rawUnit };
}
