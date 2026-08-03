/**
 * In-app "PR-review" branching over `.nodus.json`.
 *
 * There is NO real git here. "main" is an in-memory `Snapshot` baseline, persisted to localStorage,
 * that the working document is diffed against. `useBranch` tracks whether the working tree diverges
 * from that baseline and exposes `merge` (baseline := working tree) and `discard` (working tree :=
 * baseline). `computeBranch` is the pure, framework-free core of the comparison — a canonical line
 * diff (for the GitHub-style review view) plus the engine's record-level diff (for the summary).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { diff, restore, toCanonicalString } from '@nodus-dev/core';
import type { Editor, Snapshot, DiffResult } from '@nodus-dev/core';
import { unifiedDiff } from './unified-diff.js';
import type { UnifiedDiffResult } from './unified-diff.js';
import { useValue } from './use-value.js';

// ---------------------------------------------------------------------------
// Pure comparison
// ---------------------------------------------------------------------------

export interface BranchComparison {
  /** Line diff of the two documents' canonical form: baseline (old) -> working (new). */
  unified: UnifiedDiffResult;
  /** Core record-level diff: added / removed / changed record ids. */
  semantic: DiffResult;
  /** Count of added canonical lines (=== `unified.adds`). */
  adds: number;
  /** Count of removed canonical lines (=== `unified.dels`). */
  dels: number;
  /** Whether the working tree diverges from the baseline (`adds + dels > 0`). */
  dirty: boolean;
}

/**
 * Compare a baseline snapshot against a working snapshot. Pure — no React, no DOM, no I/O.
 *
 * The line diff runs over `toCanonicalString` (one record per line, sorted by identity) so an added
 * record is +1 line, a removed record is -1 line, and an in-place edit is exactly 1 del + 1 add.
 *
 * Both sides are normalized through `restore` before the semantic diff: core's `diff` compares
 * records via plain `JSON.stringify` and is therefore key-order sensitive, so restoring both sides
 * guarantees a consistent key order and avoids spurious "changed" entries.
 */
export function computeBranch(baseline: Snapshot, working: Snapshot): BranchComparison {
  const unified = unifiedDiff(toCanonicalString(baseline), toCanonicalString(working));
  const semantic = diff(restore(baseline).records, restore(working).records);
  const adds = unified.adds;
  const dels = unified.dels;
  return { unified, semantic, adds, dels, dirty: adds + dels > 0 };
}

/** A zeroed comparison, returned while the baseline has not yet been captured. */
const EMPTY_COMPARISON: BranchComparison = {
  unified: { lines: [], adds: 0, dels: 0, changed: false },
  semantic: { added: [], removed: [], changed: [] },
  adds: 0,
  dels: 0,
  dirty: false,
};

// ---------------------------------------------------------------------------
// Version stack — the in-app "version history"
// ---------------------------------------------------------------------------

/** A saved document version: a labeled snapshot with a wall-clock capture time and a stable id. */
export interface VersionEntry {
  /** Stable, opaque id (generation lives in the hook, not the pure helper). */
  id: string;
  /** Human label — a manual title, or an auto `main @ HH:MM` stamp captured on merge. */
  label: string;
  /** Capture time (`Date.now()` at save/merge); rendered as a relative "5m ago" string. */
  at: number;
  /** The captured document. */
  snapshot: Snapshot;
}

/** Default maximum number of retained versions — oldest are dropped past this. */
const DEFAULT_VERSION_CAP = 30;

/**
 * Prepend `entry` as the newest version and cap the list length, dropping the oldest.
 *
 * Pure and side-effect-free: returns a NEW array (never mutates `list`), so it is safe to unit-test
 * and to use as a React state updater. `id`/`at` generation deliberately lives in the hook — this
 * helper only owns ordering (newest-first) and the length cap.
 */
export function pushVersion(
  list: VersionEntry[],
  entry: VersionEntry,
  cap: number = DEFAULT_VERSION_CAP,
): VersionEntry[] {
  return [entry, ...list].slice(0, Math.max(0, cap));
}

// ---------------------------------------------------------------------------
// localStorage helpers — SSR / private-mode safe (mirrors persistence.ts)
// ---------------------------------------------------------------------------

