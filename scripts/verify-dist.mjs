/**
 * verify-dist — prove the BUILT packages are consumable by an app OUTSIDE the workspace.
 *
 * Why this exists: this repo develops "src-first". Every package's package.json points
 * `main`/`types` at its `src` index and Vite/Vitest alias every `@nodus` package to its source
 * dir, so nothing in the repo ever imports the built `dist`. `publishConfig` swaps entries to dist
 * only at publish time. That means the real external-consumer path — the dual ESM/CJS build, the
 * emitted `.d.ts`, the `exports` map, and the `workspace:*` → real-version rewrite that packing
 * performs — is completely untested by `pnpm test`. This script closes that gap:
 *
 *   1. `pnpm pack` each target package → a real npm tarball (exercises files/publishConfig and the
 *      workspace-protocol rewrite exactly as `pnpm publish` would).
 *   2. Extract the tarballs into a throwaway consumer project in os.tmpdir() (OUTSIDE the repo, so
 *      no workspace symlink can shadow the installed dist).
 *   3. Satisfy the packages' external runtime deps (rbush, @napi-rs/canvas, @dagrejs/dagre, react,
 *      react-dom) by symlinking them from the monorepo's own node_modules — no registry install, so
 *      it runs with NO network. Symlinks (to the real .pnpm dir) are used rather than copies so the
 *      native @napi-rs/canvas module still resolves its platform `.node` sibling by realpath.
 *   4. From the consumer, assert ESM import, CJS require, type-declaration presence, headless PNG
 *      render, and that preset-infra / a layout adapter / the react entry all resolve from dist.
 *
 * Prereq: `pnpm build` must have produced `dist/` in each package. Run `node scripts/verify-dist.mjs`.
 * Exits 0 only if every check passes; non-zero with a diagnostic otherwise. All temp dirs are removed
 * on exit (success or failure).
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));

// The @nodus packages we pack + install into the consumer for BEHAVIORAL checks. icons-cloud is
// private (never publishes) but stays here to exercise its multi-entry build. cli and its @nodus
// runtime deps are included so the packed bin can be executed end-to-end.
const NODUS_PACKAGES = [
  'core',
  'icons-cloud',
  'preset-infra',
  'preset-diagrams',
  'preset-draw',
  'import-infra',
  'from-mermaid',
  'layout-dagre',
  'layout-elk',
  'react',
  'cli',
  'mcp',
];

// Every publishable package (private !== true), derived from the workspace so the list can't
// drift from reality. These all get packed for the STATIC manifest assertions.
const ALL_PUBLISHABLE = readdirSync(join(ROOT, 'packages')).filter((name) => {
  const f = join(ROOT, 'packages', name, 'package.json');
  if (!existsSync(f)) return false;
  return JSON.parse(readFileSync(f, 'utf8')).private !== true;
});

// @nodus package names that must never be referenced by a published manifest (unpublishable).
const PRIVATE_NODUS = new Set(
  readdirSync(join(ROOT, 'packages'))
    .filter((name) => {
      const f = join(ROOT, 'packages', name, 'package.json');
      return existsSync(f) && JSON.parse(readFileSync(f, 'utf8')).private === true;
    })
    .map((name) => `@nodus/${name}`),
);

// Packages whose manifests may keep @nodus/core as a regular dependency: self-contained bin apps
// that PROVIDE the peer for the extension packages they bundle. Everything else must peer-depend.
const CORE_DEP_ALLOWED = new Set(['@nodus/cli', '@nodus/mcp']);

// External runtime deps the installed packages need, and where in the monorepo each is declared
// (require.resolve searches node_modules upward from these dirs). @napi-rs/canvas is a root devDep
// used by the headless render check.
const EXTERNALS = {
  rbush: ['packages/core'],
  '@napi-rs/canvas': ['.', 'packages/cli'],
  '@dagrejs/dagre': ['packages/layout-dagre'],
  react: ['packages/react'],
  'react-dom': ['packages/react'],
  gifenc: ['packages/react'],
  yaml: ['packages/import-infra'],
  elkjs: ['packages/layout-elk'],
};

// ---------------------------------------------------------------------------
// tiny console helpers
// ---------------------------------------------------------------------------
const results = []; // { name, ok, detail }
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓ PASS' : '✗ FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
function die(msg) {
  console.error(`\nverify-dist: ${msg}`);
  process.exit(1);
}

// Bounded subprocess. Returns { code, stdout, stderr }; never hangs (killed after `timeout` ms).
function run(cmd, args, opts = {}) {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: opts.cwd ?? ROOT,
      timeout: opts.timeout ?? 120_000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      code: typeof err.status === 'number' ? err.status : 1,
      stdout: err.stdout?.toString?.() ?? '',
      stderr: err.stderr?.toString?.() ?? String(err.message ?? err),
    };
  }
}

// Locate a package's real directory in the monorepo, resolving symlinks to the canonical .pnpm path
// (so a symlink we create points at the real dir and native sub-deps resolve by realpath).
function externalDir(spec, fromDirs) {
  const paths = fromDirs.map((p) => resolve(ROOT, p));
  // package.json subpath first; falls back to walking up from the main entry when `exports`
  // hides package.json (e.g. rbush).
  try {
    return realpathSync(dirname(require.resolve(`${spec}/package.json`, { paths })));
  } catch {
    /* fall through */
  }
  let dir = dirname(require.resolve(spec, { paths }));
  for (;;) {
    const pj = join(dir, 'package.json');
    if (existsSync(pj)) {
      try {
        if (JSON.parse(readFileSync(pj, 'utf8')).name === spec) return realpathSync(dir);
      } catch {
        /* ignore malformed */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`cannot locate external dependency '${spec}' in the monorepo`);
    dir = parent;
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const cleanups = [];
function cleanup() {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
}
process.on('exit', cleanup);

function main() {
  console.log('verify-dist — consuming built @nodus/* packages from outside the workspace\n');

  // 0) Precondition: dist must exist. This script verifies the build, it does not run it.
  console.log('preconditions:');
  const missing = [];
  for (const pkg of NODUS_PACKAGES) {
    const distEsm = join(ROOT, 'packages', pkg, 'dist', 'index.js');
    if (!existsSync(distEsm)) missing.push(pkg);
  }
  if (missing.length) {
    die(
      `no dist/ for: ${missing.join(', ')}.\n` +
        `Run \`pnpm build\` first, then re-run \`node scripts/verify-dist.mjs\`.`,
    );
  }
  record('build present', true, `dist/ found for ${NODUS_PACKAGES.length} packages`);

  // Workspace for tarballs + consumer, in os.tmpdir() (outside the repo tree).
  const work = mkdtempSync(join(tmpdir(), 'nodus-verify-dist-'));
  cleanups.push(work);
  const tarballsDir = join(work, 'tarballs');
  const consumer = join(work, 'consumer');
  mkdirSync(tarballsDir, { recursive: true });
  mkdirSync(join(consumer, 'node_modules', '@nodus'), { recursive: true });
  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'nodus-dist-consumer', private: true, version: '0.0.0', type: 'module' }, null, 2)}\n`,
  );

  // 1) pack each package (publishConfig swap + workspace:* rewrite happen here).
  console.log('\npack (pnpm pack — exercises publishConfig + workspace rewrite):');
  const tarballs = {};
  for (const pkg of NODUS_PACKAGES) {
    const pkgDir = join(ROOT, 'packages', pkg);
    const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    // npm tarball naming: '@nodus/core' + '0.1.0' -> 'nodus-core-0.1.0.tgz'
    const expected = `${manifest.name.replace(/^@/, '').replace(/\//g, '-')}-${manifest.version}.tgz`;
    const r = run('pnpm', ['pack', '--pack-destination', tarballsDir], { cwd: pkgDir, timeout: 120_000 });
    const tgz = join(tarballsDir, expected);
    if (r.code !== 0 || !existsSync(tgz)) {
      record(`pack ${manifest.name}`, false, r.stderr.trim().split('\n').slice(-1)[0] || 'tarball not produced');
      finish();
      return;
    }
    tarballs[pkg] = tgz;
    record(`pack ${manifest.name}`, true, expected);
  }

  // 1b) pack the REMAINING publishable packages and statically assert every packed manifest.
  //     This is the contract gate for the published dependency topology (peer ranges, no exact
  //     pins, no workspace: survivors), types resolution (require-condition .d.cts), and
  //     manifest completeness (repository/homepage/bugs/engines/exports/sideEffects).
  console.log('\nmanifest assertions (every publishable package):');
  for (const pkg of ALL_PUBLISHABLE) {
    if (tarballs[pkg]) continue;
    const pkgDir = join(ROOT, 'packages', pkg);
    const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    const expected = `${manifest.name.replace(/^@/, '').replace(/\//g, '-')}-${manifest.version}.tgz`;
    const r = run('pnpm', ['pack', '--pack-destination', tarballsDir], { cwd: pkgDir, timeout: 120_000 });
    const tgz = join(tarballsDir, expected);
    if (r.code !== 0 || !existsSync(tgz)) {
      record(`pack ${manifest.name}`, false, r.stderr.trim().split('\n').slice(-1)[0] || 'tarball not produced');
      continue;
    }
    tarballs[pkg] = tgz;
  }
  const strictRepoUrl = process.env.REPO_URL_STRICT === '1';
  for (const pkg of ALL_PUBLISHABLE) {
    if (!tarballs[pkg]) continue; // pack failure already recorded
    const mr = run('tar', ['-xzOf', tarballs[pkg], 'package/package.json'], { timeout: 30_000 });
    let m;
    try {
      m = JSON.parse(mr.stdout);
    } catch {
      record(`manifest @nodus/${pkg}`, false, 'unreadable package.json in tarball');
      continue;
    }
    const issues = [];
    const warns = [];
    if (JSON.stringify(m).includes('workspace:')) issues.push('workspace: protocol survived packing');
    for (const field of ['dependencies', 'peerDependencies']) {
      for (const [dep, spec] of Object.entries(m[field] ?? {})) {
        if (!dep.startsWith('@nodus/')) continue;
        if (/^\d/.test(spec)) issues.push(`${field}.${dep} exact-pinned '${spec}' (must be a range)`);
        if (PRIVATE_NODUS.has(dep)) issues.push(`${field}.${dep} references a private (unpublishable) package`);
      }
    }
    if (m.dependencies?.['@nodus/core'] && !CORE_DEP_ALLOWED.has(m.name)) {
      issues.push('@nodus/core must be a peerDependency for extension packages');
    }
    if (m.engines?.node == null) issues.push('missing engines.node');
    if (!m.homepage) issues.push('missing homepage');
    if (!m.bugs?.url) issues.push('missing bugs.url');
    if (m.repository?.directory !== `packages/${pkg}`) issues.push('repository.directory wrong/missing');
    if (!m.repository?.url) issues.push('missing repository.url');
    else if (m.repository.url.includes('OWNER')) {
      (strictRepoUrl ? issues : warns).push('repository.url still has the OWNER placeholder');
    }
    if (m.exports?.['./package.json'] !== './package.json') issues.push("missing './package.json' export");
    if (!('sideEffects' in m)) issues.push('missing sideEffects');
    const rootEntry = m.exports?.['.'];
    const reqTypes = rootEntry?.require?.types;
    if (typeof reqTypes !== 'string' || !reqTypes.endsWith('.d.cts')) {
      issues.push("exports['.'].require.types must reference the .d.cts declarations");
    }
    record(
      `manifest @nodus/${pkg}`,
      issues.length === 0,
      issues.join('; ') || (warns.length ? `WARN: ${warns.join('; ')}` : 'topology + completeness ok'),
    );
  }

  // 2) extract tarballs into the consumer's node_modules/@nodus/*.
  //    npm tarballs are gzipped with a top-level `package/` directory.
  console.log('\nstage consumer (offline: extract tarballs + symlink external deps):');
  for (const pkg of NODUS_PACKAGES) {
    const stageDir = mkdtempSync(join(work, `x-${pkg}-`));
    const rx = run('tar', ['-xzf', tarballs[pkg], '-C', stageDir], { timeout: 60_000 });
    const extracted = join(stageDir, 'package');
    if (rx.code !== 0 || !existsSync(extracted)) {
      record(`extract @nodus/${pkg}`, false, rx.stderr.trim() || 'tar failed');
      finish();
      return;
    }
    // `tar` cannot cross filesystems on rename; use tar's own move via cp -R-free approach: rename.
    const dest = join(consumer, 'node_modules', '@nodus', pkg);
    rmSync(dest, { recursive: true, force: true });
    execFileSync('mv', [extracted, dest]);
  }
  record('extract tarballs', true, `${NODUS_PACKAGES.length} packages into node_modules/@nodus`);

  // 3) symlink external runtime deps from the monorepo (no registry install → offline-safe).
  try {
    for (const [spec, fromDirs] of Object.entries(EXTERNALS)) {
      const real = externalDir(spec, fromDirs);
      const dest = join(consumer, 'node_modules', spec);
      mkdirSync(dirname(dest), { recursive: true });
      rmSync(dest, { recursive: true, force: true });
      symlinkSync(real, dest, 'dir');
    }
    record('link externals', true, Object.keys(EXTERNALS).join(', '));
  } catch (err) {
    record('link externals', false, String(err.message ?? err));
    finish();
    return;
  }

  // 4) verify the whole graph actually resolves before asserting behavior.
  const resolveProbe = `
    import { createRequire } from 'node:module';
    const req = createRequire(import.meta.url);
    const specs = ${JSON.stringify([...NODUS_PACKAGES.map((p) => `@nodus/${p}`), ...Object.keys(EXTERNALS)])};
    for (const s of specs) {
      try { req.resolve(s); } catch (e) { console.error('UNRESOLVED ' + s + ': ' + e.message); process.exit(2); }
    }
    console.log('RESOLVE_OK');
  `;
  const rp = runConsumerScript(consumer, 'resolve-probe.mjs', resolveProbe);
  if (rp.code !== 0 || !rp.stdout.includes('RESOLVE_OK')) {
    record('dependency graph resolves', false, (rp.stderr || rp.stdout).trim().split('\n').slice(-1)[0]);
    finish();
    return;
  }
  record('dependency graph resolves', true, 'all @nodus/* + externals require.resolve() cleanly');

  // 5) behavioral assertions, each in its own bounded consumer subprocess.
  console.log('\nconsumer assertions:');

  // --- ESM: import resolves to dist/index.js, constructs an Editor, renders headless PNG.
  const esm = runConsumerScript(
    consumer,
    'esm-check.mjs',
    `
    import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    const out = {};
    // ESM condition of the exports map must map to dist/index.js
    const esmUrl = import.meta.resolve('@nodus/core');
    out['esm-resolves-dist'] = esmUrl.endsWith('/dist/index.js');
    const { Editor } = await import('@nodus/core');
    const { createCanvas } = await import('@napi-rs/canvas');
    const ed = new Editor();
    ed.setViewport(400, 300);
    ed.createNode({ type: 'rect', label: 'X', x: 60, y: 60, w: 160, h: 70 });
    out['esm-constructs-and-mutates'] = ed.store.nodes().length === 1;
    const canvas = createCanvas(400, 300);
    const ctx = canvas.getContext('2d');
    ed.render(ctx, 400, 300, 2);
    const png = canvas.toBuffer('image/png');
    const magicOk = png.length > 1000 && png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47;
    out['esm-headless-png'] = magicOk;
    out['_pngBytes'] = png.length;
    out['_esmUrl'] = esmUrl;
    console.log('##RESULTS## ' + JSON.stringify(out));
  `,
  );
  ingest(esm, {
    'esm-resolves-dist': 'ESM import resolves to dist/index.js',
    'esm-constructs-and-mutates': 'ESM: new Editor() + createNode works',
    'esm-headless-png': 'ESM: headless @napi-rs/canvas PNG render',
  });

  // --- CJS: require resolves to the .cjs build and constructs an Editor.
  const cjs = runConsumerScript(
    consumer,
    'cjs-check.cjs',
    `
    const out = {};
    const entry = require.resolve('@nodus/core');
    out['cjs-resolves-cjs'] = entry.endsWith('/dist/index.cjs');
    const { Editor } = require('@nodus/core');
    const ed = new Editor();
    ed.createNode({ type: 'rect', label: 'Y', x: 0, y: 0, w: 80, h: 40 });
    out['cjs-require-constructs'] = ed.store.nodes().length === 1;
    console.log('##RESULTS## ' + JSON.stringify(out));
  `,
    { ext: 'cjs' },
  );
  ingest(cjs, {
    'cjs-resolves-cjs': 'CJS require resolves to dist/index.cjs',
    'cjs-require-constructs': 'CJS: require + new Editor() works',
  });

  // --- Type declarations present on disk in the installed package.
  const dtsDir = join(consumer, 'node_modules', '@nodus', 'core', 'dist');
  const hasDts = existsSync(join(dtsDir, 'index.d.ts'));
  const hasDcts = existsSync(join(dtsDir, 'index.d.cts'));
  record('type declarations emitted', hasDts && hasDcts, `index.d.ts=${hasDts} index.d.cts=${hasDcts}`);

  // --- Exports-map subpaths: preset-infra, a layout adapter, and the react entry resolve from dist.
  const subpaths = runConsumerScript(
    consumer,
    'subpaths-check.mjs',
    `
    const out = {};
    async function probe(key, spec, assert) {
      try {
        const mod = await import(spec);
        out[key] = assert(mod);
        if (!out[key]) out['_err_' + key] = 'imported but expected exports missing';
      } catch (e) {
        out[key] = false;
        out['_err_' + key] = String(e && e.message ? e.message : e).split('\\n')[0];
      }
    }
    await probe('preset-infra-resolves', '@nodus/preset-infra', (m) =>
      typeof m.InfraCanvas === 'function' && typeof m.installInfraPreset === 'function' && m.darkInfraTheme != null);
    await probe('layout-dagre-resolves', '@nodus/layout-dagre', (m) => m.dagreLayout != null);
    await probe('react-entry-resolves', '@nodus/react', (m) =>
      // Nodus is a forwardRef exotic component (an object with .render), not a plain function.
      typeof m.useValue === 'function' &&
      m.Nodus != null &&
      (typeof m.Nodus === 'function' || typeof m.Nodus.render === 'function'));
    console.log('##RESULTS## ' + JSON.stringify(out));
  `,
  );
  ingest(subpaths, {
    'preset-infra-resolves': '@nodus/preset-infra resolves from dist (InfraCanvas etc.)',
    'layout-dagre-resolves': '@nodus/layout-dagre resolves from dist (dagreLayout)',
    'react-entry-resolves': '@nodus/react main entry resolves from dist (Nodus, useValue)',
  });

  // --- node16 types probe: a TypeScript consumer under moduleResolution node16 must get working
  //     declarations for BOTH module flavors. The .cts probe forces the require condition — if it
  //     serves ESM-flavored types (no .d.cts condition) this fails with TS1479, the exact bug class.
  writeFileSync(
    join(consumer, 'types-esm.mts'),
    `import { Editor } from '@nodus/core';\nexport const useIt = (e: Editor): Editor => e;\n`,
  );
  writeFileSync(
    join(consumer, 'types-cjs.cts'),
    `import { Editor } from '@nodus/core';\nexport const useIt = (e: Editor): Editor => e;\n`,
  );
  writeFileSync(
    join(consumer, 'tsconfig.types-probe.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'node16',
          moduleResolution: 'node16',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
        },
        files: ['types-esm.mts', 'types-cjs.cts'],
      },
      null,
      2,
    )}\n`,
  );
  const tscBin = require.resolve('typescript/bin/tsc');
  const probe = run('node', [tscBin, '-p', 'tsconfig.types-probe.json'], { cwd: consumer, timeout: 180_000 });
  record(
    'node16 types resolve (ESM .mts + CJS .cts)',
    probe.code === 0,
    probe.code === 0 ? 'both flavors typecheck' : (probe.stdout || probe.stderr).trim().split('\n')[0],
  );

  // --- RSC boundary directive: @nodus/react's shipped bundles must LEAD with 'use client' —
  //     esbuild strips module-level directives when bundling, so the build prepends it post-hoc
  //     (tsup onSuccess); this asserts the mechanism keeps working in the actual tarball.
  for (const flavor of ['index.js', 'index.cjs']) {
    const f = join(consumer, 'node_modules', '@nodus', 'react', 'dist', flavor);
    const head = existsSync(f) ? readFileSync(f, 'utf8').slice(0, 200) : '';
    record(
      `react dist ${flavor} ships 'use client'`,
      head.includes("'use client'") || head.includes('"use client"'),
      head ? '' : 'file missing',
    );
  }

  // --- cli bin smoke: the packed bin must execute from the tarball (shebang intact, dist imports
  //     resolve against the consumer's node_modules). Usage text on stdout/stderr is the assertion;
  //     exit code is not (no-args usage may exit non-zero by design).
  const binPath = join(consumer, 'node_modules', '@nodus', 'cli', 'dist', 'bin.js');
  const binRes = run('node', [binPath], { cwd: consumer, timeout: 30_000 });
  const usageOk = `${binRes.stdout}${binRes.stderr}`.includes('git-native diagram toolchain');
  record(
    'cli bin executes from packed tarball',
    usageOk,
    usageOk ? 'usage banner printed' : (binRes.stderr || binRes.stdout).trim().split('\n').slice(-1)[0] || `exit ${binRes.code}`,
  );

  // --- mcp bin boot smoke: the packed MCP server must at least BOOT from the tarball without a
  //     module-resolution crash (the broken-publish class F44 targets). A stdio MCP server waits on
  //     stdin, so run it bounded with closed stdin: a healthy build exits/idles with no
  //     ERR_MODULE/Cannot-find on stderr; a broken dist crashes immediately with one.
  const mcpBin = join(consumer, 'node_modules', '@nodus', 'mcp', 'dist', 'bin.js');
  const mcpRes = run('node', [mcpBin], { cwd: consumer, timeout: 8_000 });
  const bootCrash = /ERR_MODULE_NOT_FOUND|Cannot find (module|package)|SyntaxError/.test(mcpRes.stderr);
  record(
    'mcp bin boots from packed tarball (no module crash)',
    existsSync(mcpBin) && !bootCrash,
    bootCrash ? mcpRes.stderr.trim().split('\n').slice(-1)[0] : existsSync(mcpBin) ? 'booted without import errors' : 'bin missing',
  );

  finish();
}

// Write a consumer script into the consumer dir and run it there (so Node resolves the installed
// node_modules/@nodus/*). Bounded by a timeout; never hangs.
function runConsumerScript(consumer, filename, source, opts = {}) {
  const file = join(consumer, filename);
  writeFileSync(file, source);
  return run('node', [file], { cwd: consumer, timeout: opts.timeout ?? 60_000 });
}

// Turn a subprocess result carrying a `##RESULTS## {json}` line into per-check PASS/FAIL records.
function ingest(res, labels) {
  let parsed = null;
  const line = res.stdout.split('\n').find((l) => l.startsWith('##RESULTS##'));
  if (line) {
    try {
      parsed = JSON.parse(line.slice('##RESULTS##'.length).trim());
    } catch {
      /* handled below */
    }
  }
  if (!parsed) {
    // The subprocess crashed before emitting results: fail every check it owned with the error tail.
    const detail = (res.stderr || res.stdout).trim().split('\n').slice(-1)[0] || `exit ${res.code}`;
    for (const label of Object.values(labels)) record(label, false, detail);
    return;
  }
  for (const [key, label] of Object.entries(labels)) {
    const ok = parsed[key] === true;
    let detail = '';
    if (key === 'esm-headless-png' && parsed._pngBytes) detail = `${parsed._pngBytes} bytes, PNG magic ok`;
    else if (key === 'esm-resolves-dist' && parsed._esmUrl) detail = parsed._esmUrl.replace(/^file:\/\//, '');
    else if (!ok && parsed[`_err_${key}`]) detail = parsed[`_err_${key}`];
    record(label, ok, detail);
  }
}

function finish() {
  cleanup();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`verify-dist: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('failed:');
    for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
    process.exit(1);
  }
  console.log('✓ built dist is consumable by an external app (ESM + CJS + types + render)');
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error('\nverify-dist: unexpected error');
  console.error(err);
  process.exit(1);
}
