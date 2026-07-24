/**
 * `nodus drift <diagram.nodus.json> <source>` — re-import an infra source (Terraform show-json or a
 * Kubernetes manifest set) and compare it against the committed diagram. Built on `computeDrift` from
 * @nodus/import-infra, which matches source-managed nodes by their `props.key` (the source address) and
 * reports content drift only — layout moves never count. The CLI exits NONZERO when the diagram has
 * drifted, so it works as a CI gate: "fail the build if the architecture diagram no longer matches
 * declared infra."
 */
import { readFileSync } from 'node:fs';
import { type NodeRecord, type NodusRecord } from '@nodus/core';
import { computeDrift, fromKubernetes, fromTerraform, type DriftResult } from '@nodus/import-infra';
import { sanitizeText } from './sanitize.js';
import { loadRecords } from '../load.js';

export interface DriftCliReport {
  result: DriftResult;
  text: string;
  /** True iff the diagram no longer matches the source (`result.total > 0`) — the CLI exit gate. */
  drifted: boolean;
  /** Non-clean-load summary for the committed diagram (if restore dropped/repaired records), for stderr. */
  loadWarnings: string[];
}

type SourceKind = 'terraform' | 'kubernetes';

/** Load a `.nodus.json` Snapshot into records + a non-clean-load warning, via the shared CLI loader. */
function loadDiagram(file: string): { records: NodusRecord[]; warning: string | null } {
  const { records, warning } = loadRecords(file);
  return { records, warning };
}

/**
 * Sniff whether a parsed source JSON is a Terraform show-json document or a Kubernetes manifest set.
 * Terraform show-json carries `values`/`planned_values`/`root_module` (or `format_version`/
 * `terraform_version`); Kubernetes is an array, a `List` with `items`, or a single object with a
 * top-level `kind` + `apiVersion`. Ambiguous input falls back to Terraform (flagged so the caller
 * can note it).
 */
function detectSource(json: unknown): { source: SourceKind; ambiguous: boolean } {
  if (Array.isArray(json)) return { source: 'kubernetes', ambiguous: false };
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    if ('values' in o || 'planned_values' in o || 'root_module' in o || 'format_version' in o || 'terraform_version' in o)
      return { source: 'terraform', ambiguous: false };
    if ('items' in o) return { source: 'kubernetes', ambiguous: false };
    if ('kind' in o && 'apiVersion' in o) return { source: 'kubernetes', ambiguous: false };
  }
  return { source: 'terraform', ambiguous: true };
}

function importSource(json: unknown, source: SourceKind): NodusRecord[] {
  if (source === 'kubernetes') {
    const objs = Array.isArray(json) ? json : ((json as { items?: unknown[] }).items ?? [json]);
    return fromKubernetes(objs as Parameters<typeof fromKubernetes>[0]);
  }
  return fromTerraform(json);
}

/** One resource named by its diagram label, falling back to its source address (`props.key`) then id. */
function describe(n: NodeRecord): string {
  // `label`/`props.key`/`id` are attacker-controlled (loaded verbatim from a `.nodus.json`); strip
  // control characters before interpolating them into the terminal report (CWE-117).
  const key = typeof n.props?.['key'] === 'string' ? (n.props['key'] as string) : undefined;
  if (n.label && key) return `${sanitizeText(n.label)} (${sanitizeText(key)})`;
  return sanitizeText(n.label ?? key ?? String(n.id));
}

function buildText(result: DriftResult, note?: string): string {
  const lines: string[] = [];
  if (result.total === 0) {
    lines.push('In sync — no drift');
  } else {
    lines.push(
      `Drift: ${result.total} resource(s) changed  (+${result.added.length} -${result.removed.length} ~${result.changed.length})`,
    );
    if (result.added.length > 0) {
      lines.push('Added:');
      for (const n of result.added) lines.push(`  + ${describe(n)}`);
    }
    if (result.removed.length > 0) {
      lines.push('Removed:');
      for (const n of result.removed) lines.push(`  - ${describe(n)}`);
    }
    if (result.changed.length > 0) {
      lines.push('Changed:');
      // `c.fields` carries `props.<name>` entries whose <name> is an attacker-controlled props KEY
      // NAME (from `driftedFields`), so sanitize each field name too — not just `describe` (CWE-117).
      for (const c of result.changed) lines.push(`  ~ ${describe(c.to)}   ${c.fields.map(sanitizeText).join(', ')}`);
    }
  }
  if (note) lines.push(note);
  return lines.join('\n');
}

export function driftReport(
  diagramFile: string,
  sourceFile: string,
  opts?: { source?: SourceKind | 'auto' },
): DriftCliReport {
  const diagram = loadDiagram(diagramFile);
  const diagramRecords = diagram.records;
  const json = JSON.parse(readFileSync(sourceFile, 'utf8')) as unknown;

  const requested = opts?.source ?? 'auto';
  let source: SourceKind;
  let note: string | undefined;
  if (requested === 'auto') {
    const detected = detectSource(json);
    source = detected.source;
    if (detected.ambiguous) note = 'note: could not detect source type — assuming terraform (pass --source to override)';
  } else {
    source = requested;
  }

  const incoming = importSource(json, source);
  const result = computeDrift(diagramRecords, incoming);
  const loadWarnings = diagram.warning ? [diagram.warning] : [];
  return { result, text: buildText(result, note), drifted: result.total > 0, loadWarnings };
}
