/**
 * Golden-image check — render live and pixel-diff against committed baselines.
 *
 *   pnpm tsx scripts/golden/compare.ts
 *
 * Exit 0 when every fixture is within threshold; exit 1 on any mismatch, a
 * missing baseline, or a dimension change. On a mismatch it writes
 * scripts/golden/diff/<name>.diff.png (a highlighted diff) and
 * scripts/golden/diff/<name>.actual.png (the live render) for inspection.
 *
 * Thresholds:
 *   PIXELMATCH_THRESHOLD  per-pixel color tolerance passed to pixelmatch (0..1).
 *   MAX_DIFF_RATIO        fraction of differing pixels tolerated per image.
 * Both are deliberately small — fixtures are fixed-coordinate, so a correct
 * engine should produce byte-identical output on the same toolchain. The small
 * ratio only absorbs sub-pixel antialiasing jitter across canvas builds.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { FIXTURES } from './fixtures';
import { renderFixture } from './render';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = join(HERE, 'baseline');
const DIFF_DIR = join(HERE, 'diff');

const PIXELMATCH_THRESHOLD = 0.1;
const MAX_DIFF_RATIO = 0.001; // 0.1% of pixels

interface Result {
  name: string;
  ok: boolean;
  reason?: string;
  diffPixels?: number;
  totalPixels?: number;
}

function checkFixture(fixtureName: string): Result {
  const fixture = FIXTURES.find((f) => f.name === fixtureName)!;
  const baselinePath = join(BASELINE_DIR, `${fixture.name}.png`);

  if (!existsSync(baselinePath)) {
    return {
      name: fixture.name,
      ok: false,
      reason: `no baseline at ${baselinePath} — run: pnpm tsx scripts/golden/generate.ts`,
    };
  }

  const baseline = PNG.sync.read(readFileSync(baselinePath));
  const actualPng = renderFixture(fixture).png;
  const actual = PNG.sync.read(actualPng);

  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    mkdirSync(DIFF_DIR, { recursive: true });
    writeFileSync(join(DIFF_DIR, `${fixture.name}.actual.png`), actualPng);
    return {
      name: fixture.name,
      ok: false,
      reason: `dimension mismatch: baseline ${baseline.width}x${baseline.height} vs actual ${actual.width}x${actual.height}`,
    };
  }

  const { width, height } = baseline;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(baseline.data, actual.data, diff.data, width, height, {
    threshold: PIXELMATCH_THRESHOLD,
  });
  const totalPixels = width * height;
  const ratio = diffPixels / totalPixels;

  if (ratio > MAX_DIFF_RATIO) {
    mkdirSync(DIFF_DIR, { recursive: true });
    writeFileSync(join(DIFF_DIR, `${fixture.name}.diff.png`), PNG.sync.write(diff));
    writeFileSync(join(DIFF_DIR, `${fixture.name}.actual.png`), actualPng);
    return {
      name: fixture.name,
      ok: false,
      reason: `${diffPixels}/${totalPixels} px differ (${(ratio * 100).toFixed(4)}% > ${(MAX_DIFF_RATIO * 100).toFixed(4)}%)`,
      diffPixels,
      totalPixels,
    };
  }

  return { name: fixture.name, ok: true, diffPixels, totalPixels };
}

function main(): void {
  // Clear stale diff artifacts from a prior failing run so output is unambiguous.
  rmSync(DIFF_DIR, { recursive: true, force: true });

  console.log(`Comparing ${FIXTURES.length} fixtures against ${BASELINE_DIR}`);
  const results = FIXTURES.map((f) => checkFixture(f.name));
  let failed = 0;
  for (const r of results) {
    if (r.ok) {
      console.log(`  PASS  ${r.name}  (${r.diffPixels ?? 0}/${r.totalPixels ?? 0} px)`);
    } else {
      failed++;
      console.error(`  FAIL  ${r.name}  ${r.reason}`);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed}/${results.length} golden fixtures failed. See ${DIFF_DIR}/ for diffs.`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${results.length} golden fixtures match.`);
  }
}

main();
