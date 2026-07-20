/**
 * Live browser verification of Wave 3:
 *   - keyboard node traversal (canvas focusable; Tab / Shift+Tab cycle the selection through nodes)
 *   - command palette fuzzy match (a subsequence query that is NOT a substring still finds the command)
 *   - command palette recents (running a command surfaces it first on reopen)
 * Drives the running Vite dev server. Zero console errors expected.
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
const selInfo = (page) => page.evaluate(() => {
  const ids = window.__editor.selectedIdsArray();
  return { size: ids.length, first: ids[0] ?? null };
});
const openPalette = async (page) => {
  await page.evaluate(() => window.dispatchEvent(new Event('nodus:open-command-palette')));
  await page.getByRole('dialog', { name: 'Command palette' }).waitFor({ state: 'visible', timeout: 3000 });
  await page.waitForTimeout(100);
};
const paletteOptions = (page) => page.getByRole('dialog', { name: 'Command palette' }).getByRole('option');
const paletteInput = (page) => page.getByRole('combobox', { name: 'Search commands' });

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

  console.log('1) keyboard node traversal (Tab / Shift+Tab) ...');
  await page.evaluate(() => {
    window.__editor.setTool('select');
    window.__editor.clearSelection();
    const el = document.querySelector('[role="application"]');
    if (el) el.focus();
  });
  await page.waitForTimeout(60);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(80);
  const s1 = await selInfo(page);
  assert(s1.size === 1, `Tab selected a single node (size ${s1.size})`);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(80);
  const s2 = await selInfo(page);
  assert(s2.size === 1 && s2.first && s2.first !== s1.first, 'a second Tab advanced to a different node');
  await page.keyboard.press('Shift+Tab');
  await page.waitForTimeout(80);
  const s3 = await selInfo(page);
  assert(s3.size === 1 && s3.first === s1.first, 'Shift+Tab moved the selection back');

  console.log('2) command palette fuzzy match (subsequence, not substring) ...');
  await openPalette(page);
  await paletteInput(page).fill('');
  await page.waitForTimeout(120);
  const titles = (await paletteOptions(page).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  assert(titles.length > 0, `palette shows commands (${titles.length})`);
  console.log('   • sample labels:', JSON.stringify(titles.slice(0, 5)));
  // pick a command with >=4 letters; build a gapped subsequence (letters 0,2,3) — guaranteed NOT a substring
  let fuzzyChecked = false;
  for (const t of titles) {
    const letters = (t.match(/[A-Za-z]/g) || []).join('');
    if (letters.length < 4) continue;
    const q = (letters[0] + letters[2] + letters[3]).toLowerCase();     // skips letter[1] → a gap
    if (letters.toLowerCase().includes(q)) continue;                    // ensure it's not a substring
    await paletteInput(page).fill(q);
    await page.waitForTimeout(150);
    const after = (await paletteOptions(page).allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
    assert(after.includes(t), `fuzzy query "${q}" (subsequence, not substring) still finds "${t}"`);
    fuzzyChecked = true;
    break;
  }
  if (!fuzzyChecked) console.log(`   • (skipped fuzzy: no ≥4-letter command among ${titles.length})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);

  console.log('3) command palette recents (run a command → it surfaces first) ...');
  await openPalette(page);
  await paletteInput(page).fill('');
  await page.waitForTimeout(120);
  const before = (await paletteOptions(page).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  const target = before[1] ?? before[0];
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');   // run the 2nd command
  await page.waitForTimeout(250);
  await openPalette(page);
  await paletteInput(page).fill('');
  await page.waitForTimeout(120);
  const firstAfter = (await paletteOptions(page).first().innerText()).replace(/\s+/g, ' ').trim();
  assert(firstAfter === target, `recently-run "${target}" is now first on reopen (got "${firstAfter}")`);
  await page.keyboard.press('Escape');

  console.log('4) console error check ...');
  assert(errors.length === 0, `no console/page errors (saw ${errors.length})`);
  if (errors.length) errors.slice(0, 6).forEach((e) => console.error('     •', e));

  await browser.close();
  console.log('');
  if (failures) { console.error(`WAVE3 VERIFY: ${failures} FAILURE(S)`); process.exit(1); }
  console.log('WAVE3 VERIFY: ALL PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
