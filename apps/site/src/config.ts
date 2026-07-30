/**
 * Single source of truth for the Nodus marketing site.
 *
 * ⚠️  PLACEHOLDER URLS — none of these destinations exist yet.
 * The GitHub org (`nodus-dev`), the domain (`nodus.dev`) and the Discord invite are
 * aspirational. When they become real, edit ONLY this file — index.astro resolves every
 * link from here (`%%TOKEN%%` -> value), so it is a one-place swap. Also update `site`
 * in astro.config.mjs to match `origin`.
 *
 * `docs` and `playground` are intentionally SAME-ORIGIN paths: they are the reserved
 * slots this site will grow into (Astro Starlight docs; the @ahmazin editor, currently
 * `examples/browser`, deployed at /playground/).
 */
export interface SiteConfig {
  name: string;
  version: string;
  tagline: string;
  description: string;
  origin: string;
  /** same-origin reserved paths */
  docs: string;
  docsCli: string;
  docsMcp: string;
  playground: string;
  /** external */
  github: string;
  githubReleases: string;
  discord: string;
  npmOrg: string;
  npm: { core: string; react: string; presetInfra: string; mcp: string };
  install: string;
}

export const SITE: SiteConfig = {
  name: 'Nodus',
  version: '0.1.0',
  tagline: 'Git-native diagrams.',
  description:
    'A headless, extensible diagram engine for TypeScript. Deterministic serialization ' +
    'turns every diagram into a text file that diffs cleanly, reviews in a PR, and never ' +
    'drifts from the system it describes.',

  origin: 'https://nodus.dev', // TODO(placeholder): domain not registered yet

  // Reserved same-origin slots (built out later).
  docs: '/docs',
  docsCli: '/docs/cli',
  docsMcp: '/docs/mcp',
  playground: '/playground/',

  // External — all placeholders until the org/handles are claimed.
  github: 'https://github.com/nodus-dev/nodus',
  githubReleases: 'https://github.com/nodus-dev/nodus/releases',
  discord: 'https://discord.gg/nodus',
  npmOrg: 'https://www.npmjs.com/org/nodus',
  npm: {
    core: 'https://www.npmjs.com/package/@ahmazin/core',
    react: 'https://www.npmjs.com/package/@ahmazin/react',
    presetInfra: 'https://www.npmjs.com/package/@ahmazin/preset-infra',
    mcp: 'https://www.npmjs.com/package/@ahmazin/mcp',
  },

  install: 'npm i @ahmazin/react @ahmazin/preset-infra',
};
