// Full site build: API reference (TypeDoc) + landing/docs (Astro) + the editor demo (Vite).
//
//   apps/site/public/api/   <- TypeDoc: @nodus-dev/{core,react} API reference
//   dist/                   <- Astro: landing page + docs (+ copies public/, incl. api/)
//   dist/playground/        <- Vite: the @nodus-dev editor (examples/browser)
//
// The interim deploy is a GitHub Pages *project* site under /nodus/, so:
//   - Astro `base: '/nodus/'` prefixes bundled assets + routes.
//   - the editor is built with base=/nodus/playground/ so ITS assets resolve there too.
//
// Order matters: TypeDoc writes into public/api first (astro build then copies public/ →
// dist/); `astro build` empties dist/, so the editor is written into dist/playground/ last.
// Run:  pnpm --filter @nodus-dev/site build
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url)); // apps/site/scripts
const siteRoot = resolve(here, '..'); // apps/site
const repoRoot = resolve(siteRoot, '..', '..'); // repo root
const editorDir = join(repoRoot, 'examples', 'browser');
const playgroundOut = join(siteRoot, 'dist', 'playground');

// execFileSync with an argument array — no shell, so paths are never string-interpolated.
const run = (args, cwd) => {
  console.log(`\n$ pnpm ${args.join(' ')}\n  (cwd: ${cwd})`);
  execFileSync('pnpm', args, { cwd, stdio: 'inherit' });
};

// 0) API reference -> apps/site/public/api/  (TypeDoc, root `docs:api` script). Runs before
//    astro build so the freshly generated HTML is copied from public/ into dist/api/.
run(['run', 'docs:api'], repoRoot);

// 1) Landing + docs -> dist/
run(['exec', 'astro', 'build'], siteRoot);

// 1b) Base-prefix hand-written root-relative links in the emitted HTML. Astro's default markdown
//     processor does NOT rewrite `[x](/docs/y)` links for `base`, so on the /nodus/ subpath they
//     would 404. Astro's own bundled asset URLs are already `/nodus/…` (skipped). External (http),
//     protocol-relative (//), and anchor (#) links are untouched. `.astro`-level links use withBase()
//     and are already correct. Runs before the Vite playground build (Vite base-builds its own HTML).
const BASE = '/nodus'; // no trailing slash; matches astro.config base '/nodus/'
const distDir = join(siteRoot, 'dist');
const rebaseHtml = (html) =>
  html.replace(/(href|src)="(\/[^"]*)"/g, (m, attr, url) => {
    if (url.startsWith('//') || url === BASE || url.startsWith(BASE + '/')) return m; // external/already-based
    return `${attr}="${BASE}${url}"`;
  });
const walkHtml = (dir) => {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'playground') continue; // Vite-built separately, already base-correct
      n += walkHtml(p);
    } else if (entry.name.endsWith('.html')) {
      const before = readFileSync(p, 'utf8');
      const after = rebaseHtml(before);
      if (after !== before) { writeFileSync(p, after); n++; }
    }
  }
  return n;
};
console.log(`\n$ rebase root-relative links -> ${BASE}/…`);
console.log(`  rewrote ${walkHtml(distDir)} HTML file(s)`);

// 2) Editor demo -> dist/playground/  (base=/nodus/playground/ so its assets resolve under
//    the project-pages subpath: https://ahmazin.github.io/nodus/playground/)
run(['exec', 'vite', 'build', '--base=/nodus/playground/', '--outDir', playgroundOut, '--emptyOutDir'], editorDir);

console.log('\n✅ site built → apps/site/dist  (api + landing + docs + /playground/)');
