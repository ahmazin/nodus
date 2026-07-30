/**
 * `nodus diff a b` — a human-readable SEMANTIC diff over the core `diff()` primitive
 * (added/removed/changed by record identity), not a raw text diff. Reusing `diff()` keeps a single
 * diff vocabulary that a future three-way merge driver can build on.
 *
 * Each side may be a filesystem path OR a `REV:path` git spec (audit F19): `nodus diff
 * HEAD:diagram.nodus.json diagram.nodus.json` compares the committed diagram against the working copy.
 * The rev spec is resolved with `git show REV:path` via **execFile — never a shell** — and its shape is
 * validated with a conservative regex so diagram-controlled text cannot inject a command or a leading-
 * dash git option (the rev is anchored to start alphanumeric).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { diff, stableStringify, type DiffResult, type Id, type NodusRecord, type Snapshot } from '@ahmazin/core';
import { sanitizeText } from './sanitize.js';
import { restoreLabeled } from '../load.js';

/**
 * A `REV:path` git spec: `<rev>:<path>`. `rev` is anchored to start alphanumeric (so the assembled
 * `rev:path` argv entry can't be read as a `-option`) and limited to git-revision characters; `path`
 * is a repo-relative path (no leading `/`, no `..`-only, conservative character set). A plain
 * filesystem path has no `:` and never matches, so the two-file form keeps working; a Windows drive
 * path (`C:\…` / `C:/…`) fails the `path` sub-pattern and is treated as a file too.
 */
const REV_SPEC = /^(?<rev>[0-9A-Za-z][0-9A-Za-z._/~^@{}-]{0,254}):(?<path>[0-9A-Za-z._][0-9A-Za-z._/-]{0,1023})$/;

/** Read one diff side's raw JSON text: a `REV:path` git spec (via `git show`) or a filesystem path. */
export function readSource(spec: string): string {
  const m = REV_SPEC.exec(spec);
  if (!m) return readFileSync(spec, 'utf8');
  const rev = m.groups!['rev']!;
  const path = m.groups!['path']!;
  // execFile (no shell): the validated `${rev}:${path}` is a single argv entry, so no metacharacter
  // in the spec can start a subprocess, and the alnum-anchored rev keeps it from parsing as an option.
  try {
    return execFileSync('git', ['show', `${rev}:${path}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    throw new Error(`diff: could not read '${spec}' from git — ${err instanceof Error ? err.message : String(err)}`);
  }
}

function load(spec: string): { records: NodusRecord[]; warning: string | null } {
  const snap = JSON.parse(readSource(spec)) as Snapshot;
  const { records, warning } = restoreLabeled(snap, spec);
  return { records, warning };
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
  /** Non-clean-load summaries (one per side that dropped/repaired records) for the caller to print to stderr. */
  loadWarnings: string[];
}

export function diffReport(specA: string, specB: string): DiffReport {
  const a = load(specA);
  const b = load(specB);
  const result = diff(a.records, b.records);
  const pMap = new Map<Id, NodusRecord>(a.records.map((r) => [r.id, r]));
  const nMap = new Map<Id, NodusRecord>(b.records.map((r) => [r.id, r]));

  const lines: string[] = [];
  for (const id of result.added) lines.push(`+ ${describe(nMap.get(id)!)}`);
  for (const id of result.removed) lines.push(`- ${describe(pMap.get(id)!)}`);
  for (const c of result.changed) lines.push(`~ ${describe(c.to)}   ${fieldDelta(c.from, c.to)}`);

  const empty = result.added.length + result.removed.length + result.changed.length === 0;
  const loadWarnings = [a.warning, b.warning].filter((w): w is string => w !== null);
  return { result, text: empty ? 'no changes' : lines.join('\n'), empty, loadWarnings };
}
