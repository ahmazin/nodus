/**
 * One-time global stylesheet for the Nodus DOM chrome. The host calls `injectGlobalStyles()` once
 * (idempotent) to install:
 *   - a `:focus-visible` ring driven by the `--nodus-focus-ring` CSS var (fed per-mode by the
 *     token layer; falls back to a sensible accent),
 *   - a `prefers-reduced-motion` block that kills transitions/animations on the chrome,
 *   - minimal resets scoped to `[data-nodus-ui]` so the chrome renders consistently across hosts.
 *
 * Per-element color comes from inline token styles (see `primitives.tsx`); this sheet only carries
 * cross-cutting rules that inline styles can't express (pseudo-classes, media queries, resets).
 */

const STYLE_ID = 'nodus-ui-global-styles';

const CSS = `
[data-nodus-ui] {
  box-sizing: border-box;
  font-family: var(--nodus-font, ui-sans-serif, system-ui, sans-serif);
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
[data-nodus-ui]:focus,
[data-nodus-ui] :focus {
  outline: none;
}
[data-nodus-ui]:focus-visible,
[data-nodus-ui] :focus-visible {
  outline: 2px solid var(--nodus-focus-ring, #10b981);
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
  }
}
`;

/**
 * Idempotently inject the chrome's global stylesheet into `document.head`. Safe to call many times
 * and safe in non-DOM environments (no-op when `document` is undefined).
 */
export function injectGlobalStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
