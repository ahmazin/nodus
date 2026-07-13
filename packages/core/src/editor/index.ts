/**
 * The Editor — the single imperative facade over store, registries, scene index, history, tools,
 * camera, and rendering. Presets and the React binding talk only to this object. It also *is* the
 * plugin `EngineHost`.
 */

import { atom, batch, type Atom, type Dispose } from '../signals/index.js';
import {
  isEdge,
  isNode,
  makeId,
  type ApplyOptions,
  type Box,
  type Camera,
  type Change,
  type EdgeRecord,
  type Endpoint,
  type FlowRuntimeConfig,
  type FlowSource,
  type FlowSpec,
  type Id,
  type NodeRecord,
  type NodusRecord,
  type Vec2,
} from '../model.js';
import {
  DEFAULT_CAMERA,
  fitBox,
  panByScreen as camPanByScreen,
  renderMatrix,
  screenToWorld,
  viewportWorldBounds,
  zoomAt,
} from '../camera/index.js';
import { dist, padBox, unionBox } from '../geometry/index.js';
import { defaultTheme, type StateTokens, type Theme } from '../theme/index.js';
import { Store, type ChangeInfo, type StoreListener } from '../store/index.js';
import { SceneIndex, type RenderItem } from '../scene-index/index.js';
import { History } from '../history/index.js';
import { EventBus, type NodusEvent } from '../events/index.js';
import { Registry, type EdgeUtil, type NodeUtil } from '../registries/index.js';
import { RouterRegistry, defaultRouters } from '../routing/index.js';
import type { LayoutEngine, LayoutGraph, LayoutOptions } from '../layout/index.js';
import type { EngineHost, OverlayLayer, Plugin } from '../plugins/index.js';
import {
  ToolManager,
  defaultTools,
  type KeyInfo,
  type PointerInfo,
  type ToolNode,
} from '../tools/index.js';
import { rectNodeUtil, lineEdgeUtil, groupNodeUtil } from '../builtins/index.js';
import { drawGrid, fillBackground, fillHandle, paintFlowMarkers, paintItem, strokeWorldBox } from '../renderer/paint.js';
import { resolveFlow } from '../flow.js';
import type { Ctx2D } from '../renderer/context.js';
import { restore, serializeRecords, type Snapshot } from '../serialization/index.js';

const FLOW_DEFAULTS: FlowRuntimeConfig = {
  enabled: true,
  paused: false,
  speedScale: 1,
  respectReducedMotion: true,
};

export interface EditorOptions {
  theme?: Theme;
  nodeTypes?: NodeUtil[];
  edgeTypes?: EdgeUtil[];
  records?: NodusRecord[];
  /** Register the built-in `rect`/`line` types (default true). */
  builtins?: boolean;
  camera?: Camera;
  viewport?: { w: number; h: number };
}

export interface PointerMods {
  button?: number;
  shift?: boolean;
  meta?: boolean;
  alt?: boolean;
}

export interface ConnectDraft {
  from: Vec2;
  to: Vec2;
  valid: boolean;
}

export interface SnapConfig {
  /** Grid size to snap to (0 disables grid snapping). */
  grid: number;
  /** Snap to other nodes' edges and centers. */
  toObjects: boolean;
  /** Snap threshold in screen pixels. */
  threshold: number;
}

/** A world-space alignment guide line drawn during a snapped drag. */
export interface Guide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface ExportCanvas {
  getContext(type: '2d'): unknown;
  width: number;
  height: number;
  encode?(format: 'png'): Promise<Uint8Array> | Uint8Array;
  toBuffer?(mime: string): Uint8Array;
}
export type CreateCanvas = (w: number, h: number) => ExportCanvas;

export interface ToPNGOptions {
  pixelRatio?: number;
  padding?: number;
  background?: boolean;
  grid?: boolean;
  /** World region to export (default: the whole content bounds). */
  bounds?: Box;
  /** Also render flow markers (packets/dashes) at `time` ms — a snapshot of the current traffic. */
  flow?: boolean;
  time?: number;
}

export class Editor implements EngineHost {
  readonly store = new Store();
  readonly nodes: Registry<NodeUtil> = new Registry<NodeUtil>();
  readonly edges: Registry<EdgeUtil> = new Registry<EdgeUtil>();
  readonly sceneIndex: SceneIndex;
  readonly history: History;
  readonly events = new EventBus();
  readonly layouts = new Map<string, LayoutEngine>();
  readonly routers = new RouterRegistry();
  readonly toolManager: ToolManager;

  // reactive state
  readonly themeAtom: Atom<Theme>;
  readonly cameraAtom: Atom<Camera>;
  readonly viewportAtom: Atom<{ w: number; h: number }>;
  readonly selectedAtom: Atom<ReadonlySet<Id>> = atom<ReadonlySet<Id>>(new Set());
  readonly hoveredAtom: Atom<Id | null> = atom<Id | null>(null);
  readonly editingAtom: Atom<Id | null> = atom<Id | null>(null);
  readonly marqueeAtom: Atom<Box | null> = atom<Box | null>(null);
  readonly connectDraftAtom: Atom<ConnectDraft | null> = atom<ConnectDraft | null>(null);
  readonly createPreviewAtom: Atom<Box | null> = atom<Box | null>(null);
  readonly overlaysAtom: Atom<OverlayLayer[]> = atom<OverlayLayer[]>([]);
  readonly snapGuidesAtom: Atom<Guide[]> = atom<Guide[]>([]);

  /** Snapping config (mutate directly, e.g. `editor.snap.grid = 8`). */
  readonly snap: SnapConfig = { grid: 0, toObjects: true, threshold: 7 };

  private zCounter = 0;
  private readonly disposers: Dispose[] = [];

  constructor(opts: EditorOptions = {}) {
    this.themeAtom = atom<Theme>(opts.theme ?? defaultTheme);
    this.cameraAtom = atom<Camera>(opts.camera ?? DEFAULT_CAMERA);
    this.viewportAtom = atom(opts.viewport ?? { w: 800, h: 600 });

    for (const r of defaultRouters()) this.routers.register(r);
    this.sceneIndex = new SceneIndex({
      getRecord: (id) => this.store.peek(id),
      nodes: this.nodes,
      edges: this.edges,
      routers: this.routers,
    });
    this.history = new History((changes, o) => this.store.apply(changes, o));
    this.toolManager = new ToolManager(this, defaultTools());

    if (opts.builtins !== false) {
      this.nodes.register(rectNodeUtil);
      this.nodes.register(groupNodeUtil);
      this.edges.register(lineEdgeUtil);
    }
    for (const u of opts.nodeTypes ?? []) this.nodes.register(u);
    for (const u of opts.edgeTypes ?? []) this.edges.register(u);

    // single wiring point: every store change updates the index, history, and event bus
    this.disposers.push(
      this.store.listen((info: ChangeInfo) => {
        this.sceneIndex.applyChanges(info.changes);
        this.history.record(info);
        this.events.emit({ type: 'change', info });
      }),
    );

    if (opts.records && opts.records.length > 0) {
      this.store.load(opts.records);
      this.sceneIndex.rebuild(this.store.allRecords());
    }
  }

