/**
 * UI design tokens for the Nodus DOM chrome (toolbars, panels, menus, buttons).
 *
 * The single source of truth for light vs dark is the **active canvas `Theme`**: `modeOfTheme`
 * reads `Theme.appearance`, so flipping the canvas theme re-skins the chrome in the same frame.
 * `useUiTokens(editor)` subscribes to the editor's theme atom and hands panels the right token set.
 *
 * Values realize the "Playground" design language: near-black canvas + a lime accent (`#c4f24e`)
 * in dark, a paper-white canvas + a *darkened* lime in light (see the a11y note on `light.accent`).
 *
 * All values are plain CSS strings/numbers consumed via inline styles (repo convention — no CSS
 * modules). Contrast: `text`/`textMuted` meet WCAG AA (>= 4.5:1) on surface/panel/canvas;
 * `textFaint` is tertiary/placeholder text and only meets the 3:1 large/non-essential-text floor
 * (~3.5:1) — it is NOT for small essential body copy. `focusRing` and accent-used-as-fill meet the
 * 3:1 non-text minimum (WCAG 1.4.11) against surface/panel/canvas. Measured ratios are recorded
 * inline below. `border`/`borderStrong` are decorative dividers (exempt from 1.4.11); interactive
 * affordance comes from fill/hover/text and the focus ring.
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
    /**
     * Tertiary/placeholder text. NOTE: at the Playground ramp this is only ~3.5:1 on surface
     * (`#676a76` dark, `#83868f` light) — it clears the 3:1 large/non-essential-text floor, NOT
     * 4.5:1. Do not use it for small essential body copy.
     */
    textFaint: string;
    /** Accent fill (primary action background, active states). Also reused as active text/icon. */
    accent: string;
    /** Text/icon color placed ON `accent` (>= 4.5:1 on accent). */
    accentText: string;
    /** Destructive / error (>= 4.5:1 on surface). */
    danger: string;
    /** Selection wash (translucent accent, layered over surface). */
    selection: string;
    /** Translucent surface for frosted glass effect. */
    glass: string;
  };
  radius: { sm: number; md: number; lg: number };
  /** 4px spacing scale: `space(n)` -> px number. `space(2)` === 8. */
  space: (n: number) => number;
  shadow: { panel: string; popover: string };
  /** CSS color for the `:focus-visible` ring (>= 3:1 on surface/panel/canvas). */
  focusRing: string;
  /** CSS blur length for frosted glass effect. */
  blur: string;
  font: {
    family: string;
    /** Monospace stack for code, canonical JSON, numeric fields, and keycaps. */
    mono: string;
    /** CSS-ready sizes. */
    size: { xs: string; sm: string; md: string; lg: string };
  };
}

const FONT_STACK =
  "'Space Grotesk', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO_STACK = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const RADIUS = { sm: 6, md: 8, lg: 11 } as const;
const FONT_SIZE = { xs: '11px', sm: '12px', md: '13px', lg: '15px' } as const;
const space = (n: number): number => n * 4;

/**
 * Dark tokens — the Playground ramp: near-black canvas `#0a0b0e` with the lime accent `#c4f24e`.
 * Lime as text/icon on the dark surfaces is very high contrast (accent-on-canvas 15.1:1), so it
 * doubles as the active text color and the focus ring. Text ramp: `text` 15.4:1, `textMuted`
 * 7.3:1, `textFaint` ~3.5:1 (tertiary), `danger` 6.0:1 — all on surface `#101319`.
 */
const dark: UiTokens = {
  mode: 'dark',
  color: {
    canvas: '#0a0b0e',
    surface: '#101319',
    surfaceHover: '#171b22',
    panel: '#101319',
    border: 'rgba(255,255,255,0.08)',
    borderStrong: 'rgba(255,255,255,0.14)',
    text: '#e9e9ee',
    textMuted: '#9fa2ad',
    textFaint: '#676a76',
    accent: '#c4f24e',
    accentText: '#0a0b0e', // 15.1:1 on the lime fill
    danger: '#f0655c',
    selection: 'rgba(196,242,78,0.16)',
    glass: 'rgba(16,19,25,0.72)',
  },
  radius: { ...RADIUS },
  space,
  shadow: {
    panel: '0 8px 24px -12px rgba(0,0,0,0.5)',
    popover: '0 20px 50px -18px rgba(0,0,0,0.6)',
  },
  focusRing: '#c4f24e', // 15.1:1 on canvas — far above the 3:1 non-text minimum
  blur: '12px',
  font: { family: FONT_STACK, mono: MONO_STACK, size: { ...FONT_SIZE } },
};

/**
 * Light tokens — paper-white surface from the design's `lightVars`. The bright lime `#c4f24e`
 * is UNUSABLE here: the shell reuses `accent` as active text/icon color, and lime on white fails
 * WCAG AA badly. So the light accent is a *darkened* lime `#3f6212` chosen to clear 4.5:1 as text
 * on BOTH `#ffffff` and `surfaceHover #eeeee8`, while staying clearly in the lime/green family.
 *
 * Measured (WCAG 2.x) for `accent` `#3f6212`:
 *   - as text on surface `#ffffff`       : 7.08:1  (AA text, need >= 4.5)  ✓
 *   - as text on surfaceHover `#eeeee8`   : 6.08:1  (AA text, need >= 4.5)  ✓
 *   - as text on canvas `#f7f7f3`         : 6.59:1                          ✓
 *   - as fill / focus ring on surface     : 7.08:1  (need >= 3.0)           ✓
 *   - as focus ring on canvas             : 6.59:1  (need >= 3.0)           ✓
 * `accentText` is white `#ffffff` on the accent fill (7.08:1 — dark text would be only 2.78:1).
 * Text ramp on white: `text` 17.9:1, `textMuted` 7.5:1, `textFaint` ~3.6:1 (tertiary), `danger`
 * 5.4:1.
 */
const light: UiTokens = {
  mode: 'light',
  color: {
    canvas: '#f7f7f3',
    surface: '#ffffff',
    surfaceHover: '#eeeee8',
    panel: '#ffffff',
    border: 'rgba(10,11,14,0.10)',
    borderStrong: 'rgba(10,11,14,0.16)',
    text: '#15171c',
    textMuted: '#52555d',
    textFaint: '#83868f',
    accent: '#3f6212', // darkened lime — 7.08:1 as text on white (bright lime would fail AA)
    accentText: '#ffffff', // 7.08:1 on the darkened lime; dark-on-accent would be only 2.78:1
    danger: '#cf222e',
    selection: 'rgba(63,98,18,0.14)', // translucent light accent (#3f6212 @ 0.14)
    glass: 'rgba(255,255,255,0.72)',
  },
  radius: { ...RADIUS },
  space,
  shadow: {
    panel: '0 8px 24px -12px rgba(15,23,42,0.18)',
    popover: '0 20px 50px -18px rgba(15,23,42,0.22)',
  },
  focusRing: '#3f6212', // same darkened lime — 7.08:1 on surface/panel, 6.59:1 on canvas
  blur: '12px',
  font: { family: FONT_STACK, mono: MONO_STACK, size: { ...FONT_SIZE } },
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
