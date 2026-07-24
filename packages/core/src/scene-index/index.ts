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
import type { EdgeRegistry, NodeRegistry, NodeUtil } from '../registries/index.js';
import type { RouterRegistry } from '../routing/index.js';

/** Clearance (world units) added around each obstacle node, and used to widen the corridor query. */
const OBSTACLE_MARGIN = 10;
/** Cap on obstacle boxes handed to a router — keeps edge routing cheap under a dense scene / drag. */
const MAX_OBSTACLES = 24;

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
  /**
   * Why the record couldn't be indexed:
   * - `'build'`     — a third-party util (`getGeometry`/`getRoute`/`getPorts`) threw while building it.
   * - `'non-finite'`— its resolved geometry produced a non-finite (NaN/Infinity) world box, which would
   *   poison the whole R-tree, so the record is dropped instead of inserted (see `addRecord`).
   * - `'missing-util'`— its `type` isn't registered. Warned ONCE per unknown type per document load
   *   (deduped, cleared on `rebuild`), never per frame. A warning, not a fatal error.
   */
  phase: 'build' | 'non-finite' | 'missing-util';
  kind: 'node' | 'edge';
  id: Id;
  /** For `'missing-util'`: the unregistered type name. */
  type?: string;
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
  /** Fallback util for a node whose `type` isn't registered (opt-in placeholder). When set, an
   *  unknown-type node builds/indexes via this util instead of being dropped. */
  unknownNodeUtil?: NodeUtil;
}

