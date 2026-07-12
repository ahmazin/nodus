/**
 * The one diff primitive: `diff(prev, next) -> {added, removed, changed}`. Powers undo/redo,
 * the ghost/reveal/stage overlay layers, and (later) collaboration — from a single place.
 */

import type { Id, NodusRecord } from '../model.js';

export interface RecordChange {
  id: Id;
  from: NodusRecord;
  to: NodusRecord;
}

export interface DiffResult {
  added: Id[];
  removed: Id[];
  changed: RecordChange[];
}

function toMap(records: Iterable<NodusRecord>): Map<Id, NodusRecord> {
  const m = new Map<Id, NodusRecord>();
  for (const r of records) m.set(r.id, r);
  return m;
}

/** Structural equality ignoring the volatile `version` counter. */
function sameContent(a: NodusRecord, b: NodusRecord): boolean {
  if (a === b) return true;
  const stripV = (r: NodusRecord) => ({ ...r, version: 0 });
  return JSON.stringify(stripV(a)) === JSON.stringify(stripV(b));
}

export function diff(prev: Iterable<NodusRecord>, next: Iterable<NodusRecord>): DiffResult {
  const p = toMap(prev);
  const n = toMap(next);
  const added: Id[] = [];
  const removed: Id[] = [];
  const changed: RecordChange[] = [];

  for (const [id, rec] of n) {
    const before = p.get(id);
    if (!before) added.push(id);
    else if (!sameContent(before, rec)) changed.push({ id, from: before, to: rec });
  }
  for (const [id] of p) {
    if (!n.has(id)) removed.push(id);
  }
  return { added, removed, changed };
}
