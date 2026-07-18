/**
 * The retained render/spatial index. Mirrors document records into `RenderItem`s (world AABB +
 * resolved `Geometry2d` + edge route), indexed in an R-tree. Kept in sync exclusively through
 * `applyChanges` (the sole update path, so it can never drift), it serves three things from one
 * structure: viewport culling, marquee selection, and two-phase hit-testing. It also tracks
 * node→edge adjacency so moving/deleting a node reflows or drops its connected edges.
 */

import RBush from 'rbush';
import { atom, type Atom } from '../signals/index.js';
import { Polyline2d, boxIntersects, padBox, type Geometry2d } from '../geometry/index.js';
import type { Box, Change, EdgeRecord, Endpoint, Id, NodeRecord, NodusRecord, Vec2 } from '../model.js';
import { isEdge, isNode } from '../model.js';
import type { EdgeRegistry, NodeRegistry } from '../registries/index.js';
import type { RouterRegistry } from '../routing/index.js';

export interface RenderItem {
  id: Id;
  kind: 'node' | 'edge';
  record: NodeRecord | EdgeRecord;
  geometry: Geometry2d;
  aabb: Box;
  /** Edges only: the resolved polyline route in world coords. */
  route?: Vec2[];
  renderVersion: number;
}

interface Entry {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: Id;
}

/** Context handed to `SceneIndexDeps.onError` so a consumer can tell which record failed to index. */
export interface SceneIndexErrorContext {
  /** A third-party util (`getGeometry`/`getRoute`/`getPorts`) threw while building a render item. */
  phase: 'build';
  kind: 'node' | 'edge';
  id: Id;
}

export interface SceneIndexDeps {
  getRecord: (id: Id) => NodusRecord | undefined;
  nodes: NodeRegistry;
  edges: EdgeRegistry;
  routers?: RouterRegistry;
  /**
   * Surface — never swallow — an error thrown by a registered util while indexing a record. The
   * record is simply left unindexed (as if it couldn't build), so a buggy third-party type cannot
   * escape the mutation channel and drift undo state. Default: a safe no-op; wire to the EventBus.
   */
  onError?: (err: unknown, ctx: SceneIndexErrorContext) => void;
}

export class SceneIndex {
  private readonly tree = new RBush<Entry>();
  private readonly items = new Map<Id, RenderItem>();
  private readonly entries = new Map<Id, Entry>();
  /** node id -> ids of edges referencing it (for reflow / cascade). */
  private readonly nodeEdges = new Map<Id, Set<Id>>();
  /** edge id -> the edge record it was linked with. Lets `removeItem` unlink adjacency from
   *  *linkage* bookkeeping rather than item existence, so an edge that linked its endpoints but
   *  never built (missing endpoint / unregistered type) still reclaims its `nodeEdges` entry. */
  private readonly linkedEdges = new Map<Id, EdgeRecord>();
  /** bumped after every sync so the renderer can react. */
  readonly version: Atom<number> = atom(0);

  constructor(private readonly deps: SceneIndexDeps) {}

  /** Route a caught indexing error to the consumer's hook (default: safe no-op — never swallowed). */
  private reportError(err: unknown, ctx: SceneIndexErrorContext): void {
    this.deps.onError?.(err, ctx);
  }

  // ---- public queries ----

  getItem(id: Id): RenderItem | undefined {
    return this.items.get(id);
  }

  all(): RenderItem[] {
    return [...this.items.values()];
  }

  /** Edges referencing a node (used for cascade delete). */
  edgesForNode(nodeId: Id): Id[] {
    return [...(this.nodeEdges.get(nodeId) ?? [])];
  }

  /** Items whose AABB intersects `box`, sorted in paint order (edges under nodes, then by z). */
  visible(box: Box): RenderItem[] {
    const hits = this.tree.search({ minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h });
    const out: RenderItem[] = [];
    for (const e of hits) {
      const item = this.items.get(e.id);
      if (item) out.push(item);
    }
    return out.sort(comparePaint);
  }

  /** All items in paint order (edges first, then nodes by z). */
  paintOrder(): RenderItem[] {
    return this.all().sort(comparePaint);
  }

  /** Two-phase hit test: R-tree broad phase, then per-geometry narrow phase. Topmost wins. */
  hitTest(p: Vec2, tolerance = 4): RenderItem | null {
    const q = { minX: p.x - tolerance, minY: p.y - tolerance, maxX: p.x + tolerance, maxY: p.y + tolerance };
    const hits = this.tree.search(q);
    let best: RenderItem | null = null;
    for (const e of hits) {
      const item = this.items.get(e.id);
      if (!item) continue;
      if (item.geometry.hitPoint(p, tolerance)) {
        if (!best || comparePaint(item, best) > 0) best = item;
      }
    }
    return best;
  }

