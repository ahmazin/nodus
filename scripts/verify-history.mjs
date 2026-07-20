/**
 * Live browser verification of the version-history timeline (BranchBar → Save version / History).
 * Save a version, make a further edit, then open History, view the diff of that version vs current,
 * and restore it — asserting the document reverts. Zero console errors expected.
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
const labels = (page) => page.evaluate(() => window.__editor.store.nodes().map((n) => n.label));
const addNode = (page, label) =>
  page.evaluate((l) => window.__editor.createNode({ type: 'infra.service', x: 120 + Math.round(Math.abs(Math.sin(l.length)) * 200), y: 120, w: 120, h: 60, label: l }), label);

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
  await page.waitForTimeout(400); // let the deferred baseline capture settle
  await page.evaluate(() => window.__editor.loadSnapshot({ schemaVersion: 1, document: { records: [] } }));

  console.log('1) save a version at state {Alpha} ...');
  await addNode(page, 'Alpha');
  await page.waitForTimeout(80);
  await page.getByTestId('save-version').click();
  await page.waitForTimeout(120);

  console.log('2) make a further edit → state {Alpha, Beta} ...');
  await addNode(page, 'Beta');
  await page.waitForTimeout(80);
  const before = await labels(page);
  assert(before.includes('Alpha') && before.includes('Beta'), `current doc has Alpha + Beta (${before.join(', ')})`);

  console.log('3) open History → the saved version is listed ...');
  await page.getByTestId('review-history').click();
  await page.waitForSelector('[data-testid=history-modal]', { timeout: 4000 });
  const rows = await page.getByTestId('history-row').count();
  assert(rows >= 1, `history lists the saved version (${rows} row(s))`);

  console.log('4) view its diff vs current → shows Beta added ...');
  await page.getByTestId('history-row').first().getByTestId('history-view').click();
  await page.waitForTimeout(150);
  const diffRows = await page.getByTestId('diff-row').count();
  const addRows = await page.locator('[data-testid=diff-row][data-kind=add]').count();
  assert(diffRows > 0 && addRows > 0, `unified diff renders with added lines (rows ${diffRows}, adds ${addRows})`);

  console.log('5) restore the version → document reverts to {Alpha} ...');
  await page.getByTestId('history-restore').first().click();
  await page.waitForTimeout(250);
  const after = await labels(page);
  assert(after.includes('Alpha'), 'restored doc still has Alpha');
  assert(!after.includes('Beta'), 'restored doc dropped the later Beta edit');

  console.log('6) console error check ...');
  assert(errors.length === 0, `no console/page errors (saw ${errors.length})`);
  if (errors.length) errors.slice(0, 6).forEach((e) => console.error('     •', e));

  await browser.close();
  console.log('');
  if (failures) { console.error(`HISTORY VERIFY: ${failures} FAILURE(S)`); process.exit(1); }
  console.log('HISTORY VERIFY: ALL PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
