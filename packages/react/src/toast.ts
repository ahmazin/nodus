/** Minimal, imperative transient toasts. Any code path (React or not — e.g. a command-palette
 *  action) can pop a one-line confirmation without threading state through a provider. Multiple
 *  toasts STACK upward instead of overlapping, colors come from the shared UI tokens, and the
 *  fade respects `prefers-reduced-motion`. No-op under SSR. */
import { uiTokensFor, type UiMode } from './ui/tokens.js';

const GAP = 8; // px between stacked toasts
const BASE = 24; // px from the bottom edge to the newest toast
// Newest toast at index 0 (nearest the bottom edge); older toasts stack above it.
const stack: HTMLElement[] = [];

/** Bottom offset (px) for each toast in a vertical stack, index 0 nearest the bottom edge. Pure. */
export function stackOffsets(heights: number[], base = BASE, gap = GAP): number[] {
  const out: number[] = [];
  let acc = base;
  for (const h of heights) {
    out.push(acc);
    acc += h + gap;
  }
  return out;
}

function reflow(): void {
  const offsets = stackOffsets(stack.map((el) => el.offsetHeight || 34));
  stack.forEach((el, i) => { el.style.bottom = `${offsets[i]}px`; });
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export interface ToastOptions {
  /** Chrome mode for the token colors. Defaults to `'dark'` (the app's default appearance); callers
   *  with an editor can pass `modeOfTheme(editor.themeAtom.peek())` for an exact theme match. */
  mode?: UiMode;
  /** Auto-dismiss delay in ms (default 1900). */
  duration?: number;
}

export function showToast(message: string, tone: 'ok' | 'error' = 'ok', opts: ToastOptions = {}): void {
  if (typeof document === 'undefined') return;
  const t = uiTokensFor(opts.mode ?? 'dark');
  const reduce = prefersReducedMotion();
  const el = document.createElement('div');
  // Errors are assertive so a screen reader interrupts; success is polite.
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  el.textContent = message;
  const fg = tone === 'error' ? t.color.danger : t.color.accent;
  el.style.cssText = [
    'position:fixed',
    'left:50%',
    `bottom:${BASE}px`,
    'transform:translateX(-50%)',
    'z-index:2000',
    `background:${t.color.panel}`,
    `color:${fg}`,
    `border:1px solid ${t.color.border}`,
    `border-radius:${t.radius.md}px`,
    'padding:8px 14px',
    `font:12.5px/1.4 ${t.font.family}`,
    `box-shadow:${t.shadow.popover}`,
    reduce ? 'opacity:1' : 'opacity:0',
    reduce ? 'transition:none' : 'transition:opacity .18s ease',
    'pointer-events:none',
    'max-width:min(420px, 90vw)',
  ].join(';');
  document.body.appendChild(el);
  stack.unshift(el);
  reflow();
  if (!reduce) requestAnimationFrame(() => { el.style.opacity = '1'; });

  const remove = (): void => {
    const i = stack.indexOf(el);
    if (i >= 0) stack.splice(i, 1);
    el.remove();
    reflow();
  };
  window.setTimeout(() => {
    if (reduce) { remove(); return; }
    el.style.opacity = '0';
    window.setTimeout(remove, 250);
  }, opts.duration ?? 1900);
}