  get editor(): Editor {
    return this;
  }

  // ==========================================================================
  // EngineHost / registration
  // ==========================================================================

  registerNodeType(util: NodeUtil): void {
    this.nodes.register(util);
    this.sceneIndex.rebuild(this.store.allRecords());
  }
  registerEdgeType(util: EdgeUtil): void {
    this.edges.register(util);
    this.sceneIndex.rebuild(this.store.allRecords());
  }
  registerTool(tool: ToolNode): void {
    this.toolManager.register(tool);
  }
  registerLayout(engine: LayoutEngine): void {
    this.layouts.set(engine.id, engine);
  }
  setTheme(theme: Theme): void {
    this.themeAtom.set(theme);
    this.events.emit({ type: 'theme', name: theme.name });
  }
  addOverlay(overlay: OverlayLayer): Dispose {
    this.overlaysAtom.update((a) => [...a, overlay]);
    return () => this.overlaysAtom.update((a) => a.filter((o) => o !== overlay));
  }
  on(type: string, handler: (event: NodusEvent) => void): Dispose {
    return this.events.on(type, handler);
  }
  onChange(handler: StoreListener): Dispose {
    return this.store.listen(handler);
  }
  use(plugin: Plugin): Dispose {
    const dispose = plugin.register(this);
    const d = typeof dispose === 'function' ? dispose : () => {};
    this.disposers.push(d);
    return d;
  }

  // ==========================================================================
  // document mutations
  // ==========================================================================

  private makeZ(): string {
    return (this.zCounter++).toString(36).padStart(10, '0');
  }

  addRecords(records: NodusRecord[], opts?: ApplyOptions): void {
    this.store.apply(
      records.map((record) => ({ op: 'add', record }) as Change),
      opts ?? { capture: 'immediately' },
    );
  }

  createNode(partial: Partial<NodeRecord> & { type?: string }, opts?: ApplyOptions): Id<'node'> {
    const type = partial.type ?? 'rect';
    const util = this.nodes.get(type);
    const props = partial.props ?? util?.getDefaultProps?.() ?? {};
    const size = util?.getDefaultSize?.(props) ?? { w: 120, h: 56 };
    const node: NodeRecord = {
      id: (partial.id as Id<'node'>) ?? makeId('node'),
      typeName: 'node',
      version: 0,
      type,
      x: partial.x ?? 0,
      y: partial.y ?? 0,
      w: partial.w ?? size.w,
      h: partial.h ?? size.h,
      z: partial.z ?? this.makeZ(),
      visual: partial.visual ?? { state: 'accent' },
      label: partial.label,
      props,
      ...(partial.parentId ? { parentId: partial.parentId } : {}),
      ...(partial.meta ? { meta: partial.meta } : {}),
    };
    this.store.apply([{ op: 'add', record: node }], opts ?? { capture: 'immediately' });
    return node.id;
  }

  createNodeAt(type: string, box: Box, opts?: ApplyOptions): Id<'node'> {
    const w = box.w > 3 ? box.w : undefined;
    const h = box.h > 3 ? box.h : undefined;
    return this.createNode({ type, x: box.x, y: box.y, w, h }, opts);
  }

  /** Node type used by quick-create gestures (double-click canvas, drag-from-port into empty space).
   *  Defaults to the first registered non-group node type. */
  quickCreateType: string | null = null;

  /** Create a default-typed, default-sized node CENTERED on `world`. Returns null if no type exists. */
  quickCreateNode(world: Vec2, opts?: ApplyOptions): Id<'node'> | null {
    const type = this.quickCreateType && this.nodes.has(this.quickCreateType) ? this.quickCreateType : this.nodes.list().find((u) => u.type !== 'group')?.type;
    if (!type) return null;
    const util = this.nodes.get(type);
    const size = util?.getDefaultSize?.(util?.getDefaultProps?.() ?? {}) ?? { w: 120, h: 56 };
    return this.createNode({ type, x: world.x - size.w / 2, y: world.y - size.h / 2 }, opts);
  }

  updateNode(id: Id, patch: Partial<NodeRecord>, opts?: ApplyOptions): void {
    this.store.apply([{ op: 'update', id, patch: patch as Record<string, unknown> }], opts ?? {});
  }

  /** Generic update for any record (node/edge/page). */
  updateRecord(id: Id, patch: Record<string, unknown>, opts?: ApplyOptions): void {
    this.store.apply([{ op: 'update', id, patch }], opts ?? {});
  }

  // ---- edge helpers ----

  setEdgeRouter(id: Id, routerId: string, opts?: ApplyOptions): void {
    const e = this.store.peek(id);
    if (e && isEdge(e)) {
      this.updateRecord(id, { props: { ...e.props, router: routerId } }, opts ?? { capture: 'immediately' });
    }
  }
  setEdgeLabel(id: Id, label: string, opts?: ApplyOptions): void {
    this.updateRecord(id, { label }, opts ?? { capture: 'immediately' });
  }
  addWaypoint(id: Id, point: Vec2, opts?: ApplyOptions): void {
    const e = this.store.peek(id);
    if (e && isEdge(e)) {
      const wps = [...((e.props.waypoints as Vec2[]) ?? []), point];
      this.updateRecord(id, { props: { ...e.props, waypoints: wps } }, opts ?? { capture: 'immediately' });
    }
  }
  setWaypoints(id: Id, waypoints: Vec2[], opts?: ApplyOptions): void {
    const e = this.store.peek(id);
    if (e && isEdge(e)) {
      this.updateRecord(id, { props: { ...e.props, waypoints } }, opts ?? { capture: 'immediately' });
    }
  }

  // ---- per-element style ----

  /** Merge per-element style overrides onto records (e.g. `{ stroke: '#ef4444', dash: [4,4] }`). */
  setStyle(ids: Id[], style: Partial<StateTokens>, opts?: ApplyOptions): void {
    const changes: Change[] = [];
    for (const id of ids) {
      const r = this.store.peek(id);
      if (r) changes.push({ op: 'update', id, patch: { style: { ...r.style, ...style } } });
    }
    if (changes.length) this.store.apply(changes, opts ?? { capture: 'immediately' });
  }
  clearStyle(ids: Id[], opts?: ApplyOptions): void {
    const changes: Change[] = ids
      .filter((id) => this.store.has(id))
      .map((id) => ({ op: 'update', id, patch: { style: undefined } }) as Change);
    if (changes.length) this.store.apply(changes, opts ?? { capture: 'immediately' });
  }

