/** A minimal, dependency-free transient toast. Creates a self-removing DOM node so any code path
 *  (React or not — e.g. a command-palette action) can give the user a one-line confirmation without
 *  threading state through a provider. No-op under SSR. */
export function showToast(message: string, tone: 'ok' | 'error' = 'ok'): void {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.textContent = message;
  const fg = tone === 'error' ? '#f87171' : '#10b981';
  el.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:24px',
    'transform:translateX(-50%)',
    'z-index:2000',
    'background:#0d1310',
    `color:${fg}`,
    'border:1px solid #28322c',
    'border-radius:8px',
    'padding:8px 14px',
    'font:12.5px/1.4 ui-monospace, monospace',
    'box-shadow:0 12px 32px -12px rgba(0,0,0,0.8)',
    'opacity:0',
    'transition:opacity .18s ease',
    'pointer-events:none',
  ].join(';');
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
  });
  window.setTimeout(() => {
    el.style.opacity = '0';
    window.setTimeout(() => el.remove(), 250);
  }, 1900);
}
