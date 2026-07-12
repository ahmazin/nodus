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
    accent: { fill: '#0c100f', strokeWidth: 1 } as Theme['states'][string],
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
