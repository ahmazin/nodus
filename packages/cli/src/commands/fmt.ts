/**
 * `nodus fmt` — canonicalize diagram files in place (or verify with `--check`).
 * Pipeline: read → JSON.parse → restore() (normalize + repair dangling edges) → serializeRecords
 * → toCanonicalString. The output is idempotent, so a formatted file re-formats to itself — which
 * is what makes a pre-commit hook and a CI format-gate possible.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { restore, serializeRecords, toCanonicalString, type Snapshot } from '@nodus/core';

export interface FmtResult {
  file: string;
  /** canonical bytes differ from what's on disk */
  changed: boolean;
  /** records dropped by restore() (dangling edges / invalid records) — potential data loss */
  dropped: number;
}

/** Compute canonical bytes for a file without touching disk. */
export function canonicalizeFile(file: string): { canonical: string; original: string; dropped: number } {
  const original = readFileSync(file, 'utf8');
  const snap = JSON.parse(original) as Snapshot;
  const before = (snap.document?.records ?? []).length;
  const restored = restore(snap);
  const canonical = toCanonicalString(serializeRecords(restored.records, { typeVersions: snap.typeVersions }));
  return { canonical, original, dropped: before - restored.records.length };
}

/**
 * Canonicalize each file. In `check` mode nothing is written; otherwise files that differ are
 * rewritten. `dropped > 0` signals restore() discarded invalid/dangling records — the caller must
 * surface this (a --check run should fail) so canonicalization never silently loses data.
 */
export function fmt(files: string[], opts: { check?: boolean } = {}): FmtResult[] {
  return files.map((file) => {
    const { canonical, original, dropped } = canonicalizeFile(file);
    const changed = canonical !== original;
    if (!opts.check && changed) writeFileSync(file, canonical);
    return { file, changed, dropped };
  });
}
