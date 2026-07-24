import { describe, expect, it } from 'vitest';
import { restore, type Migration, type Snapshot } from './index.js';

function node(id: string, type: string, props: Record<string, unknown>) {
  return { id, typeName: 'node', version: 0, type, x: 0, y: 0, w: 10, h: 10, z: 'a0', visual: { state: 'solid' }, props };
}
function snap(records: unknown[], typeVersions?: Record<string, number>): Snapshot {
  return { schemaVersion: 1, document: { records: records as never }, ...(typeVersions ? { typeVersions } : {}) };
}
// v1 renames {r} -> {radius}; v2 doubles it. Type is at version 2.
const migs: Migration[] = [
  { id: 'r-to-radius', migrate: (p) => ({ radius: p.r, ...(({ r, ...rest }) => rest)(p) }) },
  { id: 'double-radius', migrate: (p) => ({ ...p, radius: (p.radius as number) * 2 }) },
];
const resolve = (rec: { typeName: string; type?: string }): Migration[] | undefined =>
  rec.type === 'box' ? migs : undefined;

describe('restore migration execution', () => {
  it('runs the full sequence for a v0 record (no typeVersions entry)', () => {
    const r = restore(snap([node('n1', 'box', { r: 5 })]), { resolveMigrations: resolve });
    expect(r.records[0]).toMatchObject({ props: { radius: 10 } });
    expect(r.migrationErrors).toBe(0);
    expect(r.unmigrated).toBe(0);
  });
  it('runs only the remaining steps for a partially-migrated record', () => {
    const r = restore(snap([node('n1', 'box', { radius: 5 })], { box: 1 }), { resolveMigrations: resolve });
    expect(r.records[0]).toMatchObject({ props: { radius: 10 } }); // only step index 1 ran
  });
  it('does nothing when stored === current', () => {
    const r = restore(snap([node('n1', 'box', { radius: 7 })], { box: 2 }), { resolveMigrations: resolve });
    expect(r.records[0]).toMatchObject({ props: { radius: 7 } });
    expect(r.unmigrated).toBe(0);
  });
  it('isolates a throwing migration: drops that record, keeps the rest', () => {
    const boom: Migration[] = [{ id: 'boom', migrate: () => { throw new Error('bad'); } }];
    const r = restore(snap([node('bad', 't', {}), node('ok', 'box', { r: 1 })]),
      { resolveMigrations: (rec) => (rec.type === 't' ? boom : rec.type === 'box' ? migs : undefined) });
    expect(r.records.map((x) => x.id)).toEqual(['ok']);
    expect(r.migrationErrors).toBe(1);
  });
  it('keeps a forward-version record raw and counts it', () => {
    const r = restore(snap([node('n1', 'box', { radius: 99 })], { box: 5 }), { resolveMigrations: resolve });
    expect(r.records[0]).toMatchObject({ props: { radius: 99 } }); // untouched
    expect(r.unmigrated).toBe(1);
  });
  it('keeps an unregistered-type record raw and counts it', () => {
    const r = restore(snap([node('n1', 'mystery', { a: 1 })]), { resolveMigrations: resolve });
    expect(r.records[0]).toMatchObject({ props: { a: 1 } });
    expect(r.unmigrated).toBe(1);
  });
  it('without opts, does not migrate (pure/back-compat)', () => {
    const r = restore(snap([node('n1', 'box', { r: 5 })]));
    expect(r.records[0]).toMatchObject({ props: { r: 5 } });
    expect(r.migrationErrors).toBe(0);
    expect(r.unmigrated).toBe(0);
  });
  it('a resolver returning [] for a registered type keeps the record and counts unmigrated:0 (not 1)', () => {
    const r = restore(snap([node('n1', 'known', { a: 1 })]), {
      resolveMigrations: (rec) => (rec.type === 'known' ? [] : undefined),
    });
    expect(r.records.map((x) => x.id)).toEqual(['n1']);
    expect(r.records[0]).toMatchObject({ props: { a: 1 } });
    expect(r.unmigrated).toBe(0); // distinct from resolveMigrations() => undefined, which is unmigrated:1
    expect(r.migrationErrors).toBe(0);
  });
  it('floors a hand-edited non-integer stored version instead of dropping the record', () => {
    // typeVersions:{box:1.5} must not index steps[1.5] (undefined) — floors to 1, runs step index 1 only.
    const r = restore(snap([node('n1', 'box', { radius: 5 })], { box: 1.5 }), { resolveMigrations: resolve });
    expect(r.records.map((x) => x.id)).toEqual(['n1']);
    expect(r.records[0]).toMatchObject({ props: { radius: 10 } }); // only step index 1 ran: 5 * 2
    expect(r.migrationErrors).toBe(0);
  });
});

import * as nodus from '../index.js';
it('exports Migration and RestoreOptions from the package root', () => {
  // types are compile-time; this asserts the value graph imports cleanly and restore is the public one
  expect(typeof nodus.restore).toBe('function');
  const _m: nodus.Migration = { id: 'noop', migrate: (p) => p }; // fails typecheck if Migration not exported
  const _o: nodus.RestoreOptions = {};  // fails typecheck if RestoreOptions is not exported
  expect(_m.migrate({ a: 1 })).toEqual({ a: 1 });
  expect(_o).toBeDefined();
});
