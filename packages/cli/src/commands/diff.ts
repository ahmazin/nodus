/**
 * `nodus diff a b` — a human-readable SEMANTIC diff over the core `diff()` primitive
 * (added/removed/changed by record identity), not a raw text diff. Reusing `diff()` keeps a single
 * diff vocabulary that a future three-way merge driver can build on.
 */
import { readFileSync } from 'node:fs';
import { diff, restore, stableStringify, type DiffResult, type Id, type NodusRecord, type Snapshot } from '@nodus/core';
import { sanitizeText } from './sanitize.js';

function loadRecords(file: string): NodusRecord[] {
  return restore(JSON.parse(readFileSync(file, 'utf8')) as Snapshot).records;
}

function describe(r: NodusRecord): string {
  // `label`/`id`/`typeName` are attacker-controlled (loaded verbatim from a `.nodus.json`); strip
  // control characters before interpolating them into the terminal report (CWE-117).
  const label = (r as { label?: string }).label;
  return `${sanitizeText(r.typeName)} ${label ? `"${sanitizeText(label)}" ` : ''}${sanitizeText(String(r.id))}`;
}

function short(v: unknown): string {
  if (v === undefined) return '∅';
  return typeof v === 'object' ? stableStringify(v) : JSON.stringify(v);
}

/** Per-field delta for a changed record, e.g. `x 100→140, visual {"state":"solid"}→{"state":"ghost"}`. */
function fieldDelta(from: NodusRecord, to: NodusRecord): string {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  for (const skip of ['version', 'id', 'typeName']) keys.delete(skip);
  const parts: string[] = [];
  for (const k of [...keys].sort()) {
    const a = (from as unknown as Record<string, unknown>)[k];
    const b = (to as unknown as Record<string, unknown>)[k];
    if (stableStringify(a) !== stableStringify(b)) parts.push(`${k} ${short(a)}→${short(b)}`);
  }
  return parts.join(', ');
}

export interface DiffReport {
  result: DiffResult;
  text: string;
  empty: boolean;
}

export function diffReport(fileA: string, fileB: string): DiffReport {
  const prev = loadRecords(fileA);
  const next = loadRecords(fileB);
  const result = diff(prev, next);
  const pMap = new Map<Id, NodusRecord>(prev.map((r) => [r.id, r]));
  const nMap = new Map<Id, NodusRecord>(next.map((r) => [r.id, r]));

  const lines: string[] = [];
  for (const id of result.added) lines.push(`+ ${describe(nMap.get(id)!)}`);
  for (const id of result.removed) lines.push(`- ${describe(pMap.get(id)!)}`);
  for (const c of result.changed) lines.push(`~ ${describe(c.to)}   ${fieldDelta(c.from, c.to)}`);

  const empty = result.added.length + result.removed.length + result.changed.length === 0;
  return { result, text: empty ? 'no changes' : lines.join('\n'), empty };
}
