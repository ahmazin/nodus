// Copies the root LICENSE into every package dir so npm ships it with each tarball
// (npm auto-includes LICENSE* regardless of the files field). icons-cloud keeps its
// own curated LICENSE/NOTICE set and is skipped. Run: node scripts/sync-license.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const license = readFileSync(join(root, 'LICENSE'), 'utf8');
const SKIP = new Set(['icons-cloud']);
let n = 0;
for (const name of readdirSync(join(root, 'packages'))) {
  if (SKIP.has(name)) continue;
  const dir = join(root, 'packages', name);
  if (!existsSync(join(dir, 'package.json'))) continue;
  const target = join(dir, 'LICENSE');
  if (!existsSync(target) || readFileSync(target, 'utf8') !== license) {
    writeFileSync(target, license);
    n++;
  }
}
console.log(`LICENSE synced into ${n} package(s)`);
