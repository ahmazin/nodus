import { describe, expect, it } from 'vitest';
import { defaultTheme, defaultLightTheme, lightTheme, resolveTokens } from '../index.js';

/**
 * Non-color status channel (PRR a11y). The `partial` status overlay must carry a `dash` so status is
 * distinguishable without relying on hue alone (WCAG "don't use color as the only cue"). `met`/`missed`
 * stay solid — they are already unambiguous via the corner glyph badge — so only `partial` gets a dash.
 */
describe('status overlay dash channel', () => {
  const themes = [
    ['default dark', defaultTheme],
    ['default light', defaultLightTheme],
    ['preset light', lightTheme],
  ] as const;

  for (const [name, theme] of themes) {
    it(`${name}: partial resolves a dash; met/missed do not`, () => {
      expect(resolveTokens(theme, { state: 'solid', overlay: 'partial' }).dash).toEqual([5, 3]);
      expect(resolveTokens(theme, { state: 'solid', overlay: 'met' }).dash).toBeUndefined();
      expect(resolveTokens(theme, { state: 'solid', overlay: 'missed' }).dash).toBeUndefined();
    });
  }
});
