/**
 * @ahmazin/cli — command behavior. Fixtures are written to a temp dir so the commands exercise real
 * file I/O (fmt writes in place; --check must not). Canonical bytes come from @ahmazin/core so these
 * tests track the real on-disk contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Editor, SCHEMA_VERSION, serializeRecords, toCanonicalString, type NodeRecord } from '@ahmazin/core';
import { fromTerraform } from '@ahmazin/import-infra';
import { diffReport, fmt } from './index.js';
import { readSource } from './commands/diff.js';
import { driftReport } from './commands/drift.js';
import { main } from './main.js';

/** A minimal `terraform show -json` document: each resource becomes a source-managed node keyed on its address. */
function tfShowJson(resources: Array<{ address: string; type: string; name: string }>): unknown {
  return { format_version: '1.0', values: { root_module: { resources } } };
}

function sampleEditor(): Editor {
  const ed = new Editor();
  ed.createNode({ type: 'rect', x: 100, y: 100 });
  ed.createNode({ type: 'rect', x: 300, y: 200 });
  const [a, b] = ed.store.nodes();
  ed.connect({ kind: 'outline', nodeId: a!.id }, { kind: 'outline', nodeId: b!.id });
  return ed;
}

describe('@ahmazin/cli', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nodus-cli-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('fmt canonicalizes a minified file and is idempotent', () => {
    const ed = sampleEditor();
    const file = join(dir, 'a.nodus.json');
    writeFileSync(file, JSON.stringify(ed.toJSON({ updated: 123 }))); // minified, carries meta

    expect(fmt([file])[0]!.changed).toBe(true); // first run reformats
    const canonical = readFileSync(file, 'utf8');
    expect(canonical.endsWith('}}\n')).toBe(true);
    expect(() => JSON.parse(canonical)).not.toThrow();

    expect(fmt([file])[0]!.changed).toBe(false); // second run is a no-op → idempotent
    expect(readFileSync(file, 'utf8')).toBe(canonical);
  });

  it('fmt --check flags non-canonical, passes canonical, and never writes', () => {
    const ed = sampleEditor();
    const minified = JSON.stringify(ed.toJSON());
    const messy = join(dir, 'messy.nodus.json');
    writeFileSync(messy, minified);
    expect(fmt([messy], { check: true })[0]!.changed).toBe(true);
    expect(readFileSync(messy, 'utf8')).toBe(minified); // --check must not rewrite

    const clean = join(dir, 'clean.nodus.json');
    writeFileSync(clean, toCanonicalString(ed.toJSON()));
    expect(fmt([clean], { check: true })[0]!.changed).toBe(false);
  });

  it('fmt reports records dropped by restore (dangling edges = data loss)', () => {
    const file = join(dir, 'dangling.nodus.json');
    const snap = {
      schemaVersion: 1,
      document: {
        records: [
          {
            id: 'edge:x',
            typeName: 'edge',
            version: 0,
            type: 'line',
            from: { kind: 'node', nodeId: 'node:missing' },
            to: { kind: 'node', nodeId: 'node:gone' },
            visual: { state: 'solid' },
            props: {},
          },
        ],
      },
    };
    writeFileSync(file, JSON.stringify(snap));
    expect(fmt([file], { check: true })[0]!.dropped).toBe(1);
  });

  it('fmt preserves typeVersions (it runs without utils, so it must pass the map through verbatim)', () => {
    const file = join(dir, 'versioned.nodus.json');
    const snap = {
      schemaVersion: 1,
      typeVersions: { 'aws:ec2': 3, edge: 1 },
      document: {
        records: [
          { id: 'n1', typeName: 'node', version: 0, type: 'aws:ec2', x: 0, y: 0, w: 10, h: 10, z: 'a0', visual: { state: 'solid' }, props: {} },
        ],
      },
    };
    writeFileSync(file, JSON.stringify(snap)); // minified, forces a reformat
    expect(fmt([file])[0]!.changed).toBe(true);
    const canonical = readFileSync(file, 'utf8');
    expect(canonical).toContain('"typeVersions":{"aws:ec2":3,"edge":1}');
    expect(JSON.parse(canonical).typeVersions).toEqual({ 'aws:ec2': 3, edge: 1 });
  });

  it('diff reports a moved node as a single change with a field delta', () => {
    const ed = sampleEditor();
    const before = join(dir, 'before.nodus.json');
    writeFileSync(before, toCanonicalString(ed.toJSON()));

    const node = ed.store.nodes()[0]!;
    ed.updateNode(node.id, { x: node.x + 40 });
    const after = join(dir, 'after.nodus.json');
    writeFileSync(after, toCanonicalString(ed.toJSON()));

    const report = diffReport(before, after);
    expect(report.result.changed).toHaveLength(1);
    expect(report.result.added).toHaveLength(0);
    expect(report.result.removed).toHaveLength(0);
    expect(report.empty).toBe(false);
    expect(report.text).toContain(node.id);
    expect(report.text).toContain('x '); // the field delta names the changed field
  });

  describe('drift', () => {
    // A diagram imported from a Terraform source is provably in sync with that same source. We build the
    // fixture in-test (import -> Snapshot -> disk) so the "no drift" assertion is grounded in real bytes.
    const v1 = tfShowJson([
      { address: 'aws_instance.web', type: 'aws_instance', name: 'web' },
      { address: 'aws_instance.api', type: 'aws_instance', name: 'api' },
      { address: 'aws_db_instance.db', type: 'aws_db_instance', name: 'db' },
    ]);

    function writeDiagram(source: unknown): string {
      const file = join(dir, 'infra.nodus.json');
      writeFileSync(file, JSON.stringify(serializeRecords(fromTerraform(source))));
      return file;
    }
    function writeSource(name: string, source: unknown): string {
      const file = join(dir, name);
      writeFileSync(file, JSON.stringify(source));
      return file;
    }

    it('reports no drift when the source is unchanged', () => {
      const diagram = writeDiagram(v1);
      const report = driftReport(diagram, writeSource('same.tf.json', v1));
      expect(report.drifted).toBe(false);
      expect(report.result.total).toBe(0);
      expect(report.result.unchanged).toBe(3);
      expect(report.text).toContain('In sync');
    });

    it('detects an added, a removed, and a changed resource (drift → nonzero)', () => {
      const diagram = writeDiagram(v1);
      // web: unchanged; api: same address, renamed → changed; db: removed; assets: added.
      const v2 = tfShowJson([
        { address: 'aws_instance.web', type: 'aws_instance', name: 'web' },
        { address: 'aws_instance.api', type: 'aws_instance', name: 'api-renamed' },
        { address: 'aws_s3_bucket.assets', type: 'aws_s3_bucket', name: 'assets' },
      ]);
      const report = driftReport(diagram, writeSource('v2.tf.json', v2));

      expect(report.drifted).toBe(true);
      expect(report.result.total).toBe(3);
      expect(report.result.added).toHaveLength(1);
      expect(report.result.removed).toHaveLength(1);
      expect(report.result.changed).toHaveLength(1);
      expect(report.result.changed[0]!.fields).toContain('label');
      expect(report.text).toMatch(/^Drift: 3 resource\(s\) changed {2}\(\+1 -1 ~1\)/);
      expect(report.text).toContain('Added:');
      expect(report.text).toContain('Removed:');
      expect(report.text).toContain('Changed:');
    });

    it('auto-detects a kubernetes manifest array and honours an explicit --source', () => {
      const diagram = writeDiagram(v1);
      // A K8s array shares no props.key with the Terraform diagram → every diagram node reads as removed.
      const k8s = [{ kind: 'Deployment', apiVersion: 'apps/v1', metadata: { name: 'web' } }];
      const auto = driftReport(diagram, writeSource('k8s.json', k8s));
      expect(auto.drifted).toBe(true);
      // Explicitly forcing the same detection gives the same result.
      const forced = driftReport(diagram, writeSource('k8s2.json', k8s), { source: 'kubernetes' });
      expect(forced.result.total).toBe(auto.result.total);
    });
  });

  // A record's `label`, `id`, `props.key`, and even a props KEY NAME are read verbatim from an
  // attacker-supplied `.nodus.json`; the diff/drift reports must not let embedded CR/LF/ESC/ANSI
  // bytes rewrite the terminal a reviewer trusts (CWE-117 terminal/log injection).
  describe('output sanitization (terminal/log injection)', () => {
    // Detect any C0/C1 control char (incl. CR/LF/ESC/DEL) without embedding one in this source file.
    const hasControlChar = (s: string): boolean =>
      [...s].some((c) => {
        const cp = c.codePointAt(0) ?? 0;
        return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
      });
    const snapshot = (records: unknown[]): unknown => ({ schemaVersion: 1, document: { records } });
    const labeledNode = (id: string, label: string, props: Record<string, unknown> = {}): unknown => ({
      id, typeName: 'node', version: 0, type: 'rect', x: 0, y: 0, w: 10, h: 10, z: 'a0', label, visual: { state: 'solid' }, props,
    });
    const CR = String.fromCharCode(0x0d);
    const ESC = String.fromCharCode(0x1b);
    // The report's own line breaks are legitimate structure; assert no control char (CR/ESC/…)
    // survives WITHIN any rendered line — that is the terminal-injection vector.
    const expectNoControlInAnyLine = (text: string): void => {
      for (const line of text.split('\n')) expect(hasControlChar(line)).toBe(false);
    };

    it('diff strips control characters from an untrusted label but keeps the printable text', () => {
      // CR + `ESC[2K` (erase-line) would overwrite the printed diff line in an ANSI terminal.
      const evil = `safe${CR}${ESC}[2Kforged`;
      const before = join(dir, 'empty.nodus.json');
      const after = join(dir, 'evil.nodus.json');
      writeFileSync(before, JSON.stringify(snapshot([])));
      writeFileSync(after, JSON.stringify(snapshot([labeledNode('node:evil', evil)])));

      const report = diffReport(before, after); // the node reads as "added" -> printed via describe()

      expectNoControlInAnyLine(report.text); // no raw CR/ESC survives into the report
      expect(report.text).toContain('node:evil'); // the id is still shown
      expect(report.text).toContain('safe'); // printable remainder preserved
      expect(report.text).toContain('forged');
    });

    it('diff leaves an ordinary label (spaces + non-control unicode) unchanged', () => {
      const before = join(dir, 'empty2.nodus.json');
      const after = join(dir, 'clean.nodus.json');
      writeFileSync(before, JSON.stringify(snapshot([])));
      writeFileSync(after, JSON.stringify(snapshot([labeledNode('node:ok', 'My Service αβ 服务')])));
      const report = diffReport(before, after);
      expect(report.text).toContain('"My Service αβ 服务"'); // rendered byte-for-byte
    });

    it('drift strips control characters from an untrusted label and props.key', () => {
      const diagram = join(dir, 'drift-evil.nodus.json');
      const source = join(dir, 'empty.tf.json');
      // A source-managed node (string props.key) with control chars in BOTH its label and its key.
      writeFileSync(
        diagram,
        JSON.stringify(snapshot([labeledNode('node:evil', `db${CR}${ESC}[2Kforged`, { key: `aws_db.evil${ESC}[31m` })])),
      );
      writeFileSync(source, JSON.stringify({ format_version: '1.0', values: { root_module: { resources: [] } } }));

      const report = driftReport(diagram, source); // node absent from source -> "removed" -> describe()
      expect(report.drifted).toBe(true);
      expectNoControlInAnyLine(report.text);
      expect(report.text).toContain('forged'); // printable remainder preserved
    });

    it('drift strips control characters from a props KEY NAME (the `props.<name>` field-list sink)', () => {
      // Route through the CHANGED section's `c.fields` (NOT describe): match a source-managed node by
      // its props.key, then add an EXTRA props key whose NAME carries control chars. `driftedFields`
      // emits `props.<name>` for it, which buildText joins into the "Changed" line.
      const src = tfShowJson([{ address: 'aws_instance.web', type: 'aws_instance', name: 'web' }]);
      const records = fromTerraform(src);
      const managed = records.find(
        (r): r is NodeRecord => r.typeName === 'node' && typeof r.props?.['key'] === 'string',
      );
      expect(managed).toBeDefined();
      managed!.props[`evil${ESC}[31m${CR}HACKED`] = '1'; // control chars live in the KEY NAME

      const diagram = join(dir, 'drift-keyname.nodus.json');
      const source = join(dir, 'keyname.tf.json');
      writeFileSync(diagram, JSON.stringify(serializeRecords(records)));
      writeFileSync(source, JSON.stringify(src)); // same source -> only the injected key drifts

      const report = driftReport(diagram, source);
      expect(report.drifted).toBe(true);
      expect(report.result.changed.length).toBeGreaterThan(0); // classified as a content change
      expectNoControlInAnyLine(report.text); // the `props.<name>` field name is sanitized in-line
      expect(report.text).toContain('Changed:');
      expect(report.text).toContain('HACKED'); // printable remainder of the key name preserved
    });
  });

  // Canonicalization can silently DISCARD data (restore() drops dangling edges / malformed records and
  // coerces non-finite numbers). fmt must refuse to rewrite a file over that loss unless forced, and the
  // bin must map each outcome to a distinct exit code so a CI gate can tell "clean" from "would lose data"
  // from "file needs a newer nodus". These assertions turn that contract into on-disk-bytes + exit-code facts.
  describe('fmt write-safety + exit codes (F41)', () => {
    // Silence the intentional stdout/stderr the dispatcher prints while asserting on exit codes / disk bytes.
    let logs: string[];
    let errs: string[];
    let warns: string[];
    beforeEach(() => {
      logs = [];
      errs = [];
      warns = [];
      vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
      vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errs.push(a.join(' ')));
      vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warns.push(a.join(' ')));
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** A minified snapshot carrying one edge whose endpoints reference missing nodes → restore drops it. */
    const danglingSnap = {
      schemaVersion: 1,
      document: {
        records: [
          {
            id: 'edge:x',
            typeName: 'edge',
            version: 0,
            type: 'line',
            from: { kind: 'node', nodeId: 'node:missing' },
            to: { kind: 'node', nodeId: 'node:gone' },
            visual: { state: 'solid' },
            props: {},
          },
        ],
      },
    };

    it('refuses to rewrite a lossy file: on-disk bytes are unchanged and the exit code is 2', async () => {
      const file = join(dir, 'lossy.nodus.json');
      const original = JSON.stringify(danglingSnap);
      writeFileSync(file, original);

      // fmt() itself must not write the lossy canonicalization…
      const [r] = fmt([file]);
      expect(r!.lossy).toBe(true);
      expect(r!.dropped).toBe(1);
      expect(r!.wrote).toBe(false);
      expect(readFileSync(file, 'utf8')).toBe(original); // byte-for-byte untouched

      // …and the dispatcher reports it as exit 2 (refused), still without writing.
      const code = await main(['fmt', file]);
      expect(code).toBe(2);
      expect(readFileSync(file, 'utf8')).toBe(original);
      expect(errs.some((l) => l.includes('refused') && l.includes('--force'))).toBe(true);
    });

    it('a file parsing to null/array never raw-TypeErrors: typed lossy refusal, file untouched (F24)', async () => {
      for (const content of ['null', '[]']) {
        const file = join(dir, `degenerate-${content.length}.nodus.json`);
        writeFileSync(file, content);
        const [r] = fmt([file]);
        expect(r!.lossy).toBe(true); // invalid-snapshot issue → lossy path, not a crash
        expect(r!.issues.some((i) => i.code === 'invalid-snapshot' || i.code === 'non-array-records')).toBe(true);
        expect(r!.wrote).toBe(false);
        expect(readFileSync(file, 'utf8')).toBe(content); // byte-for-byte untouched
        const code = await main(['fmt', file]);
        expect(code).toBe(2);
        expect(readFileSync(file, 'utf8')).toBe(content);
      }
    });

    it('--force writes the lossy canonicalization and reports exactly what was dropped (exit 0)', async () => {
      const file = join(dir, 'forced.nodus.json');
      const original = JSON.stringify(danglingSnap);
      writeFileSync(file, original);

      const code = await main(['fmt', file, '--force']);
      expect(code).toBe(0);
      const after = readFileSync(file, 'utf8');
      expect(after).not.toBe(original); // written this time
      expect(after).not.toContain('edge:x'); // the dangling edge is gone from the canonical form
      expect(warns.some((l) => l.includes('data loss') && l.includes('record(s) dropped'))).toBe(true);
    });

    it('refuses a file written by a newer Nodus with exit 3 and leaves it untouched', async () => {
      const file = join(dir, 'from-the-future.nodus.json');
      const original = JSON.stringify({
        schemaVersion: SCHEMA_VERSION + 1, // well-formed, but newer than this build understands
        document: { records: [{ id: 'n1', typeName: 'node', version: 0, type: 'rect', x: 0, y: 0, w: 10, h: 10, z: 'a0', visual: { state: 'solid' }, props: {} }] },
      });
      writeFileSync(file, original);

      const [r] = fmt([file]);
      expect(r!.tooNew).toBe(true);
      expect(r!.fileSchema).toBe(SCHEMA_VERSION + 1);
      expect(r!.wrote).toBe(false);

      const code = await main(['fmt', file]);
      expect(code).toBe(3);
      expect(readFileSync(file, 'utf8')).toBe(original); // never rewritten
      expect(errs.some((l) => l.includes('newer version of Nodus') && l.includes('upgrade @ahmazin/cli'))).toBe(true);
    });

    it('a clean, already-canonical file formats to exit 0 with no rewrite', async () => {
      const ed = sampleEditor();
      const file = join(dir, 'clean.nodus.json');
      const canonical = toCanonicalString(ed.toJSON());
      writeFileSync(file, canonical);

      const code = await main(['fmt', file]);
      expect(code).toBe(0);
      expect(readFileSync(file, 'utf8')).toBe(canonical); // idempotent → untouched
    });

    it('--check returns exit 1 when a valid file would reformat (no write)', async () => {
      const ed = sampleEditor();
      const file = join(dir, 'messy.nodus.json');
      const minified = JSON.stringify(ed.toJSON());
      writeFileSync(file, minified);

      const code = await main(['fmt', '--check', file]);
      expect(code).toBe(1);
      expect(readFileSync(file, 'utf8')).toBe(minified); // --check never writes
    });

    it('--help prints usage and exits 0; so does no command', async () => {
      expect(await main(['--help'])).toBe(0);
      expect(logs.some((l) => l.includes('Usage:') && l.includes('nodus fmt'))).toBe(true);
      logs.length = 0;
      expect(await main([])).toBe(0);
      expect(logs.some((l) => l.includes('Usage:'))).toBe(true);
    });
  });

  // The diff sides may be `REV:path` git specs, resolved with `git show` via execFile (never a shell).
  describe('diff git-rev sources + load diagnostics (F19/F24)', () => {
    it('diffs a committed revision against the working copy via REV:path', () => {
      // A self-contained temp git repo: commit v1, edit the working copy, diff HEAD:file against it.
      const repo = mkdtempSync(join(tmpdir(), 'nodus-gitdiff-'));
      const rel = 'diagram.nodus.json';
      const abs = join(repo, rel);
      const git = (...args: string[]): void => void execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
      const cwd = process.cwd();
      try {
        git('init', '-q');
        git('-c', 'user.email=t@t', '-c', 'user.name=t', 'config', 'commit.gpgsign', 'false');

        const ed = sampleEditor();
        writeFileSync(abs, toCanonicalString(ed.toJSON()));
        git('add', rel);
        git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'v1');

        // Move a node in the working copy only (HEAD still has the original).
        const node = ed.store.nodes()[0]!;
        ed.updateNode(node.id, { x: node.x + 40 });
        writeFileSync(abs, toCanonicalString(ed.toJSON()));

        // git show resolves REV:path relative to the repo root, so run from inside the repo.
        process.chdir(repo);
        const report = diffReport(`HEAD:${rel}`, rel);
        expect(report.empty).toBe(false);
        expect(report.result.changed).toHaveLength(1); // the moved node, exactly
        expect(report.result.added).toHaveLength(0);
        expect(report.result.removed).toHaveLength(0);
        expect(report.text).toContain(node.id);
      } finally {
        process.chdir(cwd);
        rmSync(repo, { recursive: true, force: true });
      }
    });

    it('readSource treats a non-matching spec (shell metacharacters) as a file path, never a shell command', () => {
      // A leading `;` fails the conservative rev regex, so this is read as a filename (which does not
      // exist) rather than handed to a shell — proving the git path can't be an injection sink.
      expect(() => readSource(';touch pwned:whatever.json')).toThrow(); // ENOENT from readFileSync, not execution
      // And a plain filesystem path with no colon is always read as a file (two-file form preserved).
      const file = join(dir, 'plain.nodus.json');
      writeFileSync(file, JSON.stringify({ schemaVersion: 1, document: { records: [] } }));
      expect(() => JSON.parse(readSource(file))).not.toThrow();
    });

    it('diff surfaces a non-clean load (dropped dangling edge) as a stderr warning while still diffing', () => {
      const clean = join(dir, 'empty.nodus.json');
      const dangling = join(dir, 'dangling.nodus.json');
      writeFileSync(clean, JSON.stringify({ schemaVersion: 1, document: { records: [] } }));
      writeFileSync(
        dangling,
        JSON.stringify({
          schemaVersion: 1,
          document: {
            records: [
              { id: 'edge:x', typeName: 'edge', version: 0, type: 'line', from: { kind: 'node', nodeId: 'node:missing' }, to: { kind: 'node', nodeId: 'node:gone' }, visual: { state: 'solid' }, props: {} },
            ],
          },
        }),
      );
      const report = diffReport(clean, dangling);
      expect(report.loadWarnings.some((w) => w.includes('dropped 1 dangling edge(s)'))).toBe(true);
      expect(report.empty).toBe(true); // the edge dropped on both the "load" and the compare → no net change
    });
  });
});