  // ---- floating / re-binding arrows ----

  /** The best endpoint for a world point: bind to a connectable node's outline, else a free point. */
  endpointAt(world: Vec2): Endpoint {
    const hit = this.sceneIndex.hitTest(world, 4 / this.camera.z);
    if (hit && hit.kind === 'node') {
      const n = hit.record as NodeRecord;
      const util = this.nodes.get(n.type);
      if (n.type !== 'group' && util?.capabilities?.canConnect !== false) {
        return { kind: 'outline', nodeId: n.id };
      }
    }
    return { kind: 'point', x: world.x, y: world.y };
  }
  setEdgeEndpoint(id: Id, which: 'from' | 'to', endpoint: Endpoint, opts?: ApplyOptions): void {
    this.updateRecord(id, { [which]: endpoint }, opts ?? { capture: 'immediately' });
  }
  /** The world positions of a selected edge's draggable endpoints (route ends), or null. */
  edgeEndpointHandles(id: Id): { from: Vec2; to: Vec2 } | null {
    const item = this.sceneIndex.getItem(id);
    if (!item || item.kind !== 'edge' || !item.route || item.route.length < 2) return null;
    return { from: item.route[0]!, to: item.route[item.route.length - 1]! };
  }

  /** Expand a set of ids to include all descendant nodes (children of selected groups). */
  expandWithDescendants(ids: Id[]): Set<Id> {
    const all = new Set<Id>(ids);
    const queue = [...ids];
    while (queue.length) {
      const id = queue.pop()!;
      for (const c of this.childrenOf(id)) if (!all.has(c)) { all.add(c); queue.push(c); }
    }
    return all;
  }

  moveBy(ids: Id[], dx: number, dy: number, opts?: ApplyOptions): void {
    const changes: Change[] = [];
    for (const id of this.expandWithDescendants(ids)) {
      const r = this.store.peek(id);
      if (r && isNode(r)) changes.push({ op: 'update', id, patch: { x: r.x + dx, y: r.y + dy } });
    }
    if (changes.length) this.store.apply(changes, opts ?? { capture: 'immediately' });
  }

  /** Set absolute positions for a set of nodes in one change (used by snapped drags). */
  setPositionsAbsolute(positions: Map<Id, Vec2>, opts?: ApplyOptions): void {
    const changes: Change[] = [];
    for (const [id, p] of positions) {
      const r = this.store.peek(id);
      if (r && isNode(r)) changes.push({ op: 'update', id, patch: { x: p.x, y: p.y } });
    }
    if (changes.length) this.store.apply(changes, opts ?? { capture: 'immediately' });
  }

  /**
   * Compute a snap correction for a moving box against the grid and other nodes' edges/centers.
   * Returns the delta to add and the alignment guides to draw.
   */
  computeSnap(box: Box, movingIds: Set<Id>): { dx: number; dy: number; guides: Guide[] } {
    const cam = this.camera;
    const thr = this.snap.threshold / cam.z;
    let bestDX = 0;
    let bestDY = 0;
    let dxDist = Infinity;
    let dyDist = Infinity;
    let gx: Guide | null = null;
    let gy: Guide | null = null;
    const bx = [box.x, box.x + box.w / 2, box.x + box.w];
    const by = [box.y, box.y + box.h / 2, box.y + box.h];

    if (this.snap.toObjects) {
      for (const item of this.sceneIndex.visible(padBox(box, 240 / cam.z))) {
        if (item.kind !== 'node' || movingIds.has(item.id)) continue;
        const o = item.aabb;
        for (const be of bx) {
          for (const oe of [o.x, o.x + o.w / 2, o.x + o.w]) {
            const d = Math.abs(oe - be);
            if (d < thr && d < dxDist) {
              dxDist = d;
              bestDX = oe - be;
              gx = { x1: oe, y1: Math.min(box.y, o.y), x2: oe, y2: Math.max(box.y + box.h, o.y + o.h) };
            }
          }
        }
        for (const be of by) {
          for (const oe of [o.y, o.y + o.h / 2, o.y + o.h]) {
            const d = Math.abs(oe - be);
            if (d < thr && d < dyDist) {
              dyDist = d;
              bestDY = oe - be;
              gy = { x1: Math.min(box.x, o.x), y1: oe, x2: Math.max(box.x + box.w, o.x + o.w), y2: oe };
            }
          }
        }
      }
    }
    if (this.snap.grid > 0) {
      if (dxDist === Infinity) {
        const t = Math.round(box.x / this.snap.grid) * this.snap.grid;
        if (Math.abs(t - box.x) < thr) bestDX = t - box.x;
      }
      if (dyDist === Infinity) {
        const t = Math.round(box.y / this.snap.grid) * this.snap.grid;
        if (Math.abs(t - box.y) < thr) bestDY = t - box.y;
      }
    }
    const guides: Guide[] = [];
    if (gx) guides.push(gx);
    if (gy) guides.push(gy);
    return { dx: bestDX, dy: bestDY, guides };
  }

  // ---- grouping / frames ----

  childrenOf(id: Id): Id[] {
    const out: Id[] = [];
    for (const n of this.store.nodes()) if (n.parentId === id) out.push(n.id);
    return out;
  }

  /** Wrap the given nodes in a `group` frame (sets their `parentId`). Returns the group id. */
  group(ids: Id[], label = 'Group'): Id | null {
    const members = ids.filter((id) => {
      const r = this.store.peek(id);
      return r && isNode(r) && r.type !== 'group';
    });
    if (members.length === 0) return null;
    const boxes = members.map((id) => this.sceneIndex.getItem(id)?.aabb).filter(Boolean) as Box[];
    const b = unionBox(boxes);
    if (!b) return null;
    const pad = 18;
    const frame = { x: b.x - pad, y: b.y - pad - 14, w: b.w + pad * 2, h: b.h + pad * 2 + 14 };
    const gid = makeId('node');
    const changes: Change[] = [
      {
        op: 'add',
        record: {
          id: gid,
          typeName: 'node',
          version: 0,
          type: 'group',
          x: frame.x,
          y: frame.y,
          w: frame.w,
          h: frame.h,
          z: '0', // send to back so children stay clickable
          visual: { state: 'solid' },
          label,
          props: {},
        },
      },
      ...members.map((id) => ({ op: 'update', id, patch: { parentId: gid } }) as Change),
    ];
    this.store.apply(changes, { capture: 'immediately' });
    this.select([gid]);
    return gid;
  }

