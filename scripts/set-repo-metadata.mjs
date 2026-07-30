// Stamps repository/homepage/bugs across every packages/*/package.json from one constant.
// Fill in the real repo URL below and rerun: node scripts/set-repo-metadata.mjs
// verify-dist warns (and will eventually fail) while the OWNER placeholder remains.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_URL = 'https://github.com/ahmazin/nodus';

const pkgsDir = new URL('../packages', import.meta.url).pathname;
let changed = 0;
for (const name of readdirSync(pkgsDir)) {
  const file = join(pkgsDir, name, 'package.json');
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const next = {
    repository: { type: 'git', url: `git+${REPO_URL}.git`, directory: `packages/${name}` },
    homepage: `${REPO_URL}/tree/main/packages/${name}#readme`,
    bugs: { url: `${REPO_URL}/issues` },
  };
  const before = JSON.stringify([pkg.repository, pkg.homepage, pkg.bugs]);
  Object.assign(pkg, next);
  if (JSON.stringify([pkg.repository, pkg.homepage, pkg.bugs]) !== before) {
    writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
    changed++;
  }
}
console.log(`repo metadata stamped on ${changed} package(s) (url base: ${REPO_URL})`);
if (REPO_URL.includes('OWNER')) {
  console.warn('WARNING: REPO_URL still contains the OWNER placeholder — edit scripts/set-repo-metadata.mjs with the real URL and rerun.');
}
