import { defineConfig } from 'astro/config';

// Static marketing site for Nodus.
//   - Landing page (src/pages/index.astro).
//   - /docs (Astro markdown pages under src/pages/docs).
//   - /playground (the @nodus-dev editor — currently examples/browser), built by scripts/build.mjs.
//
// Interim hosting is a GitHub Pages *project* site served under a subpath:
// https://ahmazin.github.io/nodus/. `site` is the scheme+host and `base` is the subpath;
// Astro composes them for routing + bundled-asset URLs. Hand-written links use `withBase()`
// from src/config.ts. Keep `site`/`base` in sync with config.ts.
export default defineConfig({
  site: 'https://ahmazin.github.io',
  base: '/nodus/',
  // output: 'static' is the default — no adapter, emits a plain static bundle.
  // NOTE: Astro's default markdown processor does NOT base-prefix hand-written root-relative
  // links (`[x](/docs/y)`) in markdown bodies. Rather than switch processors (extra dep) or
  // hardcode `/nodus/` into ~64 links, scripts/build.mjs runs a post-build pass that base-prefixes
  // root-relative internal <a href>/<img src> in the emitted HTML. .astro-level links use withBase().
  markdown: {
    // Always-dark code blocks, matching the landing page's code panels.
    shikiConfig: { theme: 'github-dark', wrap: false },
  },
});
