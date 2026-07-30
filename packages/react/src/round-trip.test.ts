/**
 * Pure-logic tests for the text <-> canvas round-trip helpers. Node env, no DOM: these pin the
 * serialization/parse/equality behavior the `CodePanel` sync state machine depends on. The
 * component itself (textarea, gutter, debounce) is verified later by driving the live app.
 */

import { describe, expect, it } from 'vitest';
import { Editor, toCanonicalString } from '@ahmazin/core';
import {
  applySource,
  canonicalOf,
  editorToCanonical,
  editorToSource,
  parseSource,
  sourceMatchesEditor,
} from './round-trip.js';

function makeEditor(): Editor {
  return new Editor({ viewport: { w: 800, h: 600 } });
}

describe('editorToSource / parseSource', () => {
  it('produces valid JSON that parseSource accepts', () => {
    const editor = makeEditor();
    editor.createNode({ type: 'rect', x: 10, y: 20, label: 'alpha' });

    const text = editorToSource(editor);
    expect(() => JSON.parse(text)).not.toThrow();

    const parsed = parseSource(text);
    expect(parsed.ok).toBe(true);
  });

  it('rejects malformed JSON with a non-null line >= 1', () => {
    const r = parseSource('{ not json');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected parse failure');
    expect(r.line).not.toBeNull();
    expect(r.line ?? 0).toBeGreaterThanOrEqual(1);
    expect(r.message).toBeTruthy();
  });

  it('accepts a well-formed minimal document', () => {
    const r = parseSource('{"schemaVersion":1,"document":{"records":[]}}');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected parse success');
    expect(r.snapshot.schemaVersion).toBe(1);
    expect(r.snapshot.document.records).toEqual([]);
  });

  it('reports a structural (non-JSON) error with a null line', () => {
    // Valid JSON, invalid Nodus document — parseSnapshot throws a plain Error with no position.
    const r = parseSource('{"nope":true}');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected parse failure');
    expect(r.line).toBeNull();
    expect(r.column).toBeNull();
  });
});

describe('sourceMatchesEditor', () => {
  it('reports identity source as matching (synced)', () => {
    const editor = makeEditor();
    editor.createNode({ type: 'rect', x: 10, y: 20, label: 'alpha' });
    expect(sourceMatchesEditor(editorToSource(editor), editor)).toBe(true);
  });

  it('reports stale source as not matching after a mutation', () => {
    const editor = makeEditor();
    const id = editor.createNode({ type: 'rect', x: 10, y: 20, label: 'alpha' });
    const before = editorToSource(editor);
    expect(sourceMatchesEditor(before, editor)).toBe(true);

    editor.updateNode(id, { x: 999 });
    expect(sourceMatchesEditor(before, editor)).toBe(false);
  });

  it('never matches on unparseable text', () => {
    const editor = makeEditor();
    editor.createNode({ type: 'rect', x: 1, y: 2 });
    expect(sourceMatchesEditor('{ not json', editor)).toBe(false);
  });
});

describe('editorToCanonical / canonicalOf', () => {
  it('is stable across calls with no mutation and equals canonicalOf(toJSON())', () => {
    const editor = makeEditor();
    editor.createNode({ type: 'rect', x: 10, y: 20, label: 'alpha' });
    editor.createNode({ type: 'rect', x: 40, y: 60, label: 'beta' });

    const a = editorToCanonical(editor);
    const b = editorToCanonical(editor);
    expect(a).toBe(b);
    expect(a).toBe(canonicalOf(editor.toJSON()));
    expect(a).toBe(toCanonicalString(editor.toJSON()));
  });
});

describe('apply round-trip', () => {
  it('losslessly reconstructs the document canonical form into a fresh editor', () => {
    const src = makeEditor();
    src.createNode({ type: 'rect', x: 10, y: 20, label: 'alpha' });
    src.createNode({ type: 'rect', x: 300, y: 140, label: 'beta' });

    const text = editorToSource(src);
    const parsed = parseSource(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('expected parse success');

    const dst = makeEditor();
    applySource(dst, parsed.snapshot);

    expect(editorToCanonical(dst)).toBe(editorToCanonical(src));
  });

  it('applySource preserves the target camera (loads without fit)', () => {
    const src = makeEditor();
    src.createNode({ type: 'rect', x: 5000, y: 5000, label: 'far' });
    const parsed = parseSource(editorToSource(src));
    if (!parsed.ok) throw new Error('expected parse success');

    const dst = makeEditor();
    const cam = { x: dst.camera.x, y: dst.camera.y, z: dst.camera.z };
    applySource(dst, parsed.snapshot);

    // No fit => camera untouched even though the loaded node sits far off the initial viewport.
    expect(dst.camera.x).toBe(cam.x);
    expect(dst.camera.y).toBe(cam.y);
    expect(dst.camera.z).toBe(cam.z);
  });
});
