/**
 * Import analysis — one contract behind the smoother import flow. `detectImportFormat` sniffs the
 * pasted content's shape (no full parse for the common cases); `analyzeImport` parses for a known
 * format and returns a preview summary (counts + skipped + notes) or a real parser error — never
 * throwing. The modal renders this before anything is committed to the canvas.
 */
import { isEdge, isNode, type NodusRecord } from '@nodus-dev/core';
import { fromMermaid } from '@nodus-dev/from-mermaid';
import { analyzeKubernetes, analyzeTerraform } from '@nodus-dev/import-infra';

export type ImportFormat = 'mermaid' | 'terraform' | 'kubernetes';

export interface ImportAnalysis {
  format: ImportFormat;
  records: NodusRecord[];
  nodeCount: number;
  edgeCount: number;
  skipped: { label: string; count: number }[];
  notes: string[];
  /** Real parser message; when set, records is [] and the modal disables Import. */
  error: string | null;
  /** Mermaid's parsed flow direction (`flowchart TB`/`LR`/`RL`/`BT`); unset for terraform/kubernetes. */
  direction?: 'TB' | 'LR' | 'RL' | 'BT';
}

const MERMAID_HEADER = /^(graph|flowchart|stateDiagram(-v2)?|erDiagram)\b/i;

function looksLikeTerraform(o: unknown): boolean {
  if (!o || typeof o !== 'object') return false;
  const r = o as Record<string, unknown>;
  const hasRoot = (m: unknown): boolean => !!m && typeof m === 'object' && 'root_module' in (m as object);
  return hasRoot(r['values']) || hasRoot(r['planned_values']) || Array.isArray(r['resource_changes']) ||
    (('terraform_version' in r || 'format_version' in r) && 'configuration' in r);
}

function looksLikeKubernetes(o: unknown): boolean {
  const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object';
  if (Array.isArray(o)) return o.some((x) => isObj(x) && typeof x['kind'] === 'string');
  if (!isObj(o)) return false;
  if (o['kind'] === 'List' && Array.isArray(o['items'])) return true;
  return typeof o['kind'] === 'string' && typeof o['apiVersion'] === 'string';
}

/** Content-shape detection: mermaid header, else JSON shape, else a YAML k8s sniff. */
export function detectImportFormat(text: string): ImportFormat | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const firstLine = trimmed.split('\n', 1)[0]!.trim();
  if (MERMAID_HEADER.test(firstLine)) return 'mermaid';

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    obj = undefined;
  }
  if (obj !== undefined) {
    if (looksLikeTerraform(obj)) return 'terraform';
    if (looksLikeKubernetes(obj)) return 'kubernetes';
    return null;
  }
  // Not JSON, not a mermaid header → maybe YAML manifest(s). Terraform show -json is always JSON.
  if (/^\s*kind:\s*\S+/m.test(text) && /^\s*apiVersion:\s*\S+/m.test(text)) return 'kubernetes';
  return null;
}

function humanError(format: ImportFormat, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (format === 'terraform') return `Couldn't read that Terraform JSON — ${msg}`;
  if (format === 'kubernetes') return `Couldn't read those Kubernetes manifests — ${msg}`;
  return msg; // fromMermaid already throws a descriptive header/syntax message
}

/** Parse `text` as a KNOWN format and summarize. Never throws — parse failure → { error }. */
export function analyzeImport(text: string, format: ImportFormat): ImportAnalysis {
  try {
    let records: NodusRecord[];
    let skipped: { label: string; count: number }[] = [];
    let notes: string[] = [];
    let direction: ImportAnalysis['direction'];
    if (format === 'mermaid') {
      const parsed = fromMermaid(text);
      records = parsed.records;
      direction = parsed.direction;
      if (parsed.skipped > 0) skipped = [{ label: 'unrecognized line', count: parsed.skipped }];
    } else if (format === 'terraform') {
      const a = analyzeTerraform(JSON.parse(text));
      ({ records, skipped, notes } = a);
    } else {
      const a = analyzeKubernetes(text);
      ({ records, skipped, notes } = a);
    }
    return {
      format,
      records,
      nodeCount: records.filter(isNode).length,
      edgeCount: records.filter(isEdge).length,
      skipped,
      notes,
      error: null,
      direction,
    };
  } catch (e) {
    return { format, records: [], nodeCount: 0, edgeCount: 0, skipped: [], notes: [], error: humanError(format, e) };
  }
}
