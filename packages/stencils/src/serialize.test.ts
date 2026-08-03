import { describe, it, expect } from 'vitest';
import { restore, type NodusRecord, type Snapshot } from '@nodus-dev/core';
import { serializeLibrary, parseLibrary } from './serialize.js';
import { builtinStencils, builtinTemplates } from './builtin.js';
import type { StencilLibrary } from './types.js';

describe('serializeLibrary', () => {
  it('is byte-stable and emits sorted keys', () => {
    // Keys are inserted in NON-sorted order on purpose; a canonical serializer must reorder them.
    const lib: StencilLibrary = {
      stencils: [{ records: [], name: 'Box', id: 's1' }],
      name: 'Tiny',
    };
    const expected = '{"name":"Tiny","stencils":[{"id":"s1","name":"Box","records":[]}]}\n';

    const a = serializeLibrary(lib);
    const b = serializeLibrary(lib);
    expect(a).toBe(b); // byte-stable across calls
    expect(a).toBe(expected); // exact bytes prove keys are sorted (id < name < records; name < stencils)
    expect(a.endsWith('\n')).toBe(true); // trailing newline (POSIX-friendly, clean diffs)
  });
});

describe('parseLibrary', () => {
  it('round-trips a library through serialize → parse (deep-equal)', () => {
    const node: NodusRecord = {
      id: 'node:x',
      typeName: 'node',
      version: 0,
      type: 'rect',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      z: 'a0',
      visual: { state: 'solid' },
      props: {},
    };
    const lib: StencilLibrary = {
      name: 'Round',
      stencils: [
        { id: 's1', name: 'One', tags: ['a'], records: [] },
        { id: 's2', name: 'Two', records: [node] },
      ],
    };
    expect(parseLibrary(serializeLibrary(lib))).toEqual(lib);
  });

  it('drops a malformed stencil without throwing, keeping the valid ones', () => {
    const json = JSON.stringify({
      name: 'Mixed',
      stencils: [
        { id: 's1', name: 'Good', records: [] },
        { id: 'x' }, // malformed: missing `name` and `records`
        { id: 's2', name: 'AlsoGood', records: [] },
      ],
    });
    const lib = parseLibrary(json);
    expect(lib.name).toBe('Mixed');
    expect(lib.stencils.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('throws on totally invalid JSON', () => {
    expect(() => parseLibrary('{ not json')).toThrow();
  });
});

describe('built-in content is valid engine data', () => {
  it('every builtin stencil restores intact (no dropped edges or records)', () => {
    expect(builtinStencils.stencils.length).toBeGreaterThan(0);
    for (const s of builtinStencils.stencils) {
      const snap: Snapshot = { schemaVersion: 1, document: { records: s.records } };
      const res = restore(snap);
      expect(res.droppedEdges).toBe(0);
      expect(s.records.length).toBeGreaterThan(0); // stencils are non-empty fragments
      expect(res.records.length).toBe(s.records.length); // nothing dropped
    }
  });

  it('every builtin template restores intact (no dropped edges or records)', () => {
    expect(builtinTemplates.length).toBeGreaterThan(0);
    for (const t of builtinTemplates) {
      const res = restore(t.snapshot);
      expect(res.droppedEdges).toBe(0);
      expect(res.records.length).toBe(t.snapshot.document.records.length); // nothing dropped
    }
  });

  it('has a non-blank template whose edges all survive restore', () => {
    const withEdges = builtinTemplates.find((t) =>
      t.snapshot.document.records.some((r) => r.typeName === 'edge'),
    );
    expect(withEdges).toBeDefined();
    const res = restore(withEdges!.snapshot);
    const edges = res.records.filter((r) => r.typeName === 'edge');
    expect(edges.length).toBeGreaterThan(0);
  });
});
