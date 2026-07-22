import { defineConfig } from 'astro/config';

// Static marketing site for Nodus.
//   - Landing page ships today (src/pages/index.astro).
//   - /docs slots in later (Astro Starlight).
//   - /playground slots in later (the @nodus editor — currently examples/browser).
//
// `site` feeds canonical/OG URLs. It is a PLACEHOLDER — nodus.dev does not exist yet.
// Keep it in sync with `origin` in src/config.ts (single source of truth for links).
export default defineConfig({
  site: 'https://nodus.dev',
  // output: 'static' is the default — no adapter, emits a plain static bundle.
  markdown: {
    // Always-dark code blocks, matching the landing page's code panels.
    shikiConfig: { theme: 'github-dark', wrap: false },
  },
});
