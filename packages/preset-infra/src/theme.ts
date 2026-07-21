/**
 * darkInfraTheme — transcribes the seed spec's design tokens. Per-type accent colors live in
 * `byType`; the four states layer on top. Neutral states clear the inherited glow with `glow: null`
 * so only accent/known nodes glow. Nothing here is type-specific code — it's all data.
 */

import type { Theme } from '@nodus/core';

export const INFRA_TYPES = ['service', 'db', 'cache', 'queue', 'lb', 'edge'] as const;
export type InfraKind = (typeof INFRA_TYPES)[number];

/** `service | db | cache | queue | lb | edge` -> accent hex. */
export const ACCENTS: Record<InfraKind, string> = {
  service: '#10b981', // emerald
  db: '#06b6d4', // cyan
  cache: '#f59e0b', // amber
  queue: '#8b5cf6', // violet
  lb: '#3b82f6', // blue
  edge: '#ef4444', // red
};

export const infraTypeKey = (kind: InfraKind): string => `infra.${kind}`;

function byTypeSlices(): Theme['byType'] {
  const out: NonNullable<Theme['byType']> = {};
  for (const kind of INFRA_TYPES) {
    const accent = ACCENTS[kind];
    out[infraTypeKey(kind)] = { stroke: accent, text: accent, glow: accent };
  }
  return out;
}

export const darkInfraTheme: Theme = {
  name: 'infra-dark',
  appearance: 'dark',
  palette: { accent: '#10b981', neutral: '#3a423f', ...ACCENTS },
  typography: {
    fontFamily: "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace",
    size: 10.5,
    lineHeight: 1.3,
  },
  radii: { node: 7 },
  canvas: { fill: '#070a09', grid: { color: 'rgba(255,255,255,0.03)', size: 24 } },
  states: {
    // accent: fill + width only; stroke/text/glow come from the type's byType slice (layered before
    // the state), so per-type accent colors win. Non-infra types fall back to BASE stroke/text.
    // glass/shadow give infra tiles a glassy material (S1 T3): vertical gradient fill + offset
    // drop-shadow + inner rim-light; no ambient wash here (that's a separate follow-up).
    accent: {
      fill: '#0c100f',
      strokeWidth: 1,
      glass: 0.16,
      shadow: { color: 'rgba(0,0,0,0.30)', blur: 16, dy: 4 },
    } as Theme['states'][string],
    // solid: neutral grey border/text, no glow
    solid: { fill: '#0c100f', stroke: '#3a423f', strokeWidth: 1, text: '#e5e5e5', glow: null },
    // ghost: faded previous-layer look
    ghost: {
      fill: '#0a0d0c',
      stroke: '#1c2320',
      strokeWidth: 1,
      text: '#2a322f',
      opacity: 0.5,
      fontScale: 0.9,
      glow: null,
    },
    // locked: transparent fill, dashed border, label forced to '?'
    locked: {
      fill: 'rgba(0,0,0,0)',
      stroke: '#232b28',
      strokeWidth: 1,
      text: '#3a423f',
      dash: [4, 4],
      labelOverride: '?',
      glow: null,
    },
  },
  overlays: {
    met: { stroke: '#10b981', glow: '#10b981' },
    partial: { stroke: '#f59e0b', glow: '#f59e0b' },
    missed: { stroke: '#ef4444', glow: '#ef4444' },
  },
  focus: { strokeWidth: 2, glow: '#ffffff' },
  byType: byTypeSlices(),
};

// The accent state must NOT override the type's stroke/text/glow. We set stroke/text on `accent`
// above only as safe fallbacks for non-infra types; real infra types supply them via byType, which
// is layered *before* the state — so for infra nodes byType wins for color and `accent` supplies
// fill. (Verified by the render demo.)

/**
 * infraLightTheme — the light mirror of `darkInfraTheme`. Light canvas + white cards + dark ink;
 * per-type accents and the met/partial/missed overlay hues are unchanged (byType is shared). Glows
 * stay subtle on light. WS-D owns the visual-tuning pass under light (contrast of accent-colored
 * node labels on white is a known follow-up — see the GA design-spec risk list).
 */
export const infraLightTheme: Theme = {
  name: 'infra-light',
  appearance: 'light',
  palette: { accent: '#10b981', neutral: '#64748b', ...ACCENTS },
  typography: {
    fontFamily: "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace",
    size: 10.5,
    lineHeight: 1.3,
  },
  radii: { node: 7 },
  canvas: { fill: '#f7f9f8', grid: { color: 'rgba(7,10,9,0.05)', size: 24 } },
  states: {
    // accent: light card fill only; stroke/text/glow come from the type's byType slice.
    // Calmer glass than dark — depth without a heavy wash (bloom/washes are a later pass).
    accent: {
      fill: '#f3faf7',
      strokeWidth: 1,
      glass: 0.08,
      shadow: { color: 'rgba(20,30,40,0.16)', blur: 12, dy: 3 },
    } as Theme['states'][string],
    // solid: neutral grey border, dark ink, no glow.
    solid: { fill: '#ffffff', stroke: '#cbd5e1', strokeWidth: 1, text: '#1a2420', glow: null },
    // ghost: faded previous-layer look.
    ghost: {
      fill: '#f1f5f4',
      stroke: '#e2e8f0',
      strokeWidth: 1,
      text: '#94a3b8',
      opacity: 0.55,
      fontScale: 0.9,
      glow: null,
    },
    // locked: transparent fill, dashed border, label forced to '?'.
    locked: {
      fill: 'rgba(255,255,255,0)',
      stroke: '#cbd5e1',
      strokeWidth: 1,
      text: '#94a3b8',
      dash: [4, 4],
      labelOverride: '?',
      glow: null,
    },
  },
  overlays: {
    met: { stroke: '#059669', glow: '#10b981' },
    partial: { stroke: '#d97706', glow: '#f59e0b' },
    missed: { stroke: '#dc2626', glow: '#ef4444' },
  },
  // White glow is invisible on a light canvas — focus reads via the accent glow instead.
  focus: { strokeWidth: 2, glow: '#10b981' },
  byType: byTypeSlices(),
};
