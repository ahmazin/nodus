/** Build every publishable package with tsup, in dependency order. Avoids `pnpm -r`'s pre-run
 *  dependency check (which is noisy under this pnpm version). */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsup = join(root, 'node_modules', '.bin', 'tsup');
// Dependency-ordered build list. NOTE: this hand-maintained array must include every publishable
// package — `@ahmazin/stencils` was previously missing, so `pnpm build` skipped it and `changeset
// publish` would have shipped a broken package with no dist (pre-publication audit H1). `stencils`
// depends only on `core` and is consumed by `react`, so it sits right after `core`.
const order = ['core', 'stencils', 'layout-dagre', 'layout-tree', 'layout-force', 'layout-elk', 'preset-infra', 'plugin-freehand', 'preset-diagrams', 'icons-cloud', 'from-mermaid', 'text-to-diagram', 'import-infra', 'preset-draw', 'persistence', 'mcp', 'cli', 'react'];

for (const pkg of order) {
  console.log(`\n▸ building @ahmazin/${pkg}`);
  execFileSync(tsup, [], { cwd: join(root, 'packages', pkg), stdio: 'inherit' });
}
console.log('\n✓ all packages built');
