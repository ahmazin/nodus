/**
 * Regenerate golden baselines.
 *
 *   pnpm tsx scripts/golden/generate.ts
 *
 * Renders every fixture and writes scripts/golden/baseline/<name>.png. Run this
 * only when a rendering change is intentional; commit the resulting PNGs and
 * review them like any other diff. CI never runs this — it runs compare.ts.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES } from './fixtures';
import { renderFixture } from './render';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = join(HERE, 'baseline');

function main(): void {
  mkdirSync(BASELINE_DIR, { recursive: true });
  console.log(`Generating ${FIXTURES.length} golden baselines -> ${BASELINE_DIR}`);
  for (const fixture of FIXTURES) {
    const { png, width, height } = renderFixture(fixture);
    const file = join(BASELINE_DIR, `${fixture.name}.png`);
    writeFileSync(file, png);
    console.log(`  wrote ${fixture.name}.png  (${width}x${height}, ${png.length} bytes)`);
  }
  console.log('Done. Review and commit the PNGs.');
}

main();
