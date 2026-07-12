import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@nodus/core';
import { MemoryDocStore, autosave, loadDoc } from '@nodus/persistence';

describe('persistence', () => {
  it('MemoryDocStore round-trips a snapshot and lists metadata', async () => {
    const s = new MemoryDocStore();
    const ed = new Editor();
    ed.createNode({ type: 'rect', label: 'A' });
    await s.save('d', ed.toJSON({ updated: 123 }));
    const loaded = await s.load('d');
    expect(loaded?.document.records).toHaveLength(1);
    const list = await s.list();
    expect(list[0]!.name).toBe('d');
    expect(list[0]!.nodes).toBe(1);
    expect(list[0]!.updated).toBe(123);
  });

  it('autosave writes ONE debounced snapshot after a burst of edits settles', async () => {
    vi.useFakeTimers();
    const ed = new Editor();
    const store = new MemoryDocStore();
    let saved = 0;
    const stop = autosave(ed, store, 'my-doc', { debounceMs: 100, onSaved: () => saved++ });
    ed.createNode({ type: 'rect' });
    ed.createNode({ type: 'rect' }); // two rapid edits
    expect(await store.load('my-doc')).toBeNull(); // nothing yet (debounced)
    await vi.advanceTimersByTimeAsync(120);
    const doc = await store.load('my-doc');
    expect(doc?.document.records).toHaveLength(2);
    expect(saved).toBe(1); // coalesced into a single save
    stop();
    vi.useRealTimers();
  });

  it('autosave flushes a pending edit on teardown instead of dropping it', async () => {
    vi.useFakeTimers();
    const ed = new Editor();
    const store = new MemoryDocStore();
    let saved = 0;
    const stop = autosave(ed, store, 'doc', { debounceMs: 800, onSaved: () => saved++ });
    ed.createNode({ type: 'rect' }); // edit lands, debounce armed but not yet fired
    expect(await store.load('doc')).toBeNull(); // still pending
    stop(); // teardown BEFORE the debounce fires — the edit must not be lost
    await vi.advanceTimersByTimeAsync(0);
    const doc = await store.load('doc');
    expect(doc?.document.records).toHaveLength(1); // flushed on dispose
    expect(saved).toBe(1);
    vi.useRealTimers();
  });

  it('loadDoc restores a saved doc (incl. outline edges) into a fresh editor', async () => {
    const store = new MemoryDocStore();
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 200, y: 0 });
    ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b });
    await store.save('graph', ed.toJSON());

    const ed2 = new Editor();
    expect(await loadDoc(ed2, store, 'graph')).toBe(true);
    expect(ed2.store.nodes()).toHaveLength(2);
    expect(ed2.store.edges()).toHaveLength(1);
    expect(await loadDoc(ed2, store, 'does-not-exist')).toBe(false);
  });
});
