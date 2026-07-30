/**
 * `nodus fmt` — canonicalize diagram files in place (or verify with `--check`).
 * Pipeline: read → JSON.parse → restore() (normalize + repair dangling edges) → serializeRecords
 * → toCanonicalString. The output is idempotent, so a formatted file re-formats to itself — which
 * is what makes a pre-commit hook and a CI format-gate possible.
 *
 * Write-SAFETY (audit F41): canonicalization can lose data — restore() drops dangling edges and
 * malformed records, and it reports repaired defects (duplicate ids, out-of-range schemaVersion,
 * non-finite numbers coerced to null) as {@link SerializationIssue}s. fmt must NOT silently rewrite a
 * file over that loss: a lossy file is left untouched on disk unless `--force`. A file written by a
 * newer Nodus is refused outright (restore throws `schema-too-new`) — captured here as `tooNew` so the
 * bin can emit the "upgrade the CLI" exit code rather than mangling the file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { restore, serializeRecords, toCanonicalString, type Snapshot } from '@ahmazin/core';
import { isSchemaTooNew, tooNewSchema, type SerializationIssue } from '../load.js';

export interface CanonicalizeResult {
  canonical: string;
  original: string;
  /** net records dropped by restore() (dangling edges, invalid/duplicate records, migration failures). */
  dropped: number;
  /** defects restore()/canonicalization reported (bad shapes, duplicate ids, non-finite coercions). */
  issues: SerializationIssue[];
}

export interface FmtResult {
  file: string;
  /** canonical bytes differ from what's on disk (always false when `tooNew`). */
  changed: boolean;
  /** records dropped by restore() (dangling edges / invalid records) — potential data loss */
  dropped: number;
  /** defects restore()/canonicalization reported while loading this file */
  issues: SerializationIssue[];
  /** canonicalizing this file would drop records or repair defects (`dropped > 0 || issues.length`). */
  lossy: boolean;
  /** restore() refused the file — it was written by a newer Nodus (schemaVersion beyond this build). */
  tooNew: boolean;
  /** the newer schemaVersion that triggered `tooNew`, when the error carried it. */
  fileSchema?: number;
  /** the file was actually (re)written to disk on this run. */
  wrote: boolean;
}

/**
 * Compute canonical bytes for a file without touching disk. Threads an `onError` into BOTH `restore()`
 * (load-time defects) and `toCanonicalString()` (non-finite number coercions) so every lossy step is
 * collected. May THROW `NodusError('schema-too-new')` — a file written by a newer Nodus can't be
 * canonicalized without silently discarding migrations it doesn't understand.
 */
export function canonicalizeFile(file: string): CanonicalizeResult {
  const original = readFileSync(file, 'utf8');
  const snap = JSON.parse(original) as Snapshot;
  // A file whose JSON parses to null / a non-object (e.g. literal `null` or `[]`) must flow the
  // typed lossy path — restore() reports 'invalid-snapshot' — never a raw TypeError on the
  // `snap.typeVersions` deref below.
  const isObject = snap !== null && typeof snap === 'object' && !Array.isArray(snap);
  const before = isObject && Array.isArray(snap.document?.records) ? snap.document.records.length : 0;
  const issues: SerializationIssue[] = [];
  const onError = (i: SerializationIssue): void => {
    issues.push(i);
  };
  const restored = restore(snap, { onError });
  const canonical = toCanonicalString(
    serializeRecords(restored.records, { typeVersions: isObject ? snap.typeVersions : undefined }),
    { onError },
  );
  return { canonical, original, dropped: before - restored.records.length, issues };
}

/**
 * Canonicalize each file. In `check` mode nothing is written; otherwise files that differ are
 * rewritten — EXCEPT a lossy file (records dropped or defects repaired), which is left untouched
 * unless `force` is set. A file refused as `tooNew` is never read past `restore()` and never written.
 */
export function fmt(files: string[], opts: { check?: boolean; force?: boolean } = {}): FmtResult[] {
  return files.map((file) => {
    let c: CanonicalizeResult;
    try {
      c = canonicalizeFile(file);
    } catch (err) {
      if (isSchemaTooNew(err)) {
        return { file, changed: false, dropped: 0, issues: [], lossy: false, tooNew: true, fileSchema: tooNewSchema(err), wrote: false };
      }
      throw err;
    }
    const changed = c.canonical !== c.original;
    const lossy = c.dropped > 0 || c.issues.length > 0;
    const wrote = changed && !opts.check && (!lossy || opts.force === true);
    if (wrote) writeFileSync(file, c.canonical);
    return { file, changed, dropped: c.dropped, issues: c.issues, lossy, tooNew: false, wrote };
  });
}