/** Return a usable `Storage`, or `null` when unavailable (SSR, disabled, or private-mode throw). */
function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Structural shape check for a persisted baseline — the same contract as `parseSnapshot`. */
function isSnapshotShape(data: unknown): data is Snapshot {
  return (
    data !== null &&
    typeof data === 'object' &&
    typeof (data as { schemaVersion?: unknown }).schemaVersion === 'number' &&
    Array.isArray((data as { document?: { records?: unknown } }).document?.records)
  );
}

/** Read a persisted baseline, or `null` when absent / unavailable / malformed. Never throws. */
function readStoredSnapshot(key: string): Snapshot | null {
  const store = safeStorage();
  if (!store) return null;
  try {
    const text = store.getItem(key);
    if (text == null) return null;
    const data: unknown = JSON.parse(text);
    return isSnapshotShape(data) ? data : null;
  } catch {
    return null;
  }
}

/** Persist a baseline. Best-effort: swallows quota / serialization errors (like persistence.ts). */
function persistSnapshot(key: string, snap: Snapshot): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(snap));
  } catch {
    // best-effort — a full or serialization-hostile store just means no persisted baseline
  }
}

/** Structural shape check for a persisted `VersionEntry`. */
function isVersionEntryShape(data: unknown): data is VersionEntry {
  if (data === null || typeof data !== 'object') return false;
  const v = data as VersionEntry;
  return (
    typeof v.id === 'string' &&
    typeof v.label === 'string' &&
    typeof v.at === 'number' &&
    isSnapshotShape(v.snapshot)
  );
}

/** Read the persisted version stack, or `[]` when absent / unavailable / malformed. Never throws. */
function readStoredVersions(key: string): VersionEntry[] {
  const store = safeStorage();
  if (!store) return [];
  try {
    const text = store.getItem(key);
    if (text == null) return [];
    const data: unknown = JSON.parse(text);
    if (!Array.isArray(data)) return [];
    return data.filter(isVersionEntryShape).slice(0, DEFAULT_VERSION_CAP);
  } catch {
    return [];
  }
}

/** Persist the version stack. Best-effort: swallows quota / serialization errors. */
function persistVersions(key: string, list: VersionEntry[]): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(list));
  } catch {
    // best-effort — a full store just means the history is not persisted across reloads
  }
}