  ungroup(id: Id): void {
    const g = this.store.peek(id);
    if (!g || !isNode(g) || g.type !== 'group') return;
    const changes: Change[] = this.childrenOf(id).map(
      (cid) => ({ op: 'update', id: cid, patch: { parentId: undefined } }) as Change,
    );
    // a group frame shouldn't normally carry edges, but if one is bound to it, cascade it — else the
    // store would keep a dangling edge the scene index has already dropped (store↔index desync)
    for (const eid of this.sceneIndex.edgesForNode(id)) changes.push({ op: 'remove', id: eid });
    changes.push({ op: 'remove', id });
    this.store.apply(changes, { capture: 'immediately' });
    const sel = new Set(this.selectedAtom.peek());
    sel.delete(id);
    this.selectedAtom.set(sel);
    this.emitSelection();
  }

  // ---- clipboard ----

  private clipboard: NodusRecord[] = [];

  /** Collect the nodes (+ descendants) and interconnecting edges for a set of ids, deep-cloned. */
  private collectForCopy(ids: Id[]): NodusRecord[] {
    const nodeIds = new Set<Id>();
    const queue = [...ids];
    while (queue.length) {
      const id = queue.pop()!;
      const r = this.store.peek(id);
      if (r && isNode(r) && !nodeIds.has(id)) {
        nodeIds.add(id);
        for (const c of this.childrenOf(id)) queue.push(c);
      }
    }
    const nodes = [...nodeIds].map((id) => this.store.peek(id)!).filter(isNode);
    const epNode = (ep: Endpoint): Id<'node'> | null =>
      ep.kind === 'node' || ep.kind === 'outline' ? ep.nodeId : null;
    const edges = this.store.edges().filter((e) => {
      const f = epNode(e.from);
      const t = epNode(e.to);
      return f !== null && t !== null && nodeIds.has(f) && nodeIds.has(t);
    });
    return [...nodes, ...edges].map((r) => structuredClone(r));
  }

  /** Copy the selection (nodes + their descendants + interconnecting edges) to the clipboard. */
  copy(ids: Id[] = this.selectedIdsArray()): void {
    this.clipboard = this.collectForCopy(ids);
  }

  hasClipboard(): boolean {
    return this.clipboard.length > 0;
  }

  /** Paste the clipboard with fresh ids, offset, and remapped endpoints. Returns the new ids. */
  paste(offset: Vec2 = { x: 24, y: 24 }): Id[] {
    return this.pasteRecords(this.clipboard, offset);
  }

  /** Insert a set of copied records with fresh ids/endpoints at an offset. Returns the new node ids. */
  private pasteRecords(records: NodusRecord[], offset: Vec2): Id[] {
    if (records.length === 0) return [];
    const idMap = new Map<Id, Id<'node'>>();
    for (const r of records) if (isNode(r)) idMap.set(r.id, makeId('node'));
    const changes: Change[] = [];
    const newIds: Id[] = [];
    for (const r of records) {
      if (isNode(r)) {
        const nid = idMap.get(r.id)!;
        const rec = structuredClone(r) as NodeRecord;
        rec.id = nid;
        rec.version = 0;
        rec.x += offset.x;
        rec.y += offset.y;
        rec.z = rec.type === 'group' ? '0' : this.makeZ();
        if (rec.parentId) rec.parentId = idMap.get(rec.parentId) ?? undefined;
        changes.push({ op: 'add', record: rec });
        newIds.push(nid);
      } else if (isEdge(r)) {
        const rec = structuredClone(r) as EdgeRecord;
        rec.id = makeId('edge');
        rec.version = 0;
        rec.from = this.remapEndpoint(rec.from, idMap);
        rec.to = this.remapEndpoint(rec.to, idMap);
        changes.push({ op: 'add', record: rec });
      }
    }
    this.store.apply(changes, { capture: 'immediately' });
    this.select(newIds);
    return newIds;
  }

  duplicate(ids: Id[] = this.selectedIdsArray()): Id[] {
    // duplicate must NOT disturb the user's clipboard — collect + paste directly
    return this.pasteRecords(this.collectForCopy(ids), { x: 24, y: 24 });
  }

  private remapEndpoint(ep: Endpoint, idMap: Map<Id, Id<'node'>>): Endpoint {
    if ((ep.kind === 'node' || ep.kind === 'outline') && idMap.has(ep.nodeId)) {
      return { ...ep, nodeId: idMap.get(ep.nodeId)! };
    }
    return ep;
  }

  connect(from: Endpoint, to: Endpoint, type?: string, opts?: ApplyOptions): Id<'edge'> | null {
    const edgeType = type ?? this.edges.list()[0]?.type ?? 'line';
    if (!this.edges.has(edgeType)) return null;
    const edge: EdgeRecord = {
      id: makeId('edge'),
      typeName: 'edge',
      version: 0,
      type: edgeType,
      from,
      to,
      visual: { state: 'solid' },
      props: {},
    };
    this.store.apply([{ op: 'add', record: edge }], opts ?? { capture: 'immediately' });
    return edge.id;
  }

  deleteRecords(ids: Id[]): void {
    const toRemove = new Set<Id>();
    // Deleting a group deletes its contents too (descendants + their edges); otherwise a surviving
    // child would keep a parentId pointing at the removed group — a dangling ref. `ungroup` is the
    // keep-the-children path.
    for (const id of this.expandWithDescendants(ids)) {
      const r = this.store.peek(id);
      if (!r) continue;
      toRemove.add(id);
      if (isNode(r)) {
        for (const eid of this.sceneIndex.edgesForNode(id)) toRemove.add(eid);
      }
    }
    if (toRemove.size === 0) return;
    this.store.apply(
      [...toRemove].map((id) => ({ op: 'remove', id }) as Change),
      { capture: 'immediately' },
    );
    const sel = new Set(this.selectedAtom.peek());
    for (const id of toRemove) sel.delete(id);
    this.selectedAtom.set(sel);
    this.emitSelection();
  }

  // ==========================================================================
  // selection
  // ==========================================================================

  select(ids: Id[], additive = false): void {
    const set = additive ? new Set([...this.selectedAtom.peek(), ...ids]) : new Set(ids);
    this.selectedAtom.set(set);
    this.emitSelection();
  }
  toggleSelect(id: Id): void {
    const set = new Set(this.selectedAtom.peek());
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.selectedAtom.set(set);
    this.emitSelection();
  }
  clearSelection(): void {
    if (this.selectedAtom.peek().size === 0) return;
    this.selectedAtom.set(new Set());
    this.emitSelection();
  }
  selectAll(): void {
    this.selectedAtom.set(new Set(this.store.ids()));
    this.emitSelection();
  }
  isSelected(id: Id): boolean {
    return this.selectedAtom.peek().has(id);
  }
  selectedIdsArray(): Id[] {
    return [...this.selectedAtom.peek()];
  }
  selectionBounds(): Box | null {
    const boxes: Box[] = [];
    for (const id of this.selectedAtom.peek()) {
      const item = this.sceneIndex.getItem(id);
      if (item) boxes.push(item.aabb);
    }
    return unionBox(boxes);
  }
  private emitSelection(): void {
    this.events.emit({ type: 'selection', ids: [...this.selectedAtom.peek()] });
  }

