/**
 * Live browser verification of drift detection ("Sync from infra source"). Drives the Sync modal to
 * (1) import a Terraform v1 source (empty diagram → all "added"), apply it, then (2) paste a v2 source
 * that adds one resource, removes one, and renames one → asserts the "N resources changed" report is
 * correct, the removed resource is ghosted on the canvas (state:'ghost'), and Apply reconciles the
 * diagram (removed gone, added present, renamed updated) in one step. Zero console errors expected.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';

const URL = 'http://localhost:5188/';
const OUT = join(process.cwd(), 'examples', 'output');

// terraform show -json shape: { values: { root_module: { resources: [ { address, type, name } ] } } }
const tf = (resources) => JSON.stringify({ values: { root_module: { resources } } });
const V1 = tf([
  { address: 'aws_lb.web', type: 'aws_lb', name: 'web' },
  { address: 'aws_instance.api', type: 'aws_instance', name: 'api' },
  { address: 'aws_db_instance.main', type: 'aws_db_instance', name: 'main' },
]);
const V2 = tf([
  { address: 'aws_lb.web', type: 'aws_lb', name: 'web' }, // unchanged
  { address: 'aws_instance.api', type: 'aws_instance', name: 'api-v2' }, // changed (renamed)
  { address: 'aws_elasticache_cluster.cache', type: 'aws_elasticache_cluster', name: 'cache' }, // added
  // aws_db_instance.main removed
]);

function findChromium() {
  const base = join(homedir(), '.cache', 'ms-playwright');
  for (const rev of ['chromium-1228', 'chromium-1208']) {
    const p = join(base, rev, 'chrome-linux64', 'chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('No chromium found in playwright cache');
}

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`   ✓ ${msg}`);
  else { console.error(`   ✗ ${msg}`); failures++; }
}
const labels = (page) => page.evaluate(() => window.__editor.store.nodes().map((n) => n.label));
const openSync = async (page) => {
  await page.getByTestId('scene-sync').click();
  await page.waitForSelector('[data-testid=sync-modal]', { timeout: 4000 });
};

async function main() {
  const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 820 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  console.log('0) fresh load → empty doc ...');
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__editor, { timeout: 10000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__editor.loadSnapshot({ schemaVersion: 1, document: { records: [] } }));

  console.log('1) import v1 via Sync (empty → 3 added) ...');
  await openSync(page);
  await page.fill('[data-testid=sync-input]', V1);
  await page.getByTestId('sync-check').click();
  await page.waitForTimeout(150);
  const h1 = (await page.getByTestId('sync-headline').textContent()) ?? '';
  assert(/3 resources changed/.test(h1), `v1 drift headline reads 3 changed (got "${h1}")`);
  await page.getByTestId('sync-apply').click();
  await page.waitForTimeout(200);
  const after1 = await labels(page);
  assert(after1.length === 3, `v1 applied → 3 nodes (${after1.length})`);
  assert(['web', 'api', 'main'].every((l) => after1.includes(l)), `v1 nodes present (${after1.join(', ')})`);

  console.log('2) paste v2 → drift report (+1 −1 ~1) + ghost preview ...');
  await openSync(page);
  await page.fill('[data-testid=sync-input]', V2);
  await page.getByTestId('sync-check').click();
  await page.waitForTimeout(150);
  const h2 = (await page.getByTestId('sync-headline').textContent()) ?? '';
  assert(/3 resources changed/.test(h2), `v2 drift headline reads 3 changed (got "${h2}")`);
  const report = (await page.getByTestId('sync-report').innerText()) ?? '';
  assert(/added\s*·\s*1/i.test(report) && /removed\s*·\s*1/i.test(report) && /changed\s*·\s*1/i.test(report),
    'report lists 1 added, 1 removed, 1 changed');
  const ghost = await page.evaluate(() => {
    const n = window.__editor.store.nodes().find((x) => x.label === 'main');
    return n && n.visual ? n.visual.state : null;
  });
  assert(ghost === 'ghost', `the removed resource ("main") is ghosted on the canvas during preview (state=${ghost})`);
  await page.screenshot({ path: join(OUT, 'verify-drift-report.png') });

  console.log('3) apply → diagram reconciled to the new source ...');
  await page.getByTestId('sync-apply').click();
  await page.waitForTimeout(250);
  const after2 = await labels(page);
  assert(after2.length === 3, `still 3 nodes after re-sync (${after2.length})`);
  assert(!after2.includes('main'), 'removed resource ("main") is gone');
  assert(after2.includes('cache'), 'added resource ("cache") is present');
  assert(after2.includes('api-v2') && !after2.includes('api'), 'renamed resource updated (api → api-v2)');

  console.log('4) console error check ...');
  assert(errors.length === 0, `no console/page errors (saw ${errors.length})`);
  if (errors.length) errors.slice(0, 6).forEach((e) => console.error('     •', e));

  await browser.close();
  console.log('');
  if (failures) { console.error(`DRIFT VERIFY: ${failures} FAILURE(S)`); process.exit(1); }
  console.log('DRIFT VERIFY: ALL PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
