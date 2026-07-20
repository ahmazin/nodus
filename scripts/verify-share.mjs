/**
 * Live browser verification of the share-link feature: copy a share URL from the Export menu, then
 * open it in a FRESH browser context (empty localStorage) and confirm the diagram is reconstructed
 * purely from the `#scene=` hash — proving loadSceneFromLocation, not autosave, did the restore.
 * Also checks Copy-SVG-to-clipboard. Zero console errors expected.
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
  const errors = [];
  const watch = (p, tag) => {
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`); });
    p.on('pageerror', (e) => errors.push(`[${tag}] ${String(e)}`));
  };

  // --- author context: create a node, copy a share link from the Export menu ---
  const ctx = await browser.newContext({
    viewport: { width: 1360, height: 820 }, deviceScaleFactor: 2,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();
  watch(page, 'author');

  console.log('0) author: fresh load + a distinctive edit ...');
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__editor, { timeout: 10000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__editor.createNode({ type: 'infra.service', x: 180, y: 420, w: 120, h: 60, label: 'ShareProbe' }));

  console.log('1) copy a share link from the Export menu ...');
  await page.getByRole('button', { name: /Export/ }).click();
  await page.getByRole('button', { name: /Copy share link/ }).click();
  await page.waitForTimeout(200);
  const shareUrl = await page.evaluate(() => navigator.clipboard.readText());
  assert(typeof shareUrl === 'string' && shareUrl.includes('#scene='), `share URL copied with #scene= (${(shareUrl || '').slice(0, 48)}…)`);

  console.log('2) copy SVG to clipboard ...');
  await page.getByRole('button', { name: /Export/ }).click();
  await page.getByRole('button', { name: /Copy SVG/ }).click();
  await page.waitForTimeout(200);
  const svg = await page.evaluate(() => navigator.clipboard.readText());
  assert(typeof svg === 'string' && svg.includes('<svg'), 'Copy SVG placed SVG markup on the clipboard');

  console.log('3) open the link in a FRESH context (no localStorage) → scene restored from #scene ...');
  const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 820 }, deviceScaleFactor: 2 });
  const page2 = await ctx2.newPage();
  watch(page2, 'viewer');
  await page2.goto(shareUrl, { waitUntil: 'networkidle' });
  await page2.waitForFunction(() => !!window.__editor, { timeout: 10000 });
  await page2.waitForTimeout(400);
  const info = await page2.evaluate(() => {
    const ed = window.__editor;
    // read storage length BEFORE the app writes its own autosave for the freshly-loaded scene
    return { labels: ed.store.nodes().map((n) => n.label) };
  });
  assert(info.labels.includes('ShareProbe'), 'fresh load reconstructed the shared node from the URL hash (no prior storage → came from #scene)');

  console.log('4) console error check ...');
  assert(errors.length === 0, `no console/page errors (saw ${errors.length})`);
  if (errors.length) errors.slice(0, 6).forEach((e) => console.error('     •', e));

  await browser.close();
  console.log('');
  if (failures) { console.error(`SHARE VERIFY: ${failures} FAILURE(S)`); process.exit(1); }
  console.log('SHARE VERIFY: ALL PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
