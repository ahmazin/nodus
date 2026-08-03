import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, isNodusError } from '@nodus-dev/core';
import { HttpDocStore, MemoryDocStore, autosave, loadDoc } from '@nodus-dev/persistence';

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

describe('HttpDocStore failure semantics (F43)', () => {
  afterEach(() => vi.unstubAllGlobals());

  // Route every fetch through `impl`; the store only cares about `.ok`/`.status`/`.json`/`.text`.
  const stubFetch = (impl: (url: string, init?: RequestInit) => Response): void => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => impl(String(input), init)));
  };
  // Resolve to the value a promise REJECTS with; fail loudly if it unexpectedly resolves (which is
  // exactly the pre-fix behavior for list()/remove()).
  const rejection = async (p: Promise<unknown>): Promise<unknown> => {
    try {
      await p;
    } catch (e) {
      return e;
    }
    throw new Error('expected the promise to reject, but it resolved');
  };

  it('load() on 500 throws a typed NodusError carrying the status — not a bare Error', async () => {
    stubFetch(() => new Response('kaboom', { status: 500 }));
    const err = await rejection(new HttpDocStore('http://api').load('doc'));
    expect(isNodusError(err)).toBe(true);
    expect(err).toMatchObject({ code: 'persistence/load-failed', context: { op: 'load', status: 500, body: 'kaboom' } });
  });

  it('load() on 404 returns null (no throw) — null stays reserved for "absent"', async () => {
    stubFetch(() => new Response(null, { status: 404 }));
    expect(await new HttpDocStore('http://api').load('missing')).toBeNull();
  });

  it('list() on a non-OK response throws instead of masking the failure as an empty list', async () => {
    stubFetch(() => new Response('down', { status: 503 }));
    const err = await rejection(new HttpDocStore('http://api').list());
    expect(isNodusError(err)).toBe(true);
    expect(err).toMatchObject({ code: 'persistence/list-failed', context: { op: 'list', status: 503 } });
  });

  it('save() on 500 throws a typed NodusError', async () => {
    stubFetch(() => new Response(null, { status: 500 }));
    const ed = new Editor();
    ed.createNode({ type: 'rect' });
    const err = await rejection(new HttpDocStore('http://api').save('doc', ed.toJSON()));
    expect(isNodusError(err)).toBe(true);
    expect(err).toMatchObject({ code: 'persistence/save-failed', context: { op: 'save', status: 500 } });
  });

  it('remove() on 500 throws — a rejected delete never reports success', async () => {
    stubFetch(() => new Response(null, { status: 500 }));
    const err = await rejection(new HttpDocStore('http://api').remove('doc'));
    expect(isNodusError(err)).toBe(true);
    expect(err).toMatchObject({ code: 'persistence/remove-failed', context: { op: 'remove', status: 500 } });
  });

  it('keeps the happy paths working (200 list/load, 204 remove)', async () => {
    stubFetch((url, init) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.endsWith('/docs')) return new Response(JSON.stringify([{ name: 'a', updated: 5, nodes: 1, edges: 0 }]), { status: 200 });
      return new Response(JSON.stringify({ schemaVersion: 1, document: { records: [] }, meta: {} }), { status: 200 });
    });
    const store = new HttpDocStore('http://api');
    expect((await store.list())[0]!.name).toBe('a');
    expect(await store.load('doc')).toMatchObject({ document: { records: [] } });
    await expect(store.remove('doc')).resolves.toBeUndefined();
  });
});
