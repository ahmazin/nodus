/** Shared flow-authoring tokens, defaults, and the injected keyframe stylesheet. Kept in its own
 *  module so `flow-controls` and `flow-scale-editor` can both depend on it without a cycle. */
import type { CSSProperties } from 'react';
import type { FlowColorStop, FlowScale, FlowSpec } from '@nodus/core';

/** Pure: build a CSS `background` string for the ramp. gradient=true → one stop per color;
 *  gradient=false → stepped bands (doubled boundaries) matching colorForValue's floor rule. */
export function buildRampCss(stops: FlowColorStop[], domain: [number, number], gradient = false): string {
  const [min, max] = domain;
  const span = max - min;
  const pct = (at: number): number => {
    const p = span === 0 ? 0 : (at - min) / span;
    const c = p < 0 ? 0 : p > 1 ? 1 : p;
    return +(c * 100).toFixed(2);
  };
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  if (sorted.length === 0) return 'transparent';
  if (sorted.length === 1) return `linear-gradient(90deg, ${sorted[0]!.color} 0%, ${sorted[0]!.color} 100%)`;
  if (gradient) {
    return `linear-gradient(90deg, ${sorted.map((s) => `${s.color} ${pct(s.at)}%`).join(', ')})`;
  }
  const parts: string[] = [`${sorted[0]!.color} 0%`];
  for (let i = 1; i < sorted.length; i++) {
    const p = pct(sorted[i]!.at);
    parts.push(`${sorted[i - 1]!.color} ${p}%`);
    parts.push(`${sorted[i]!.color} ${p}%`);
  }
  parts.push(`${sorted[sorted.length - 1]!.color} 100%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

// ---- flow-authoring defaults (shared with context-menu.tsx) ----
export const DEFAULT_FLOW: FlowSpec = { style: 'dots', speed: 70, size: 3 };
export const DEFAULT_SCALE: FlowScale = {
  domain: [0, 100],
  colors: [
    { at: 0, color: '#22c55e' },
    { at: 60, color: '#f59e0b' },
    { at: 85, color: '#ef4444' },
  ],
};

// ---- palette (inherit the panel; add ONE flow accent) ----
export const BG = '#0d1310';
export const FIELD_BG = '#12161c';
export const BORDER = '#28322c';
export const TEXT = '#cdd5d0';
export const ROW_LABEL = '#8b958f';
export const MICRO = '#556058';
export const FLOW = '#2dd4bf'; // teal — "live signal"

export const flowRowCss: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 26 };
export const flowMicro: CSSProperties = { fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: MICRO };
export const swatch: CSSProperties = { width: 34, height: 20, padding: 0, border: `1px solid ${BORDER}`, background: 'transparent', borderRadius: 4 };
export const flowSelect: CSSProperties = { background: FIELD_BG, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 5, fontSize: 12, padding: '2px 4px' };
export const numField: CSSProperties = { width: 52, background: FIELD_BG, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 5, fontSize: 11.5, padding: '2px 4px' };
export const ghostBtn: CSSProperties = { background: FIELD_BG, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '3px 7px', fontSize: 11, cursor: 'pointer' };

// One injected stylesheet: preview keyframes + a reduced-motion kill-switch for preview + disclosure.
export const FLOW_STYLE = `
@keyframes nodus-flow-dots { from { transform: translateX(0) } to { transform: translateX(var(--nodus-flow-shift, 0px)) } }
@keyframes nodus-flow-dash { from { background-position-x: 0px } to { background-position-x: var(--nodus-flow-shift, 0px) } }
@media (prefers-reduced-motion: reduce) {
  .nodus-flow-anim { animation: none !important }
  .nodus-flow-disc { transition: none !important }
  .nodus-flow-chevron { transition: none !important }
}
`;