  canEdit(id: Id): boolean {
    const r = this.store.peek(id);
    if (!r) return false;
    if (isEdge(r)) return true; // edges are always label-editable
    if (!isNode(r)) return false;
    return this.nodes.get(r.type)?.capabilities?.canEdit !== false;
  }

  // ---- resize ----

  canResizeNode(id: Id): boolean {
    const r = this.store.peek(id);
    if (!r || !isNode(r)) return false;
    return this.nodes.get(r.type)?.capabilities?.canResize !== false;
  }

  /** World positions of a box's 8 resize handles. */
  resizeHandlePoints(b: Box): Record<ResizeHandle, Vec2> {
    const midX = b.x + b.w / 2;
    const midY = b.y + b.h / 2;
    const x2 = b.x + b.w;
    const y2 = b.y + b.h;
    return {
      nw: { x: b.x, y: b.y }, n: { x: midX, y: b.y }, ne: { x: x2, y: b.y },
      e: { x: x2, y: midY }, se: { x: x2, y: y2 }, s: { x: midX, y: y2 },
      sw: { x: b.x, y: y2 }, w: { x: b.x, y: midY },
    };
  }
  /** Which resize handle (if any) is under `world`, within a screen-scaled tolerance. */
  hitResizeHandle(b: Box, world: Vec2): ResizeHandle | null {
    const tol = 7 / this.camera.z;
    const pts = this.resizeHandlePoints(b);
    let best: ResizeHandle | null = null;
    let bd = Infinity;
    for (const h of Object.keys(pts) as ResizeHandle[]) {
      const d = dist(world, pts[h]);
      if (d < tol && d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }

  // ---- z-order ----

  /** Renumber node z by current paint order, moving `ids` to the front or back. Robust regardless
   *  of where the existing z values came from (loaded docs, created nodes, etc.). */
  private reorder(ids: Id[], where: 'front' | 'back'): void {
    const set = new Set(ids);
    const nodes = this.store
      .nodes()
      .slice()
      .filter((n) => n.type !== 'group') // groups stay pinned behind their children (z='0')
      .sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : 1));
    const moving = nodes.filter((n) => set.has(n.id));
    if (moving.length === 0) return;
    const rest = nodes.filter((n) => !set.has(n.id));
    const ordered = where === 'front' ? [...rest, ...moving] : [...moving, ...rest];
    const changes: Change[] = [];
    ordered.forEach((n, i) => {
      const z = i.toString(36).padStart(10, '0');
      if (n.z !== z) changes.push({ op: 'update', id: n.id, patch: { z } });
    });
    if (changes.length) {
      this.zCounter = Math.max(this.zCounter, ordered.length);
      this.store.apply(changes, { capture: 'immediately' });
    }
  }
  bringToFront(ids: Id[]): void {
    this.reorder(ids, 'front');
  }
  sendToBack(ids: Id[]): void {
    this.reorder(ids, 'back');
  }
  /** Whether label editing for this node should be multi-line (text nodes). */
  isMultilineEdit(id: Id): boolean {
    const r = this.store.peek(id);
    if (!r || !isNode(r)) return false;
    return this.nodes.get(r.type)?.capabilities?.multiline === true;
  }
  beginEdit(id: Id): void {
    this.editingAtom.set(id);
    this.events.emit({ type: 'edit:start', id });
  }
  commitEdit(label: string): void {
    const id = this.editingAtom.peek();
    if (id) {
      this.updateNode(id, { label }, { capture: 'immediately' });
      this.editingAtom.set(null);
      this.events.emit({ type: 'edit:end', id, committed: true });
    }
  }
  cancelEdit(): void {
    const id = this.editingAtom.peek();
    if (id) {
      this.editingAtom.set(null);
      this.events.emit({ type: 'edit:end', id, committed: false });
    }
  }

  // ==========================================================================
  // camera / viewport
  // ==========================================================================

  get camera(): Camera {
    return this.cameraAtom.peek();
  }
  setCamera(cam: Camera): void {
    this.cameraAtom.set(cam);
    this.events.emit({ type: 'camera', camera: cam });
  }
  setViewport(w: number, h: number): void {
    const vp = this.viewportAtom.peek();
    if (vp.w === w && vp.h === h) return;
    this.viewportAtom.set({ w, h });
  }
  panByScreen(dx: number, dy: number): void {
    this.setCamera(camPanByScreen(this.camera, dx, dy));
  }
  zoomBy(factor: number, screenCenter?: Vec2): void {
    const vp = this.viewportAtom.peek();
    const center = screenCenter ?? { x: vp.w / 2, y: vp.h / 2 };
    this.setCamera(zoomAt(this.camera, center, factor));
  }
  zoomToFit(padding = 48): void {
    const bounds = this.sceneIndex.contentBounds();
    if (!bounds) return;
    const vp = this.viewportAtom.peek();
    this.setCamera(fitBox(bounds, vp.w, vp.h, padding));
  }
  worldViewport(): Box {
    const vp = this.viewportAtom.peek();
    return viewportWorldBounds(this.camera, vp.w, vp.h);
  }
  screenToWorld(p: Vec2): Vec2 {
    return screenToWorld(this.camera, p);
  }

  // ==========================================================================
  // history
  // ==========================================================================

  mark(): void {
    this.history.mark();
  }
  undo(): void {
    this.history.undo();
    this.pruneSelection();
  }
  redo(): void {
    this.history.redo();
    this.pruneSelection();
  }
  private pruneSelection(): void {
    const sel = new Set([...this.selectedAtom.peek()].filter((id) => this.store.has(id)));
    if (sel.size !== this.selectedAtom.peek().size) {
      this.selectedAtom.set(sel);
      this.emitSelection();
    }
  }

  // ==========================================================================
  // layout
  // ==========================================================================

  async layout(engineId: string, opts?: LayoutOptions): Promise<void> {
    const engine = this.layouts.get(engineId);
    if (!engine) throw new Error(`No layout engine "${engineId}" registered`);
    const nodes = this.store.nodes();
    const edges = this.store.edges();
    const graph: LayoutGraph = {
      nodes: nodes.map((n) => ({ id: n.id, w: n.w, h: n.h, x: n.x, y: n.y })),
      edges: edges
        .filter((e) => e.from.kind !== 'point' && e.to.kind !== 'point') // node OR outline (both carry nodeId)
        .map((e) => ({
          id: e.id,
          source: (e.from as { nodeId: Id }).nodeId,
          target: (e.to as { nodeId: Id }).nodeId,
        })),
      ...(opts?.direction ? { direction: opts.direction } : {}),
    };
    const result = await engine.layout(graph, opts);
    const changes: Change[] = [];
    for (const n of nodes) {
      const pos = result.positions[n.id];
      if (pos && (pos.x !== n.x || pos.y !== n.y)) {
        changes.push({ op: 'update', id: n.id, patch: { x: pos.x, y: pos.y } });
      }
    }
    if (changes.length) this.store.apply(changes, { capture: 'immediately' });
  }

