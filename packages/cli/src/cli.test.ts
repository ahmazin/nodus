/**
 * @nodus/cli — command behavior. Fixtures are written to a temp dir so the commands exercise real
 * file I/O (fmt writes in place; --check must not). Canonical bytes come from @nodus/core so these
 * tests track the real on-disk contract.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Editor, serializeRecords, toCanonicalString } from '@nodus/core';
import { fromTerraform } from '@nodus/import-infra';
import { diffReport, fmt } from './index.js';
import { driftReport } from './commands/drift.js';

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

describe('@nodus/cli', () => {
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
});
