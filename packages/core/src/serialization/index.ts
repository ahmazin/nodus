/**
 * Versioned serialization + a defensive restore that never trusts loaded data: it validates and
 * normalizes each record and repairs dangling edge endpoints (edges referencing missing nodes are
 * dropped rather than crashing the scene). `schemaVersion` is stamped for forward compatibility;
 * when the first breaking schema change lands, a real migration step is reintroduced here.
 */

import type { EdgeRecord, Endpoint, NodeRecord, NodusRecord, PageRecord } from '../model.js';
import { isEdge, isNode, isPage } from '../model.js';
import type { Migration } from '../registries/index.js';

export type { NodusRecord, Migration };

export const SCHEMA_VERSION = 1;

export interface RestoreOptions {
  /** Ordered migrations for a record's type; `undefined` ⇒ the type is not registered. */
  resolveMigrations?: (record: { typeName: string; type?: string }) => Migration[] | undefined;
}

/**
 * Engine record-shape migrations, indexed by the `schemaVersion` being migrated FROM. Empty until
 * the first breaking record-shape change (which bumps SCHEMA_VERSION and adds `engineMigrations[1]`).
 */
const engineMigrations: Array<(r: Record<string, unknown>) => Record<string, unknown>> = [];

export interface Snapshot {
  schemaVersion: number;
  document: { records: NodusRecord[] };
  /** Per-shape-`type` version its `props` were written at. Additive; absent ⇒ every type at v0. */
  typeVersions?: Record<string, number>;
  meta?: Record<string, unknown>;
}

export interface RestoreResult {
  records: NodusRecord[];
  /** Count of edges dropped because an endpoint referenced a missing node. */
  droppedEdges: number;
  /** Count of records dropped because a migration threw. */
  migrationErrors: number;
  /** Count of records kept raw (newer-than-known version, or type util not registered). */
  unmigrated: number;
}

export function serializeRecords(
  records: NodusRecord[],
  opts?: { meta?: Record<string, unknown>; typeVersions?: Record<string, number> },
): Snapshot {
  // document records only; camera/session/selection never appear here
  const clean = records.map((r) => ({ ...r }));
  const snap: Snapshot = { schemaVersion: SCHEMA_VERSION, document: { records: clean } };
  if (opts?.typeVersions && Object.keys(opts.typeVersions).length > 0) snap.typeVersions = opts.typeVersions;
  if (opts?.meta) snap.meta = opts.meta;
  return snap;
}

/**
 * Order-insensitive canonical stringify: object keys are emitted in sorted order and
 * undefined-valued keys are dropped (`{label:undefined}` ≡ no label). Array order IS preserved —
 * it is meaningful (route waypoints, flow colour stops). This is the single, shared definition of
 * "canonical" that every git-facing writer (`toCanonicalString`, the CLI, a future merge driver)
 * routes through, so the on-disk byte format is defined in exactly one place.
 */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

// A record's file position must depend ONLY on its identity, so a content edit (e.g. moving a node)
// changes exactly that record's line and nothing else. Pages first (they scope nodes), then nodes,
// then edges (which reference nodes). NEVER sort spatially: a spatial key would relocate a node's
// record block on every move and churn the diff — defeating the whole point.
const TYPE_RANK: Record<string, number> = { page: 0, node: 1, edge: 2 };

export function compareRecords(a: NodusRecord, b: NodusRecord): number {
  const ra = TYPE_RANK[a.typeName] ?? 99;
  const rb = TYPE_RANK[b.typeName] ?? 99;
  if (ra !== rb) return ra - rb;
  return String(a.id).localeCompare(String(b.id));
}

/** On-disk shape of one record: the churny per-record `version` counter is dropped (every load
 *  path already defaults it via `num(r.version)`), so an edit that only bumps `version` — or a
 *  reload that resets it — produces no diff. */
function canonicalRecord(r: NodusRecord): Record<string, unknown> {
  const { version: _version, ...rest } = r;
  return rest;
}

/**
 * The on-disk byte contract for a diagram: deterministic, minimal-diff, and still valid JSON
 * (so GitHub renders it with syntax highlighting + intra-line word-diff, and `restore()` can
 * `JSON.parse` it). Records are sorted by identity and emitted one-per-line, so an add is +1 line,
 * a delete is −1 line, and an in-place edit changes exactly one line. `meta` is excluded entirely:
 * every current meta key (`updated`, `exportedBy`) is volatile and would churn every save.
 */
