import { describe, expect, it } from 'vitest';
import { serializeRecords, toCanonicalString, restore, type NodusRecord } from './index.js';

const recs: NodusRecord[] = [];

describe('typeVersions data model', () => {
  it('serializeRecords stores a non-empty typeVersions map', () => {
    const snap = serializeRecords(recs, { typeVersions: { 'aws:ec2': 3, edge: 1 } });
    expect(snap.typeVersions).toEqual({ 'aws:ec2': 3, edge: 1 });
  });
  it('omits an empty typeVersions map', () => {
    expect(serializeRecords(recs, { typeVersions: {} }).typeVersions).toBeUndefined();
    expect(serializeRecords(recs).typeVersions).toBeUndefined();
  });
  it('canonical output emits typeVersions with sorted keys, between schemaVersion and document', () => {
    const s = toCanonicalString(serializeRecords(recs, { typeVersions: { b: 2, a: 1 } }));
    expect(s).toBe('{"schemaVersion":1,"typeVersions":{"a":1,"b":2},"document":{"records":[]}}\n');
  });
  it('canonical output is byte-identical to the no-map form when typeVersions is empty', () => {
    expect(toCanonicalString(serializeRecords(recs))).toBe('{"schemaVersion":1,"document":{"records":[]}}\n');
  });
  it('restore reports migration counters (zero before the engine exists)', () => {
    const r = restore({ schemaVersion: 1, document: { records: [] } });
    expect(r.migrationErrors).toBe(0);
    expect(r.unmigrated).toBe(0);
  });
  it('serializeRecords({ meta }) sets meta (the options-object signature)', () => {
    expect(serializeRecords(recs, { meta: { a: 1 } }).meta).toEqual({ a: 1 });
  });
  it('serializeRecords({ meta, typeVersions }) sets both fields', () => {
    const snap = serializeRecords(recs, { meta: { a: 1 }, typeVersions: { box: 2 } });
    expect(snap.meta).toEqual({ a: 1 });
    expect(snap.typeVersions).toEqual({ box: 2 });
  });
});
