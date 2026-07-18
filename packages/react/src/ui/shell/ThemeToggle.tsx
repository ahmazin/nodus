/**
 * `ThemeToggle` — flips the editor between a light and a dark canvas `Theme`. It is **generic**: the
 * app supplies the concrete theme pair, so `@nodus/react` stays preset-free. The current mode is read
 * from the active theme's `appearance` (via `modeOfTheme`), which means canvas and DOM chrome always
 * agree — flipping this re-skins both in one frame.
 *
 * Affordance follows convention: in dark mode it shows a sun (click → light); in light mode a moon
 * (click → dark). The button is `aria-pressed` when dark is active.
 */

import type { CSSProperties, ReactElement } from 'react';
import type { Editor, Theme } from '@nodus/core';
import { IconButton } from '../primitives.js';
import { modeOfTheme, useUiTokens, type UiTokens } from '../tokens.js';
import { useValue } from '../../use-value.js';
import { MoonIcon, SunIcon } from './icons.js';

export interface ThemeToggleProps {
  editor: Editor;
  /** Theme applied in light mode (`appearance: 'light'`). */
  light: Theme;
  /** Theme applied in dark mode (`appearance: 'dark'`). */
  dark: Theme;
  tokens?: UiTokens;
  size?: 'sm' | 'md';
  style?: CSSProperties;
}

export function ThemeToggle({ editor, light, dark, tokens, size = 'md', style }: ThemeToggleProps): ReactElement {
  const themed = useUiTokens(editor);
  const t = tokens ?? themed;
  const mode = useValue(() => modeOfTheme(editor.themeAtom.get()));
  const isDark = mode === 'dark';

  const toggle = (): void => editor.setTheme(isDark ? light : dark);

  return (
    <IconButton
      tokens={t}
      size={size}
      variant="ghost"
      active={isDark}
      icon={isDark ? <SunIcon /> : <MoonIcon />}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light theme' : 'Dark theme'}
      onClick={toggle}
      style={style}
    />
  );
}
