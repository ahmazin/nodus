/**
 * Live browser verification of the analysis-driven import modal. Opens the Terraform import modal
 * from the Scene panel, checks it's a real code editor (line-numbered textarea), that "Format JSON"
 * prettifies, and that Import builds the diagram; then the error path (invalid JSON → inline error,
 * Import stays disabled, no crash); then a Mermaid import (non-JSON path); then the unified
 * "Import diagram…" entry auto-detecting a pasted Kubernetes YAML manifest and previewing counts +
 * a skipped kind before commit; then a Terraform PLAN producing reference-based edges. Zero console
 * errors expected throughout.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';

const URL = 'http://localhost:5188/';
const TF_COMPACT = '{"values":{"root_module":{"resources":[{"address":"aws_lb.web","type":"aws_lb","name":"web"},{"address":"aws_instance.api","type":"aws_instance","name":"api","depends_on":["aws_lb.web"]}]}}}';
const TF_PLAN = JSON.stringify({
  planned_values: { root_module: { resources: [
    { address: 'aws_subnet.main', type: 'aws_subnet', name: 'main' },
    { address: 'aws_instance.web', type: 'aws_instance', name: 'web' },
  ] } },
  configuration: { root_module: { resources: [
    { address: 'aws_subnet.main', type: 'aws_subnet', name: 'main', expressions: {} },
    { address: 'aws_instance.web', type: 'aws_instance', name: 'web', expressions: { subnet_id: { references: ['aws_subnet.main.id', 'aws_subnet.main'] } } },
  ] } },
});
const K8S_YAML = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cfg';

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
const nodeCount = (page) => page.evaluate(() => window.__editor.store.nodes().length);

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
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__editor.loadSnapshot({ schemaVersion: 1, document: { records: [] } }));

  console.log('1) Terraform import opens a real editor modal (not a prompt) ...');
  await page.getByRole('button', { name: 'Terraform', exact: true }).click();
  await page.waitForSelector('[data-testid=import-modal][data-format=terraform]', { timeout: 4000 });
  assert((await page.getByTestId('import-input').count()) === 1, 'a code textarea is present (not window.prompt)');

  console.log('2) Format JSON prettifies the pasted source ...');
  await page.fill('[data-testid=import-input]', TF_COMPACT);
  await page.getByTestId('import-format').click();
  await page.waitForTimeout(80);
  const formatted = await page.inputValue('[data-testid=import-input]');
  assert(formatted.includes('\n') && /\n\s+"values"/.test(formatted), 'the source was reformatted (indented, multi-line)');

  console.log('3) Import builds the diagram ...');
  // Import stays disabled until the debounced preview analysis resolves; Playwright's click()
  // auto-waits for the button to become enabled, so no extra sleep is needed here.
  await page.getByTestId('import-run').click();
  await page.waitForTimeout(300);
  assert((await page.getByTestId('import-modal').count()) === 0, 'modal closed after a successful import');
  assert((await nodeCount(page)) === 2, `imported 2 resources (${await nodeCount(page)})`);

  console.log('4) invalid JSON → inline error, Import stays disabled, no crash ...');
  await page.getByRole('button', { name: 'Terraform', exact: true }).click();
  await page.waitForSelector('[data-testid=import-modal]');
  await page.fill('[data-testid=import-input]', '{ this is not json');
  await page.waitForTimeout(320); // debounce
  const err = (await page.getByTestId('import-error').textContent().catch(() => '')) ?? '';
  assert(/couldn.t read that Terraform/i.test(err), `invalid input shows an inline error (got "${err.slice(0, 50)}…")`);
  assert(await page.getByTestId('import-run').isDisabled(), 'Import stays disabled while the preview shows a parser error');
  await page.getByTestId('import-modal').getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(100);

  console.log('5) Mermaid import (non-JSON path) ...');
  await page.evaluate(() => window.__editor.loadSnapshot({ schemaVersion: 1, document: { records: [] } }));
  await page.getByRole('button', { name: 'Mermaid', exact: true }).click();
  await page.waitForSelector('[data-testid=import-modal][data-format=mermaid]');
  await page.fill('[data-testid=import-input]', 'flowchart LR\n  A[Web] --> B[(Postgres)]\n  A --> C{Redis}');
  await page.getByTestId('import-run').click();
  await page.waitForTimeout(500);
  assert((await nodeCount(page)) >= 3, `Mermaid built nodes (${await nodeCount(page)})`);

  console.log('6) unified "Import diagram…" auto-detects Kubernetes YAML + previews counts ...');
  await page.evaluate(() => window.__editor.loadSnapshot({ schemaVersion: 1, document: { records: [] } }));
  await page.getByTestId('import-auto').click();
  await page.waitForSelector('[data-testid=import-modal]');
  await page.fill('[data-testid=import-input]', K8S_YAML);
  await page.waitForTimeout(320); // debounce
  assert((await page.getByTestId('import-modal').getAttribute('data-format')) === 'kubernetes', 'YAML auto-detected as kubernetes');
  const summary = (await page.getByTestId('import-summary').textContent()) ?? '';
  assert(/1\s*nodes?/i.test(summary), `preview shows 1 node (got "${summary.slice(0, 80)}")`);
  assert(/ConfigMap/.test(summary), `preview reports the skipped ConfigMap (got "${summary.slice(0, 80)}")`);
  await page.getByTestId('import-run').click();
  await page.waitForTimeout(300);
  assert((await nodeCount(page)) === 1, `imported 1 workload from YAML (${await nodeCount(page)})`);

  console.log('7) Terraform PLAN → reference-based edges ...');
  await page.evaluate(() => window.__editor.loadSnapshot({ schemaVersion: 1, document: { records: [] } }));
  await page.getByRole('button', { name: 'Terraform', exact: true }).click();
  await page.waitForSelector('[data-testid=import-modal][data-format=terraform]');
  await page.fill('[data-testid=import-input]', TF_PLAN);
  await page.getByTestId('import-run').click();
  await page.waitForTimeout(300);
  assert((await page.getByTestId('import-modal').count()) === 0, 'modal closed after the plan import');
  const edgeCount = await page.evaluate(() => window.__editor.store.edges().length);
  assert(edgeCount >= 1, `plan references produced an edge (${edgeCount})`);

  console.log('8) console error check ...');
  assert(errors.length === 0, `no console/page errors (saw ${errors.length})`);
  if (errors.length) errors.slice(0, 6).forEach((e) => console.error('     •', e));

  await browser.close();
  console.log('');
  if (failures) { console.error(`IMPORT VERIFY: ${failures} FAILURE(S)`); process.exit(1); }
  console.log('IMPORT VERIFY: ALL PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