  // ==========================================================================
  // serialization
  // ==========================================================================

  toJSON(meta?: Record<string, unknown>): Snapshot {
    return serializeRecords(this.store.allRecords(), meta);
  }
  loadSnapshot(snap: Snapshot, opts?: { fit?: boolean }): void {
    const { records } = restore(snap);
    batch(() => {
      this.store.load(records);
      this.sceneIndex.rebuild(this.store.allRecords());
      this.selectedAtom.set(new Set());
      this.editingAtom.set(null);
    });
    // seed the z counter past the largest loaded z so new nodes paint on top (records.length is not
    // a reliable proxy — z is an absolute counter, unaffected by deletions)
    let maxZ = -1;
    for (const r of records) {
      if (isNode(r) && r.type !== 'group') {
        const v = Number.parseInt(r.z, 36);
        if (Number.isFinite(v) && v > maxZ) maxZ = v;
      }
    }
    this.zCounter = Math.max(this.zCounter, maxZ + 1);
    this.history.clear();
    if (opts?.fit) this.zoomToFit();
  }

  // ==========================================================================
  // rendering
  // ==========================================================================

  private setWorldTransform(ctx: Ctx2D, dpr: number): void {
    const m = renderMatrix(this.camera, dpr);
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  }

  paintStatic(ctx: Ctx2D, cssW: number, cssH: number, dpr: number): void {
    const theme = this.themeAtom.peek();
    const cam = this.camera;
    fillBackground(ctx, theme, cssW * dpr, cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGrid(ctx, theme, cam, cssW, cssH);
    this.setWorldTransform(ctx, dpr);
    for (const item of this.sceneIndex.visible(this.worldViewport())) {
      paintItem(ctx, item, this.nodes, this.edges, theme);
    }
  }

  paintOverlays(ctx: Ctx2D, cssW: number, cssH: number, dpr: number): void {
    const overlays = this.overlaysAtom.peek();
    if (overlays.length === 0) return;
    const theme = this.themeAtom.peek();
    this.setWorldTransform(ctx, dpr);
    for (const o of overlays) {
      o.paint({ ctx, camera: this.camera, dpr, cssW, cssH, theme, editor: this });
    }
  }

  paintInteractive(ctx: Ctx2D, _cssW: number, _cssH: number, dpr: number): void {
    const cam = this.camera;
    const px = (n: number) => n / cam.z;
    const theme = this.themeAtom.peek();
    const accent = theme.palette.accent ?? '#3b82f6';
    this.setWorldTransform(ctx, dpr);

    const single = this.selectedAtom.peek().size === 1;
    for (const id of this.selectedAtom.peek()) {
      const item = this.sceneIndex.getItem(id);
      if (!item) continue;
      if (item.kind === 'node') {
        strokeWorldBox(ctx, padBox(item.aabb, px(3)), accent, px(1.5));
        if (single && this.canResizeNode(id)) {
          // handles drawn on the RAW aabb so they coincide with the hit-test box (hitResizeHandle)
          const hs = px(6);
          for (const c of Object.values(this.resizeHandlePoints(item.aabb))) {
            fillHandle(ctx, c, hs, '#ffffff', accent);
          }
        }
      } else if (single && item.route && item.route.length >= 2) {
        // selected edge: draggable endpoint handles at the route ends
        const hs = px(6);
        fillHandle(ctx, item.route[0]!, hs, '#ffffff', accent);
        fillHandle(ctx, item.route[item.route.length - 1]!, hs, '#ffffff', accent);
      } else {
        strokeWorldBox(ctx, padBox(item.aabb, px(3)), accent, px(1));
      }
    }

    const mq = this.marqueeAtom.peek();
    if (mq) {
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = accent;
      ctx.fillRect(mq.x, mq.y, mq.w, mq.h);
      ctx.restore();
      strokeWorldBox(ctx, mq, accent, px(1), [px(4), px(4)]);
    }

    const cd = this.connectDraftAtom.peek();
    if (cd) {
      ctx.save();
      ctx.strokeStyle = cd.valid ? '#10b981' : accent;
      ctx.lineWidth = px(1.5);
      ctx.setLineDash([px(5), px(4)]);
      ctx.beginPath();
      ctx.moveTo(cd.from.x, cd.from.y);
      ctx.lineTo(cd.to.x, cd.to.y);
      ctx.stroke();
      ctx.restore();
    }

    const cp = this.createPreviewAtom.peek();
    if (cp) strokeWorldBox(ctx, cp, accent, px(1), [px(4), px(4)]);

    // port dots on the hovered node — drag from one to connect (create a node if dropped in space)
    const hoverId = this.hoveredAtom.peek();
    if (hoverId && !mq && !cd && !cp) {
      const item = this.sceneIndex.getItem(hoverId);
      if (item && item.kind === 'node') {
        const node = item.record as NodeRecord;
        for (const port of this.nodes.get(node.type)?.getPorts?.(node) ?? []) {
          fillHandle(ctx, { x: node.x + port.anchor.x * node.w, y: node.y + port.anchor.y * node.h }, px(4), accent, '#0b110e');
        }
      }
    }

    const guides = this.snapGuidesAtom.peek();
    if (guides.length) {
      ctx.save();
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = px(1);
      ctx.setLineDash([px(4), px(3)]);
      for (const g of guides) {
        ctx.beginPath();
        ctx.moveTo(g.x1, g.y1);
        ctx.lineTo(g.x2, g.y2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** Set (or clear, with `null`) animated flow on edges. Undoable like any other edit. */
  setFlow(ids: Id[], flow: FlowSpec | null, opts?: ApplyOptions): void {
    const changes: Change[] = [];
    for (const id of ids) {
      const r = this.store.peek(id);
      if (r && isEdge(r)) changes.push({ op: 'update', id, patch: { flow: flow ?? undefined } });
    }
    if (changes.length) this.store.apply(changes, opts ?? { capture: 'immediately' });
  }

  /** True if any edge is flowing. The host keeps the rAF loop ticking while this holds (else idle). */
  hasFlow(): boolean {
    return this.store.edges().some((e) => e.flow != null);
  }

  /** Live, EPHEMERAL metric per edge for data-driven flow — NOT serialized, NOT historied, so a
   *  dashboard can tick continuously without churning the document. Read by `paintFlow` each frame. */
  private readonly flowMetrics = new Map<Id, number>();

  /** Set the live metric that drives a data-driven edge's flow (via its `flow.scale`). */
  setFlowMetric(id: Id, value: number): void {
    this.flowMetrics.set(id, value);
  }
  /** Bulk-set live metrics (e.g. one dashboard tick). */
  setFlowMetrics(entries: Iterable<readonly [Id, number]>): void {
    for (const [id, v] of entries) this.flowMetrics.set(id, v);
  }
  flowMetric(id: Id): number | undefined {
    return this.flowMetrics.get(id);
  }
  clearFlowMetrics(): void {
    this.flowMetrics.clear();
  }

  /** id -> teardown (clears the interval for a pull source, or calls unsubscribe for a push source). */
  private readonly flowSources = new Map<Id, () => void>();

  /** Bind a declarative live feed to an edge's flow metric. Replaces any existing binding for `id`.
   *  Returns a `Dispose` that unbinds. EPHEMERAL — not serialized, not undoable. */
  bindFlowSource(id: Id, source: FlowSource): Dispose {
    this.unbindFlowSource(id);
    const emit = (value: number): void => {
      if (Number.isFinite(value)) this.setFlowMetric(id, value);
    };
    let teardown: () => void;
    if ('poll' in source) {
      let inFlight = false;
      const tick = async (): Promise<void> => {
        if (inFlight) return; // skip overlapping polls
        inFlight = true;
        try {
          emit(await source.poll());
        } catch (err) {
          source.onError?.(err); // keep last metric, keep polling
        } finally {
          inFlight = false;
        }
      };
      void tick(); // immediate first poll
      const handle = setInterval(() => void tick(), source.intervalMs);
      teardown = () => clearInterval(handle);
    } else {
      let unsub: () => void = () => {};
      try {
        const u = source.subscribe(emit);
        if (typeof u === 'function') unsub = u;
      } catch (err) {
        source.onError?.(err);
      }
      teardown = () => {
        try {
          unsub();
        } catch (err) {
          source.onError?.(err);
        }
      };
    }
    this.flowSources.set(id, teardown);
    return () => this.unbindFlowSource(id);
  }

  /** Stop and remove the source bound to `id` (idempotent). */
  unbindFlowSource(id: Id): void {
    const teardown = this.flowSources.get(id);
    if (teardown) {
      teardown();
      this.flowSources.delete(id);
    }
  }

  /** Unbind every source. */
  clearFlowSources(): void {
    for (const teardown of this.flowSources.values()) teardown();
    this.flowSources.clear();
  }

  /** Global ephemeral flow runtime config (enable/pause/speed/reduced-motion/fps). NOT serialized. */
  readonly flowConfigAtom: Atom<FlowRuntimeConfig> = atom<FlowRuntimeConfig>({ ...FLOW_DEFAULTS });
  /** Current OS reduced-motion state — the headless core can't detect it, so the host feeds it in. */
  readonly reducedMotionAtom: Atom<boolean> = atom(false);
  /** Integrated flow time (ms), advanced by paintFlow only while animating. */
  private flowClock = 0;
  private flowPrevTime: number | null = null;

  flowConfig(): Readonly<FlowRuntimeConfig> {
    return this.flowConfigAtom.peek();
  }
  /** Merge a partial config (clamps speedScale >= 0). Ephemeral: no undo entry. */
  setFlowConfig(patch: Partial<FlowRuntimeConfig>): void {
    const next: FlowRuntimeConfig = { ...this.flowConfigAtom.peek(), ...patch };
    next.speedScale = Number.isFinite(next.speedScale) ? Math.max(0, next.speedScale) : 1;
    this.flowConfigAtom.set(next);
  }
  pauseFlow(): void { this.setFlowConfig({ paused: true }); }
  resumeFlow(): void { this.setFlowConfig({ paused: false }); }
  setFlowEnabled(enabled: boolean): void { this.setFlowConfig({ enabled }); }
  setFlowSpeedScale(speedScale: number): void { this.setFlowConfig({ speedScale }); }
  /** Host feeds the OS prefers-reduced-motion state; headless default is false. */
  setReducedMotion(active: boolean): void { this.reducedMotionAtom.set(active); }

  /** True if flow should be actively animating right now — the rAF gate. Respects enabled/paused/
   *  reduced-motion. (`hasFlow()` stays doc-truth: "any edge has a flow spec".) */
  isFlowAnimating(): boolean {
    const c = this.flowConfigAtom.peek();
    if (!c.enabled || c.paused) return false;
    if (c.respectReducedMotion && this.reducedMotionAtom.peek()) return false;
    return this.hasFlow();
  }

  /** Draw the animated flow markers for every visible flowing edge. `time` is a ms clock (the host
   *  passes performance.now()). Advances the internal flow clock only while animating, so pause /
   *  reduced-motion freeze in place and speedScale changes stay smooth. No-op draw when disabled. */
  paintFlow(ctx: Ctx2D, dpr: number, time: number): void {
    const c = this.flowConfigAtom.peek();
    const frameMs = c.maxFps && c.maxFps > 0 ? 1000 / c.maxFps : 1000 / 30;
    const maxDt = Math.max(64, frameMs * 1.5);
    const dt = this.flowPrevTime == null ? 0 : Math.max(0, Math.min(time - this.flowPrevTime, maxDt));
    this.flowPrevTime = time;
    if (!c.enabled) return; // draw nothing
    const frozen = c.paused || (c.respectReducedMotion && this.reducedMotionAtom.peek());
    if (!frozen) this.flowClock += dt * c.speedScale;
    const theme = this.themeAtom.peek();
    this.setWorldTransform(ctx, dpr);
    this.drawFlowEdges(ctx, this.sceneIndex.visible(this.worldViewport()), theme, this.flowClock);
  }

  /** Shared per-edge flow draw: resolve each edge's spec against its live metric and paint markers at
   *  `time`. Caller has already set the world transform and computed the effective (scaled) time. */
  private drawFlowEdges(ctx: Ctx2D, items: Iterable<RenderItem>, theme: Theme, time: number): void {
    for (const item of items) {
      if (item.kind !== 'edge') continue;
      const flow = (item.record as EdgeRecord).flow;
      if (flow) paintFlowMarkers(ctx, item, theme, time, resolveFlow(flow, this.flowMetrics.get(item.id)));
    }
  }

  /** Convenience: paint the full frame (static + flow + overlays + optional interactive) onto one ctx.
   *  Pass `time` (ms) to animate flow; the host keeps calling frames while `isFlowAnimating()` is true. */
  render(ctx: Ctx2D, cssW: number, cssH: number, dpr = 1, interactive = false, time = 0): void {
    this.setViewport(cssW, cssH);
    this.paintStatic(ctx, cssW, cssH, dpr);
    this.paintFlow(ctx, dpr, time);
    this.paintOverlays(ctx, cssW, cssH, dpr);
    if (interactive) this.paintInteractive(ctx, cssW, cssH, dpr);
  }

  /** Paint a specific world region into a context at `pixelRatio` (used by `toPNG`). */
  paintRegion(
    ctx: Ctx2D,
    region: Box,
    pixelRatio: number,
    opts: { background?: boolean; grid?: boolean; flow?: boolean; time?: number } = {},
  ): void {
    const theme = this.themeAtom.peek();
    const dw = Math.ceil(region.w * pixelRatio);
    const dh = Math.ceil(region.h * pixelRatio);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, dw, dh);
    if (opts.background !== false) {
      ctx.fillStyle = theme.canvas.fill;
      ctx.fillRect(0, 0, dw, dh);
    }
    if (opts.grid) {
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      drawGrid(ctx, theme, { x: region.x, y: region.y, z: 1 }, region.w, region.h);
    }
    // world -> device: scale by pixelRatio, offset by region origin
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, -region.x * pixelRatio, -region.y * pixelRatio);
    for (const item of this.sceneIndex.paintOrder()) {
      paintItem(ctx, item, this.nodes, this.edges, theme);
    }
    // optional flow snapshot at `time` (stateless: honors enabled + speedScale; ignores pause/reduced-motion)
    if (opts.flow) {
      const c = this.flowConfigAtom.peek();
      if (c.enabled) {
        this.drawFlowEdges(ctx, this.sceneIndex.paintOrder(), theme, (opts.time ?? 0) * c.speedScale);
      }
    }
  }

  async toPNG(create: CreateCanvas, opts: ToPNGOptions = {}): Promise<Uint8Array> {
    const bounds = opts.bounds ?? this.sceneIndex.contentBounds() ?? { x: 0, y: 0, w: 100, h: 100 };
    const pad = opts.padding ?? 40;
    const region = padBox(bounds, pad);
    const ratio = opts.pixelRatio ?? 2;
    const cw = Math.max(1, Math.ceil(region.w * ratio));
    const ch = Math.max(1, Math.ceil(region.h * ratio));
    const canvas = create(cw, ch);
    const ctx = canvas.getContext('2d') as unknown as Ctx2D;
    this.paintRegion(ctx, region, ratio, {
      background: opts.background ?? true,
      grid: opts.grid ?? false,
      ...(opts.flow ? { flow: true, time: opts.time ?? 0 } : {}),
    });
    if (canvas.encode) return await canvas.encode('png');
    if (canvas.toBuffer) return canvas.toBuffer('image/png');
    throw new Error('Export canvas provides neither encode() nor toBuffer()');
  }

  // ==========================================================================
  // interaction dispatch
  // ==========================================================================

  setTool(id: string, config?: Record<string, unknown>): void {
    this.toolManager.setTool(id, config);
    this.events.emit({ type: 'tool', id });
  }
  get currentToolId(): string {
    return this.toolManager.currentToolId;
  }

  private pointerInfo(screen: Vec2, mods: PointerMods): PointerInfo {
    const world = this.screenToWorld(screen);
    return {
      world,
      screen,
      button: mods.button ?? 0,
      shift: mods.shift ?? false,
      meta: mods.meta ?? false,
      alt: mods.alt ?? false,
      target: this.sceneIndex.hitTest(world, 5 / this.camera.z),
    };
  }
  pointerDown(screen: Vec2, mods: PointerMods = {}): void {
    this.toolManager.pointerDown(this.pointerInfo(screen, mods));
  }
  pointerMove(screen: Vec2, mods: PointerMods = {}): void {
    const info = this.pointerInfo(screen, mods);
    this.hoveredAtom.set(info.target?.id ?? null);
    this.toolManager.pointerMove(info);
  }
  pointerUp(screen: Vec2, mods: PointerMods = {}): void {
    this.toolManager.pointerUp(this.pointerInfo(screen, mods));
  }
  doubleClick(screen: Vec2, mods: PointerMods = {}): void {
    this.toolManager.doubleClick(this.pointerInfo(screen, mods));
  }
  keyDown(k: KeyInfo): void {
    this.toolManager.keyDown(k);
  }

  nearestPort(
    world: Vec2,
    kind: 'source' | 'target' | 'both',
  ): { nodeId: Id; portId?: string; point: Vec2 } | null {
    const tol = 24 / this.camera.z;
    const box = { x: world.x - tol, y: world.y - tol, w: tol * 2, h: tol * 2 };
    let best: { nodeId: Id; portId?: string; point: Vec2 } | null = null;
    let bestD = Infinity;
    for (const item of this.sceneIndex.visible(box)) {
      if (item.kind !== 'node') continue;
      const node = item.record as NodeRecord;
      const util = this.nodes.get(node.type);
      const ports = util?.getPorts?.(node) ?? [];
      for (const port of ports) {
        if (kind !== 'both' && port.kind !== 'both' && port.kind !== kind) continue;
        const pw = { x: node.x + port.anchor.x * node.w, y: node.y + port.anchor.y * node.h };
        const d = dist(world, pw);
        if (d < bestD) {
          bestD = d;
          best = { nodeId: node.id, portId: port.id, point: pw };
        }
      }
    }
    if (best && bestD <= tol * 1.5) return best;
    // fallback: the node under the pointer, anchored at its center
    const hit = this.sceneIndex.hitTest(world, 5 / this.camera.z);
    if (hit && hit.kind === 'node') {
      const n = hit.record as NodeRecord;
      return { nodeId: n.id, point: { x: n.x + n.w / 2, y: n.y + n.h / 2 } };
    }
    return best;
  }

  /** A real, named port ANCHOR strictly under the pointer (tight radius, no center fallback). Used to
   *  start a drag-from-port connection without hijacking normal node drags. */
  portHandleAt(world: Vec2): { nodeId: Id; portId: string; point: Vec2 } | null {
    const tol = 11 / this.camera.z;
    const box = { x: world.x - tol, y: world.y - tol, w: tol * 2, h: tol * 2 };
    let best: { nodeId: Id; portId: string; point: Vec2 } | null = null;
    let bestD = tol;
    for (const item of this.sceneIndex.visible(box)) {
      if (item.kind !== 'node') continue;
      const node = item.record as NodeRecord;
      for (const port of this.nodes.get(node.type)?.getPorts?.(node) ?? []) {
        const pw = { x: node.x + port.anchor.x * node.w, y: node.y + port.anchor.y * node.h };
        const d = dist(world, pw);
        if (d <= bestD) {
          bestD = d;
          best = { nodeId: node.id, portId: port.id, point: pw };
        }
      }
    }
    return best;
  }

  // ==========================================================================
  // ephemeral setters (drive the interactive layer)
  // ==========================================================================

  setMarquee(box: Box | null): void {
    this.marqueeAtom.set(box);
  }
  setConnectDraft(draft: ConnectDraft | null): void {
    this.connectDraftAtom.set(draft);
  }
  setCreatePreview(box: Box | null): void {
    this.createPreviewAtom.set(box);
  }
  setHover(id: Id | null): void {
    this.hoveredAtom.set(id);
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}

export type { RenderItem };