  /** Nodes fully enclosed by `box` (marquee selection). */
  enclosedNodes(box: Box): Id[] {
    const hits = this.tree.search({ minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h });
    const out: Id[] = [];
    for (const e of hits) {
      const item = this.items.get(e.id);
      if (!item || item.kind !== 'node') continue;
      const a = item.aabb;
      if (a.x >= box.x && a.y >= box.y && a.x + a.w <= box.x + box.w && a.y + a.h <= box.y + box.h) {
        out.push(item.id);
      }
    }
    return out;
  }

  contentBounds(): Box | null {
    const items = this.all();
    if (items.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const it of items) {
      minX = Math.min(minX, it.aabb.x);
      minY = Math.min(minY, it.aabb.y);
      maxX = Math.max(maxX, it.aabb.x + it.aabb.w);
      maxY = Math.max(maxY, it.aabb.y + it.aabb.h);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  // ---- sync ----

  /** Full rebuild from the current record set. */
  rebuild(records: Iterable<NodusRecord>): void {
    this.tree.clear();
    this.items.clear();
    this.entries.clear();
    this.nodeEdges.clear();
    this.linkedEdges.clear();
    const list = [...records];
    // Collect entries and bulk-`load` the R-tree in one pass (OMT) — a balanced tree built faster
    // than N individual `insert`s. Query behavior is identical; only construction differs.
    const bulk: Entry[] = [];
    for (const r of list) if (isNode(r)) this.addRecord(r, bulk);
    for (const r of list) if (isEdge(r)) this.addRecord(r, bulk);
    this.tree.load(bulk);
    this.version.update((v) => v + 1);
  }

  applyChanges(changes: Change[]): void {
    const edgesToRebuild = new Set<Id>();
    const touchedNodes = new Set<Id>();

    for (const c of changes) {
      if (c.op === 'add') {
        if (isNode(c.record)) {
          this.addRecord(c.record);
          touchedNodes.add(c.record.id);
        } else if (isEdge(c.record)) {
          edgesToRebuild.add(c.record.id);
        }
      } else if (c.op === 'update') {
        const rec = this.deps.getRecord(c.id);
        if (!rec) continue;
        if (isNode(rec)) {
          this.removeItem(c.id);
          this.addRecord(rec);
          touchedNodes.add(c.id);
        } else if (isEdge(rec)) {
          edgesToRebuild.add(c.id);
        }
      } else if (c.op === 'remove') {
        // if it was a node, its edges must reflow (likely to be dropped or cascade-removed)
        for (const eid of this.nodeEdges.get(c.id) ?? []) edgesToRebuild.add(eid);
        this.removeItem(c.id);
      }
    }

    // nodes that moved -> their edges reflow
    for (const nid of touchedNodes) {
      for (const eid of this.nodeEdges.get(nid) ?? []) edgesToRebuild.add(eid);
    }

    for (const eid of edgesToRebuild) {
      const rec = this.deps.getRecord(eid);
      this.removeItem(eid);
      if (rec && isEdge(rec)) this.addRecord(rec);
    }

    this.version.update((v) => v + 1);
  }

  // ---- internals ----

  private addRecord(rec: NodeRecord | EdgeRecord, bulk?: Entry[]): void {
    // Link an edge to its endpoint nodes BEFORE building, so even an edge that can't build yet
    // (endpoint node not present) is tracked — adding that node later reflows and indexes it.
    if (isEdge(rec)) this.linkEdge(rec);
    let item: RenderItem | null;
    try {
      item = isNode(rec) ? this.buildNode(rec) : this.buildEdge(rec);
    } catch (err) {
      // A registered util (getGeometry/getRoute/getPorts) threw. Do NOT let it escape the mutation
      // channel: that would leave the store's atoms committed but the index (and, upstream, undo
      // history) unsynced. Report it and leave the record unindexed, exactly as an unbuildable one.
      this.reportError(err, { phase: 'build', kind: isNode(rec) ? 'node' : 'edge', id: rec.id });
      return;
    }
    if (!item) return; // e.g. edge with a still-missing endpoint: linked above, indexed once resolvable
    this.items.set(rec.id, item);
    const pad = item.kind === 'edge' ? Math.max(6, (item.geometry as Polyline2d).width) : 0;
    const b = pad ? padBox(item.aabb, pad) : item.aabb;
    const entry: Entry = { minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h, id: rec.id };
    this.entries.set(rec.id, entry);
    if (bulk) bulk.push(entry); // deferred: the caller (rebuild) bulk-`load`s these in one pass
    else this.tree.insert(entry);
  }

  private removeItem(id: Id): void {
    const entry = this.entries.get(id);
    if (entry) {
      this.tree.remove(entry);
      this.entries.delete(id);
    }
    this.items.delete(id);
    // Unlink adjacency from *linkage* bookkeeping, not item existence: an edge that linked its
    // endpoints but never built (missing endpoint / unregistered type) has no item, yet still holds
    // a `nodeEdges` entry that must be reclaimed. `linkedEdges` also carries the edge's OLD endpoints,
    // which is exactly what unlink needs (the record itself may already be gone from the store).
    const linked = this.linkedEdges.get(id);
    if (linked) this.unlinkEdge(id, linked);
    // NB: we do NOT delete nodeEdges[id] here — removeItem also runs during a node *update*
    // (remove+re-add), and the node's edge set must survive so its edges still reflow. `id` is a
    // node there (never in `linkedEdges`), so the unlink above is correctly skipped. The set is
    // reclaimed by unlinkEdge (empty-set cleanup) when the connected edges are removed.
  }

  private buildNode(node: NodeRecord): RenderItem | null {
    const util = this.deps.nodes.get(node.type);
    if (!util) return null;
    const geometry = util.getGeometry(node);
    return {
      id: node.id,
      kind: 'node',
      record: node,
      geometry,
      aabb: geometry.bounds(),
      renderVersion: node.version,
    };
  }

  private buildEdge(edge: EdgeRecord): RenderItem | null {
    const util = this.deps.edges.get(edge.type);
    if (!util) return null;
    const from = this.resolveEndpoint(edge.from);
    const to = this.resolveEndpoint(edge.to);
    if (!from || !to) return null; // drop edges with missing endpoints
    // outline endpoints attach at the boundary point toward the *other* end
    const fromPoint = from.outline && from.geom ? from.geom.boundaryToward(to.point) : from.point;
    const toPoint = to.outline && to.geom ? to.geom.boundaryToward(from.point) : to.point;
    const waypoints = Array.isArray(edge.props.waypoints)
      ? (edge.props.waypoints as Vec2[])
      : undefined;
    const route = util.getRoute(edge, {
      from: fromPoint,
      to: toPoint,
      fromGeom: from.geom,
      toGeom: to.geom,
      fromNode: from.node,
      toNode: to.node,
      fromBox: from.geom?.bounds(),
      toBox: to.geom?.bounds(),
      ...(waypoints ? { waypoints } : {}),
      ...(this.deps.routers ? { router: this.deps.routers.get(edge.props.router as string) } : {}),
    });
    const geometry = new Polyline2d(route, util.hitWidth ?? 8);
    return {
      id: edge.id,
      kind: 'edge',
      record: edge,
      geometry,
      aabb: geometry.bounds(),
      route,
      renderVersion: edge.version,
    };
  }

  private resolveEndpoint(
    ep: Endpoint,
  ): { point: Vec2; node?: NodeRecord; geom?: Geometry2d; outline?: boolean } | null {
    if (ep.kind === 'point') return { point: { x: ep.x, y: ep.y } };
    const node = this.deps.getRecord(ep.nodeId);
    if (!node || !isNode(node)) return null;
    const util = this.deps.nodes.get(node.type);
    const geom = util?.getGeometry(node);
    if (ep.kind === 'outline') {
      const center = geom?.center() ?? { x: node.x + node.w / 2, y: node.y + node.h / 2 };
      return { point: center, node, geom, outline: true };
    }
    // ep.kind === 'node' (fixed port/anchor)
    let normalized: Vec2 | undefined = ep.anchor;
    if (!normalized && ep.portId && util?.getPorts) {
      const port = util.getPorts(node).find((p) => p.id === ep.portId);
      if (port) normalized = port.anchor;
    }
    const a = normalized ?? { x: 0.5, y: 0.5 };
    return { point: { x: node.x + a.x * node.w, y: node.y + a.y * node.h }, node, geom };
  }

  private linkEdge(edge: EdgeRecord): void {
    // Record the linkage so removal can unlink from bookkeeping even if the edge never built.
    // Re-linking (edge rebuild) overwrites with the latest endpoints.
    this.linkedEdges.set(edge.id, edge);
    for (const ep of [edge.from, edge.to]) {
      if (ep.kind === 'node' || ep.kind === 'outline') {
        let set = this.nodeEdges.get(ep.nodeId);
        if (!set) {
          set = new Set();
          this.nodeEdges.set(ep.nodeId, set);
        }
        set.add(edge.id);
      }
    }
  }

  private unlinkEdge(edgeId: Id, edge: EdgeRecord): void {
    this.linkedEdges.delete(edgeId);
    for (const ep of [edge.from, edge.to]) {
      if (ep.kind === 'node' || ep.kind === 'outline') {
        const set = this.nodeEdges.get(ep.nodeId);
        if (set) {
          set.delete(edgeId);
          if (set.size === 0) this.nodeEdges.delete(ep.nodeId); // don't leak an empty set
        }
      }
    }
  }
}

/** Paint order: edges below nodes; among nodes by z ascending. Returns >0 if `a` is on top. */
function comparePaint(a: RenderItem, b: RenderItem): number {
  if (a.kind !== b.kind) return a.kind === 'node' ? 1 : -1;
  if (a.kind === 'node') {
    const az = (a.record as NodeRecord).z;
    const bz = (b.record as NodeRecord).z;
    if (az < bz) return -1;
    if (az > bz) return 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export { boxIntersects };
