/**
 * Hardening regression tests: `restore()` and the canonical writer must never crash on
 * malformed-but-parseable JSON (a hand-edited or corrupt `.nodus.json`), must be order-invariant,
 * and must surface — rather than swallow — every defect they repair. Each test fails against the
 * pre-hardening code (stack overflow / thrown TypeError / silent load / non-deterministic bytes).
 */
import { describe, expect, it } from 'vitest';
import {
  compareRecords,
  restore,
  serializeRecords,
  stableStringify,
  toCanonicalString,
  type NodusRecord,
  type SerializationIssue,
  type Snapshot,
} from './index.js';

function nodeRec(id: string, over: Record<string, unknown> = {}, props: Record<string, unknown> = {}): NodusRecord {
  return { id, typeName: 'node', version: 0, type: 'rect', x: 0, y: 0, w: 10, h: 10, z: 'a0', visual: { state: 'solid' }, props, ...over } as NodusRecord;
}
function snap(records: unknown): Snapshot {
  return { schemaVersion: 1, document: { records: records as never } };
}

describe('1. stableStringify — no stack-overflow on deep nesting', () => {
  it('serializes a very deeply nested value without throwing', () => {
    // ~60k deep — comfortably past the recursive form's ~5k call-stack ceiling.
    const root: Record<string, unknown> = {};
    let cur = root;
    const DEPTH = 60_000;
    for (let i = 0; i < DEPTH; i++) {
      const next: Record<string, unknown> = {};
      cur.a = next;
      cur = next;
    }
    let out = '';
    expect(() => {
      out = stableStringify(root);
    }).not.toThrow();
    expect((out.match(/\{/g) ?? []).length).toBe(DEPTH + 1); // one brace per level + the innermost {}
  });

  it('is byte-identical to the recursive form for ordinary nested values', () => {
    const v = { z: 1, a: [3, { y: true, x: null }, 'txt'], m: { b: 2, a: 1 }, u: undefined };
    // keys sorted, undefined-valued keys dropped, array order preserved
    expect(stableStringify(v)).toBe('{"a":[3,{"x":null,"y":true},"txt"],"m":{"a":1,"b":2},"z":1}');
  });
});

describe('2. restore — defensive against malformed shapes', () => {
  it('skips a null record entry instead of throwing', () => {
    const issues: SerializationIssue[] = [];
    let res!: ReturnType<typeof restore>;
    expect(() => {
      res = restore(snap([null, nodeRec('n1')]), { onError: (i) => issues.push(i) });
    }).not.toThrow();
    expect(res.records.map((r) => r.id)).toEqual(['n1']);
    expect(issues.some((i) => i.code === 'invalid-record')).toBe(true);
  });

  it('skips a primitive record entry instead of throwing', () => {
    let res!: ReturnType<typeof restore>;
    expect(() => {
      res = restore(snap(['oops', 7, nodeRec('n1')]));
    }).not.toThrow();
    expect(res.records.map((r) => r.id)).toEqual(['n1']);
  });

  it('treats a non-array records field as empty instead of throwing', () => {
    const issues: SerializationIssue[] = [];
    for (const bad of [42, {}, null]) {
      let res!: ReturnType<typeof restore>;
      expect(() => {
        res = restore(snap(bad), { onError: (i) => issues.push(i) });
      }).not.toThrow();
      expect(res.records).toEqual([]);
    }
    // 42 and {} are non-arrays and report; a missing/undefined records field is not an error.
    expect(issues.filter((i) => i.code === 'non-array-records')).toHaveLength(2);
  });
});

describe('3. compareRecords — code-point total order (order-invariant bytes)', () => {
  // U+00AD is a soft hyphen: 'a\u00adb' and 'ab' are DISTINCT ids that locale collation rates EQUAL.
  const COLLIDE = 'a\u00adb';
  it('gives distinct-but-collating-equal ids a deterministic tiebreak', () => {
    expect(compareRecords(nodeRec(COLLIDE), nodeRec('ab'))).not.toBe(0);
  });

  it('canonical bytes do not depend on input order for such ids', () => {
    const a = nodeRec(COLLIDE);
    const b = nodeRec('ab');
    const forward = toCanonicalString(serializeRecords([a, b]));
    const reversed = toCanonicalString(serializeRecords([b, a]));
    expect(forward).toBe(reversed);
  });
});

describe('4. restore — duplicate id dedupe (last wins)', () => {
  it('keeps a single record per id and reports the duplicate', () => {
    const issues: SerializationIssue[] = [];
    const res = restore(snap([nodeRec('dup', { x: 1 }), nodeRec('dup', { x: 2 })]), { onError: (i) => issues.push(i) });
    const dups = res.records.filter((r) => String(r.id) === 'dup');
    expect(dups).toHaveLength(1);
    expect((dups[0] as unknown as { x: number }).x).toBe(2); // last occurrence wins
    expect(issues.some((i) => i.code === 'duplicate-id')).toBe(true);
  });
});

describe('5. restore — schemaVersion range validation', () => {
  it('reports an out-of-range / non-integer schemaVersion but still best-effort loads', () => {
    for (const bad of [999, -1, 1.5, Number.NaN, 'nope' as unknown as number]) {
      const issues: SerializationIssue[] = [];
      const res = restore({ schemaVersion: bad, document: { records: [nodeRec('n1')] } } as unknown as Snapshot, {
        onError: (i) => issues.push(i),
      });
      expect(issues.some((i) => i.code === 'bad-schema-version')).toBe(true);
      expect(res.records.map((r) => r.id)).toEqual(['n1']);
    }
  });

  it('does not warn for a valid or absent schemaVersion', () => {
    const issues: SerializationIssue[] = [];
    restore({ schemaVersion: 1, document: { records: [] } }, { onError: (i) => issues.push(i) });
    restore({ schemaVersion: 0, document: { records: [] } }, { onError: (i) => issues.push(i) });
    restore({ document: { records: [] } } as unknown as Snapshot, { onError: (i) => issues.push(i) });
    expect(issues).toEqual([]);
  });
});

describe('6. toCanonicalString — non-finite numbers surface, bytes unchanged', () => {
  it('warns when Infinity/NaN are written as null, but emits bytes identical to a literal null', () => {
    const issues: SerializationIssue[] = [];
    const inf = toCanonicalString(serializeRecords([nodeRec('n1', {}, { rate: Infinity })]), { onError: (i) => issues.push(i) });
    const nul = toCanonicalString(serializeRecords([nodeRec('n1', {}, { rate: null })]));
    expect(inf).toBe(nul); // JSON already coerces Infinity → null; canonical bytes must not change
    expect(issues.some((i) => i.code === 'non-finite-number')).toBe(true);
  });

  it('does not warn for ordinary finite numbers', () => {
    const issues: SerializationIssue[] = [];
    toCanonicalString(serializeRecords([nodeRec('n1', {}, { rate: 42, n: -3.5 })]), { onError: (i) => issues.push(i) });
    expect(issues).toEqual([]);
  });
});

// Audit 2026-07-22 (M1): the iterative stableStringify rewrite closed the overflow in the canonical
// writer, but the diff (`sameContent`), share-link (`encodeScene`), and autosave (`serializeDocument`)
// writers still feed the SAME untrusted record through NATIVE `JSON.stringify`, which overflows on a
// deeply-nested `props`. restore() now rejects such a record at the trust boundary so no downstream
// serializer ever sees it. These fail pre-fix (deep record survived restore → native stringify threw).
describe('M1. restore — rejects a record too deeply nested to serialize', () => {
  const deepProps = (depth: number): Record<string, unknown> => {
    const root: Record<string, unknown> = {};
    let cur = root;
    for (let i = 0; i < depth; i++) {
      const next: Record<string, unknown> = {};
      cur.a = next;
      cur = next;
    }
    return root;
  };

  it('drops an over-deep record and reports excess-nesting, keeping healthy siblings', () => {
    const issues: SerializationIssue[] = [];
    const res = restore(snap([nodeRec('ok'), nodeRec('evil', {}, deepProps(12_000))]), { onError: (i) => issues.push(i) });
    expect(res.records.map((r) => r.id)).toEqual(['ok']); // deep record dropped, healthy one kept
    expect(issues.some((i) => i.code === 'excess-nesting')).toBe(true);
  });

  it('leaves the restored records safe for the native-JSON.stringify sinks (diff / share / autosave)', () => {
    const res = restore(snap([nodeRec('ok'), nodeRec('evil', {}, deepProps(12_000))]));
    // Pre-fix the ~12k-deep record survived restore() and overflowed native JSON.stringify downstream.
    expect(() => JSON.stringify(res.records)).not.toThrow();
  });

  it('preserves a legitimately nested record well under the cap', () => {
    const issues: SerializationIssue[] = [];
    const res = restore(snap([nodeRec('cfg', {}, deepProps(32))]), { onError: (i) => issues.push(i) });
    expect(res.records.map((r) => r.id)).toEqual(['cfg']);
    expect(issues.some((i) => i.code === 'excess-nesting')).toBe(false);
  });
});