export function toCanonicalString(snapshot: Snapshot): string {
  const sorted = [...snapshot.document.records].sort(compareRecords);
  const lines = sorted.map((r) => stableStringify(canonicalRecord(r)));
  const body = lines.length ? `\n${lines.join(',\n')}\n` : '';
  const tv =
    snapshot.typeVersions && Object.keys(snapshot.typeVersions).length > 0
      ? `"typeVersions":${stableStringify(snapshot.typeVersions)},`
      : '';
  return `{"schemaVersion":${snapshot.schemaVersion},${tv}"document":{"records":[${body}]}}\n`;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function normalizeNode(r: Record<string, unknown>): NodeRecord | null {
  if (typeof r.id !== 'string' || typeof r.type !== 'string') return null;
  const visual = (r.visual as NodeRecord['visual']) ?? { state: 'solid' };
  return {
    id: r.id as NodeRecord['id'],
    typeName: 'node',
    version: num(r.version),
    type: r.type,
    x: num(r.x),
    y: num(r.y),
    w: num(r.w, 100),
    h: num(r.h, 50),
    ...(r.rotation !== undefined ? { rotation: num(r.rotation) } : {}),
    ...(typeof r.locked === 'boolean' ? { locked: r.locked } : {}),
    z: typeof r.z === 'string' ? r.z : '00000000',
    ...(typeof r.parentId === 'string' ? { parentId: r.parentId as NodeRecord['parentId'] } : {}),
    visual: { state: visual.state ?? 'solid', ...(visual.overlay ? { overlay: visual.overlay } : {}), ...(visual.focused ? { focused: true } : {}) },
    ...(r.style ? { style: r.style as NodeRecord['style'] } : {}),
    ...(typeof r.label === 'string' ? { label: r.label } : {}),
    props: (r.props as Record<string, unknown>) ?? {},
    ...(r.meta ? { meta: r.meta as Record<string, unknown> } : {}),
  };
}

function validEndpoint(ep: unknown): ep is Endpoint {
  if (!ep || typeof ep !== 'object') return false;
  const e = ep as Record<string, unknown>;
  if (e.kind === 'node' || e.kind === 'outline') return typeof e.nodeId === 'string';
  // reject non-finite coords: a NaN/Infinity point poisons the R-tree bbox and silently breaks
  // every subsequent hit-test / viewport query
  if (e.kind === 'point') return Number.isFinite(e.x) && Number.isFinite(e.y);
  return false;
}

function normalizeEdge(r: Record<string, unknown>): EdgeRecord | null {
  if (typeof r.id !== 'string' || typeof r.type !== 'string') return null;
  if (!validEndpoint(r.from) || !validEndpoint(r.to)) return null;
  const visual = (r.visual as EdgeRecord['visual']) ?? { state: 'solid' };
  return {
    id: r.id as EdgeRecord['id'],
    typeName: 'edge',
    version: num(r.version),
    type: r.type,
    from: r.from as Endpoint,
    to: r.to as Endpoint,
    visual: { state: visual.state ?? 'solid', ...(visual.overlay ? { overlay: visual.overlay } : {}), ...(visual.focused ? { focused: true } : {}) },
    ...(r.style ? { style: r.style as EdgeRecord['style'] } : {}),
    ...(r.flow && typeof r.flow === 'object' ? { flow: r.flow as EdgeRecord['flow'] } : {}),
    ...(typeof r.label === 'string' ? { label: r.label } : {}),
    props: (r.props as Record<string, unknown>) ?? {},
    ...(r.meta ? { meta: r.meta as Record<string, unknown> } : {}),
  };
}

function normalizePage(r: Record<string, unknown>): PageRecord | null {
  if (typeof r.id !== 'string') return null;
  return {
    id: r.id as PageRecord['id'],
    typeName: 'page',
    version: num(r.version),
    name: typeof r.name === 'string' ? r.name : 'Page',
    index: typeof r.index === 'string' ? r.index : 'a0',
    ...(r.style ? { style: r.style as PageRecord['style'] } : {}),
  };
}

export function restore(input: Snapshot, opts?: RestoreOptions): RestoreResult {
  const raw = input.document?.records ?? [];
  const typeVersions = input.typeVersions ?? {};
  const fromSchema = num(input.schemaVersion, SCHEMA_VERSION);

  const nodes: NodeRecord[] = [];
  const edges: EdgeRecord[] = [];
  const pages: PageRecord[] = [];
  let migrationErrors = 0;
  let unmigrated = 0;

  for (const original of raw as unknown as Array<Record<string, unknown>>) {
    let r = original;

    // 1. engine record-shape migrations (schemaVersion → SCHEMA_VERSION)
    try {
      for (let v = fromSchema; v < SCHEMA_VERSION; v++) {
        const step = engineMigrations[v];
        if (step) r = step(r);
      }
    } catch {
      migrationErrors++;
      continue;
    }

    // 2. custom-shape props migrations (nodes/edges only, and only when a resolver is provided)
    if ((r.typeName === 'node' || r.typeName === 'edge') && opts?.resolveMigrations) {
      const type = typeof r.type === 'string' ? r.type : '';
      const steps = opts.resolveMigrations({ typeName: r.typeName, type });
      if (steps === undefined) {
        unmigrated++; // type not registered — keep raw
      } else {
        const current = steps.length;
        const stored = typeVersions[type] ?? 0;
        if (stored > current) {
          unmigrated++; // newer than this client — keep raw, preserve
        } else if (stored < current) {
          try {
            let props = (r.props as Record<string, unknown>) ?? {};
            for (let i = stored; i < current; i++) props = steps[i]!(props);
            r = { ...r, props };
          } catch {
            migrationErrors++;
            continue;
          }
        }
      }
    }

    // 3. normalize (validates the migrated record)
    if (r.typeName === 'node') {
      const n = normalizeNode(r);
      if (n) nodes.push(n);
    } else if (r.typeName === 'edge') {
      const e = normalizeEdge(r);
      if (e) edges.push(e);
    } else if (r.typeName === 'page') {
      const p = normalizePage(r);
      if (p) pages.push(p);
    }
  }

  // repair: drop edges whose node endpoints reference a missing node
  const nodeIds = new Set(nodes.map((n) => n.id));
  let droppedEdges = 0;
  const keptEdges = edges.filter((e) => {
    for (const ep of [e.from, e.to]) {
      if ((ep.kind === 'node' || ep.kind === 'outline') && !nodeIds.has(ep.nodeId)) {
        droppedEdges++;
        return false;
      }
    }
    return true;
  });

  return { records: [...pages, ...nodes, ...keptEdges], droppedEdges, migrationErrors, unmigrated };
}

export { isNode, isEdge, isPage };
