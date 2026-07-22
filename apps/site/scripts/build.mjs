// Full site build: landing/docs (Astro) + the editor demo (Vite) at /playground/.
//
//   dist/                 <- Astro: landing page + docs
//   dist/playground/      <- Vite: the @nodus editor (examples/browser), base=/playground/
//
// Order matters: `astro build` empties dist/, so it runs first; the editor is written into
// dist/playground/ afterwards. Run:  pnpm --filter @nodus/site build
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

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

// 1) Landing + docs -> dist/
run(['exec', 'astro', 'build'], siteRoot);

// 2) Editor demo -> dist/playground/  (subpath base so its assets resolve under /playground/)
run(['exec', 'vite', 'build', '--base=/playground/', '--outDir', playgroundOut, '--emptyOutDir'], editorDir);

console.log('\n✅ site built → apps/site/dist  (landing + docs + /playground/)');
