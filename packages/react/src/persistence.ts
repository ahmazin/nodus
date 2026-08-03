/**
 * Browser-side document persistence for the Nodus web layer.
 *
 * This is a thin binding over the engine's canonical serialization (`editor.toJSON()` /
 * `editor.loadSnapshot()`) — no new package dependency, no bespoke document format. It offers:
 *   - `useAutosave(editor, { key })` — a debounced localStorage save that fires on *document*
 *     mutation (the `store.sceneNonce` signal), survives reload, and is safe under SSR / disabled
 *     storage.
 *   - `restoreAutosave(editor, key)` — load a previous autosave on mount, if any.
 *   - `saveToFile` / `openFromFile` — download / pick a `.nodus.json` document.
 *   - `parseSnapshot(text)` — parse + shape-validate a document, throwing on bad input (never a
 *     silent catch), so callers can surface a real error to the user.
 */

import { useEffect } from 'react';
import { effect, type Dispose, type Editor, type Snapshot } from '@nodus-dev/core';

/** localStorage namespace so autosaves never collide with other app keys. */
const AUTOSAVE_PREFIX = 'nodus:autosave:';
/** Default download name; every saved document ends in `.nodus.json`. */
const DEFAULT_FILENAME = 'diagram.nodus.json';
const NODUS_EXT = '.nodus.json';

// ---------------------------------------------------------------------------
// Snapshot (de)serialization — pure, DOM-free, unit-testable
// ---------------------------------------------------------------------------

/** Serialize the editor's current document to pretty JSON text (human-diffable). */
export function serializeDocument(editor: Editor): string {
  return JSON.stringify(editor.toJSON({ updated: Date.now() }), null, 2);
}

/**
 * Parse document text into a `Snapshot`, validating enough of the shape to fail loudly on garbage
 * (a truncated file, the wrong JSON, an empty string). Throws `SyntaxError` for invalid JSON and
 * `Error` for a structurally-wrong document. Never swallows — the caller decides how to report.
 */
/**
 * Upper bound on a document's serialized size, enforced before the main-thread `JSON.parse`. Every
 * untrusted load path funnels through here (file open, persistence load, and — via `decodeScene` — a
 * `#scene=` share link), so one cap keeps a multi-megabyte blob from freezing the tab / exhausting
 * memory (pre-publication audit M2). ~8 MB is far above any hand-authored diagram.
 */
export const MAX_SNAPSHOT_BYTES = 8_000_000;

export function parseSnapshot(text: string): Snapshot {
  if (text.length > MAX_SNAPSHOT_BYTES) {
    throw new Error(`Document too large (${text.length} bytes > ${MAX_SNAPSHOT_BYTES} cap).`);
  }
  const data: unknown = JSON.parse(text); // throws SyntaxError on malformed JSON — let it propagate
  if (
    data === null ||
    typeof data !== 'object' ||
    typeof (data as { schemaVersion?: unknown }).schemaVersion !== 'number' ||
    !Array.isArray((data as { document?: { records?: unknown } }).document?.records)
  ) {
    throw new Error('Not a valid Nodus document (expected { schemaVersion, document.records }).');
  }
  return data as Snapshot;
}

// ---------------------------------------------------------------------------
// localStorage helpers — SSR / private-mode safe
// ---------------------------------------------------------------------------

/** Return a usable `Storage`, or `null` when unavailable (SSR, disabled, or private-mode throw). */
function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // Some browsers throw on `localStorage` access when storage is blocked.
    return null;
  }
}

/** Persist the editor's document under an autosave key. Returns false when storage is unavailable. */
function writeAutosave(editor: Editor, key: string): boolean {
  const store = safeStorage();
  if (!store) return false;
  store.setItem(AUTOSAVE_PREFIX + key, serializeDocument(editor));
  return true;
}

/**
 * Load a previously autosaved document into the editor. Returns `true` if one was found and loaded,
 * `false` if there was nothing to restore. A corrupt autosave throws (via `parseSnapshot`) so the
 * caller can decide whether to clear it — we never silently discard user data.
 */
