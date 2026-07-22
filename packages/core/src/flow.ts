/**
 * Data-driven flow: map a scalar metric to concrete flow visuals via a `FlowScale`. Pure functions —
 * the editor calls `resolveFlow` at paint time, combining an edge's static `FlowSpec` with its live
 * (ephemeral) metric, so a dashboard can tick continuously without ever touching the document.
 */
import type { FlowScale, FlowSpec } from './model.js';

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Normalize a metric to [0,1] across the scale's domain. */
function normalize(scale: FlowScale, value: number): number {
  const [lo, hi] = scale.domain;
  return hi === lo ? 0 : clamp01((value - lo) / (hi - lo));
}

function parseHex(c: string): [number, number, number] | null {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(c.trim());
  return m ? [Number.parseInt(m[1]!, 16), Number.parseInt(m[2]!, 16), Number.parseInt(m[3]!, 16)] : null;
}
const toHex = (rgb: [number, number, number]): string => `#${rgb.map((n) => Math.round(clamp01(n / 255) * 255).toString(16).padStart(2, '0')).join('')}`;

/** Color for `value` from the ordered stops — stepped (last stop ≤ value) unless `gradient` blends. */
export function colorForValue(scale: FlowScale, value: number): string | undefined {
  const stops = scale.colors;
  if (!stops || stops.length === 0) return undefined;
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  // A NaN metric compares false against every stop, so it slips past the endpoint clamps below and
  // poisons the gradient interpolation into an invalid `#NaNNaNNaN`. Fall back to the low stop.
  // (±Infinity is fine — the `<=`/`>=` endpoint clamps handle it.)
  if (Number.isNaN(value)) return sorted[0]!.color;
  if (value <= sorted[0]!.at) return sorted[0]!.color;
  if (value >= sorted[sorted.length - 1]!.at) return sorted[sorted.length - 1]!.color;
  // find the bracketing pair
  let i = 0;
  while (i < sorted.length - 1 && value >= sorted[i + 1]!.at) i++;
  const lo = sorted[i]!;
  const hi = sorted[i + 1]!;
  if (!scale.gradient) return lo.color; // stepped threshold band
  const a = parseHex(lo.color);
  const b = parseHex(hi.color);
  if (!a || !b) return lo.color;
  const t = hi.at === lo.at ? 0 : clamp01((value - lo.at) / (hi.at - lo.at));
  return toHex([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
}

/**
 * Combine an edge's static flow spec with a live/static metric. Returns the base spec unchanged when
 * there's no scale or no value; otherwise overrides speed/count/size/color from the scale.
 */
export function resolveFlow(flow: FlowSpec, metric?: number): FlowSpec {
  const value = metric ?? flow.data;
  if (!flow.scale || value == null || !Number.isFinite(value)) return flow;
  const s = flow.scale;
  const t = normalize(s, value);
  const out: FlowSpec = { ...flow };
  if (s.speed) out.speed = lerp(s.speed[0], s.speed[1], t);
  if (s.count) out.count = Math.max(1, Math.round(lerp(s.count[0], s.count[1], t)));
  if (s.size) out.size = lerp(s.size[0], s.size[1], t);
  const color = colorForValue(s, value);
  if (color) out.color = color;
  return out;
}
