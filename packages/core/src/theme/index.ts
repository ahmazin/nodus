/**
 * Theming — a first-class design-token system. The active `Theme` is data; `resolveTokens`
 * runs at *draw* time and layers slices in priority order:
 *
 *   base defaults  <  byType[type]  <  states[state]  <  overlays[overlay]  <  focus (if focused)
 *
 * A `draw()` implementation receives only `ResolvedTokens` and never reads raw hex, so swapping
 * the theme re-skins every node with zero type-specific work.
 */

import type { VisualState } from '../model.js';

export interface StateTokens {
  fill: string;
  stroke: string;
  strokeWidth: number;
  text: string;
  /** Accent glow color. `null` explicitly clears an inherited glow (e.g. a neutral state). */
  glow?: string | null;
  opacity?: number;
  fontScale?: number;
  dash?: number[];
  radius?: number;
  /** Force the label to a fixed string (e.g. `"?"` for a locked/undiscovered node). */
  labelOverride?: string;
}

export interface Theme {
  name: string;
  palette: Record<string, string>;
  typography: {
    fontFamily: string;
    size: number;
    lineHeight: number;
  };
  radii: Record<string, number>;
  canvas: {
    fill: string;
    grid?: { color: string; size: number };
  };
  /** Must include the four built-in states; presets may add more. */
  states: Record<string, StateTokens>;
  overlays: Record<string, Partial<StateTokens>>;
  focus: Partial<StateTokens>;
  /** Per-type default token slices, so third-party types are theme-aware. */
  byType?: Record<string, Partial<StateTokens>>;
}

export interface ResolvedTokens {
  fill: string;
  stroke: string;
  strokeWidth: number;
  text: string;
  glow?: string | null;
  opacity: number;
  fontScale: number;
  dash?: number[];
  radius: number;
  labelOverride?: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}

const BASE: StateTokens = {
  fill: '#1a1a1a',
  stroke: '#3a3a3a',
  strokeWidth: 1,
  text: '#e5e5e5',
  opacity: 1,
  fontScale: 1,
};

function mergeTokens(...slices: Array<Partial<StateTokens> | undefined>): StateTokens {
  const out: StateTokens = { ...BASE };
  for (const s of slices) {
    if (!s) continue;
    for (const k of Object.keys(s) as (keyof StateTokens)[]) {
      const v = s[k];
      if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

export function resolveTokens(
  theme: Theme,
  visual: VisualState,
  type?: string,
  override?: Partial<StateTokens>,
): ResolvedTokens {
  const byType = type ? theme.byType?.[type] : undefined;
  const state = theme.states[visual.state] ?? theme.states.solid;
  const overlay = visual.overlay ? theme.overlays[visual.overlay] : undefined;
  const focus = visual.focused ? theme.focus : undefined;

  // per-element style wins over everything (byType < state < overlay < focus < style)
  const merged = mergeTokens(byType, state, overlay, focus, override);
  const radius = merged.radius ?? theme.radii.node ?? 6;

  return {
    fill: merged.fill,
    stroke: merged.stroke,
    strokeWidth: merged.strokeWidth,
    text: merged.text,
    glow: merged.glow,
    opacity: merged.opacity ?? 1,
    fontScale: merged.fontScale ?? 1,
    dash: merged.dash,
    radius,
    labelOverride: merged.labelOverride,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.size,
    lineHeight: theme.typography.lineHeight,
  };
}

/** A neutral, generic dark theme. Presets (e.g. infra) ship richer themes. */
export const defaultTheme: Theme = {
  name: 'default-dark',
  palette: {
    accent: '#3b82f6',
    neutral: '#3a3a3a',
  },
  typography: { fontFamily: 'system-ui, sans-serif', size: 12, lineHeight: 1.3 },
  radii: { node: 6 },
  canvas: { fill: '#0e0e10', grid: { color: 'rgba(255,255,255,0.04)', size: 24 } },
  states: {
    accent: {
      fill: '#12161c',
      stroke: '#3b82f6',
      strokeWidth: 1,
      text: '#dbeafe',
      glow: '#3b82f6',
    },
    solid: { fill: '#161616', stroke: '#3a3a3a', strokeWidth: 1, text: '#e5e5e5' },
    ghost: {
      fill: '#0d0d0f',
      stroke: '#1c1c22',
      strokeWidth: 1,
      text: '#2a2a32',
      opacity: 0.5,
      fontScale: 0.9,
    },
    locked: {
      fill: 'transparent',
      stroke: '#23232b',
      strokeWidth: 1,
      text: '#3a3a42',
      dash: [4, 4],
      labelOverride: '?',
    },
  },
  overlays: {
    met: { stroke: '#10b981', glow: '#10b981' },
    partial: { stroke: '#f59e0b', glow: '#f59e0b' },
    missed: { stroke: '#ef4444', glow: '#ef4444' },
  },
  focus: { strokeWidth: 2, glow: '#ffffff' },
};
