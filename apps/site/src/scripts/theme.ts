// Shared theme toggle. Pairs with the FOUC inline script in SiteHead (which sets the
// initial `data-theme` before paint) and the icon-swap CSS in theme.css.
export function initThemeToggle(): void {
  const root = document.documentElement;
  const toggle = document.getElementById('nd-theme-toggle');
  if (!toggle) return;

  const theme = () => (root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  const apply = (t: string) => {
    if (t === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
    toggle.setAttribute('aria-pressed', String(t === 'light'));
  };

  apply(theme());
  toggle.addEventListener('click', () => {
    const next = theme() === 'light' ? 'dark' : 'light';
    apply(next);
    try {
      localStorage.setItem('nodus-theme', next);
    } catch (e) {
      /* private mode — ignore */
    }
  });
}
