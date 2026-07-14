/**
 * The on-disk byte contract (`toCanonicalString`) — the keystone of "diagrams you can code-review".
 * These assertions pin the properties a clean git diff depends on: deterministic, order-independent,
 * free of `version`/`meta` churn, and minimal (an in-place edit touches exactly one line).
 */
import { describe, expect, it } from 'vitest';
import { Editor, restore, serializeRecords, toCanonicalString, type Snapshot } from '../index.js';

/** A small deterministic diagram: two rects and an edge between them. */
function build(): Editor {
  const ed = new Editor();
  ed.createNode({ type: 'rect', x: 100, y: 100 });
  ed.createNode({ type: 'rect', x: 300, y: 200 });
  const [a, b] = ed.store.nodes();
  ed.connect({ kind: 'outline', nodeId: a!.id }, { kind: 'outline', nodeId: b!.id });
  return ed;
}

describe('canonical serialization', () => {
  it('1. canonical bytes are idempotent through parse → restore → re-serialize', () => {
    const ed = build();
    const s1 = toCanonicalString(ed.toJSON());
    const parsed = JSON.parse(s1) as Snapshot;
    const s2 = toCanonicalString(serializeRecords(restore(parsed).records));
    expect(s2).toBe(s1);
    // valid JSON, and the shape we expect
    expect(parsed.schemaVersion).toBe(1);
  });

  it('2. bytes are stable across toJSON → loadSnapshot → toJSON', () => {
    const ed = build();
    const s1 = toCanonicalString(ed.toJSON());
    const ed2 = new Editor();
    ed2.loadSnapshot(ed.toJSON());
    const s2 = toCanonicalString(ed2.toJSON());
    expect(s2).toBe(s1);
  });

  it('3. record array order does not affect canonical bytes', () => {
    const snap = build().toJSON();
    const reversed: Snapshot = {
      ...snap,
      document: { records: [...snap.document.records].reverse() },
    };
    expect(toCanonicalString(reversed)).toBe(toCanonicalString(snap));
  });

  it('4. moving one node changes exactly one line (the minimal-diff property)', () => {
    const ed = build();
    const before = toCanonicalString(ed.toJSON());
    const node = ed.store.nodes()[0]!;
    ed.updateNode(node.id, { x: node.x + 40 });
    const after = toCanonicalString(ed.toJSON());

    const b = before.split('\n');
    const a = after.split('\n');
    const removed = b.filter((l) => !a.includes(l));
    const added = a.filter((l) => !b.includes(l));

    expect(removed).toHaveLength(1);
    expect(added).toHaveLength(1);
    expect(removed[0]).toContain(node.id);
    expect(added[0]).toContain(node.id);
  });

  it('5. per-record version churn (edit + undo) does not affect bytes', () => {
    const ed = build();
    const s1 = toCanonicalString(ed.toJSON());
    const node = ed.store.nodes()[0]!;
    // Same logical content reached via more mutations → higher version counters, identical bytes.
    ed.updateNode(node.id, { x: node.x + 10 });
    ed.undo();
    const s2 = toCanonicalString(ed.toJSON());
    expect(s2).toBe(s1);
  });

  it('6. volatile meta (updated/exportedBy) is excluded from canonical bytes', () => {
    const base = build().toJSON(); // toJSON() with no arg carries no meta
    const noMeta = toCanonicalString(base);
    const withMeta1 = toCanonicalString({ ...base, meta: { updated: 1, exportedBy: 'a' } });
    const withMeta2 = toCanonicalString({ ...base, meta: { updated: 999_999 } });
    expect(withMeta1).toBe(noMeta);
    expect(withMeta2).toBe(noMeta);
  });
});
