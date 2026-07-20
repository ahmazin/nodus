/**
 * Live browser verification of the git-native features added on top of the Playground:
 *   1. Text↔canvas round-trip (the editable Source tab / <CodePanel>)
 *   2. PR-review flow (the ⎇ main <BranchBar> chip + unified-diff <ReviewModal>)
 *
 * Drives the running Vite dev server (http://localhost:5188) with headless Chromium, exercising the
 * real DOM (textarea edits, tab switches, modal buttons) and asserting `window.__editor` state
 * responded correctly. Mirrors scripts/browser-verify.mjs conventions. Screenshots → examples/output.
 *
 * Run with the dev server already up:
 *   pnpm --filter nodus-example-browser exec vite --host 127.0.0.1 --port 5188 &
 *   node scripts/verify-git-native.mjs
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';

const URL = 'http://localhost:5188/';
const OUT = join(process.cwd(), 'examples', 'output');
const DEBOUNCE = 500; // CodePanel debounces parse at ~300ms; wait comfortably past it.

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
      labels: ed.store.nodes().map((n) => n.label),
    };
  });

async function main() {
  const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 820 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  console.log('0) fresh load (cleared storage → baseline == seed) ...');
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__editor, { timeout: 10000 });
  await page.waitForTimeout(400); // let the deferred baseline capture (setTimeout 0, post-restore) run
  const seed = await snap(page);
  assert(seed.nodes === 10 && seed.edges === 10, `seed model loaded (${seed.nodes} nodes, ${seed.edges} edges)`);

  // ============================ PR-REVIEW FLOW ============================
  console.log('1) branch bar: clean working tree shows no +/- pill ...');
  assert((await page.getByTestId('branch-chip').count()) === 1, 'branch chip (⎇ main) is present');
  assert((await page.getByTestId('review-pill').count()) === 0, 'no diff pill while working tree == main');

  console.log('2) an edit makes the branch dirty (pill appears) ...');
  await page.evaluate(() => {
    const ed = window.__editor;
    ed.createNode({ type: 'infra.service', x: 120, y: 120, w: 120, h: 60, label: 'ReviewProbe' });
  });
  await page.waitForTimeout(150);
  assert((await page.getByTestId('review-pill').count()) === 1, 'diff pill appears after a canvas edit');
  const pillText = (await page.getByTestId('review-pill').textContent())?.trim() ?? '';
  assert(/\+\s*\d/.test(pillText), `pill shows additions (got "${pillText}")`);

  console.log('3) review modal opens with a unified diff ...');
  await page.getByTestId('review-open').click();
  await page.waitForSelector('[data-testid=review-modal]', { timeout: 4000 });
  assert(true, 'review modal opened');
  const rows = await page.getByTestId('diff-row').count();
  assert(rows > 0, `unified diff rendered rows (${rows})`);
  const addRows = await page.locator('[data-testid=diff-row][data-kind=add]').count();
  assert(addRows > 0, `at least one added (green) line present (${addRows})`);
  await page.screenshot({ path: join(OUT, 'verify-git-review-modal.png') });

  console.log('4) Approve & merge adopts the working tree as the new main ...');
  await page.getByTestId('review-merge').click();
  await page.waitForTimeout(200);
  assert((await page.getByTestId('review-modal').count()) === 0, 'modal closed after merge');
  assert((await page.getByTestId('review-pill').count()) === 0, 'pill cleared — working tree now equals main');
  const merged = await snap(page);
  assert(merged.nodes === seed.nodes + 1, `merged baseline retains the added node (${merged.nodes})`);

  console.log('5) Discard (two-step confirm) reverts the working tree to main ...');
  await page.evaluate(() => {
    const ed = window.__editor;
    ed.createNode({ type: 'infra.service', x: 300, y: 300, w: 120, h: 60, label: 'ToBeDiscarded' });
  });
  await page.waitForTimeout(150);
  assert((await page.getByTestId('review-pill').count()) === 1, 'pill re-appears after a new edit');
  await page.getByTestId('review-open').click();
  await page.waitForSelector('[data-testid=review-modal]');
  await page.getByTestId('review-discard').click(); // arms "Confirm discard"
  await page.waitForTimeout(100);
  await page.getByTestId('review-discard').click(); // confirms
  await page.waitForTimeout(250);
  const afterDiscard = await snap(page);
  assert(afterDiscard.nodes === merged.nodes, `discard reverted to main (${afterDiscard.nodes} == ${merged.nodes})`);
  assert(!afterDiscard.labels.includes('ToBeDiscarded'), 'the discarded node is gone');
  assert((await page.getByTestId('review-pill').count()) === 0, 'pill cleared after discard');

  // ============================ TEXT↔CANVAS ROUND-TRIP ============================
  console.log('6) Source tab shows a live, synced editor ...');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.waitForSelector('[data-testid=code-panel]', { timeout: 4000 });
  assert((await page.getByTestId('code-textarea').count()) === 1, 'editable source textarea present');
  const status0 = (await page.getByTestId('code-status').textContent())?.trim() ?? '';
  assert(/synced/i.test(status0), `status starts "Synced" (got "${status0}")`);

  console.log('7) invalid JSON → parse error, canvas untouched ...');
  const beforeBad = await snap(page);
  await page.fill('[data-testid=code-textarea]', '{ this is not valid json');
  await page.waitForTimeout(DEBOUNCE);
  const statusBad = (await page.getByTestId('code-status').textContent())?.trim() ?? '';
  assert(/error/i.test(statusBad), `status shows a parse error (got "${statusBad}")`);
  const afterBad = await snap(page);
  assert(afterBad.nodes === beforeBad.nodes && afterBad.edges === beforeBad.edges, 'canvas unchanged while JSON is invalid');
  await page.screenshot({ path: join(OUT, 'verify-git-source-error.png') });

  console.log('8) valid JSON edit → canvas rebuilds ...');
  const modified = await page.evaluate(() => {
    const ed = window.__editor;
    const s = ed.toJSON();
    const node = s.document.records.find((r) => typeof r.label === 'string');
    node.label = 'RoundTripOK';
    return JSON.stringify(s, null, 2);
  });
  await page.fill('[data-testid=code-textarea]', modified);
  await page.waitForTimeout(DEBOUNCE);
  const statusGood = (await page.getByTestId('code-status').textContent())?.trim() ?? '';
  assert(/synced/i.test(statusGood), `status back to "Synced" after a valid edit (got "${statusGood}")`);
  const afterGood = await snap(page);
  assert(afterGood.labels.includes('RoundTripOK'), 'typing JSON renamed a node on the canvas (text → canvas)');

  console.log('9) canvas edit flows back into the source text ...');
  // blur the textarea so the canvas→text effect is allowed to regenerate the draft
  await page.getByTestId('code-status').click();
  const newId = await page.evaluate(() => {
    const ed = window.__editor;
    const id = ed.createNode({ type: 'infra.service', x: 500, y: 60, w: 120, h: 60, label: 'FromCanvas' });
    return typeof id === 'string' ? id : (ed.store.nodes().find((n) => n.label === 'FromCanvas')?.id ?? '');
  });
  await page.waitForTimeout(300);
  const text = await page.inputValue('[data-testid=code-textarea]');
  assert(text.includes('FromCanvas'), 'a node created on the canvas appears in the source text (canvas → text)');
  assert(newId === '' || text.includes(newId), 'source text reflects the new record id');
  await page.screenshot({ path: join(OUT, 'verify-git-source-synced.png') });

  console.log('10) console error check ...');
  assert(errors.length === 0, `no console/page errors (saw ${errors.length})`);
  if (errors.length) errors.slice(0, 5).forEach((e) => console.error('     •', e));

  await browser.close();
  console.log('');
  if (failures) {
    console.error(`GIT-NATIVE VERIFY: ${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log('GIT-NATIVE VERIFY: ALL PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
