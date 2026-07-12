/**
 * A pack of ready-made general themes (usable with any node/edge types). Presets like infra ship
 * their own type-aware themes; these are neutral palettes for quick restyling. Swap with
 * `editor.setTheme(...)`.
 */

import type { StateTokens, Theme } from './index.js';

interface Palette {
  name: string;
  canvas: string;
  grid: string;
  panel: string;
  border: string;
  borderStrong: string;
  ink: string;
  inkDim: string;
  accent: string;
  ghostFill: string;
  ghostBorder: string;
  ghostInk: string;
}

function build(p: Palette): Theme {
  const accentState: StateTokens = { fill: p.panel, stroke: p.accent, strokeWidth: 1.4, text: p.accent, glow: p.accent };
  return {
    name: p.name,
    palette: { accent: p.accent, ink: p.ink, panel: p.panel },
    typography: { fontFamily: "ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace", size: 11.5, lineHeight: 1.3 },
    radii: { node: 8 },
    canvas: { fill: p.canvas, grid: { color: p.grid, size: 24 } },
    states: {
      accent: accentState,
      solid: { fill: p.panel, stroke: p.border, strokeWidth: 1.2, text: p.ink, glow: null },
      ghost: { fill: p.ghostFill, stroke: p.ghostBorder, strokeWidth: 1, text: p.ghostInk, opacity: 0.55, fontScale: 0.92, glow: null },
      locked: { fill: 'rgba(0,0,0,0)', stroke: p.borderStrong, strokeWidth: 1, text: p.inkDim, dash: [4, 4], labelOverride: '?', glow: null },
    },
    overlays: {
      met: { stroke: '#10b981', glow: '#10b981' },
      partial: { stroke: '#f59e0b', glow: '#f59e0b' },
      missed: { stroke: '#ef4444', glow: '#ef4444' },
    },
    focus: { strokeWidth: 2.2, glow: p.accent },
  };
}

export const lightTheme = build({
  name: 'light',
  canvas: '#f6f7f9', grid: 'rgba(15,23,42,0.05)', panel: '#ffffff', border: '#cbd5e1', borderStrong: '#94a3b8',
  ink: '#0f172a', inkDim: '#64748b', accent: '#4f46e5', ghostFill: '#eef1f6', ghostBorder: '#dbe1ea', ghostInk: '#94a3b8',
});

export const blueprintTheme = build({
  name: 'blueprint',
  canvas: '#0a1a2f', grid: 'rgba(56,189,248,0.08)', panel: '#0e2138', border: '#1e3a57', borderStrong: '#274b6d',
  ink: '#cfe6ff', inkDim: '#6f92b3', accent: '#38bdf8', ghostFill: '#0b1a2c', ghostBorder: '#16304a', ghostInk: '#3f5f80',
});

export const neonTheme = build({
  name: 'neon',
  canvas: '#08070d', grid: 'rgba(217,70,239,0.07)', panel: '#120f1c', border: '#2a2340', borderStrong: '#3a2f54',
  ink: '#f0e9ff', inkDim: '#8a7fb0', accent: '#d946ef', ghostFill: '#0d0b16', ghostBorder: '#211b33', ghostInk: '#4a4266',
});

export const paperTheme = build({
  name: 'paper',
  canvas: '#efe9dc', grid: 'rgba(60,50,35,0.06)', panel: '#f7f2e8', border: '#cdbfa4', borderStrong: '#a8966f',
  ink: '#2c2618', inkDim: '#7a6f57', accent: '#b45309', ghostFill: '#e7e0d0', ghostBorder: '#d3c8b0', ghostInk: '#a8966f',
});

/** A phosphor-green brand theme (JetBrains Mono, dark) — on-brand exports with zero per-diagram effort. */
export const pisTheme = build({
  name: 'pis',
  canvas: '#070b09', grid: 'rgba(63,221,138,0.06)', panel: '#0d1512', border: '#22302a', borderStrong: '#35473f',
  ink: '#d7e5dc', inkDim: '#6f8579', accent: '#3fdd8a', ghostFill: '#0a120e', ghostBorder: '#18241e', ghostInk: '#3a4a42',
});

/** All bundled general themes, keyed by name. */
export const themePack: Record<string, Theme> = {
  pis: pisTheme,
  light: lightTheme,
  blueprint: blueprintTheme,
  neon: neonTheme,
  paper: paperTheme,
};
