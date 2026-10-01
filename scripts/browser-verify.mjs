/**
 * Live browser verification of the interactive editor. Launches headless Chromium against the
 * running Vite dev server, drives real DOM events (create, drag, rename, undo, auto-layout), and
 * asserts the editor's state responded correctly. Screenshots land in examples/output.
 */
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const URL = 'http://localhost:5188/';
const OUT = join(process.cwd(), 'examples', 'output');

// Let playwright-core resolve the Chromium revision it manages (from its bundled browsers.json),
// so a playwright-core version bump never strands this script on a hard-coded stale revision. The
// CI browser-e2e job runs `playwright-core ... install chromium`, which fetches that exact revision.

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
  const browser = await chromium.launch({ headless: true });
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

  // C1/F2: useNodusEditor must survive StrictMode's dev mount→unmount→remount — a LIVE editor, not a
  // disposed one, is what `window.__editor` ends up pointing at.
  assert(
    await page.evaluate(() => window.__editor.disposed === false),
    'editor is live after StrictMode remount (useNodusEditor)',
  );

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
  assert(
    await page.evaluate(() => {
      const ed = window.__editor;
      const ns = ed.store.nodes();
      const n = ns[ns.length - 1];
      return ed.sceneIndex.hitTest({ x: n.x + n.w / 2, y: n.y + n.h / 2 }, 5 / ed.camera.z)?.id === n.id;
    }),
    'the newly created node hit-tests on a live editor',
  );

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

  console.log('7) flow authoring (panel + scale + metric) ...');
  // give the tall Properties+Flow panel room so every control is on-screen for interaction
  await page.setViewportSize({ width: 1280, height: 1200 });
  const edgeId = await page.evaluate(() => {
    const ed = window.__editor;
    const e = ed.store.edges()[0];
    ed.setFlow([e.id], null); // ensure a clean starting state
    ed.select([e.id]);
    return e.id;
  });
  await page.waitForSelector('[data-testid="flow-animate"]', { timeout: 5000 });

  // Animate on → edge gains a dots flow spec
  await page.getByTestId('flow-animate').check();
  let flow = await page.evaluate((id) => window.__editor.store.peek(id).flow, edgeId);
  assert(!!flow && flow.style === 'dots', 'Animate on adds a dots flow spec');

  // the preview strip animates (a keyframe animation is active) under default motion
  const animName = await page.evaluate(() => {
    const el = document.querySelector('.nodus-flow-anim');
    return el ? getComputedStyle(el).animationName : null;
  });
  assert(!!animName && animName !== 'none', `preview strip animates (animation-name=${animName})`);

  // Style → dash
  await page.getByTestId('flow-style').selectOption('dash');
  flow = await page.evaluate((id) => window.__editor.store.peek(id).flow, edgeId);
  assert(flow.style === 'dash', 'Style select sets flow.style=dash');

  // Reverse toggle, then undo reverts it in one step
  await page.getByTestId('flow-reverse').check();
  flow = await page.evaluate((id) => window.__editor.store.peek(id).flow, edgeId);
  assert(flow.reverse === true, 'Reverse sets flow.reverse=true');
  await page.evaluate(() => window.__editor.undo());
  flow = await page.evaluate((id) => window.__editor.store.peek(id).flow, edgeId);
  assert(!flow.reverse, 'undo reverts reverse in one step');

  // Advanced disclosure → data-driven → a 3-stop scale
  await page.getByTestId('flow-advanced-toggle').click();
  await page.waitForTimeout(250); // let the grid-rows disclosure settle
  await page.getByTestId('flow-datadriven').check();
  flow = await page.evaluate((id) => window.__editor.store.peek(id).flow, edgeId);
  assert(!!flow.scale && Array.isArray(flow.scale.colors) && flow.scale.colors.length === 3, 'Data-driven sets a 3-stop scale');

  // Gradient toggle
  await page.getByTestId('flow-gradient').check();
  flow = await page.evaluate((id) => window.__editor.store.peek(id).flow, edgeId);
  assert(flow.scale.gradient === true, 'Gradient toggles flow.scale.gradient');

  // Add a color stop
  await page.getByTestId('flow-stop-add').click();
  flow = await page.evaluate((id) => window.__editor.store.peek(id).flow, edgeId);
  assert(flow.scale.colors.length === 4, 'Add stop appends a color stop');

  // Undo granularity: a field edit (blur suppressed) + a ramp-handle drag are TWO undo entries
  const dMin = await page.evaluate((id) => window.__editor.store.peek(id).flow.scale.domain[0], edgeId);
  await page.getByTestId('flow-domain-min').fill(String(dMin + 5)); // opens a 'later' group, keeps focus (no blur)
  const hb = await page.getByTestId('flow-ramp-handle-1').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 60, hb.y + hb.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  await page.evaluate(() => window.__editor.undo());
  const afterU1 = await page.evaluate((id) => window.__editor.store.peek(id).flow.scale.domain[0], edgeId);
  assert(afterU1 === dMin + 5, 'undo reverts only the ramp drag, leaving the prior field edit (separate undo entries)');
  await page.evaluate(() => window.__editor.undo());
  const afterU2 = await page.evaluate((id) => window.__editor.store.peek(id).flow.scale.domain[0], edgeId);
  assert(afterU2 === dMin, 'a second undo reverts the field edit');

  // Metric scrubber → ephemeral flowMetric reflects it (React-controlled range input)
  await page.getByTestId('flow-metric').evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '42');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const metric = await page.evaluate((id) => window.__editor.flowMetric(id), edgeId);
  assert(metric === 42, `Metric scrubber drives ephemeral flowMetric (=${metric})`);

  // Clear via setFlow(null)
  await page.evaluate((id) => window.__editor.setFlow([id], null), edgeId);
  flow = await page.evaluate((id) => window.__editor.store.peek(id).flow, edgeId);
  assert(!flow, 'setFlow(null) clears flow');

  // Right-click the edge → the context-menu flow quick-toggles
  const edgePt = await page.evaluate((id) => {
    const ed = window.__editor;
    ed.zoomToFit(60); // ensure the edge is in view and clear of the panels
    const item = ed.sceneIndex.getItem(id);
    const route = item && item.route ? item.route : null;
    const pt = route && route.length ? route[Math.floor(route.length / 2)] : null;
    const cam = ed.cameraAtom.peek();
    const r = document.querySelector('canvas').getBoundingClientRect();
    return pt ? { x: r.left + (pt.x - cam.x) * cam.z, y: r.top + (pt.y - cam.y) * cam.z } : null;
  }, edgeId);
  await page.mouse.click(edgePt.x, edgePt.y, { button: 'right' });
  await page.waitForTimeout(150);
  const sawFlowOn = await page.getByText('Flow: on', { exact: true }).count();
  assert(sawFlowOn === 1, 'right-click edge shows "Flow: on"');
  await page.getByText('Flow: on', { exact: true }).click();
  flow = await page.evaluate((id) => window.__editor.store.peek(id).flow, edgeId);
  assert(!!flow, 'context-menu "Flow: on" enables flow');
  // re-open: now the on-state items appear; toggle reverse
  await page.mouse.click(edgePt.x, edgePt.y, { button: 'right' });
  await page.waitForTimeout(150);
  const sawReverse = await page.getByText('Flow: reverse', { exact: true }).count();
  assert(sawReverse === 1, 'right-click edge (flow on) shows "Flow: reverse"');
  await page.getByText('Flow: reverse', { exact: true }).click();
  flow = await page.evaluate((id) => window.__editor.store.peek(id).flow, edgeId);
  assert(flow.reverse === true, 'context-menu "Flow: reverse" toggles reverse');
  await page.evaluate((id) => { const ed = window.__editor; ed.setFlow([id], null); ed.select([id]); }, edgeId);

  // prefers-reduced-motion → the preview animation is disabled (static frame)
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByTestId('flow-animate').check();
  const reducedAnim = await page.evaluate(() => {
    const el = document.querySelector('.nodus-flow-anim');
    return el ? getComputedStyle(el).animationName : null;
  });
  assert(reducedAnim === 'none', `reduced-motion freezes the preview (animation-name=${reducedAnim})`);
  await page.emulateMedia({ reducedMotion: null });
  await page.screenshot({ path: join(OUT, 'browser-3-flow.png') });

  console.log('8) cloud icon picker: open, search, drag onto canvas ...');
  const beforeCloud = (await snap(page)).nodes;
  // The cloud/stencil palettes live in the right panel's always-available "Insert" tab now.
  await page.click('[data-testid="tab-insert"]');
  await page.click('[data-testid="cloud-picker-button"]');
  await page.fill('[data-testid="cloud-picker-search"]', 'lambda');
  await page.waitForTimeout(120);
  const tile = await page.locator('[data-testid="cloud-tile-aws:lambda"]').boundingBox();
  // pick the MAIN editing canvas, not a 46x46 tile-preview canvas inside the open popover: the
  // editing canvas is by far the largest-area <canvas> on the page (popover previews and the
  // minimap are tiny by comparison).
  const cRect = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    const c = cs.reduce((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height > ra.width * ra.height ? b : a;
    });
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  // an off-center drop point: if the component mistakenly fell back to the CLICK path
  // (placeAtCenter, which places at the viewport center), the placed node would land far from
  // this point, so the third assertion below would catch it.
  const dropX = cRect.x + cRect.w * 0.3;
  const dropY = cRect.y + cRect.h * 0.72;
  await page.mouse.move(tile.x + tile.width / 2, tile.y + tile.height / 2);
  await page.mouse.down();
  await page.mouse.move(dropX, dropY, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const afterCloud = await snap(page);
  assert(afterCloud.nodes === beforeCloud + 1, 'dragging a cloud icon adds one node');
  const placed = await page.evaluate(() => {
    const n = window.__editor.store.nodes();
    const last = n[n.length - 1];
    return { icon: last?.props?.icon, label: last?.label };
  });
  assert(placed.icon === 'aws:lambda', 'placed node carries the dragged icon (aws:lambda)');
  assert(placed.label === 'lambda', 'placed node is labeled with its service name (lambda)');
  // prove the DRAG branch actually ran (placeAtClient -> screenToWorld -> canvas-registry),
  // not the click fallback (placeAtCenter): the placed node's center should equal the drop
  // point converted to world space, which is clearly different from the viewport center.
  const dragCheck = await page.evaluate(
    ([dx, dy, left, top]) => {
      const ed = window.__editor;
      const expected = ed.screenToWorld({ x: dx - left, y: dy - top });
      const ns = ed.store.nodes();
      const n = ns[ns.length - 1];
      return { dx: n.x + n.w / 2 - expected.x, dy: n.y + n.h / 2 - expected.y };
    },
    [dropX, dropY, cRect.x, cRect.y],
  );
  assert(
    Math.abs(dragCheck.dx) < 6 && Math.abs(dragCheck.dy) < 6,
    `dragged node landed at the drop point (drag path, not click fallback) (dx=${dragCheck.dx.toFixed(1)}, dy=${dragCheck.dy.toFixed(1)})`,
  );
  await page.screenshot({ path: join(OUT, 'browser-4-cloud.png') });

  console.log('8b) cloud icon picker: click (no drag) places at viewport center ...');
  // the popover auto-closes on outside pointerdown / after the previous drop; reopen it and
  // re-search so the aws:lambda tile is present again.
  const panelOpen = await page.locator('[data-testid="cloud-picker-panel"]').count();
  if (!panelOpen) {
    await page.click('[data-testid="cloud-picker-button"]');
    await page.fill('[data-testid="cloud-picker-search"]', 'lambda');
    await page.waitForTimeout(120);
  }
  const beforeClick = (await snap(page)).nodes;
  const clickTile = await page.locator('[data-testid="cloud-tile-aws:lambda"]').boundingBox();
  const cx = clickTile.x + clickTile.width / 2;
  const cy = clickTile.y + clickTile.height / 2;
  // move + down + up at the SAME point (no movement past DRAG_THRESHOLD) -> click branch (placeAtCenter)
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
  const afterClick = await snap(page);
  assert(afterClick.nodes === beforeClick + 1, 'clicking (no drag) a cloud icon adds one node');
  const clickCheck = await page.evaluate(() => {
    const ed = window.__editor;
    const vp = ed.worldViewport();
    const expected = { x: vp.x + vp.w / 2, y: vp.y + vp.h / 2 };
    const ns = ed.store.nodes();
    const n = ns[ns.length - 1];
    return {
      icon: n?.props?.icon,
      dx: n.x + n.w / 2 - expected.x,
      dy: n.y + n.h / 2 - expected.y,
    };
  });
  assert(clickCheck.icon === 'aws:lambda', 'clicked node carries the clicked icon (aws:lambda)');
  assert(
    Math.abs(clickCheck.dx) < 2 && Math.abs(clickCheck.dy) < 2,
    `clicked node landed at the viewport center (placeAtCenter, not drag path) (dx=${clickCheck.dx.toFixed(1)}, dy=${clickCheck.dy.toFixed(1)})`,
  );

  console.log('8c) cloud icon picker: provider chips filter + live counts ...');
  // popover is still open from 8b; clear the search so the chips show full totals
  await page.fill('[data-testid="cloud-picker-search"]', '');
  await page.waitForTimeout(100);
  const chipNum = (p) =>
    page.evaluate(
      (sel) => Number((document.querySelector(sel)?.textContent || '').replace(/\D/g, '')),
      `[data-testid="cloud-chip-${p}"]`,
    );
  const awsFull = await chipNum('aws');
  assert(awsFull === 36, `AWS chip shows its service count (${awsFull} === 36)`);
  await page.click('[data-testid="cloud-chip-aws"]');
  await page.waitForTimeout(120);
  const grid = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('[data-testid^="cloud-tile-"]')];
    return {
      count: tiles.length,
      allAws: tiles.length > 0 && tiles.every((t) => (t.getAttribute('data-testid') || '').startsWith('cloud-tile-aws:')),
    };
  });
  assert(grid.count === 36 && grid.allAws, `AWS chip filters the grid to 36 AWS-only tiles (got ${grid.count})`);
  // counts are query-aware: narrowing the search lowers the chip number
  await page.fill('[data-testid="cloud-picker-search"]', 'database');
  await page.waitForTimeout(120);
  const awsDb = await chipNum('aws');
  assert(awsDb > 0 && awsDb < awsFull, `chip counts are query-aware (AWS 'database' ${awsDb} < ${awsFull})`);

  console.log('8d) cloud icon picker: empty state, clear button, Enter-to-add ...');
  await page.fill('[data-testid="cloud-picker-search"]', 'zzzzz');
  await page.waitForTimeout(100);
  assert(
    await page.locator('[data-testid="cloud-picker-empty"]').isVisible(),
    'a no-match search shows the empty state (not a blank grid)',
  );
  await page.click('[data-testid="cloud-picker-clear"]');
  await page.waitForTimeout(80);
  assert((await page.inputValue('[data-testid="cloud-picker-search"]')) === '', 'the clear button empties the search');
  await page.fill('[data-testid="cloud-picker-search"]', 'lambda');
  await page.waitForTimeout(100);
  const beforeEnter = (await snap(page)).nodes;
  await page.focus('[data-testid="cloud-picker-search"]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  assert((await snap(page)).nodes === beforeEnter + 1, 'pressing Enter adds the top match as a node');
  const enterIcon = await page.evaluate(() => {
    const n = window.__editor.store.nodes();
    return n[n.length - 1]?.props?.icon;
  });
  assert(enterIcon === 'aws:lambda', 'Enter-added node is the top match (aws:lambda)');

  console.log('8e) cloud icon picker: arrow-key grid navigation ...');
  await page.fill('[data-testid="cloud-picker-search"]', '');
  await page.click('[data-testid="cloud-chip-all"]');
  await page.waitForTimeout(80);
  await page.focus('[data-testid="cloud-picker-search"]');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(80);
  const nav = await page.evaluate(() => {
    const clean = (el) => el?.getAttribute('data-testid')?.replace('cloud-tile-', '') ?? null;
    return {
      active: clean(document.querySelector('[role="option"][aria-selected="true"]')),
      top: clean(document.querySelector('[data-idx="0"]')),
    };
  });
  assert(nav.active && nav.active !== nav.top, `arrow keys move the cursor off the top match (active=${nav.active}, top=${nav.top})`);
  const beforeNav = (await snap(page)).nodes;
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  const navPlaced = await page.evaluate(() => {
    const n = window.__editor.store.nodes();
    return { count: n.length, icon: n[n.length - 1]?.props?.icon };
  });
  assert(
    navPlaced.count === beforeNav + 1 && navPlaced.icon === nav.active,
    `Enter places the highlighted tile (${navPlaced.icon}), not the top match`,
  );

  console.log('8f) cloud icon picker: recent strip ...');
  await page.fill('[data-testid="cloud-picker-search"]', ''); // recents show only when the search is empty
  await page.waitForTimeout(80);
  assert(
    await page.locator('[data-testid="cloud-recent-aws:ebs"]').isVisible(),
    'a recently placed icon (aws:ebs) appears in the Recent strip',
  );
  const beforeRecent = (await snap(page)).nodes;
  await page.locator('[data-testid="cloud-recent-aws:ebs"]').click();
  await page.waitForTimeout(120);
  assert((await snap(page)).nodes === beforeRecent + 1, 'clicking a recent re-places it as a node');

  // ---------------------------------------------------------------------------------------------
  // PRR wave E2 — keyboard / a11y / touch (these drive the LIVE app; the double-undo fix lives in
  // the example lane, the host wiring in @nodus-dev/react). All fail on the pre-remediation tree.
  // ---------------------------------------------------------------------------------------------

  console.log('8g) keyboard: one Ctrl/Cmd+Z undoes exactly ONE action (no double undo) ...');
  await page.evaluate(() => {
    const ed = window.__editor;
    const id = ed.store.nodes()[0].id;
    ed.select([id]);
    // two DIFFERENT undoable actions → two distinct history entries
    window.__t = { id, x0: ed.store.peek(id).x };
    ed.nudge([id], 10, 0);
    ed.setStyle([id], { stroke: '#123456' });
  });
  await page.locator('[role="application"]').first().focus();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(90);
  {
    const undoX = await page.evaluate(() => window.__editor.store.peek(window.__t.id).x);
    const x0 = await page.evaluate(() => window.__t.x0);
    // one undo pops only the setStyle → x stays x0+10. A double-undo would also pop the nudge → x0.
    assert(undoX === x0 + 10, `one Ctrl+Z undoes exactly one action (x=${undoX}, expected ${x0 + 10})`);
  }

  console.log('8h) a11y: Escape moves focus out of the canvas (WCAG 2.1.2, no keyboard trap) ...');
  await page.evaluate(() => window.__editor.select([]));
  await page.locator('[role="application"]').first().focus();
  assert(
    await page.evaluate(() => document.activeElement?.getAttribute('role') === 'application'),
    'canvas host holds focus after focus()',
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  assert(
    await page.evaluate(() => document.activeElement?.getAttribute('role') !== 'application'),
    'Escape with nothing selected moves focus out of the canvas',
  );

  console.log('8i) a11y: aria-live region announces the selection ...');
  assert(
    await page.evaluate(() => !!document.querySelector('[data-testid="nodus-selection-live"][aria-live="polite"]')),
    'aria-live selection region is present',
  );
  await page.evaluate(() => { const ed = window.__editor; ed.select([ed.store.nodes()[0].id]); });
  await page.waitForTimeout(60);
  {
    const liveText = await page.evaluate(
      () => document.querySelector('[data-testid="nodus-selection-live"]').textContent || '',
    );
    assert(/ of \d+/.test(liveText) && liveText.trim().length > 0, `aria-live announces the selection ("${liveText}")`);
  }

  console.log('8j) edge-label editor is finitely positioned (no NaN) ...');
  // Trigger via a REAL double-click on the edge's route midpoint — the faithful user path for editing
  // an edge label. (A programmatic beginEdit() sets the atom but does not wake the example's
  // idle-parked render loop, so EditOverlay never re-renders; a real pointer interaction does.)
  {
    const at = await page.evaluate(() => {
      const ed = window.__editor;
      ed.zoomToFit(60);
      ed.cancelEdit();
      const e = ed.store.edges()[0];
      const route = ed.sceneIndex.getItem(e.id)?.route ?? [];
      const a = route[0];
      const b = route[route.length - 1] ?? a;
      const cam = ed.cameraAtom.peek();
      const r = document.querySelector('[role="application"]').getBoundingClientRect();
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return { sx: r.left + (mid.x - cam.x) * cam.z, sy: r.top + (mid.y - cam.y) * cam.z };
    });
    await page.mouse.dblclick(at.sx, at.sy);
  }
  await page.waitForTimeout(80);
  {
    const box = await page.evaluate(() => {
      const ta = document.querySelector('[role="application"] textarea');
      if (!ta) return null;
      const cs = getComputedStyle(ta);
      const r = ta.getBoundingClientRect();
      return { left: parseFloat(cs.left), top: parseFloat(cs.top), w: r.width, h: r.height };
    });
    assert(
      box && [box.left, box.top, box.w, box.h].every(Number.isFinite) && box.w > 0 && box.h > 0,
      `edge-label editor is finitely positioned (${box ? JSON.stringify(box) : 'no textarea'})`,
    );
  }
  await page.evaluate(() => window.__editor.cancelEdit());

  console.log('8k) touch: two-finger pinch zooms the camera + gestures do not drag a node ...');
  {
    // Isolated touch-enabled page so the mouse scenarios above are untouched. Real multi-touch is
    // driven via CDP (playwright-core's touchscreen is single-touch only).
    const tp = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2, hasTouch: true });
    const tErrors = [];
    tp.on('console', (m) => { if (m.type() === 'error') tErrors.push(m.text()); });
    tp.on('pageerror', (e) => tErrors.push(String(e)));
    await tp.goto(URL, { waitUntil: 'networkidle' });
    await tp.waitForFunction(() => !!window.__editor, { timeout: 10000 });
    await tp.waitForTimeout(200);
    const cdp = await tp.context().newCDPSession(tp);
    const biggestCanvas = () =>
      tp.evaluate(() => {
        const c = [...document.querySelectorAll('canvas')].reduce((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return rb.width * rb.height > ra.width * ra.height ? b : a;
        });
        const r = c.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      });
    const cr = await biggestCanvas();
    const cx = cr.x + cr.w / 2;
    const cy = cr.y + cr.h / 2;

    // (a) pinch-zoom about the canvas center
    const z0 = await tp.evaluate(() => window.__editor.cameraAtom.peek().z);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 40, y: cy, id: 0 }, { x: cx + 40, y: cy, id: 1 }] });
    for (let i = 1; i <= 6; i++) {
      const s = 40 + i * 25;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - s, y: cy, id: 0 }, { x: cx + s, y: cy, id: 1 }] });
      await tp.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await tp.waitForTimeout(80);
    const z1 = await tp.evaluate(() => window.__editor.cameraAtom.peek().z);
    assert(z1 > z0 * 1.2, `two-finger pinch increases camera.z (${z0.toFixed(3)} → ${z1.toFixed(3)})`);

    // (b) gesture isolation: a pinch starting on a node must not drag it
    const n0 = await tp.evaluate(() => { const ed = window.__editor; ed.zoomToFit(60); const n = ed.store.nodes()[0]; return { id: n.id, x: n.x, y: n.y }; });
    const nc = await tp.evaluate((id) => {
      const ed = window.__editor;
      const it = ed.sceneIndex.getItem(id);
      const cam = ed.cameraAtom.peek();
      const c = [...document.querySelectorAll('canvas')].reduce((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return rb.width * rb.height > ra.width * ra.height ? b : a;
      });
      const r = c.getBoundingClientRect();
      const a = it.aabb;
      return { x: r.left + (a.x + a.w / 2 - cam.x) * cam.z, y: r.top + (a.y + a.h / 2 - cam.y) * cam.z };
    }, n0.id);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: nc.x, y: nc.y, id: 0 }] });
    await tp.waitForTimeout(16);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: nc.x, y: nc.y, id: 0 }, { x: nc.x + 60, y: nc.y, id: 1 }] });
    for (let i = 1; i <= 5; i++) {
      const s = i * 20;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: nc.x - s, y: nc.y, id: 0 }, { x: nc.x + 60 + s, y: nc.y, id: 1 }] });
      await tp.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await tp.waitForTimeout(80);
    const nAfter = await tp.evaluate((id) => { const n = window.__editor.store.peek(id); return { x: n.x, y: n.y }; }, n0.id);
    assert(
      Math.abs(nAfter.x - n0.x) < 0.5 && Math.abs(nAfter.y - n0.y) < 0.5,
      `a two-finger pinch starting on a node does not drag it (Δ=${(nAfter.x - n0.x).toFixed(2)},${(nAfter.y - n0.y).toFixed(2)})`,
    );
    assert(tErrors.length === 0, `no console/page errors on the touch page (saw ${tErrors.length})`);
    await tp.close();
  }

  // ---------------------------------------------------------------------------------------------
  // PRR wave E3 — accessibility verification (A11Y-VERIFY lane). Runs axe-core (the bundled build,
  // injected from node_modules — zero-network, no CDN, CSP-safe) against the shell chrome, plus a
  // keyboard smoke proving Tab reaches the canvas selection and Escape is not a focus trap
  // (WCAG 2.1.2 — the E2 keyboard-trap fix). Kept AFTER the touch block and BEFORE the twin-harness
  // navigation so the main app page is still loaded.
  // ---------------------------------------------------------------------------------------------

  console.log('8l) a11y: axe-core reports no serious/critical violations in the shell chrome ...');
  {
    // Reload to a pristine shell — 8g–8k mutated the model heavily; axe should audit the clean UI.
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__editor, { timeout: 10000 });
    await page.waitForTimeout(300);
    // Inject the bundled axe source read from node_modules (no network — CSP/offline safe). Dynamic
    // import of node:fs keeps this section fully self-contained.
    const { readFileSync } = await import('node:fs');
    const axeSource = readFileSync(join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
    await page.addScriptTag({ content: axeSource });
    assert(await page.evaluate(() => typeof window.axe?.run === 'function'), 'axe-core injected into the page');
    // Audit the whole document but EXCLUDE the <canvas> — its pixels are opaque to axe and would
    // only yield meaningless color-contrast noise. Report every violation for triage, but fail the
    // gate only on serious/critical, which is the shell-chrome accessibility bar.
    const axeResult = await page.evaluate(async () => {
      const res = await window.axe.run(
        { exclude: [['canvas']] },
        {
          resultTypes: ['violations'],
          // rules that cannot meaningfully apply to a single-page canvas editor / are harness noise
          rules: { region: { enabled: false }, 'page-has-heading-one': { enabled: false } },
        },
      );
      return res.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      }));
    });
    const serious = axeResult.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    if (serious.length) {
      console.error('     axe serious/critical violations:');
      for (const v of serious) console.error(`       [${v.impact}] ${v.id}: ${v.help} — e.g. ${v.nodes.join(', ')}`);
    } else if (axeResult.length) {
      // minor/moderate findings are surfaced for triage but do NOT fail the gate
      console.log(`     (axe: ${axeResult.length} minor/moderate finding(s), not gating)`);
    }
    assert(serious.length === 0, `axe-core: 0 serious/critical violations in the shell chrome (found ${serious.length})`);
    await page.screenshot({ path: join(OUT, 'verify-a11y.png') });
  }

  console.log('8m) a11y: keyboard reaches the canvas and Escape is not a focus trap ...');
  {
    await page.evaluate(() => window.__editor.select([]));
    // Tab traversal must move focus INTO the canvas host (role=application) ...
    await page.locator('[role="application"]').first().focus();
    assert(
      await page.evaluate(() => document.activeElement?.getAttribute('role') === 'application'),
      'keyboard focus lands on the canvas host (role=application)',
    );
    // ... and Tab THROUGH the canvas cycles the selection via the reading-order traversal.
    await page.keyboard.press('Tab');
    await page.waitForTimeout(60);
    const sel1 = await page.evaluate(() => window.__editor.selectedIdsArray().length);
    assert(sel1 === 1, `Tab inside the canvas selects a node (selection size=${sel1})`);
    const firstId = await page.evaluate(() => window.__editor.selectedIdsArray()[0]);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(60);
    const secondId = await page.evaluate(() => window.__editor.selectedIdsArray()[0]);
    assert(!!secondId && secondId !== firstId, 'a second Tab advances the selection to the next node');
    // The aria-live region must exist and announce the current selection for screen readers.
    assert(
      await page.evaluate(() => !!document.querySelector('[data-testid="nodus-selection-live"][aria-live="polite"]')),
      'aria-live selection region exists',
    );
    {
      const liveText = await page.evaluate(
        () => document.querySelector('[data-testid="nodus-selection-live"]').textContent || '',
      );
      assert(/ of \d+/.test(liveText), `aria-live announces the Tab selection ("${liveText.trim()}")`);
    }
    // WCAG 2.1.2 — Escape must be able to move focus OUT of the canvas (the E2 keyboard-trap fix).
    // First Escape clears the (Tab-built) selection; a second, now-empty Escape blurs the host.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(40);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
    assert(
      await page.evaluate(() => document.activeElement?.getAttribute('role') !== 'application'),
      'Escape (nothing selected) moves focus OUT of the canvas host — no keyboard trap',
    );
  }

  console.log('9b) keyboard-scope isolation (twin harness, keyboardScope="host") ...');
  await page.goto(URL + '?harness=twin', { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__editorA && window.__editorB && !window.__editorA.disposed && !window.__editorB.disposed,
    { timeout: 10000 },
  );
  await page.waitForTimeout(300);
  const twin = () =>
    page.evaluate(() => ({ a: window.__editorA.store.nodes().length, b: window.__editorB.store.nodes().length }));
  let tw = await twin();
  assert(tw.a === 1 && tw.b === 1, `twin harness: A and B each start live with 1 node (a=${tw.a}, b=${tw.b})`);
  await page.locator('.twin-host-a').focus();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(120);
  tw = await twin();
  assert(tw.a === 0 && tw.b === 1, `Delete with A focused removes A's node only (a=${tw.a}, b=${tw.b})`);
  const bId = await page.evaluate(() => window.__editorB.store.nodes()[0].id);
  const bx0 = await page.evaluate((id) => window.__editorB.store.peek(id).x, bId);
  await page.evaluate((id) => window.__editorB.nudge([id], 25, 0), bId);
  assert(
    await page.evaluate((a) => window.__editorB.store.peek(a.id).x === a.x0 + 25, { id: bId, x0: bx0 }),
    'B node nudged (an undoable action for B)',
  );
  await page.locator('.twin-host-b').focus();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(120);
  assert(
    await page.evaluate((a) => window.__editorB.store.peek(a.id).x === a.x0, { id: bId, x0: bx0 }),
    'Ctrl/Cmd+Z with B focused undoes B',
  );
  tw = await twin();
  assert(tw.a === 0, "A is unaffected by B's undo (still 0 nodes)");
  const beforeInput = await twin();
  await page.locator('[data-testid="plain-input"]').focus();
  await page.keyboard.type(' world');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
  const afterInput = await twin();
  assert(
    afterInput.a === beforeInput.a && afterInput.b === beforeInput.b,
    'typing/Backspace/undo in a plain input leaves both diagrams unchanged',
  );

  console.log('9) console error check ...');
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
