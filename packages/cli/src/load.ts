/**
 * Shared load helpers for the CLI commands. Every command that reads a `.nodus.json` funnels its
 * `restore()` call through here so all three agree on two behaviors the audit (F24/F41) requires:
 *
 *  1. a schema-too-new refusal is re-labelled with the *file* it came from, keeping the error `code`
 *     so the caller still maps it to the "newer file" exit code (3); and
 *  2. a non-clean load (dropped edges / migration failures / repointed page refs) yields a one-line
 *     diagnostic summary the command prints to stderr while still proceeding.
 *
 * `unmigrated` is deliberately excluded from the summary: the CLI restores WITHOUT registering any
 * node/edge type utils, so it never runs props migrations and `unmigrated` is always 0 here — the
 * summary reports only the counts that mean the loaded data differs from the file on disk.
 */
import { readFileSync } from 'node:fs';
import {
  isNodusError,
  NodusError,
  restore,
  type NodusRecord,
  type RestoreOptions,
  type RestoreResult,
  type Snapshot,
} from '@nodus-dev/core';

/**
 * The defect record `restore()`/`toCanonicalString()` report through `onError`. Derived from the
 * exported `RestoreOptions` signature because core does not (yet) re-export `SerializationIssue` from
 * its barrel — this keeps the CLI's type in lockstep with core's without a cross-package barrel change.
 */
export type SerializationIssue = Parameters<NonNullable<RestoreOptions['onError']>>[0];

/** True iff `err` is core's hard refusal to open a file written by a newer Nodus (schemaVersion too high). */
export function isSchemaTooNew(err: unknown): err is NodusError<string> {
  return isNodusError(err) && err.code === 'schema-too-new';
}

/** The newer file schemaVersion carried in a schema-too-new error's context, when present. */
export function tooNewSchema(err: unknown): number | undefined {
  if (!isNodusError(err)) return undefined;
  const v = err.context?.['fileSchema'];
  return typeof v === 'number' ? v : undefined;
}

/** Message the CLI prints for a schema-too-new file — points at upgrading the CLI, never at `fmt`. */
export function tooNewMessage(label: string, err: unknown): string {
  const schema = tooNewSchema(err);
  const at = schema !== undefined ? ` (schemaVersion ${schema})` : '';
  return `${label}: written by a newer version of Nodus${at} — upgrade @nodus-dev/cli to read it`;
}

/** One-line stderr summary of a non-clean load; `null` when restore dropped/repaired nothing. */
export function restoreSummary(label: string, r: RestoreResult): string | null {
  const parts: string[] = [];
  if (r.droppedEdges) parts.push(`dropped ${r.droppedEdges} dangling edge(s)`);
  if (r.migrationErrors) parts.push(`${r.migrationErrors} migration error(s)`);
  if (r.repointedPageRefs) parts.push(`repointed ${r.repointedPageRefs} page ref(s)`);
  if (parts.length === 0) return null;
  return `${label}: loaded ${r.records.length} record(s); ${parts.join(', ')}`;
}

export interface LoadedRecords {
  records: NodusRecord[];
  result: RestoreResult;
  /** A non-clean-load summary line for stderr, or `null` when the load was clean. */
  warning: string | null;
}

/**
 * Restore a parsed snapshot, capturing the {@link RestoreResult} for diagnostics and re-labelling a
 * schema-too-new refusal with `label` (typically the file name or `REV:path` spec). The re-thrown
 * error keeps its `'schema-too-new'` code so callers still recognise it via {@link isSchemaTooNew}.
 */
export function restoreLabeled(snap: Snapshot, label: string): LoadedRecords {
  let result: RestoreResult;
  try {
    result = restore(snap);
  } catch (err) {
    if (isSchemaTooNew(err)) {
      throw new NodusError('schema-too-new', tooNewMessage(label, err), { context: err.context, cause: err });
    }
    throw err;
  }
  return { records: result.records, result, warning: restoreSummary(label, result) };
}

/** Read + parse + restore a `.nodus.json` file from disk, with the diagnostics of {@link restoreLabeled}. */
export function loadRecords(file: string): LoadedRecords {
  const snap = JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
  return restoreLabeled(snap, file);
}
