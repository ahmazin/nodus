/**
 * One hydration path + LoadReport (A12) and observable unknown types at the editor (A8). The
 * constructor `records` path and `loadSnapshot` share hydrateSnapshot (migrations, z-seed, active
 * page); loadSnapshot returns a LoadReport and emits document:load carrying it. An unregistered type
 * warns once (severity 'warning'), round-trips byte-identical, and — with a placeholder — hit-tests.
 */
import { describe, expect, it } from 'vitest';
import { Editor } from './index.js';
import { SCHEMA_VERSION, toCanonicalString, type NodusRecord, type Snapshot } from '../index.js';
import type { Change, Id, NodeRecord } from '../model.js';

function rawNode(id: string, type: string, over: Partial<NodeRecord> = {}): NodeRecord {
  return {
    id: id as Id<'node'>,
    typeName: 'node',
    version: 0,
    type,
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    z: '0000000a0',
    visual: { state: 'solid' },
    props: {},
    ...over,
  } as NodeRecord;
}
const snap = (records: NodusRecord[]): Snapshot => ({ schemaVersion: SCHEMA_VERSION, document: { records } });

describe('A8 — observable unknown types at the editor', () => {
  it('surfaces a missing-util warning (severity warning) exactly once for repeated unknown records', () => {
    const ed = new Editor();
    const warnings: { severity: string; phase: unknown }[] = [];
    ed.on('error', (e) => {
      if (e.context.phase === 'missing-util') warnings.push({ severity: e.severity, phase: e.context.phase });
    });
    // createNode would throw on an unknown type; use the remote path to add raw unknown records
    ed.applyRemote([
      { op: 'add', record: rawNode('node:g1', 'ghost') },
      { op: 'add', record: rawNode('node:g2', 'ghost') },
    ] as Change[]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.severity).toBe('warning'); // a missing type is a warning, not a fatal error
  });

  it('preserves an unknown-type record byte-identically across a round-trip', () => {
    const ed = new Editor();
    ed.applyRemote([{ op: 'add', record: rawNode('node:g', 'ghost', { label: 'kept' }) }] as Change[]);
    const before = toCanonicalString(ed.toJSON());
    ed.loadSnapshot(ed.toJSON());
    expect(toCanonicalString(ed.toJSON())).toBe(before); // not mangled
  });

  it('placeholder makes an unknown-type node hit-testable; default does not', () => {
    const withPh = new Editor({ unknownTypePlaceholder: true });
    withPh.applyRemote([{ op: 'add', record: rawNode('node:g', 'ghost', { x: 0, y: 0, w: 100, h: 50 }) }] as Change[]);
    expect(withPh.sceneIndex.hitTest({ x: 50, y: 25 }, 4)?.id).toBe('node:g');

    const bare = new Editor();
    bare.applyRemote([{ op: 'add', record: rawNode('node:g', 'ghost', { x: 0, y: 0, w: 100, h: 50 }) }] as Change[]);
    expect(bare.sceneIndex.hitTest({ x: 50, y: 25 }, 4)).toBeNull();
  });

  it('registering the real type stops the warning on the next load', () => {
    const ed = new Editor();
    const warnings: unknown[] = [];
    ed.on('error', (e) => {
      if (e.context.phase === 'missing-util') warnings.push(e);
    });
    ed.applyRemote([{ op: 'add', record: rawNode('node:g', 'ghost') }] as Change[]);
    expect(warnings).toHaveLength(1);
    ed.registerNodeType({
      type: 'ghost',
      getDefaultProps: () => ({}),
      getGeometry: (n) => ({ bounds: () => ({ x: n.x, y: n.y, w: n.w, h: n.h }) }) as never,
      draw: () => {},
    });
    ed.loadSnapshot(ed.toJSON()); // rebuild with the type now registered
    expect(warnings).toHaveLength(1); // no new warning
  });
});

describe('A12 — one hydration path + LoadReport', () => {
  it('constructor records run the z-seed: a later node paints on top of a high-z loaded node', () => {
    const ed = new Editor({ records: [rawNode('node:high', 'rect', { z: '00000000zz' })] });
    const id = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const newZ = (ed.store.peek(id) as NodeRecord).z;
    expect(Number.parseInt(newZ, 36)).toBeGreaterThan(Number.parseInt('00000000zz', 36));
  });

  it('constructor with multi-page records opens on the first page', () => {
    const p1 = { id: 'page:1', typeName: 'page', version: 0, name: 'One', index: 'a0' } as unknown as NodusRecord;
    const p2 = { id: 'page:2', typeName: 'page', version: 0, name: 'Two', index: 'a1' } as unknown as NodusRecord;
    const ed = new Editor({ records: [p1, p2] });
    expect(ed.activePageId()).toBe('page:1');
  });

  it('constructor records and loadSnapshot yield identical store state', () => {
    const records = [rawNode('node:a', 'rect'), rawNode('node:b', 'rect')];
    const a = new Editor({ records });
    const b = new Editor();
    b.loadSnapshot(snap(records));
    expect(toCanonicalString(a.toJSON())).toBe(toCanonicalString(b.toJSON()));
  });

  it('loadSnapshot returns a LoadReport with droppedEdges===1 for a dangling edge', () => {
    const ed = new Editor();
    const node = rawNode('node:a', 'rect');
    const dangling = {
      id: 'edge:e' as Id<'edge'>,
      typeName: 'edge',
      version: 0,
      type: 'line',
      from: { kind: 'node', nodeId: 'node:a' },
      to: { kind: 'node', nodeId: 'node:MISSING' },
      visual: { state: 'solid' },
      props: {},
    } as unknown as NodusRecord;
    const report = ed.loadSnapshot(snap([node, dangling]));
    expect(report.droppedEdges).toBe(1);
    expect(report.issues).toEqual([]);
  });

  it('document:load carries the LoadReport', () => {
    const ed = new Editor();
    let report: unknown;
    ed.on('document:load', (e) => (report = e.report));
    ed.loadSnapshot(snap([rawNode('node:a', 'rect')]));
    expect(report).toMatchObject({ droppedEdges: 0, migrationErrors: 0, issues: [] });
  });
});
