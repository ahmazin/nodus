/**
 * Live browser verification of the "Describe a diagram (AI)" feature. Uses the component's built-in
 * test seam (window.__nodusDescribeModel) to inject a canned tool_use, so the full flow — prompt →
 * recordsFromToolUse → add records → auto-layout — runs with NO network call and NO API key. Also
 * checks the no-key guard (an error, not a silent failure). Zero console errors expected.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';

const URL = 'http://localhost:5188/';

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

async function main() {
  const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 820 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  console.log('0) fresh load → empty doc, no stored key ...');
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__editor, { timeout: 10000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__editor.loadSnapshot({ schemaVersion: 1, document: { records: [] } }));

  console.log('1) open the Describe modal from the Insert tab ...');
  await page.getByTestId('tab-insert').click();
  await page.getByTestId('insert-describe').click();
  await page.waitForSelector('[data-testid=describe-modal]', { timeout: 4000 });
  assert(true, 'Describe modal opened');

  console.log('2) no key → an explicit error (not a silent failure) ...');
  await page.fill('[data-testid=describe-input]', 'A web app: a load balancer to two API services, a Postgres database and a Redis cache');
  await page.getByTestId('describe-generate').click();
  await page.waitForTimeout(150);
  const errText = (await page.getByTestId('describe-error').textContent().catch(() => '')) ?? '';
  assert(/api key/i.test(errText), `no-key attempt shows a key error (got "${errText.slice(0, 40)}…")`);

  console.log('3) inject a canned model response → generate builds the diagram ...');
  await page.evaluate(() => {
    window.__nodusDescribeModel = async () => ({
      name: 'render_diagram',
      input: {
        nodes: [
          { id: 'web', type: 'service', label: 'Web' },
          { id: 'db', type: 'db', label: 'Postgres' },
          { id: 'cache', type: 'cache', label: 'Redis' },
        ],
        edges: [
          { from: 'web', to: 'db', label: 'reads' },
          { from: 'web', to: 'cache' },
        ],
      },
    });
  });
  await page.getByTestId('describe-generate').click();
  await page.waitForTimeout(600); // mock await + recordsFromToolUse + store.apply + async layout/fit
  assert((await page.getByTestId('describe-modal').count()) === 0, 'modal closed after a successful generate');
  const snap = await page.evaluate(() => ({
    nodes: window.__editor.store.nodes().length,
    edges: window.__editor.store.edges().length,
    labels: window.__editor.store.nodes().map((n) => n.label),
  }));
  assert(snap.nodes === 3, `three nodes were created from the description (got ${snap.nodes})`);
  assert(snap.edges === 2, `two edges were created (got ${snap.edges})`);
  assert(['Web', 'Postgres', 'Redis'].every((l) => snap.labels.includes(l)), `nodes carry the described labels (${snap.labels.join(', ')})`);

  console.log('4) console error check ...');
  assert(errors.length === 0, `no console/page errors (saw ${errors.length})`);
  if (errors.length) errors.slice(0, 6).forEach((e) => console.error('     •', e));

  await browser.close();
  console.log('');
  if (failures) { console.error(`DESCRIBE VERIFY: ${failures} FAILURE(S)`); process.exit(1); }
  console.log('DESCRIBE VERIFY: ALL PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