export function restoreAutosave(editor: Editor, key: string, opts: { fit?: boolean } = {}): boolean {
  const store = safeStorage();
  if (!store) return false;
  const text = store.getItem(AUTOSAVE_PREFIX + key);
  if (text == null) return false;
  editor.loadSnapshot(parseSnapshot(text), { fit: opts.fit ?? true });
  return true;
}

/** Remove a stored autosave (e.g. after a corrupt-restore recovery). No-op without storage. */
export function clearAutosave(key: string): void {
  safeStorage()?.removeItem(AUTOSAVE_PREFIX + key);
}

// ---------------------------------------------------------------------------
// useAutosave — debounced, document-mutation-driven
// ---------------------------------------------------------------------------

export interface UseAutosaveOptions {
  /** Storage slot; namespaced under `nodus:autosave:`. */
  key: string;
  /** Idle window before a save fires (default 800ms). */
  debounceMs?: number;
  /** Called after each successful write, with the storage key. */
  onSaved?: (key: string) => void;
  /** Called if a write throws (e.g. quota exceeded). Defaults to `console.error`. */
  onError?: (err: unknown) => void;
}

/**
 * Debounced autosave. Subscribes to `editor.store.sceneNonce` — the engine's "document changed"
 * counter — and writes `editor.toJSON()` to localStorage after edits settle. A trailing edit is
 * flushed on `pagehide` (reliable across reloads/bfcache) and on unmount, so nothing within the last
 * debounce window is dropped. SSR/no-storage safe: the effect still tracks the signal but writes
 * become no-ops.
 */
export function useAutosave(editor: Editor, options: UseAutosaveOptions): void {
  const { key, debounceMs = 800, onSaved, onError } = options;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let first = true;
    let disposed = false;

    const flush = (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        if (writeAutosave(editor, key)) onSaved?.(key);
      } catch (err) {
        (onError ?? ((e: unknown) => console.error('[nodus] autosave failed', e)))(err);
      }
    };

    const stop: Dispose = effect(() => {
      editor.store.sceneNonce.get(); // subscribe: fires on every applied document mutation
      if (first) {
        // The effect body runs once at creation to register the dependency — that isn't an edit.
        first = false;
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!disposed) flush();
      }, debounceMs);
    });

    const onHide = (): void => {
      if (timer) flush(); // don't lose an edit made within the last debounce window
    };
    const hasWindow = typeof window !== 'undefined';
    if (hasWindow) window.addEventListener('pagehide', onHide);

    return () => {
      disposed = true;
      if (hasWindow) window.removeEventListener('pagehide', onHide);
      if (timer) flush(); // flush the pending edit rather than dropping it on unmount
      stop();
    };
  }, [editor, key, debounceMs, onSaved, onError]);
}

// ---------------------------------------------------------------------------
// File open / save — DOM-driven
// ---------------------------------------------------------------------------

/** Ensure a filename carries the `.nodus.json` extension. */
function withNodusExt(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return DEFAULT_FILENAME;
  if (trimmed.endsWith(NODUS_EXT)) return trimmed;
  return trimmed.replace(/\.json$/i, '') + NODUS_EXT;
}

/**
 * Download the editor's document as a `.nodus.json` file. No-op outside the browser. The `filename`
 * is normalized to end in `.nodus.json`.
 */
export function saveToFile(editor: Editor, filename = DEFAULT_FILENAME): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([serializeDocument(editor)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = withNodusExt(filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has started reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Open a native file picker and load the chosen `.nodus.json` into the editor. Resolves `true` when
 * a document is loaded, `false` when the picker is dismissed with no file. A malformed file
 * **rejects** (via `parseSnapshot`) — the caller should surface the error, not ignore it.
 */
export function openFromFile(editor: Editor, opts: { fit?: boolean } = {}): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  return new Promise<boolean>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${NODUS_EXT},application/json`;
    input.style.display = 'none';
    document.body.appendChild(input);

    const cleanup = (): void => input.remove();
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        cleanup();
        resolve(false);
        return;
      }
      file
        .text()
        .then((text) => {
          editor.loadSnapshot(parseSnapshot(text), { fit: opts.fit ?? true });
          cleanup();
          resolve(true);
        })
        .catch((err) => {
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
    input.click();
  });
}
