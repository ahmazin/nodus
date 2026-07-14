/**
 * @nodus/persistence — trustworthy document persistence.
 *  - `DocStore` implementations: `HttpDocStore` (a doc API), `LocalDocStore` (localStorage crash
 *    recovery), `MemoryDocStore` (tests).
 *  - `autosave(editor, store, name)` — a debounced effect on the store version; one save per burst.
 *  - `loadDoc(editor, store, name)` — restore a named doc.
 * The document format is the versioned `Snapshot` with defensive restore, so this is a thin layer.
 */

import { effect, toCanonicalString, type Dispose, type Editor, type Snapshot } from '@nodus/core';

export interface DocMeta {
  name: string;
  updated: number;
  nodes: number;
  edges: number;
}

export interface DocStore {
  list(): Promise<DocMeta[]>;
  load(name: string): Promise<Snapshot | null>;
  save(name: string, snapshot: Snapshot): Promise<void>;
  remove(name: string): Promise<void>;
}

function metaFor(name: string, snap: Snapshot): DocMeta {
  const recs = snap.document?.records ?? [];
  return {
    name,
    updated: typeof snap.meta?.updated === 'number' ? snap.meta.updated : 0,
    nodes: recs.filter((r) => r.typeName === 'node').length,
    edges: recs.filter((r) => r.typeName === 'edge').length,
  };
}

// ---------------------------------------------------------------------------
// stores
// ---------------------------------------------------------------------------
export class MemoryDocStore implements DocStore {
  private readonly m = new Map<string, Snapshot>();
  async list(): Promise<DocMeta[]> {
    return [...this.m].map(([name, s]) => metaFor(name, s)).sort((a, b) => b.updated - a.updated);
  }
  async load(name: string): Promise<Snapshot | null> {
    return this.m.get(name) ?? null;
  }
  async save(name: string, snapshot: Snapshot): Promise<void> {
    this.m.set(name, JSON.parse(JSON.stringify(snapshot)) as Snapshot);
  }
  async remove(name: string): Promise<void> {
    this.m.delete(name);
  }
}

const LS_PREFIX = 'nodus:doc:';
export class LocalDocStore implements DocStore {
  constructor(private readonly prefix = LS_PREFIX) {}
  async list(): Promise<DocMeta[]> {
    const out: DocMeta[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(this.prefix)) continue;
      try {
        out.push(metaFor(k.slice(this.prefix.length), JSON.parse(localStorage.getItem(k)!) as Snapshot));
      } catch {
        /* skip corrupt entry */
      }
    }
    return out.sort((a, b) => b.updated - a.updated);
  }
  async load(name: string): Promise<Snapshot | null> {
    const v = localStorage.getItem(this.prefix + name);
    return v ? (JSON.parse(v) as Snapshot) : null;
  }
  async save(name: string, snapshot: Snapshot): Promise<void> {
    localStorage.setItem(this.prefix + name, JSON.stringify(snapshot));
  }
  async remove(name: string): Promise<void> {
    localStorage.removeItem(this.prefix + name);
  }
}

/** Talks to the Nodus doc server (see scripts/doc-server.mjs). */
export class HttpDocStore implements DocStore {
  constructor(private readonly baseUrl: string) {}
  private url(name?: string): string {
    return name ? `${this.baseUrl}/docs/${encodeURIComponent(name)}` : `${this.baseUrl}/docs`;
  }
  async list(): Promise<DocMeta[]> {
    const r = await fetch(this.url());
    return r.ok ? ((await r.json()) as DocMeta[]) : [];
  }
  async load(name: string): Promise<Snapshot | null> {
    const r = await fetch(this.url(name));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`load failed: ${r.status}`);
    return (await r.json()) as Snapshot;
  }
  async save(name: string, snapshot: Snapshot): Promise<void> {
    // Git-facing writer: emit canonical bytes so the committed file has a clean, minimal diff.
    // (LocalDocStore/MemoryDocStore stay on JSON.stringify — their doc-list sort reads meta.updated,
    // which canonical bytes intentionally drop.)
    const r = await fetch(this.url(name), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: toCanonicalString(snapshot) });
    if (!r.ok) throw new Error(`save failed: ${r.status}`);
  }
  async remove(name: string): Promise<void> {
    await fetch(this.url(name), { method: 'DELETE' });
  }
}

// ---------------------------------------------------------------------------
// autosave + load
// ---------------------------------------------------------------------------
export interface AutosaveOptions {
  debounceMs?: number;
  onSaved?: (name: string) => void;
  onError?: (err: unknown) => void;
}

/** Debounced autosave: saves `editor.toJSON()` under `name` after edits settle. Returns a disposer. */
export function autosave(editor: Editor, store: DocStore, name: string, opts: AutosaveOptions = {}): Dispose {
  const debounceMs = opts.debounceMs ?? 800;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let first = true;
  let disposed = false;
  // Persist immediately, cancelling any pending debounce. Called on the debounce fire, on teardown,
  // and on tab-close — so an edit made within the last debounceMs is never silently dropped.
  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const snap = editor.toJSON({ updated: Date.now() });
    Promise.resolve(store.save(name, snap))
      .then(() => opts.onSaved?.(name))
      .catch((e) => opts.onError?.(e));
  };
  const stop = effect(() => {
    editor.store.sceneNonce.get(); // track any document change
    if (first) {
      first = false;
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!disposed) flush();
    }, debounceMs);
  });
  // Flush the trailing edit if the tab is hidden/closed before the debounce fires (pagehide is the
  // reliable cross-browser signal, and works with the bfcache). Sync stores (localStorage) complete.
  const onHide = (): void => {
    if (timer) flush();
  };
  const hasWin = typeof window !== 'undefined';
  if (hasWin) window.addEventListener('pagehide', onHide);
  return () => {
    disposed = true;
    if (hasWin) window.removeEventListener('pagehide', onHide);
    if (timer) flush(); // flush the pending edit instead of dropping it on teardown
    stop();
  };
}

/** Load a named doc into the editor. Returns false if the doc does not exist. */
export async function loadDoc(editor: Editor, store: DocStore, name: string, opts: { fit?: boolean } = {}): Promise<boolean> {
  const snap = await store.load(name);
  if (!snap) return false;
  editor.loadSnapshot(snap, { fit: opts.fit ?? true });
  return true;
}