/** The retained render-item index: one `RenderItem` per record in an rbush R-tree, driving viewport
 * culling, paint order, and two-phase hit-testing (R-tree broad phase → per-geometry narrow phase). */
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
  /** Unknown types already warned about this document, so `missing-util` fires ONCE per type per load
   *  (not per frame). Cleared on `rebuild`. */
  private readonly warnedMissingTypes = new Set<string>();

  constructor(private readonly deps: SceneIndexDeps) {}

  /** Route a caught indexing error to the consumer's hook (default: safe no-op — never swallowed). */
  private reportError(err: unknown, ctx: SceneIndexErrorContext): void {
    this.deps.onError?.(err, ctx);
  }

  /** Warn once per unknown type per document that a record's `type` isn't registered. */
  private warnMissingType(kind: 'node' | 'edge', id: Id, type: string): void {
    if (this.warnedMissingTypes.has(type)) return;
    this.warnedMissingTypes.add(type);
    const fate = kind === 'node' && this.deps.unknownNodeUtil ? 'rendered via the placeholder' : 'left unindexed';
    this.reportError(new Error(`No ${kind} type "${type}" is registered; the record is ${fate}.`), {
      phase: 'missing-util',
      kind,
      id,
      type,
    });
  }

  /** The active page, or null for the single implicit page (no page filtering). The editor sets this
   *  when the viewed page changes; it bumps `version` so the scene repaints. */
  private activePageId: Id<'page'> | null = null;

  setActivePage(pageId: Id<'page'> | null): void {
    if (this.activePageId === pageId) return;
    this.activePageId = pageId;
    this.version.update((v) => v + 1); // the visible / pickable set changed
  }

  /**
   * Whether a render item must be EXCLUDED from painting / hit-testing / marquee. Two rules, both
   * applied only at the query layer (`visible`, `paintOrder`, `hitTest`, `enclosedNodes`) — excluded
   * records STAY in the R-tree, so edges still route through them and bounds still compute:
   *   1. **hidden** — a hidden node, or an edge with an endpoint bound to a hidden node (so hiding a
   *      node also drops its dangling connectors);
   *   2. **off the active page** — when a page is active, any record not on it. Records are explicit
   *      once pages exist (the `pageId` invariant), so a direct comparison suffices.
   */
  private isExcludedItem(item: RenderItem): boolean {
    if (item.kind === 'node') {
      if ((item.record as NodeRecord).hidden === true) return true;
    } else {
      const e = item.record as EdgeRecord;
      if (this.endpointHidden(e.from) || this.endpointHidden(e.to)) return true;
    }
    if (this.activePageId !== null && (item.record as NodeRecord | EdgeRecord).pageId !== this.activePageId) return true;
    return false;
  }

  private endpointHidden(ep: Endpoint): boolean {
    if (ep.kind === 'point') return false;
    const n = this.deps.getRecord(ep.nodeId);
    return !!n && isNode(n) && n.hidden === true;
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
      if (item && !this.isExcludedItem(item)) out.push(item);
    }
    return out.sort(comparePaint);
  }

  /** All items in paint order (edges first, then nodes by z). Hidden nodes (and edges to them) omitted. */
  paintOrder(): RenderItem[] {
    return this.all()
      .filter((it) => !this.isExcludedItem(it))
      .sort(comparePaint);
  }

  /** Two-phase hit test: R-tree broad phase, then per-geometry narrow phase. Topmost wins. */
  hitTest(p: Vec2, tolerance = 4): RenderItem | null {
    const q = { minX: p.x - tolerance, minY: p.y - tolerance, maxX: p.x + tolerance, maxY: p.y + tolerance };
    const hits = this.tree.search(q);
    let best: RenderItem | null = null;
    for (const e of hits) {
      const item = this.items.get(e.id);
      if (!item || this.isExcludedItem(item)) continue; // hidden nodes/edges are not pickable
      // A rotated node's geometry is still axis-aligned, so map the pointer into the node's local
      // (un-rotated) frame before the narrow phase. Rotation is rigid, so `tolerance` stays world-unit.
      if (item.geometry.hitPoint(localHitPoint(item, p), tolerance)) {
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
      if (!item || item.kind !== 'node' || this.isExcludedItem(item)) continue; // hidden nodes not marquee-selectable
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
    this.warnedMissingTypes.clear(); // a fresh document re-warns for any still-unknown type
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
    const pad = item.kind === 'edge' ? Math.max(6, (item.geometry as Polyline2d).width) : 0;
    const b = pad ? padBox(item.aabb, pad) : item.aabb;
    const entry: Entry = { minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h, id: rec.id };
    // A single non-finite coordinate (NaN/Infinity from a degenerate layout, a bad importer, or a
    // buggy plugin) would poison the ENTIRE R-tree: rbush folds child boxes with Math.min/Math.max,
    // so one NaN box drives every ancestor bbox — up to the root — non-finite, and every subsequent
    // query (visible/hitTest/marquee) intersects against NaN and returns nothing (blank canvas), while
    // contentBounds() goes non-finite and breaks zoomToFit/export. Treat such geometry as unbuildable:
    // report it and leave the record FULLY unindexed (out of items, entries, and both the incremental
    // `insert` and bulk `load` paths), exactly like a util that threw, so every healthy record stays
    // hit-testable and finite. If no onError channel is wired, reportError is a safe no-op and the box
    // is still dropped.
    if (!isFiniteEntry(entry)) {
      this.reportError(new Error(`non-finite geometry for ${String(rec.id)} — record left unindexed`), {
        phase: 'non-finite',
        kind: item.kind,
        id: rec.id,
      });
      return;
    }
    this.items.set(rec.id, item);
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
    let util = this.deps.nodes.get(node.type);
    if (!util) {
      this.warnMissingType('node', node.id, node.type);
      util = this.deps.unknownNodeUtil; // opt-in placeholder; undefined ⇒ keep the drop behavior
      if (!util) return null;
    }
    const geometry = util.getGeometry(node);
    return {
      id: node.id,
      kind: 'node',
      record: node,
      geometry,
      // broad-phase key: the axis-aligned box that CONTAINS the (possibly rotated) node, so culling,
      // marquee, and content-bounds still bound the visible footprint. Unrotated -> geometry bounds.
      aabb: nodeAabb(node, geometry),
      renderVersion: node.version,
    };
  }

  private buildEdge(edge: EdgeRecord): RenderItem | null {
    const util = this.deps.edges.get(edge.type);
    if (!util) {
      this.warnMissingType('edge', edge.id, edge.type);
      return null; // no edge placeholder — an unknown edge type stays unindexed
    }
    const from = this.resolveEndpoint(edge.from);
    const to = this.resolveEndpoint(edge.to);
    if (!from || !to) return null; // drop edges with missing endpoints
    // outline endpoints attach at the boundary point toward the *other* end
    const fromPoint = from.outline && from.geom ? from.geom.boundaryToward(to.point) : from.point;
    const toPoint = to.outline && to.geom ? to.geom.boundaryToward(from.point) : to.point;
    const waypoints = Array.isArray(edge.props.waypoints)
      ? (edge.props.waypoints as Vec2[])
      : undefined;
    const obstacles = this.gatherObstacles(fromPoint, toPoint, from.node?.id, to.node?.id, waypoints);
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
      ...(obstacles.length ? { obstacles } : {}),
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

  /**
   * Padded boxes of other nodes sitting in the corridor of an edge, for the router to route around.
   * A cheap R-tree query over the endpoints' (and waypoints') bounding box grown by `OBSTACLE_MARGIN`,
   * excluding the two endpoint nodes; each hit's AABB is padded by `OBSTACLE_MARGIN` for clearance and
   * the list is capped so this stays inexpensive on the drag hot path.
   */
  private gatherObstacles(
    from: Vec2,
    to: Vec2,
    fromId: Id | undefined,
    toId: Id | undefined,
    waypoints: Vec2[] | undefined,
  ): Box[] {
    let minX = Math.min(from.x, to.x);
    let minY = Math.min(from.y, to.y);
    let maxX = Math.max(from.x, to.x);
    let maxY = Math.max(from.y, to.y);
    if (waypoints) {
      for (const p of waypoints) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    const hits = this.tree.search({
      minX: minX - OBSTACLE_MARGIN,
      minY: minY - OBSTACLE_MARGIN,
      maxX: maxX + OBSTACLE_MARGIN,
      maxY: maxY + OBSTACLE_MARGIN,
    });
    const out: Box[] = [];
    for (const e of hits) {
      if (e.id === fromId || e.id === toId) continue; // never treat an endpoint as an obstacle
      const item = this.items.get(e.id);
      if (!item || item.kind !== 'node' || this.isExcludedItem(item)) continue;
      out.push(padBox(item.aabb, OBSTACLE_MARGIN));
      if (out.length >= MAX_OBSTACLES) break; // perf cap — the router degrades gracefully anyway
    }
    return out;
  }

  private resolveEndpoint(
    ep: Endpoint,
  ): { point: Vec2; node?: NodeRecord; geom?: Geometry2d; outline?: boolean } | null {
    if (ep.kind === 'point') return { point: { x: ep.x, y: ep.y } };
    const node = this.deps.getRecord(ep.nodeId);
    if (!node || !isNode(node)) return null;
    const util = this.deps.nodes.get(node.type) ?? this.deps.unknownNodeUtil; // placeholder attaches edges too
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

/**
 * Contract for node rotation, shared with the renderer and the select tool: `rotation` is in radians,
 * clockwise, about the node's bounding-box center `(x + w/2, y + h/2)`. A zero, absent, or non-finite
 * rotation is treated as "no rotation" so a corrupt value can't poison culling or picking.
 */
function nodeRotationCenter(node: NodeRecord): { rot: number; cx: number; cy: number } | null {
  const rot = node.rotation;
  if (!rot || !Number.isFinite(rot)) return null;
  return { rot, cx: node.x + node.w / 2, cy: node.y + node.h / 2 };
}

/**
 * The world AABB of a node, accounting for its rotation. For a rotated node it is the axis-aligned box
 * enclosing the four rotated corners of the un-rotated geometry bounds — guaranteed to contain the
 * rotated shape, so it is a valid (conservative) broad-phase key for culling and marquee.
 */
function nodeAabb(node: NodeRecord, geometry: Geometry2d): Box {
  const b = geometry.bounds();
  const rc = nodeRotationCenter(node);
  if (!rc) return b;
  const cos = Math.cos(rc.rot);
  const sin = Math.sin(rc.rot);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const corners: readonly [number, number][] = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
  for (const [px, py] of corners) {
    const dx = px - rc.cx;
    const dy = py - rc.cy;
    const rx = rc.cx + dx * cos - dy * sin; // clockwise (Canvas2D +y-down) rotation of the corner
    const ry = rc.cy + dx * sin + dy * cos;
    if (rx < minX) minX = rx;
    if (ry < minY) minY = ry;
    if (rx > maxX) maxX = rx;
    if (ry > maxY) maxY = ry;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Map a world point into a node's local (un-rotated) frame so it can be hit-tested against the node's
 * axis-aligned geometry. Non-nodes and unrotated nodes pass the point through unchanged.
 */
function localHitPoint(item: RenderItem, p: Vec2): Vec2 {
  if (item.kind !== 'node') return p;
  const rc = nodeRotationCenter(item.record as NodeRecord);
  if (!rc) return p;
  // inverse of the render rotation: rotate `p` by `-rot` about the center.
  const cos = Math.cos(rc.rot);
  const sin = Math.sin(rc.rot);
  const dx = p.x - rc.cx;
  const dy = p.y - rc.cy;
  return { x: rc.cx + dx * cos + dy * sin, y: rc.cy - dx * sin + dy * cos };
}

/**
 * Whether all four R-tree coordinates are finite. A non-finite box (NaN/Infinity) must never be inserted:
 * rbush computes node bounds with Math.min/Math.max, so one such box poisons every ancestor bbox and
 * silently breaks all spatial queries. `Number.isFinite` rejects NaN, Infinity and -Infinity.
 */
function isFiniteEntry(e: Entry): boolean {
  return (
    Number.isFinite(e.minX) &&
    Number.isFinite(e.minY) &&
    Number.isFinite(e.maxX) &&
    Number.isFinite(e.maxY)
  );
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
