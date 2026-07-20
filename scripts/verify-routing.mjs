/**
 * Live browser verification of obstacle-avoiding orthogonal routing.
 * Before/after proof: an orthogonal edge routed straight through empty space starts crossing a node's
 * box once that node is dropped in its path — after avoidance, no route segment passes through the box.
 * Drives the running Vite dev server. Zero console errors expected. Screenshot → examples/output.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';

const URL = 'http://localhost:5188/';
const OUT = join(process.cwd(), 'examples', 'output');
const OBSTACLE = { x: 320, y: 300, w: 100, h: 100 };

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

// does any consecutive segment of the polyline pass through the box interior? (sampled, robust)
function routeHitsBox(route, box) {
  const inside = (x, y) => x > box.x + 0.5 && x < box.x + box.w - 0.5 && y > box.y + 0.5 && y < box.y + box.h - 0.5;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    for (let s = 0; s <= 40; s++) {
      const t = s / 40;
      if (inside(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return true;
    }
  }
  return false;
}
const axisAligned = (route) => route.every((p, i) => i === 0 || Math.abs(p.x - route[i - 1].x) < 1e-6 || Math.abs(p.y - route[i - 1].y) < 1e-6);

async function main() {
  const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 820 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  console.log('0) fresh load → build two orthogonally-connected nodes in a line ...');
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__editor, { timeout: 10000 });
  await page.waitForTimeout(300);
  const ids = await page.evaluate(() => {
    const ed = window.__editor;
    ed.loadSnapshot({ schemaVersion: 1, document: { records: [] } });  // isolate: drop the seed diagram so only our test nodes exist
    const a = ed.createNode({ type: 'infra.service', x: 100, y: 300, w: 100, h: 60, label: 'RouteA' });
    const b = ed.createNode({ type: 'infra.service', x: 600, y: 300, w: 100, h: 60, label: 'RouteB' });
    const eid = ed.connect({ kind: 'node', nodeId: a, portId: 'out' }, { kind: 'node', nodeId: b, portId: 'in' });
    ed.setEdgeRouter(eid, 'orthogonal');
    return { a, b, e: eid };
  });
  await page.waitForTimeout(120);
  const before = await page.evaluate((eid) => window.__editor.sceneIndex.getItem(eid)?.route ?? [], ids.e);
  assert(before.length >= 2, `edge routed (${before.length} points)`);
  assert(routeHitsBox(before, OBSTACLE), 'without an obstacle, the straight orthogonal route passes through the target box region');

  console.log('1) drop a node directly in the edge’s path ...');
  await page.evaluate((o) => { window.__editor.createNode({ type: 'infra.db', x: o.x, y: o.y, w: o.w, h: o.h, label: 'Obstacle' }); }, OBSTACLE);
  // Edges recompute when an endpoint moves (the common case: dragging a node reflows its edges around
  // obstacles). Nudge B to trigger the edge rebuild so avoidance runs with the obstacle present.
  await page.evaluate((b) => window.__editor.updateNode(b, { x: 601 }), ids.b);
  await page.waitForTimeout(150);
  const after = await page.evaluate((eid) => window.__editor.sceneIndex.getItem(eid)?.route ?? [], ids.e);

  console.log('2) the edge now routes AROUND it ...');
  assert(!routeHitsBox(after, OBSTACLE), 'after avoidance, NO route segment passes through the obstacle box');
  assert(axisAligned(after), 'the avoidance route is fully axis-aligned (orthogonal invariant preserved)');
  assert(after.length > before.length, `the route detoured (gained bend points: ${before.length} → ${after.length})`);
  await page.screenshot({ path: join(OUT, 'verify-routing-avoid.png') });

  console.log('3) console error check ...');
  assert(errors.length === 0, `no console/page errors (saw ${errors.length})`);
  if (errors.length) errors.slice(0, 6).forEach((x) => console.error('     •', x));

  await browser.close();
  console.log('');
  if (failures) { console.error(`ROUTING VERIFY: ${failures} FAILURE(S)`); process.exit(1); }
  console.log('ROUTING VERIFY: ALL PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
