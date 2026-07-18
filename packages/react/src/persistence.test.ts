/**
 * Pure-logic tests for browser persistence. The DOM-driven surface (`useAutosave`, `saveToFile`,
 * `openFromFile`) needs a browser and is covered by the Playwright drive of the example app; here we
 * pin the headless core: snapshot parse/validation and a full serialize -> parse -> reload round-trip
 * through a real (headless) `Editor`.
 */

import { describe, expect, it } from 'vitest';
import { Editor } from '@nodus/core';
import { parseSnapshot, serializeDocument } from './persistence.js';

function makeEditor(): Editor {
  return new Editor({ viewport: { w: 800, h: 600 } });
}

describe('parseSnapshot', () => {
  it('throws on malformed JSON', () => {
    expect(() => parseSnapshot('{ not json')).toThrow();
  });

  it('rejects structurally-invalid documents', () => {
    expect(() => parseSnapshot('null')).toThrow(/valid Nodus document/);
    expect(() => parseSnapshot('{}')).toThrow(/valid Nodus document/);
    expect(() => parseSnapshot('{"schemaVersion":1}')).toThrow(/valid Nodus document/);
    expect(() => parseSnapshot('{"schemaVersion":"1","document":{"records":[]}}')).toThrow(
      /valid Nodus document/,
    );
  });

  it('accepts a well-formed empty document', () => {
    const snap = parseSnapshot('{"schemaVersion":1,"document":{"records":[]}}');
    expect(snap.schemaVersion).toBe(1);
    expect(snap.document.records).toEqual([]);
  });
});

describe('serialize -> parse -> reload round-trip', () => {
  it('preserves nodes across a document round-trip', () => {
    const a = makeEditor();
    const idA = a.createNode({ type: 'rect', x: 10, y: 20, label: 'alpha' });
    const idB = a.createNode({ type: 'rect', x: 300, y: 140, label: 'beta' });

    const text = serializeDocument(a);
    const snap = parseSnapshot(text);
    expect(snap.document.records.length).toBe(2);

    const b = makeEditor();
    b.loadSnapshot(snap);

    const nodes = b.store.nodes();
    expect(nodes.length).toBe(2);

    const reA = b.store.get(idA);
    const reB = b.store.get(idB);
    expect(reA).toMatchObject({ x: 10, y: 20, label: 'alpha' });
    expect(reB).toMatchObject({ x: 300, y: 140, label: 'beta' });
  });

  it('produces byte-identical output when re-serialized after reload', () => {
    const a = makeEditor();
    a.createNode({ type: 'rect', x: 5, y: 5 });

    const first = serializeDocument(a);
    const b = makeEditor();
    b.loadSnapshot(parseSnapshot(first));

    // Compare the document body only — `meta.updated` is a wall-clock stamp that legitimately differs.
    const bodyOf = (text: string): unknown => JSON.parse(text).document;
    expect(bodyOf(serializeDocument(b))).toEqual(bodyOf(first));
  });
});
