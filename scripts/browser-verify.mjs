/**
 * Live browser verification of the interactive editor. Launches headless Chromium against the
 * running Vite dev server, drives real DOM events (create, drag, rename, undo, auto-layout), and
 * asserts the editor's state responded correctly. Screenshots land in examples/output.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';

const URL = 'http://127.0.0.1:5188/';
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
  else {
    console.error(`   ✗ ${msg}`);
    failures++;
  }
}

const snap = (page) =>
  page.evaluate(() => {
    const ed = window.__editor;
    return {
      nodes: ed.store.nodes().length,
      edges: ed.store.edges().length,
      selected: ed.selectedAtom.peek().size,
      canUndo: ed.history.canUndo(),
      labels: ed.store.nodes().map((n) => n.label),
    };
  });

async function main() {
  const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  console.log('1) load app ...');
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__editor, { timeout: 10000 });
  await page.waitForTimeout(300);
  const initial = await snap(page);
  console.log(`   initial: ${initial.nodes} nodes, ${initial.edges} edges`);
  assert(initial.nodes === 10 && initial.edges === 10, 'sample model loaded (10 nodes, 10 edges)');
  await page.screenshot({ path: join(OUT, 'browser-1-initial.png') });

  // canvas geometry helper: world -> client pixel
  const worldToClient = async (wx, wy) =>
    page.evaluate(
      ([x, y]) => {
        const ed = window.__editor;
        const cam = ed.cameraAtom.peek();
        const canvas = document.querySelector('canvas');
        const r = canvas.getBoundingClientRect();
        return { x: r.left + (x - cam.x) * cam.z, y: r.top + (y - cam.y) * cam.z };
      },
      [wx, wy],
    );

  console.log('2) create a node with the Create tool ...');
  await page.getByTestId('type-select').selectOption('cache');
  await page.getByTestId('tool-create').click();
  const spot = await worldToClient(300, 650);
  await page.mouse.click(spot.x, spot.y);
  await page.waitForTimeout(150);
  let s = await snap(page);
  assert(s.nodes === 11, 'clicking canvas created a node (11 total)');

  console.log('3) select + drag a node ...');
  await page.getByTestId('tool-select').click();
  // grab the "Redis" node (known world pos ~720,180 in sample) and drag it right/down
  const before = await page.evaluate(() => {
    const ed = window.__editor;
    const n = ed.store.nodes().find((x) => x.label === 'Redis');
    return n ? { id: n.id, x: n.x, y: n.y, w: n.w, h: n.h } : null;
  });
  assert(!!before, 'found the Redis node');
  const from = await worldToClient(before.x + before.w / 2, before.y + before.h / 2);
  const to = { x: from.x + 120, y: from.y + 80 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 20, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const after = await page.evaluate((id) => {
    const n = window.__editor.store.peek(id);
    return { x: n.x, y: n.y };
  }, before.id);
  assert(Math.abs(after.x - before.x) > 40 && Math.abs(after.y - before.y) > 20, 'drag moved the node');

  console.log('4) single undo reverts the whole drag ...');
  await page.evaluate(() => window.__editor.undo());
  await page.waitForTimeout(100);
  const reverted = await page.evaluate((id) => {
    const n = window.__editor.store.peek(id);
    return { x: n.x, y: n.y };
  }, before.id);
  assert(Math.abs(reverted.x - before.x) < 0.01 && Math.abs(reverted.y - before.y) < 0.01, 'undo restored original position');

  console.log('5) rename a node via double-click overlay ...');
  const rc = await worldToClient(before.x + before.w / 2, before.y + before.h / 2);
  await page.mouse.dblclick(rc.x, rc.y);
  await page.waitForTimeout(120);
  const hasTextarea = await page.evaluate(() => !!document.querySelector('textarea'));
  assert(hasTextarea, 'double-click opened the inline text editor');
  if (hasTextarea) {
    await page.fill('textarea', 'Valkey');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
    const renamed = await page.evaluate((id) => window.__editor.store.peek(id).label, before.id);
    assert(renamed === 'Valkey', 'committing the editor renamed the node');
  }

  console.log('6) auto-layout repositions nodes ...');
  const posBefore = await page.evaluate(() => {
    const n = window.__editor.store.nodes()[0];
    return { id: n.id, x: n.x, y: n.y };
  });
  await page.getByTestId('layout').click();
  await page.waitForTimeout(400);
  const posAfter = await page.evaluate((id) => {
    const n = window.__editor.store.peek(id);
    return { x: n.x, y: n.y };
  }, posBefore.id);
  assert(posAfter.x !== posBefore.x || posAfter.y !== posBefore.y, 'auto-layout moved nodes');
  await page.screenshot({ path: join(OUT, 'browser-2-edited.png') });

  console.log('7) console error check ...');
  assert(errors.length === 0, `no console/page errors (saw ${errors.length})`);
  if (errors.length) errors.slice(0, 5).forEach((e) => console.error('     ', e));

  await browser.close();
  console.log(failures === 0 ? '\nBROWSER VERIFY: ALL PASS' : `\nBROWSER VERIFY: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
