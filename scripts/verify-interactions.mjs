/**
 * Live browser verification of the Wave-1 interaction hardening:
 *   - group/union bounding box when >1 node is selected
 *   - drag-from-port quick-connect end-to-end (rubber-band + mid-drag target-port highlight + edge create)
 * The validation LOGIC (canConnect / isValidConnection rejection) is covered deterministically by
 * packages/core/src/tools/connect-validation.test.ts; this script confirms the visual pieces render
 * and the full pointer gesture creates an edge with zero console errors. Screenshots → examples/output.
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
const edgeCount = (page) => page.evaluate(() => window.__editor.store.edges().length);

async function main() {
  const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 820 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  console.log('0) fresh load ...');
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__editor, { timeout: 10000 });
  await page.waitForTimeout(300);

  console.log('1) group/union bounding box on multi-select ...');
  const sel = await page.evaluate(() => {
    const ed = window.__editor;
    ed.setTool('select');
    const ns = ed.store.nodes();
    ed.select([ns[2].id, ns[3].id]);
    return { size: ed.selectedAtom.peek().size, bounds: ed.selectionBounds() };
  });
  assert(sel.size === 2, 'two nodes selected');
  assert(sel.bounds && typeof sel.bounds.w === 'number' && sel.bounds.w > 0, 'selectionBounds() returns a union box');
  await page.waitForTimeout(80);
  await page.screenshot({ path: join(OUT, 'verify-interactions-groupbox.png') });

  console.log('2) drag-from-port quick-connect (rubber-band + target highlight + edge) ...');
  const geom = await page.evaluate(() => {
    const ed = window.__editor;
    ed.clearSelection();
    ed.setTool('select');
    const cam = ed.cameraAtom.peek();
    const canvas = document.querySelector('canvas');
    const r = canvas.getBoundingClientRect();
    const toClient = (wx, wy) => ({ x: r.left + (wx - cam.x) * cam.z, y: r.top + (wy - cam.y) * cam.z });
    // two distinct nodes; drag from source's right-center 'out' port to target's body (outline drop)
    const ns = ed.store.nodes().filter((n) => n.type !== 'group');
    const s = ns[0], t = ns[1];
    return {
      sOut: toClient(s.x + s.w, s.y + s.h / 2),
      tCenter: toClient(t.x + t.w / 2, t.y + t.h / 2),
      mid: toClient((s.x + s.w + t.x) / 2, (s.y + s.h / 2 + t.y + t.h / 2) / 2),
    };
  });
  const before = await edgeCount(page);
  await page.mouse.move(geom.sOut.x, geom.sOut.y);   // hover reveals port dots
  await page.waitForTimeout(80);
  await page.mouse.down();                            // grab the port
  await page.mouse.move(geom.mid.x, geom.mid.y, { steps: 8 });   // mid-drag: rubber-band + target ring
  await page.waitForTimeout(80);
  await page.screenshot({ path: join(OUT, 'verify-interactions-connect-drag.png') });
  await page.mouse.move(geom.tCenter.x, geom.tCenter.y, { steps: 8 });
  await page.mouse.up();                              // drop on target → connect
  await page.waitForTimeout(150);
  const after = await edgeCount(page);
  assert(after === before + 1, `drag-from-port created one edge (${before} → ${after})`);

  console.log('3) console error check ...');
  assert(errors.length === 0, `no console/page errors (saw ${errors.length})`);
  if (errors.length) errors.slice(0, 5).forEach((e) => console.error('     •', e));

  await browser.close();
  console.log('');
  if (failures) { console.error(`INTERACTIONS VERIFY: ${failures} FAILURE(S)`); process.exit(1); }
  console.log('INTERACTIONS VERIFY: ALL PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
