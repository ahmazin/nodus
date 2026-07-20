/**
 * Live browser verification of the Layers/Outline panel:
 *   - tree lists the scene; clicking a row selects on canvas (tree → canvas sync)
 *   - hide removes the node from the canvas (not hit-testable) but keeps it in the tree/document
 *   - lock, z-reorder (up), and inline rename all drive the engine
 * Drives the running Vite dev server. Zero console errors expected. Screenshot → examples/output.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';

const URL = 'http://localhost:5188/';
const OUT = join(process.cwd(), 'examples', 'output');

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

  console.log('0) fresh load → open Layers tab ...');
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__editor, { timeout: 10000 });
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.waitForSelector('[data-testid=layers-panel]', { timeout: 4000 });
  const rows = page.locator('[data-testid=layer-row]');
  const rowCount = await rows.count();
  assert(rowCount > 0, `layers tree lists the scene (${rowCount} rows)`);
  await page.screenshot({ path: join(OUT, 'verify-layers-panel.png') });

  const ids = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
  const nodeIds = ids.filter((id) => id && id.startsWith('node:'));
  assert(nodeIds.length >= 3, `tree has node rows (${nodeIds.length})`);
  const A = nodeIds[0];              // select + hide + lock
  const B = nodeIds[nodeIds.length - 1]; // back-most → reorder up definitely moves it
  const C = nodeIds[1];              // rename
  const rowOf = (id) => page.locator(`[data-testid=layer-row][data-id="${id}"]`).first();

  console.log('1) tree → canvas selection sync ...');
  await rowOf(A).locator('span[title]').first().click();   // click the label, not the row center (avoids the action buttons)
  await page.waitForTimeout(100);
  const selected = await page.evaluate(() => window.__editor.selectedIdsArray());
  assert(selected.includes(A), 'clicking a layer row selects that node on the canvas');

  console.log('2) hide removes the node from the canvas but not the document ...');
  await rowOf(A).locator('[data-testid=layer-visibility]').click();
  await page.waitForTimeout(120);
  const hideInfo = await page.evaluate((id) => {
    const ed = window.__editor;
    const n = ed.store.peek(id);
    const p = { x: n.x + n.w / 2, y: n.y + n.h / 2 };
    const hit = ed.sceneIndex.hitTest(p, 5 / ed.cameraAtom.peek().z);
    return { hidden: ed.isHidden(id), stillInStore: !!ed.store.peek(id), hitId: hit && hit.record ? hit.record.id : null };
  }, A);
  assert(hideInfo.hidden === true, 'node is marked hidden');
  assert(hideInfo.stillInStore === true, 'hidden node still exists in the document (tree keeps it)');
  assert(hideInfo.hitId !== A, 'hidden node is no longer hit-testable on the canvas');
  await page.screenshot({ path: join(OUT, 'verify-layers-hidden.png') });

  console.log('3) lock ...');
  await rowOf(A).locator('[data-testid=layer-lock]').click();
  await page.waitForTimeout(100);
  const locked = await page.evaluate((id) => window.__editor.isLocked(id), A);
  assert(locked === true, 'lock toggled the node locked');

  console.log('4) z-reorder (bring forward) ...');
  const zBefore = await page.evaluate((id) => window.__editor.store.peek(id).z, B);
  await rowOf(B).locator('[data-testid=layer-up]').click();
  await page.waitForTimeout(120);
  const zAfter = await page.evaluate((id) => window.__editor.store.peek(id).z, B);
  assert(zAfter !== zBefore, `bring-forward changed the back-most node's z (${zBefore} → ${zAfter})`);

  console.log('5) inline rename ...');
  await rowOf(C).locator('span[title]').first().dblclick();
  await page.waitForTimeout(100);
  const input = page.locator('input[aria-label="Rename layer"]');
  assert((await input.count()) === 1, 'double-click opened the rename input');
  await input.fill('LayerRenamed');
  await input.press('Enter');
  await page.waitForTimeout(120);
  const label = await page.evaluate((id) => window.__editor.store.peek(id).label, C);
  assert(label === 'LayerRenamed', `inline rename updated the node label (got "${label}")`);

  console.log('6) console error check ...');
  assert(errors.length === 0, `no console/page errors (saw ${errors.length})`);
  if (errors.length) errors.slice(0, 6).forEach((e) => console.error('     •', e));

  await browser.close();
  console.log('');
  if (failures) { console.error(`LAYERS VERIFY: ${failures} FAILURE(S)`); process.exit(1); }
  console.log('LAYERS VERIFY: ALL PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