/** A short, collision-resistant id for a saved version. Runtime-only (uses `Date.now`/`Math.random`). */
function genVersionId(): string {
  return `v${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A short `HH:MM` clock stamp for `at`, used in auto (merge) and default (manual) version labels. */
function clockLabel(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ---------------------------------------------------------------------------
// useBranch — the reactive hook
// ---------------------------------------------------------------------------

export interface BranchInfo extends BranchComparison {
  /** Display name of the in-memory branch (default `'main'`). */
  branchName: string;
  /** The current baseline snapshot the working tree is compared against. */
  baseline: Snapshot;
  /** False until the baseline has been captured (see the effect-ordering note in `useBranch`). */
  ready: boolean;
  /** Adopt the working tree as the new baseline and persist it. Now not dirty. */
  merge: () => void;
  /** Reset the working tree to the baseline (no fit — preserves camera). Clears undo history. */
  discard: () => void;
  /** Saved document versions, newest first (see `saveVersion` / auto-capture on `merge`). */
  versions: VersionEntry[];
  /** Push the CURRENT document onto the version stack under `label` (or a default `Saved @ HH:MM`). */
  saveVersion: (label?: string) => void;
  /** Load a saved version by id back onto the canvas (no fit — preserves camera). */
  restoreVersion: (id: string) => void;
}

export interface UseBranchOptions {
  /** localStorage slot for the persisted baseline (default `'nodus.playground.main'`). */
  storageKey?: string;
  /** localStorage slot for the persisted version stack (default `'nodus.playground.versions'`). */
  versionsKey?: string;
  /** Display name of the branch (default `'main'`). */
  branchName?: string;
}

interface BranchState {
  baseline: Snapshot;
  ready: boolean;
}

/**
 * Track how the working document diverges from an in-memory "main" baseline.
 *
 * Baseline capture handles a React effect-ordering trap: child effects fire before parent effects,
 * so a naive mount-time `editor.toJSON()` would snapshot the transient seed model BEFORE the parent
 * app's `restoreAutosave` mount effect loads the real document. To avoid that:
 *   - If a valid baseline is already persisted, use it immediately (`ready = true`).
 *   - Otherwise capture the baseline deferred to the next macrotask (`setTimeout(…, 0)`), which runs
 *     after all mount effects — including the parent's autosave restore — have settled.
 */
export function useBranch(editor: Editor, opts: UseBranchOptions = {}): BranchInfo {
  const storageKey = opts.storageKey ?? 'nodus.playground.main';
  const versionsKey = opts.versionsKey ?? 'nodus.playground.versions';
  const branchName = opts.branchName ?? 'main';

  const [versions, setVersions] = useState<VersionEntry[]>(() => readStoredVersions(versionsKey));

  const [{ baseline, ready }, setState] = useState<BranchState>(() => {
    const stored = readStoredSnapshot(storageKey);
    if (stored) return { baseline: stored, ready: true };
    // Placeholder baseline; never surfaced meaningfully while `ready` is false (comparison is zeroed).
    return { baseline: editor.toJSON(), ready: false };
  });

  // Deferred first-capture: only when nothing valid was persisted. Runs on the next macrotask so the
  // baseline reflects the document AFTER the parent's mount effects (e.g. autosave restore) have run.
  useEffect(() => {
    if (ready) return;
    const id = setTimeout(() => {
      const snap = editor.toJSON();
      setState({ baseline: snap, ready: true });
      persistSnapshot(storageKey, snap);
    }, 0);
    return () => clearTimeout(id);
    // Mount-only: `ready` is read once here; the timeout flips it to true and this effect does not
    // re-run because `editor`/`storageKey` are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, storageKey]);

  // Recompute the comparison on every applied document mutation. `useValue` subscribes to the store's
  // "document changed" counter and returns a stable number (safe for useSyncExternalStore); the heavy
  // reserialization is deferred to `useMemo`, keyed on that counter + baseline identity.
  const sceneNonce = useValue(() => editor.store.sceneNonce.get());
  const comparison = useMemo<BranchComparison>(() => {
    if (!ready) return EMPTY_COMPARISON;
    return computeBranch(baseline, editor.toJSON());
    // `sceneNonce` participates so a mutation triggers a fresh `editor.toJSON()`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, baseline, sceneNonce, editor]);

  const merge = useCallback(() => {
    // Auto-capture the PREVIOUS baseline as a version BEFORE it is overwritten, so the history
    // becomes the sequence of past "main" states. (Runtime label/id/time — not a tested path.)
    const now = Date.now();
    const prev = baseline;
    setVersions((list) => {
      const next = pushVersion(list, {
        id: genVersionId(),
        label: `${branchName} @ ${clockLabel(now)}`,
        at: now,
        snapshot: prev,
      });
      persistVersions(versionsKey, next);
      return next;
    });
    const snap = editor.toJSON();
    setState({ baseline: snap, ready: true });
    persistSnapshot(storageKey, snap);
  }, [editor, storageKey, versionsKey, baseline, branchName]);

  const discard = useCallback(() => {
    editor.loadSnapshot(baseline); // NO fit — preserve the camera
  }, [editor, baseline]);

  const saveVersion = useCallback(
    (label?: string) => {
      const now = Date.now();
      const entry: VersionEntry = {
        id: genVersionId(),
        label: label ?? `Saved @ ${clockLabel(now)}`,
        at: now,
        snapshot: editor.toJSON(),
      };
      setVersions((list) => {
        const next = pushVersion(list, entry);
        persistVersions(versionsKey, next);
        return next;
      });
    },
    [editor, versionsKey],
  );

  const restoreVersion = useCallback(
    (id: string) => {
      const entry = versions.find((v) => v.id === id);
      if (!entry) return;
      editor.loadSnapshot(entry.snapshot); // NO fit — preserve the camera
    },
    [editor, versions],
  );

  return {
    ...comparison,
    branchName,
    baseline,
    ready,
    merge,
    discard,
    versions,
    saveVersion,
    restoreVersion,
  };
}
