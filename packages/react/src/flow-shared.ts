/** Shared flow-authoring styles, defaults, and the injected keyframe stylesheet. Kept in its own
 *  module so `flow-controls` and `flow-scale-editor` can both depend on it without a cycle.
 *
 *  Styling is derived from the shared `UiTokens` (see `flowStyles`) rather than a private grey
 *  scale, so the whole Flow section re-skins with the theme and meets WCAG AA in light + dark. */
import type { CSSProperties } from 'react';
import type { FlowColorStop, FlowScale, FlowSpec } from '@nodus-dev/core';
import type { UiMode, UiTokens } from './ui/tokens.js';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** A 6-digit hex color — the only form core's parseHex can interpolate (else it steps). */
export const isHex6 = (c: string): boolean => /^#[0-9a-f]{6}$/i.test(c);

/** Pure: build a CSS `background` string for the ramp, faithfully mirroring core's colorForValue.
 *  gradient=false → stepped bands (doubled boundaries, floor rule). gradient=true → smooth blend,
 *  but a segment whose endpoints aren't BOTH 6-digit hex is hard-stepped (core's parseHex can't
 *  interpolate those, so it renders that band as a step — the ramp must not lie about it). */
export function buildRampCss(stops: FlowColorStop[], domain: [number, number], gradient = false): string {
  const [min, max] = domain;
  const span = max - min;
  const pct = (at: number): number => {
    const p = span === 0 ? 0 : (at - min) / span;
    return +(clamp(p, 0, 1) * 100).toFixed(2);
  };
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  if (sorted.length === 0) return 'transparent';
  if (sorted.length === 1) return `linear-gradient(90deg, ${sorted[0]!.color} 0%, ${sorted[0]!.color} 100%)`;
  if (gradient) {
    // CSS clamps below-first/above-last, matching colorForValue's end clamp.
    const parts: string[] = [`${sorted[0]!.color} ${pct(sorted[0]!.at)}%`];
    for (let i = 1; i < sorted.length; i++) {
      const p = pct(sorted[i]!.at);
      const hard = !(isHex6(sorted[i - 1]!.color) && isHex6(sorted[i]!.color));
      if (hard) parts.push(`${sorted[i - 1]!.color} ${p}%`); // hold prev color to the boundary → hard step
      parts.push(`${sorted[i]!.color} ${p}%`);
    }
    return `linear-gradient(90deg, ${parts.join(', ')})`;
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

// ---- the dedicated "live signal" flow accent (distinct from the app accent), mode-aware for AA ----
// The bright teal reads well on dark panels but fails 4.5:1 on white; light mode uses teal-700
// (>= 4.5:1 on the light surface) so stop bullets, handles, and the metric readout stay legible.
export const flowAccent = (mode: UiMode): string => (mode === 'light' ? '#0f766e' : '#2dd4bf');

/** Token-derived styles for the flow controls. Built once per render from the active `UiTokens`. */
export interface FlowStyles {
  /** The mode-aware flow accent (teal), for handles / bullets / the metric readout. */
  accent: string;
  rowCss: CSSProperties;
  micro: CSSProperties;
  /** Row label span color. */
  labelColor: string;
  /** Muted placeholder color (e.g. the "flow off" preview text). */
  faintColor: string;
  border: string;
  swatch: CSSProperties;
  select: CSSProperties;
  numField: CSSProperties;
  ghostBtn: CSSProperties;
  /** Range inputs have a fixed intrinsic width (~129px) and won't shrink by default, so in the
   *  narrow 210px panel they overflow off the right edge. flex:1 + minWidth:0 makes them fit. */
  slider: CSSProperties;
  /** `accent-color` for native checkboxes so they read as themed, not browser-blue. */
  checkbox: CSSProperties;
}

export function flowStyles(t: UiTokens): FlowStyles {
  const accent = flowAccent(t.mode);
  const field: CSSProperties = {
    background: t.color.surface, color: t.color.text, border: `1px solid ${t.color.border}`,
    borderRadius: t.radius.sm, fontSize: t.font.size.xs, padding: '2px 4px',
  };
  return {
    accent,
    rowCss: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 26 },
    micro: { fontSize: t.font.size.xs, letterSpacing: '.08em', textTransform: 'uppercase', color: t.color.textMuted },
    labelColor: t.color.textMuted,
    faintColor: t.color.textFaint,
    border: t.color.border,
    swatch: { width: 34, height: 20, padding: 0, border: `1px solid ${t.color.border}`, background: 'transparent', borderRadius: t.radius.sm, cursor: 'pointer' },
    select: { ...field },
    numField: { ...field, width: 52 },
    ghostBtn: { background: t.color.surface, color: t.color.text, border: `1px solid ${t.color.border}`, borderRadius: t.radius.md, padding: '3px 7px', fontSize: t.font.size.xs, cursor: 'pointer' },
    slider: { flex: 1, minWidth: 0, accentColor: accent },
    checkbox: { accentColor: accent },
  };
}

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
