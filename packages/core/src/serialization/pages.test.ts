/**
 * Page-membership (`pageId`) round-trip + load-migration tests.
 *
 * Invariant under test:
 *  - 0 PageRecords  ⇒ implicit single page; NO record carries `pageId` (a pre-pages diagram
 *    round-trips byte-identically — the git-native moat).
 *  - ≥1 PageRecord  ⇒ every node/edge carries an EXPLICIT `pageId` resolving to a real page; on load,
 *    a missing/dangling `pageId` is backfilled/repointed to the first page (lowest `index`).
 * Each test fails against the pre-pageId serializer.
 */
import { describe, expect, it } from 'vitest';
import { restore, serializeRecords, toCanonicalString, type NodusRecord, type Snapshot } from './index.js';

function nodeRec(id: string, over: Record<string, unknown> = {}): NodusRecord {
  return { id, typeName: 'node', version: 0, type: 'rect', x: 0, y: 0, w: 10, h: 10, z: 'a0', visual: { state: 'solid' }, props: {}, ...over } as NodusRecord;
}
function edgeRec(id: string, from: string, to: string, over: Record<string, unknown> = {}): NodusRecord {
  return { id, typeName: 'edge', version: 0, type: 'line', from: { kind: 'node', nodeId: from }, to: { kind: 'node', nodeId: to }, visual: { state: 'solid' }, props: {}, ...over } as NodusRecord;
}
function pageRec(id: string, index: string, name = 'Page'): NodusRecord {
  return { id, typeName: 'page', version: 0, name, index } as NodusRecord;
}
function snap(records: NodusRecord[]): Snapshot {
  return { schemaVersion: 1, document: { records } };
}
const pageIdOf = (rec: NodusRecord | undefined) => (rec as { pageId?: string } | undefined)?.pageId;

describe('pageId — byte-stability for page-less docs', () => {
  it('a doc with no pages carries no pageId and round-trips byte-identically', () => {
    const bytes = toCanonicalString(serializeRecords([nodeRec('node:a'), nodeRec('node:b'), edgeRec('edge:e', 'node:a', 'node:b')]));
    const r = restore(snap([nodeRec('node:a'), nodeRec('node:b'), edgeRec('edge:e', 'node:a', 'node:b')]));
    expect(r.repointedPageRefs).toBe(0);
    expect(r.records.every((rec) => !('pageId' in rec))).toBe(true);
    expect(bytes).not.toContain('pageId');
    // re-serialize the restored records — identical bytes
    expect(toCanonicalString(serializeRecords(r.records))).toBe(bytes);
  });
});

describe('pageId — round-trips when set', () => {
  it('a node/edge with a valid pageId round-trips and appears in canonical output', () => {
    const recs = [pageRec('page:1', 'a0'), pageRec('page:2', 'a1'), nodeRec('node:a', { pageId: 'page:2' }), edgeRec('edge:e', 'node:a', 'node:a', { pageId: 'page:2' })];
    const bytes = toCanonicalString(serializeRecords(recs));
    expect(bytes).toContain('"pageId":"page:2"');
    const r = restore(snap(recs));
    expect(pageIdOf(r.records.find((x) => x.id === 'node:a'))).toBe('page:2');
    expect(pageIdOf(r.records.find((x) => x.id === 'edge:e'))).toBe('page:2');
    expect(r.repointedPageRefs).toBe(0);
  });
});

describe('pageId — load migration / repair', () => {
  it('with pages present, a node missing pageId is backfilled to the first page (lowest index)', () => {
    const r = restore(snap([pageRec('page:2', 'a1'), pageRec('page:1', 'a0'), nodeRec('node:a')]));
    expect(pageIdOf(r.records.find((x) => x.id === 'node:a'))).toBe('page:1'); // 'a0' < 'a1'
    expect(r.repointedPageRefs).toBe(1);
  });

  it('a dangling pageId (target page missing) is repointed to the first page', () => {
    const r = restore(snap([pageRec('page:1', 'a0'), nodeRec('node:a', { pageId: 'page:ghost' })]));
    expect(pageIdOf(r.records.find((x) => x.id === 'node:a'))).toBe('page:1');
    expect(r.repointedPageRefs).toBe(1);
  });

  it('with NO pages, a stray pageId is stripped (falls back to the implicit page)', () => {
    const r = restore(snap([nodeRec('node:a', { pageId: 'page:ghost' })]));
    expect('pageId' in (r.records.find((x) => x.id === 'node:a') as object)).toBe(false);
    expect(r.repointedPageRefs).toBe(1);
  });
});

describe('pageId — reorder safety', () => {
  it('explicit pageIds are stable regardless of page index order', () => {
    const recs = [pageRec('page:1', 'a0'), pageRec('page:2', 'a1'), nodeRec('node:a', { pageId: 'page:1' }), nodeRec('node:b', { pageId: 'page:2' })];
    const r = restore(snap(recs));
    expect(pageIdOf(r.records.find((x) => x.id === 'node:a'))).toBe('page:1');
    expect(pageIdOf(r.records.find((x) => x.id === 'node:b'))).toBe('page:2');
    expect(r.repointedPageRefs).toBe(0);
  });
});
