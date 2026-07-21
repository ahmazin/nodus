/** Tiny dependency-free color helpers for material derivation (glass gradients, edge blends). Pure. */

const clamp255 = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));

export function parseHex(c: string): [number, number, number] | null {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(c.trim());
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : null;
}

export function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((n) => clamp255(n).toString(16).padStart(2, '0')).join('')}`;
}

/** Linear blend a→b in RGB; `t` clamped to [0,1]. Non-hex inputs return `a` unchanged. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return toHex([ca[0] + (cb[0] - ca[0]) * u, ca[1] + (cb[1] - ca[1]) * u, ca[2] + (cb[2] - ca[2]) * u]);
}

/** `amt>0` lightens toward white, `amt<0` darkens toward black, by `|amt|` fraction. Non-hex → unchanged. */
export function shade(hex: string, amt: number): string {
  if (!parseHex(hex)) return hex;
  return amt >= 0 ? mix(hex, '#ffffff', amt) : mix(hex, '#000000', -amt);
}
