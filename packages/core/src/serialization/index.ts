/**
 * Versioned serialization + a defensive restore that never trusts loaded data: it migrates by
 * schema version, validates/normalizes each record, and repairs dangling edge endpoints (edges
 * referencing missing nodes are dropped rather than crashing the scene).
 */

import type { EdgeRecord, Endpoint, NodeRecord, NodusRecord, PageRecord } from '../model.js';
import { isEdge, isNode, isPage } from '../model.js';

export const SCHEMA_VERSION = 1;

export interface Snapshot {
  schemaVersion: number;
  document: { records: NodusRecord[] };
  meta?: Record<string, unknown>;
}

export interface RestoreResult {
  records: NodusRecord[];
  /** Count of edges dropped because an endpoint referenced a missing node. */
  droppedEdges: number;
}

export function serializeRecords(records: NodusRecord[], meta?: Record<string, unknown>): Snapshot {
  // document records only; camera/session/selection never appear here
  const clean = records.map((r) => ({ ...r }));
  return { schemaVersion: SCHEMA_VERSION, document: { records: clean }, ...(meta ? { meta } : {}) };
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

function migrate(snap: Snapshot): Snapshot {
  // Future breaking schema changes run their migrations here, oldest-first.
  return snap;
}

export function restore(input: Snapshot): RestoreResult {
  const snap = migrate(input);
  const raw = snap.document?.records ?? [];

  const nodes: NodeRecord[] = [];
  const edges: EdgeRecord[] = [];
  const pages: PageRecord[] = [];

  for (const r of raw as unknown as Array<Record<string, unknown>>) {
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

  return { records: [...pages, ...nodes, ...keptEdges], droppedEdges };
}

export { isNode, isEdge, isPage };
