/**
 * Single source of truth for the Nodus marketing site.
 *
 * These destinations are LIVE (interim). The site deploys to GitHub Pages as a
 * *project* site served under a subpath: `https://ahmazin.github.io/nodus/`.
 * Because of the subpath, every in-app, root-relative path ("/docs", "/playground/",
 * "/favicon.svg", …) must be prefixed with the deploy base ("/nodus/") or it 404s.
 * Use `withBase()` for in-app paths and `absoluteUrl()` for canonical/OG URLs — do
 * NOT hand-write "/nodus/…" and do NOT use `new URL(path, origin)` (a leading-slash
 * path drops the "/nodus" segment). Astro auto-prefixes bundled assets (imported CSS/
 * JS) with the base; only hand-written href/src strings need `withBase()`.
 *
 * When the org/domain change, edit ONLY this file (+ `site`/`base` in astro.config.mjs).
 *
 * `docs` and `playground` are same-origin paths: the docs live at /docs (Astro pages)
 * and the @nodus-dev editor (currently `examples/browser`) is built into /playground/.
 */

// Scheme + host only (NO subpath). The GitHub Pages subpath lives in `base`.
const HOST = 'https://ahmazin.github.io';

// The deploy base, kept in lockstep with `base` in astro.config.mjs. Astro exposes it
// as import.meta.env.BASE_URL (e.g. '/nodus/') — deriving it here keeps one source.
const BASE = import.meta.env.BASE_URL;

/** Prefix a root-relative in-app path with the deploy base ('/nodus/…'). External or
 * already-relative values pass through unchanged. */
export const withBase = (p: string): string => {
  if (!p.startsWith('/')) return p; // external URL or relative path — leave alone
  return BASE.replace(/\/$/, '') + p; // '/nodus' + '/docs' -> '/nodus/docs'
};

/** Absolute URL (host + base + path) for canonical/OG/sitemap. */
export const absoluteUrl = (p: string): string => HOST + withBase(p);

export interface SiteConfig {
  name: string;
  version: string;
  tagline: string;
  description: string;
  /** Canonical origin including the GitHub Pages subpath (host + base). */
  origin: string;
  /** same-origin reserved paths (already base-prefixed) */
  docs: string;
  docsCli: string;
  docsMcp: string;
  playground: string;
  /** external */
  github: string;
  githubReleases: string;
  npmOrg: string;
  npm: { core: string; react: string; presetInfra: string; mcp: string };
  install: string;
}

export const SITE: SiteConfig = {
  name: 'Nodus',
  version: '0.3.0',
  tagline: 'Git-native diagrams.',
  description:
    'A headless, extensible diagram engine for TypeScript. Deterministic serialization ' +
    'turns every diagram into a text file that diffs cleanly, reviews in a PR, and never ' +
    'drifts from the system it describes.',

  origin: `${HOST}${BASE.replace(/\/$/, '')}`, // https://ahmazin.github.io/nodus

  // Reserved same-origin slots — base-aware so they resolve under the /nodus/ subpath.
  docs: withBase('/docs'),
  docsCli: withBase('/docs/cli'),
  docsMcp: withBase('/docs/mcp'),
  playground: withBase('/playground/'),

  // External.
  github: 'https://github.com/ahmazin/nodus',
  githubReleases: 'https://github.com/ahmazin/nodus/releases',
  npmOrg: 'https://www.npmjs.com/org/nodus-dev',
  npm: {
    core: 'https://www.npmjs.com/package/@nodus-dev/core',
    react: 'https://www.npmjs.com/package/@nodus-dev/react',
    presetInfra: 'https://www.npmjs.com/package/@nodus-dev/preset-infra',
    mcp: 'https://www.npmjs.com/package/@nodus-dev/mcp',
  },

  install: 'npm i @nodus-dev/react @nodus-dev/preset-infra',
};
