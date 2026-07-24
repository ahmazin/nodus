/**
 * One-time global stylesheet for the Nodus DOM chrome. The host calls `injectGlobalStyles()` once
 * (idempotent) to install:
 *   - a `:focus-visible` ring driven by the `--nodus-focus-ring` CSS var (fed per-mode by the
 *     token layer; falls back to a sensible accent),
 *   - a `prefers-reduced-motion` block that kills transitions/animations on the chrome,
 *   - minimal resets scoped to `[data-nodus-ui]` so the chrome renders consistently across hosts.
 *
 * The base sheet makes **zero network requests** — text defaults to the system UI font via the
 * `--nodus-font` var. Fonts are opt-in: pass `{ webFonts: true }` to additionally load the Space
 * Grotesk / JetBrains Mono web fonts from Google Fonts (a request to `fonts.googleapis.com`). Most
 * adopters instead set `--nodus-font` to a self-hosted family and leave `webFonts` off.
 *
 * Per-element color comes from inline token styles (see `primitives.tsx`); this sheet only carries
 * cross-cutting rules that inline styles can't express (pseudo-classes, media queries, resets).
 */

const STYLE_ID = 'nodus-ui-global-styles';
const WEBFONTS_ID = 'nodus-ui-webfonts';
const WEBFONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap';

const CSS = `
[data-nodus-ui] {
  box-sizing: border-box;
  font-family: var(--nodus-font, ui-sans-serif, system-ui, -apple-system, 'Space Grotesk', sans-serif);
}
[data-nodus-ui] *,
[data-nodus-ui] *::before,
[data-nodus-ui] *::after {
  box-sizing: border-box;
}
[data-nodus-ui] button {
  font: inherit;
  color: inherit;
  margin: 0;
}
[data-nodus-ui] button,
button[data-nodus-ui] {
  transition: transform 80ms ease;
}
[data-nodus-ui] button:active,
button[data-nodus-ui]:active {
  transform: scale(0.97);
}
[data-nodus-ui]:focus,
[data-nodus-ui] :focus {
  outline: none;
}
[data-nodus-ui]:focus-visible,
[data-nodus-ui] :focus-visible {
  outline: 2px solid var(--nodus-focus-ring, #c4f24e);
  outline-offset: 2px;
  border-radius: inherit;
}
@media (prefers-reduced-motion: reduce) {
  [data-nodus-ui],
  [data-nodus-ui] * {
    transition-duration: 0.001ms !important;
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transform: none !important;
  }
}
`;

/**
 * Idempotently inject the chrome's global stylesheet into `document.head`. Safe to call many times
 * and safe in non-DOM environments (no-op when `document` is undefined).
 *
 * The base sheet is network-free. Pass `{ webFonts: true }` to also inject a separate
 * `<link id="nodus-ui-webfonts">` that pulls the Space Grotesk / JetBrains Mono web fonts from
 * `fonts.googleapis.com`. The web-font link is tracked under its own id so it can be added on a
 * later call even after the base sheet is already present.
 *
 * @param options.webFonts  Load the Google Fonts web fonts (default `false`, no network request).
 */
export function injectGlobalStyles(options?: { webFonts?: boolean }): void {
  if (typeof document === 'undefined') return;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  if (options?.webFonts && !document.getElementById(WEBFONTS_ID)) {
    const link = document.createElement('link');
    link.id = WEBFONTS_ID;
    link.rel = 'stylesheet';
    link.href = WEBFONTS_HREF;
    document.head.appendChild(link);
  }
}
