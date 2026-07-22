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

/**
 * A non-fatal defect surfaced while (de)serializing untrusted data. `restore()` and
 * `toCanonicalString()` never throw on malformed-but-parseable input — they skip/repair the bad
 * part and report it here, so a caller (editor, CLI, persistence, MCP) can log or count it instead
 * of crashing on a hand-edited or corrupt `.nodus.json`.
 */
export interface SerializationIssue {
  code: 'non-array-records' | 'invalid-record' | 'duplicate-id' | 'bad-schema-version' | 'non-finite-number';
  message: string;
  /** The offending value, when one can be attached (the raw entry, the duplicate id, the number). */
  value?: unknown;
}

export interface RestoreOptions {
  /** Ordered migrations for a record's type; `undefined` ⇒ the type is not registered. */
  resolveMigrations?: (record: { typeName: string; type?: string }) => Migration[] | undefined;
  /** Reports each skipped/repaired defect (bad record shape, duplicate id, out-of-range schemaVersion). Never throws for the caller. */
  onError?: (issue: SerializationIssue) => void;
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
 *
 * Walked ITERATIVELY with an explicit stack, not by recursion: a valid but deeply nested diagram
 * (~36KB can nest thousands deep) would overflow the call stack and turn `fmt`/`diff`/export into a
 * hard crash. The output is byte-for-byte identical to the equivalent recursive walk.
 *
 * `onNonFinite`, if given, is called for every `Infinity`/`-Infinity`/`NaN` encountered — JSON has no
 * literal for these, so `JSON.stringify` still coerces them to `null` (bytes are unchanged); the hook
 * only lets a caller surface that lossy coercion instead of it happening silently.
 */
export function stableStringify(v: unknown, onNonFinite?: (value: number) => void): string {
  const isContainer = (x: unknown): boolean => Array.isArray(x) || (x !== null && typeof x === 'object');
  const leaf = (x: unknown): string => {
    if (typeof x === 'number' && !Number.isFinite(x)) onNonFinite?.(x);
    // JSON.stringify(undefined|function|symbol) is `undefined`; the recursive form fed that to
    // Array.join, which coerces it to '' — pushing it here reproduces that byte-for-byte.
    return JSON.stringify(x);
  };
  if (!isContainer(v)) return leaf(v);

  interface Frame {
    open: '[' | '{';
    keys: string[] | null; // objects: sorted keys parallel to `values`; arrays: null
    values: unknown[];
    i: number;
    parts: string[];
  }
  const frameFor = (x: unknown): Frame => {
    if (Array.isArray(x)) return { open: '[', keys: null, values: x, i: 0, parts: [] };
    const o = x as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return { open: '{', keys, values: keys.map((k) => o[k]), i: 0, parts: [] };
  };

  const stack: Frame[] = [frameFor(v)];
  let done: string | undefined; // serialized string bubbling up from a just-completed child frame

  while (stack.length) {
    const f = stack[stack.length - 1]!;
    if (done !== undefined) {
      const k = f.keys ? f.keys[f.i]! : null;
      f.parts.push(k !== null ? `${JSON.stringify(k)}:${done}` : done);
      f.i++;
      done = undefined;
    }
    let descended = false;
    while (f.i < f.values.length) {
      const child = f.values[f.i];
      if (isContainer(child)) {
        stack.push(frameFor(child));
        descended = true;
        break;
      }
      const k = f.keys ? f.keys[f.i]! : null;
      const s = leaf(child);
      f.parts.push(k !== null ? `${JSON.stringify(k)}:${s}` : s);
      f.i++;
    }
    if (descended) continue;
    done = `${f.open}${f.parts.join(',')}${f.open === '[' ? ']' : '}'}`;
    stack.pop();
  }
  return done!;
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
  // Code-point total order, NOT localeCompare: locale collation returns 0 for DISTINCT ids that
  // merely collate equal (a soft hyphen, a combining mark), and a stable sort then leaves their
  // order = input order — so semantically-equal diagrams canonicalize to different bytes (a
  // diff-CI/merge hazard). A strict `<`/`>` compare gives every distinct id a deterministic tiebreak.
  const ia = String(a.id);
  const ib = String(b.id);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
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
export function toCanonicalString(snapshot: Snapshot, opts?: { onError?: (issue: SerializationIssue) => void }): string {
  // JSON has no literal for Infinity/NaN, so such a value in any props/style/flow/meta is written as
  // `null` — unavoidable, but no longer silent: surface it via onError while the bytes stay unchanged.
  const onNonFinite = opts?.onError
    ? (value: number) => opts.onError!({ code: 'non-finite-number', message: `non-finite number ${String(value)} serialized as null`, value })
    : undefined;
  const sorted = [...snapshot.document.records].sort(compareRecords);
  const lines = sorted.map((r) => stableStringify(canonicalRecord(r), onNonFinite));
  const body = lines.length ? `\n${lines.join(',\n')}\n` : '';
  const tv =
    snapshot.typeVersions && Object.keys(snapshot.typeVersions).length > 0
      ? `"typeVersions":${stableStringify(snapshot.typeVersions, onNonFinite)},`
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
    // Visibility is omit-when-false: only a truly-hidden node carries the key, so canonical bytes
    // never gain a `"hidden":false` and a never-hidden node round-trips byte-identically.
    ...(r.hidden === true ? { hidden: true } : {}),
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
  const onError = opts?.onError;
  const typeVersions = input.typeVersions ?? {};

  // schemaVersion: only a non-negative integer ≤ SCHEMA_VERSION is a version we can honour. A
  // future/negative/non-integer/NaN/string value would otherwise silently skip migrations and load
  // as-is; report it and fall back to a best-effort current-schema load.
  let fromSchema = SCHEMA_VERSION;
  const rawSchema: unknown = input.schemaVersion;
  if (rawSchema === undefined) {
    // absent ⇒ treat as current (a snapshot may predate the field); not an error.
  } else if (typeof rawSchema === 'number' && Number.isInteger(rawSchema) && rawSchema >= 0 && rawSchema <= SCHEMA_VERSION) {
    fromSchema = rawSchema;
  } else {
    onError?.({ code: 'bad-schema-version', message: `schemaVersion ${String(rawSchema)} is outside the supported range [0, ${SCHEMA_VERSION}]; loading as ${SCHEMA_VERSION}`, value: rawSchema });
  }

  // records must be an array: a non-array (number/object) is not iterable and would throw.
  const rawRecords: unknown = input.document?.records;
  let raw: unknown[];
  if (Array.isArray(rawRecords)) {
    raw = rawRecords;
  } else {
    if (rawRecords !== undefined && rawRecords !== null) {
      onError?.({ code: 'non-array-records', message: 'document.records is not an array; treating as empty', value: rawRecords });
    }
    raw = [];
  }

  // Dedupe by id, last-wins: keep exactly one record per id (a corrupt/merged file can repeat ids,
  // which would otherwise collide in the store). Split into type buckets only for the edge repair.
  const byId = new Map<string, NodusRecord>();
  let migrationErrors = 0;
  let unmigrated = 0;
  const add = (rec: NodusRecord): void => {
    if (byId.has(rec.id)) onError?.({ code: 'duplicate-id', message: `duplicate record id ${JSON.stringify(rec.id)}; keeping the last occurrence`, value: rec.id });
    byId.set(rec.id, rec);
  };

  for (const original of raw) {
    // Malformed entries (null / primitive / array) are not records — skip rather than crash on
    // `original.typeName`.
    if (original === null || typeof original !== 'object' || Array.isArray(original)) {
      onError?.({ code: 'invalid-record', message: 'record entry is not an object; skipping', value: original });
      continue;
    }
    let r = original as Record<string, unknown>;

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
        // restore() never trusts loaded data: a hand-edited non-integer version (e.g. 1.5) must not
        // index steps[1.5] (undefined, silently dropping the record) — floor and clamp to >= 0.
        const stored = Math.max(0, Math.floor(num(typeVersions[type])));
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
      if (n) add(n);
    } else if (r.typeName === 'edge') {
      const e = normalizeEdge(r);
      if (e) add(e);
    } else if (r.typeName === 'page') {
      const p = normalizePage(r);
      if (p) add(p);
    }
  }

  const all = [...byId.values()];
  const nodes = all.filter(isNode);
  const edges = all.filter(isEdge);
  const pages = all.filter(isPage);

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
