/**
 * UI design tokens for the Nodus DOM chrome (toolbars, panels, menus, buttons).
 *
 * The single source of truth for light vs dark is the **active canvas `Theme`**: `modeOfTheme`
 * reads `Theme.appearance`, so flipping the canvas theme re-skins the chrome in the same frame.
 * `useUiTokens(editor)` subscribes to the editor's theme atom and hands panels the right token set.
 *
 * All values are plain CSS strings/numbers consumed via inline styles (repo convention — no CSS
 * modules). Contrast: every text-on-surface pair meets WCAG AA (>= 4.5:1); `focusRing` meets the
 * 3:1 non-text minimum (WCAG 1.4.11) against surface/panel/canvas. Ratios are recorded in
 * `docs`/the WS-0 contract report. `border`/`borderStrong` are decorative dividers (exempt from
 * 1.4.11); interactive affordance comes from fill/hover/text and the focus ring.
 */

import type { Editor, Theme } from '@nodus/core';
import { useValue } from '../use-value.js';

export type UiMode = 'light' | 'dark';

export interface UiTokens {
  /** Which mode these tokens realize — handy for mode-aware chrome (e.g. a sun/moon glyph). */
  mode: UiMode;
  color: {
    /** App background behind/around the canvas host. */
    canvas: string;
    /** Base chrome surface (toolbar / panel body). */
    surface: string;
    /** Hovered surface (menu items, ghost buttons). */
    surfaceHover: string;
    /** Elevated surface for popovers / floating panels / menus. */
    panel: string;
    /** Hairline divider — decorative, low-contrast by design. */
    border: string;
    /** Stronger divider for structural separation. */
    borderStrong: string;
    /** Primary text (>= 4.5:1 on surface & canvas). */
    text: string;
    /** Secondary text (>= 4.5:1 on surface, panel, surfaceHover). */
    textMuted: string;
    /** Tertiary/placeholder text (>= 4.5:1 on surface). */
    textFaint: string;
    /** Accent fill (primary action background, active states). */
    accent: string;
    /** Text/icon color placed ON `accent` (>= 4.5:1 on accent). */
    accentText: string;
    /** Destructive / error (>= 4.5:1 on surface). */
    danger: string;
    /** Selection wash (translucent accent, layered over surface). */
    selection: string;
  };
  radius: { sm: number; md: number; lg: number };
  /** 4px spacing scale: `space(n)` -> px number. `space(2)` === 8. */
  space: (n: number) => number;
  shadow: { panel: string; popover: string };
  /** CSS color for the `:focus-visible` ring (>= 3:1 on surface/panel/canvas). */
  focusRing: string;
  font: {
    family: string;
    /** CSS-ready sizes. */
    size: { xs: string; sm: string; md: string };
  };
}

const FONT_STACK =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const RADIUS = { sm: 4, md: 6, lg: 10 } as const;
const FONT_SIZE = { xs: '11px', sm: '12px', md: '13px' } as const;
const space = (n: number): number => n * 4;

/**
 * Dark tokens — harmonized with the app's dark canvas (infra `#070a09`) and emerald accent
 * `#10b981`. Text ramp all >= 4.5:1 on surface; focusRing 7.1:1 on surface.
 */
const dark: UiTokens = {
  mode: 'dark',
  color: {
    canvas: '#0a0d0c',
    surface: '#121815',
    surfaceHover: '#1d2621',
    panel: '#1a221e',
    border: '#2a332e',
    borderStrong: '#3d4a43',
    text: '#e6ede9',
    textMuted: '#9db0a6',
    textFaint: '#869388',
    accent: '#10b981',
    accentText: '#04231a',
    danger: '#f87171',
    selection: 'rgba(16,185,129,0.16)',
  },
  radius: { ...RADIUS },
  space,
  shadow: {
    panel: '0 1px 2px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.35)',
    popover: '0 4px 12px rgba(0,0,0,0.5), 0 12px 32px rgba(0,0,0,0.45)',
  },
  focusRing: '#10b981',
  font: { family: FONT_STACK, size: { ...FONT_SIZE } },
};

/** Light tokens — clean neutral surface, emerald accent kept; text ramp all >= 4.5:1 on white. */
const light: UiTokens = {
  mode: 'light',
  color: {
    canvas: '#f4f6f5',
    surface: '#ffffff',
    surfaceHover: '#eef2f0',
    panel: '#ffffff',
    border: '#e3e8e5',
    borderStrong: '#c8d2cd',
    text: '#0f1714',
    textMuted: '#586b62',
    textFaint: '#6b7a72',
    accent: '#10b981',
    accentText: '#04231a',
    danger: '#dc2626',
    selection: 'rgba(16,185,129,0.14)',
  },
  radius: { ...RADIUS },
  space,
  shadow: {
    panel: '0 1px 2px rgba(15,23,42,0.08), 0 4px 16px rgba(15,23,42,0.10)',
    popover: '0 4px 12px rgba(15,23,42,0.12), 0 12px 32px rgba(15,23,42,0.14)',
  },
  // Bright accent fails 3:1 on white as a thin outline — use a darker teal for the focus ring.
  focusRing: '#0f766e',
  font: { family: FONT_STACK, size: { ...FONT_SIZE } },
};

/** Fully-specified light + dark token sets, keyed by mode. */
export const uiTokens: Record<UiMode, UiTokens> = { light, dark };

/** The token set for a given mode. */
export function uiTokensFor(mode: UiMode): UiTokens {
  return uiTokens[mode];
}

/** Derive the chrome mode from a canvas `Theme`. Unset `appearance` is treated as `'dark'`. */
export function modeOfTheme(theme: Theme): UiMode {
  return theme.appearance ?? 'dark';
}

/**
 * Subscribe a component to the editor's active theme and return the matching UI tokens. Re-renders
 * (and re-skins) whenever the theme atom changes — one atom drives both canvas and chrome.
 */
export function useUiTokens(editor: Editor): UiTokens {
  const mode = useValue(() => modeOfTheme(editor.themeAtom.get()));
  return uiTokensFor(mode);
}
