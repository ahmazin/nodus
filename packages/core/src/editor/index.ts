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
import { boxEncloses, dist, padBox, unionBox } from '../geometry/index.js';
import { defaultTheme, type ResolvedTokens, type StateTokens, type Theme } from '../theme/index.js';
import { Store, type ChangeInfo, type StoreListener } from '../store/index.js';
import { SceneIndex, type RenderItem } from '../scene-index/index.js';
import { History } from '../history/index.js';
import { EventBus, type NodusEvent } from '../events/index.js';
import {
  Registry,
  validateNodeUtil,
  validateEdgeUtil,
  type EdgeUtil,
  type Migration,
  type NodeUtil,
} from '../registries/index.js';
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
import { drawAmbient, drawGrid, fillBackground, fillHandle, paintFlowMarkers, paintItem, strokeWorldBox } from '../renderer/paint.js';
import { StaticLayerCache, type CreateOffscreen, type LayerCacheStats } from '../renderer/layer-cache.js';
import { planDirtyRegion } from '../renderer/dirty-region.js';
import { resolveTokensCached } from '../renderer/token-cache.js';
import { resolveFlow } from '../flow.js';
import type { Ctx2D } from '../renderer/context.js';
import { restore, serializeRecords, type Snapshot } from '../serialization/index.js';
import { AnimationClock, type TweenSpec } from './animation.js';

/** Edge/center a multi-selection aligns to (see `Editor.align`). */
export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
/** Axis a multi-selection distributes along (see `Editor.distribute`). */
export type DistributeAxis = 'h' | 'v';

/** Ephemeral per-item paint modifier driven by tweens (`Editor.animate`). Never serialized; identity
 *  (alpha 1, scale 1, dx/dy 0) when absent from the presentation map. */
export interface Presentation {
  alpha: number;
  scale: number;
  dx: number;
  dy: number;
}

const FLOW_DEFAULTS: FlowRuntimeConfig = {
  enabled: true,
  paused: false,
  speedScale: 1,
  respectReducedMotion: true,
};

/**
 * Draw a small padlock affordance centered on `(bx, by)` — the top-left corner of a locked node's
 * selection box. `s` is a screen-scaled size (world units; callers pass `px(...)`) so the glyph stays
 * roughly constant on screen at any zoom. Pure canvas primitives, so it paints identically headless
 * and in the browser, and never throws.
 */
function drawLockBadge(ctx: Ctx2D, bx: number, by: number, s: number, accent: string): void {
  const bw = s * 0.8; // body width
  const bh = s * 0.6; // body height
  const x = bx - s / 2; // center the badge on the corner
  const y = by - s / 2;
  const bodyY = y + s - bh;
  const cx = x + bw / 2;
  ctx.save();
  // shackle (upper arc)
  ctx.strokeStyle = accent;
  ctx.lineWidth = s * 0.13;
  ctx.beginPath();
  ctx.arc(cx, bodyY, s * 0.26, Math.PI, 2 * Math.PI);
  ctx.stroke();
  // body
  ctx.fillStyle = accent;
  ctx.fillRect(x, bodyY, bw, bh);
  // keyhole
  ctx.fillStyle = '#0b110e';
  ctx.beginPath();
  ctx.arc(cx, bodyY + bh * 0.5, s * 0.1, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
}

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
  /** A candidate target port under the cursor mid-drag, drawn as a highlighted drop-target ring
   *  (green when the connection would be accepted, accent when not). */
  targetPort?: { point: Vec2; valid: boolean };
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

/** Above this fraction of the canvas covered by the dirty region, the drag fast path isn't worth it —
 *  clip/region bookkeeping costs about a full repaint anyway — so `paintStatic` falls back to a full
 *  repaint. Purely a performance guard; either branch is pixel-identical. */
const STATIC_INCREMENTAL_MAX_AREA = 0.6;

/** Snapshot the visible set as id → `RenderItem` for the next frame's dirty-region diff. Cheap: it
 *  stores object references (the scene index mints a fresh `RenderItem` on any change, so reference
 *  identity is the change signal), never a copy of geometry. */
function snapshotVisible(items: readonly RenderItem[]): Map<Id, RenderItem> {
  const map = new Map<Id, RenderItem>();
  for (const it of items) map.set(it.id, it);
  return map;
}

/** The node an endpoint resolves to, or `undefined` for a `'point'` endpoint (pinned to a free world
 *  coordinate — no node to color-match against). */
function endpointNodeId(ep: Endpoint): Id<'node'> | undefined {
  return ep.kind === 'node' || ep.kind === 'outline' ? ep.nodeId : undefined;
}

export class Editor implements EngineHost {
  // Route errors caught inside the store's listener dispatch (a throwing third-party change listener)
  // to the EventBus, so hosts can observe them instead of them being swallowed. The closure reads
  // `this.events` lazily (only when an error fires), so field-init order is not a problem.
  readonly store = new Store({
    onError: (error, context) => this.events.emit({ type: 'error', error, context }),
  });
  // Registries validate at registration (fail fast on a malformed util) and route a re-registration
  // override through the same observable `error` channel as isolated store/index faults. The
  // `onOverride` closure reads `this` lazily (only when an override fires, well after construction),
  // so field-init order is not a problem — same pattern as the store's `onError` above.
  readonly nodes: Registry<NodeUtil> = new Registry<NodeUtil>({
    label: 'node type',
    validate: validateNodeUtil,
    onOverride: (type) => this.reportRegistryOverride('node type', type),
  });
  readonly edges: Registry<EdgeUtil> = new Registry<EdgeUtil>({
    label: 'edge type',
    validate: validateEdgeUtil,
    onOverride: (type) => this.reportRegistryOverride('edge type', type),
  });
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
  /** typeVersions from the most recently loaded snapshot — merged with current utils on save. */
  private loadedTypeVersions: Record<string, number> = {};
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
      // a throwing third-party getGeometry/getRoute leaves the record unindexed and surfaces here
      onError: (error, context) => this.events.emit({ type: 'error', error, context }),
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
        this.reconcileFlowIndex(info.changes);
        this.history.record(info);
        this.events.emit({ type: 'change', info });
      }),
    );

    // flow data sources: auto-unbind a source whose edge is gone (delete/undo), and tear down all on dispose
    this.disposers.push(
      this.onChange(() => {
        for (const id of [...this.flowSources.keys()]) {
          if (!this.store.peek(id)) this.unbindFlowSource(id);
        }
      }),
      () => this.clearFlowSources(),
    );

    if (opts.records && opts.records.length > 0) {
      this.store.load(opts.records);
      this.sceneIndex.rebuild(this.store.allRecords());
      this.rebuildFlowIndex();
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
    const id = (engine as { id?: unknown } | null | undefined)?.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(
        `Cannot register layout: 'id' must be a non-empty string (got ${typeof id === 'string' ? JSON.stringify(id) : String(id)}).`,
      );
    }
    if (typeof engine.layout !== 'function') {
      throw new Error(`Cannot register layout ${JSON.stringify(id)}: 'layout' must be a function.`);
    }
    if (this.layouts.has(id)) this.reportRegistryOverride('layout', id);
    this.layouts.set(id, engine);
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
    // Isolate a throwing plugin: surface the failure on the observable `error` channel, then rethrow
    // with context (which plugin) so a plugin that can't install is loud for the app author. We push
    // the disposer only on success — a plugin that threw never leaves a half-baked disposer that a
    // later `dispose()`/teardown would run against partial state.
    let dispose: Dispose | void;
    try {
      dispose = plugin.register(this);
    } catch (err) {
      const id = (plugin as { id?: unknown } | null | undefined)?.id;
      const label = typeof id === 'string' && id.length > 0 ? JSON.stringify(id) : '<unknown>';
      this.events.emit({ type: 'error', error: err, context: { phase: 'plugin', pluginId: id } });
      throw new Error(`Plugin ${label} failed to install: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
    const d = typeof dispose === 'function' ? dispose : () => {};
    this.disposers.push(d);
    return d;
  }

  /** Surface a type/layout re-registration (a deliberate override, e.g. a preset replacing a builtin)
   *  through the same observable `error` channel used for isolated store/index faults — never a raw
   *  console call — so it stays visible without being fatal. */
  private reportRegistryOverride(kind: string, type: string): void {
    this.events.emit({
      type: 'error',
      error: new Error(`Overriding an already-registered ${kind} '${type}'.`),
      context: { phase: 'register', kind, type },
    });
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

  // ==========================================================================
  // WS-0 command contract — transform / arrange / lock / zoom helpers.
  //
  // Signatures are FROZEN here so the UI shell (WS-D/E) can build against them while WS-B owns the
  // full implementations. Bodies below are minimal-but-safe: real where trivially correct, no-op
  // stubs (never throwing) where they need model/tool support WS-B must add. See markers.
  // ==========================================================================

  /**
   * Rotate each node in place by `radians` (added to its own `rotation`). Nodes whose `NodeUtil`
   * sets `capabilities.canRotate === false` are skipped.
   *
   * WS-B: implement group-centroid rotation — rotating a multi-selection about its shared center
   * (moving each node's x/y too), not just spinning each node about its own center.
   */
  rotate(ids: Id[], radians: number, opts?: ApplyOptions): void {
    if (!radians) return;
    const changes: Change[] = [];
    for (const id of ids) {
      const r = this.store.peek(id);
      if (!r || !isNode(r)) continue;
      if (r.locked === true) continue; // edit-locked: not rotatable
      if (this.nodes.get(r.type)?.capabilities?.canRotate === false) continue;
      changes.push({ op: 'update', id, patch: { rotation: (r.rotation ?? 0) + radians } });
    }
    if (changes.length) this.store.apply(changes, opts ?? { capture: 'immediately' });
  }

  /** Align the selected nodes' boxes to a shared edge/center of their union bounds. */
  align(ids: Id[], edge: AlignEdge, opts?: ApplyOptions): void {
    const nodes: NodeRecord[] = [];
    for (const id of ids) {
      const r = this.store.peek(id);
      if (r && isNode(r)) nodes.push(r);
    }
    if (nodes.length < 2) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const changes: Change[] = [];
    for (const n of nodes) {
      const patch: Record<string, unknown> = {};
      switch (edge) {
        case 'left': patch.x = minX; break;
        case 'right': patch.x = maxX - n.w; break;
        case 'hcenter': patch.x = cx - n.w / 2; break;
        case 'top': patch.y = minY; break;
        case 'bottom': patch.y = maxY - n.h; break;
        case 'vcenter': patch.y = cy - n.h / 2; break;
      }
      if (Object.keys(patch).length) changes.push({ op: 'update', id: n.id, patch });
    }
    if (changes.length) this.store.apply(changes, opts ?? { capture: 'immediately' });
  }

  /** Evenly distribute nodes so the gaps between successive boxes along `axis` are equal. */
  distribute(ids: Id[], axis: DistributeAxis, opts?: ApplyOptions): void {
    const nodes: NodeRecord[] = [];
    for (const id of ids) {
      const r = this.store.peek(id);
      if (r && isNode(r)) nodes.push(r);
    }
    if (nodes.length < 3) return;
    const horiz = axis === 'h';
    const size = (n: NodeRecord): number => (horiz ? n.w : n.h);
    const pos = (n: NodeRecord): number => (horiz ? n.x : n.y);
    const sorted = [...nodes].sort((a, b) => pos(a) - pos(b));
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    let totalSize = 0;
    for (const n of sorted) totalSize += size(n);
    const gap = (pos(last) + size(last) - pos(first) - totalSize) / (sorted.length - 1);
    const changes: Change[] = [];
    let cursor = pos(first);
    for (const n of sorted) {
      if (cursor !== pos(n)) {
        const patch: Record<string, unknown> = horiz ? { x: cursor } : { y: cursor };
        changes.push({ op: 'update', id: n.id, patch });
      }
      cursor += size(n) + gap;
    }
    if (changes.length) this.store.apply(changes, opts ?? { capture: 'immediately' });
  }

  /** Arrow-key nudge — moves the given nodes by (dx,dy) world units. */
  nudge(ids: Id[], dx: number, dy: number, opts?: ApplyOptions): void {
    this.moveBy(ids, dx, dy, opts ?? { capture: 'immediately' });
  }

  /**
   * Edit-lock the given nodes: they stay selectable (so they can be unlocked) but the interaction
   * tools refuse to move/resize/rotate/delete them. This is edit-locking, distinct from the
   * `'locked'` VISUAL state (dashed, `'?'` label) in `visual.state`, which is only a theme skin.
   */
  lock(ids: Id[], opts?: ApplyOptions): void {
    const changes: Change[] = [];
    for (const id of ids) {
      const r = this.store.peek(id);
      if (r && isNode(r) && r.locked !== true) changes.push({ op: 'update', id, patch: { locked: true } });
    }
    if (changes.length) this.store.apply(changes, opts ?? { capture: 'immediately' });
  }
  /** Remove the edit-lock. Clears the key (patch `undefined` deletes it) to keep serialization canonical. */
  unlock(ids: Id[], opts?: ApplyOptions): void {
    const changes: Change[] = [];
    for (const id of ids) {
      const r = this.store.peek(id);
      if (r && isNode(r) && r.locked === true) changes.push({ op: 'update', id, patch: { locked: undefined } });
    }
    if (changes.length) this.store.apply(changes, opts ?? { capture: 'immediately' });
  }
  isLocked(id: Id): boolean {
    const r = this.store.peek(id);
    return !!r && isNode(r) && r.locked === true;
  }

  /**
   * Show/hide the given nodes — the visibility toggle a layers/outline panel drives. A hidden node stays
   * in the document (so the tree can still list it) but is excluded from rendering, hit-testing, and
   * marquee (see SceneIndex). Undoable (one entry). Hiding sets `hidden:true`; showing CLEARS the key
   * (patch `undefined`, like `unlock`) so serialization stays canonical (never a `hidden:false`).
   */
  setNodesHidden(ids: Id[], hidden: boolean, opts?: ApplyOptions): void {
    const changes: Change[] = [];
    for (const id of ids) {
      const r = this.store.peek(id);
      if (!r || !isNode(r)) continue;
      if (hidden && r.hidden !== true) changes.push({ op: 'update', id, patch: { hidden: true } });
      else if (!hidden && r.hidden === true) changes.push({ op: 'update', id, patch: { hidden: undefined } });
    }
    if (changes.length) this.store.apply(changes, opts ?? { capture: 'immediately' });
  }
  /** Whether the node is currently hidden (visibility-off). `record.hidden === true`. */
  isHidden(id: Id): boolean {
    const r = this.store.peek(id);
    return !!r && isNode(r) && r.hidden === true;
  }

  /** Fit the current selection into the viewport with padding. */
  zoomToSelection(padding = 48): void {
    const bounds = this.selectionBounds();
    if (!bounds) return;
    const vp = this.viewportAtom.peek();
    this.setCamera(fitBox(bounds, vp.w, vp.h, padding));
  }

  /**
   * Pan the camera so all content is centered, keeping the current zoom. If the content does not
   * fit at the current zoom, falls back to fit-to-content (which does change zoom).
   */
  scrollToContent(padding = 48): void {
    const bounds = this.sceneIndex.contentBounds();
    if (!bounds) return;
    const vp = this.viewportAtom.peek();
    const z = this.camera.z;
    if (bounds.w * z > vp.w - padding * 2 || bounds.h * z > vp.h - padding * 2) {
      this.setCamera(fitBox(bounds, vp.w, vp.h, padding));
      return;
    }
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    this.setCamera({ x: cx - vp.w / (2 * z), y: cy - vp.h / (2 * z), z });
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
        this.remapRefs(rec, idMap);
        changes.push({ op: 'add', record: rec });
        newIds.push(nid);
      } else if (isEdge(r)) {
        const rec = structuredClone(r) as EdgeRecord;
        rec.id = makeId('edge');
        rec.version = 0;
        this.remapRefs(rec, idMap);
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

  /**
   * Capture a selection as a normalized, placement-agnostic **stencil** fragment: the nodes (+ their
   * descendants) and interconnecting edges, deep-cloned, with ids renumbered to `node:n0…`/`edge:e0…`,
   * cross-references (edge endpoints + `parentId`) rewritten to those ids, and node positions shifted so
   * the fragment's top-left origin is `(0,0)`. Pure read — the store, history, and the originals are
   * untouched; the result is a reusable value you later drop with `placeStencil`.
   */
  captureStencil(ids: Id[]): NodusRecord[] {
    const recs = this.collectForCopy(ids); // already deep-cloned + edges-to-unselected-nodes dropped
    if (recs.length === 0) return [];

    // (1) deterministic old→new ids, numbered in sorted-id order so a fragment is stable across captures
    const nodeMap = new Map<Id, Id<'node'>>();
    const edgeMap = new Map<Id, Id<'edge'>>();
    let ni = 0;
    let ei = 0;
    for (const r of [...recs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      if (isNode(r)) nodeMap.set(r.id, makeId('node', `n${ni++}`));
      else if (isEdge(r)) edgeMap.set(r.id, makeId('edge', `e${ei++}`));
    }

    // (2) rewrite each record's own id + cross-references, and zero the churny `version` counter so a
    // serialized library diffs cleanly (read old ids before overwriting)
    for (const r of recs) {
      r.version = 0;
      if (isNode(r)) {
        this.remapRefs(r, nodeMap); // parentId first (still holds the old value)
        r.id = nodeMap.get(r.id)!;
      } else if (isEdge(r)) {
        this.remapRefs(r, nodeMap); // from/to endpoints
        r.id = edgeMap.get(r.id)!;
      }
    }

    // (3) shift so the fragment's bounding-box min corner sits at the origin
    const nodes = recs.filter(isNode);
    if (nodes.length > 0) {
      const minX = Math.min(...nodes.map((n) => n.x));
      const minY = Math.min(...nodes.map((n) => n.y));
      for (const n of nodes) {
        n.x -= minX;
        n.y -= minY;
      }
    }
    return recs;
  }

  /**
   * Drop a captured stencil fragment into the document at world point `at`, cloned with fresh ids as
   * ONE undo entry. A fragment's origin is `(0,0)`, so `at` becomes its top-left. Returns (and selects)
   * the new node ids.
   */
  placeStencil(records: NodusRecord[], at: Vec2): Id[] {
    return this.pasteRecords(records, at);
  }

  private remapEndpoint(ep: Endpoint, idMap: Map<Id, Id<'node'>>): Endpoint {
    if ((ep.kind === 'node' || ep.kind === 'outline') && idMap.has(ep.nodeId)) {
      return { ...ep, nodeId: idMap.get(ep.nodeId)! };
    }
    return ep;
  }

  /**
   * Rewrite a cloned record's cross-references through an old→new node-id map, in place: a node's
   * `parentId` (dropped if its target is outside the map) and an edge's `from`/`to` endpoints. Shared
   * by `pasteRecords` (fresh random ids) and `captureStencil` (normalized ids) so both remap identically.
   */
  private remapRefs(rec: NodusRecord, idMap: Map<Id, Id<'node'>>): void {
    if (isNode(rec)) {
      if (rec.parentId) rec.parentId = idMap.get(rec.parentId) ?? undefined;
    } else if (isEdge(rec)) {
      rec.from = this.remapEndpoint(rec.from, idMap);
      rec.to = this.remapEndpoint(rec.to, idMap);
    }
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

  /** Whether an edge endpoint may bind to this node under interaction — its type's
   *  `capabilities.canConnect` (default true). */
  canConnectTo(nodeId: Id): boolean {
    const rec = this.store.peek(nodeId);
    if (!rec || !isNode(rec)) return false;
    return this.nodes.get(rec.type)?.capabilities?.canConnect !== false;
  }

  /**
   * Interaction-layer connection gate. `connect()` itself stays unvalidated so programmatic callers
   * (importers, presets) can wire anything; the tools call this to honor the two connection-validity
   * axes: the target node must be connectable (`capabilities.canConnect`), and if the source endpoint
   * is a named port with an `isValidConnection` predicate, that predicate must accept the pair.
   */
  connectAllowed(from: Endpoint, to: Endpoint): boolean {
    if (to.kind !== 'point' && !this.canConnectTo(to.nodeId)) return false;
    if (from.kind === 'node' && from.portId) {
      const rec = this.store.peek(from.nodeId);
      if (rec && isNode(rec)) {
        const port = this.nodes.get(rec.type)?.getPorts?.(rec)?.find((p) => p.id === from.portId);
        if (port?.isValidConnection && !port.isValidConnection(from, to)) return false;
      }
    }
    return true;
  }

  deleteRecords(ids: Id[], opts?: ApplyOptions): void {
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
    // Default one undo entry; the eraser passes `capture: 'later'` per-hit and `mark()`s on release
    // so a whole drag-erase collapses into a single entry.
    this.store.apply(
      [...toRemove].map((id) => ({ op: 'remove', id }) as Change),
      opts ?? { capture: 'immediately' },
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

  /**
   * Keyboard traversal: move the sole selection to the next (`dir === 1`) or previous
   * (`dir === -1`) node in reading order — top-to-bottom by `y`, then left-to-right by `x`,
   * ties broken by `id` for stability. With nothing selected, selects the first node
   * (`dir === 1`) or the last (`dir === -1`); otherwise advances from the last-selected node,
   * wrapping around the ends. The new node becomes the only selection, and the camera pans
   * (keeping the current zoom) to center it when it lies outside the viewport. Returns the
   * selected node id, or `null` when there are no nodes.
   */
  selectNextNode(dir: 1 | -1): Id | null {
    const ordered = this.store
      .nodes()
      .slice()
      .sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x !== b.x ? a.x - b.x : a.id < b.id ? -1 : 1));
    if (ordered.length === 0) return null;

    const sel = this.selectedAtom.peek();
    let idx: number;
    if (sel.size === 0) {
      idx = dir === 1 ? 0 : ordered.length - 1;
    } else {
      const selArr = [...sel];
      let cur = -1;
      for (let i = selArr.length - 1; i >= 0 && cur === -1; i--) {
        cur = ordered.findIndex((n) => n.id === selArr[i]);
      }
      idx = cur === -1 ? (dir === 1 ? 0 : ordered.length - 1) : (cur + dir + ordered.length) % ordered.length;
    }

    const next = ordered[idx]!;
    this.select([next.id]);
    // Pan (keeping zoom) to bring the focused node into view when it is off-screen.
    const item = this.sceneIndex.getItem(next.id);
    if (item && !boxEncloses(this.worldViewport(), item.aabb)) {
      const vp = this.viewportAtom.peek();
      const z = this.camera.z;
      this.setCamera({
        x: item.aabb.x + item.aabb.w / 2 - vp.w / (2 * z),
        y: item.aabb.y + item.aabb.h / 2 - vp.h / (2 * z),
        z,
      });
    }
    return next.id;
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
    if (r.locked === true) return false; // edit-locked: no resize handles / no resize gesture
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

  /** Move `ids` one step within the z-order (a single swap past the nearest non-selected neighbor),
   *  then renumber. `forward` raises toward the front (higher z); `backward` lowers toward the back.
   *  A contiguous run of selected nodes moves together. Groups stay pinned behind their children. */
  private stepReorder(ids: Id[], dir: 'forward' | 'backward'): void {
    const set = new Set(ids);
    const arr = this.store
      .nodes()
      .slice()
      .filter((n) => n.type !== 'group')
      .sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : 1));
    if (!arr.some((n) => set.has(n.id))) return;
    if (dir === 'forward') {
      // walk high→low so a selected run shifts up as a block without cascading past itself
      for (let i = arr.length - 2; i >= 0; i--) {
        if (set.has(arr[i]!.id) && !set.has(arr[i + 1]!.id)) {
          [arr[i], arr[i + 1]] = [arr[i + 1]!, arr[i]!];
        }
      }
    } else {
      for (let i = 1; i < arr.length; i++) {
        if (set.has(arr[i]!.id) && !set.has(arr[i - 1]!.id)) {
          [arr[i], arr[i - 1]] = [arr[i - 1]!, arr[i]!];
        }
      }
    }
    const changes: Change[] = [];
    arr.forEach((n, i) => {
      const z = i.toString(36).padStart(10, '0');
      if (n.z !== z) changes.push({ op: 'update', id: n.id, patch: { z } });
    });
    if (changes.length) {
      this.zCounter = Math.max(this.zCounter, arr.length);
      this.store.apply(changes, { capture: 'immediately' });
    }
  }
  bringForward(ids: Id[]): void {
    this.stepReorder(ids, 'forward');
  }
  sendBackward(ids: Id[]): void {
    this.stepReorder(ids, 'backward');
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

  /** Resolve a record's ordered migrations from the registries. `undefined` ⇒ type not registered. */
  private readonly resolveMigrations = (record: { typeName: string; type?: string }): Migration[] | undefined => {
    const type = record.type ?? '';
    if (record.typeName === 'node') {
      const u = this.nodes.get(type);
      return u ? (u.migrations ?? []) : undefined;
    }
    if (record.typeName === 'edge') {
      const u = this.edges.get(type);
      return u ? (u.migrations ?? []) : undefined;
    }
    return undefined;
  };

  /** Per-type version to stamp on save: max(loaded, current) so an old client never downgrades data. */
  private computeTypeVersions(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.store.allRecords()) {
      if (r.typeName !== 'node' && r.typeName !== 'edge') continue;
      const type = (r as NodeRecord | EdgeRecord).type;
      if (out[type] !== undefined) continue;
      const util = r.typeName === 'node' ? this.nodes.get(type) : this.edges.get(type);
      const current = util?.migrations?.length ?? 0;
      const v = Math.max(this.loadedTypeVersions[type] ?? 0, current);
      if (v > 0) out[type] = v; // omit v0 types to keep the map + diff minimal
    }
    return out;
  }

  toJSON(meta?: Record<string, unknown>): Snapshot {
    return serializeRecords(this.store.allRecords(), {
      ...(meta ? { meta } : {}),
      typeVersions: this.computeTypeVersions(),
    });
  }
  loadSnapshot(snap: Snapshot, opts?: { fit?: boolean }): void {
    this.loadedTypeVersions = snap.typeVersions ?? {};
    const { records } = restore(snap, { resolveMigrations: this.resolveMigrations });
    batch(() => {
      this.store.load(records);
      this.sceneIndex.rebuild(this.store.allRecords());
      this.rebuildFlowIndex();
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

  /** Per-frame memo of the culled + paint-sorted visible set, so the static and flow passes of one
   *  frame share a single rbush query + sort instead of doing it twice. */
  private frameVisible: { key: string; items: RenderItem[] } | null = null;

  /** Culled + paint-sorted items for the current viewport. Memoized on (scene version, camera,
   *  viewport): the two passes of a frame hit the cache, an idle re-render (nothing changed) reuses
   *  the last result, and any mutation / pan / zoom invalidates it. Theme changes intentionally do
   *  NOT invalidate — they change how items draw, not which are visible. */
  private visibleItems(): RenderItem[] {
    const vp = this.viewportAtom.peek();
    const cam = this.camera;
    const key = `${this.sceneIndex.version.peek()}|${cam.x}|${cam.y}|${cam.z}|${vp.w}|${vp.h}`;
    if (this.frameVisible && this.frameVisible.key === key) return this.frameVisible.items;
    const items = this.sceneIndex.visible(this.worldViewport());
    this.frameVisible = { key, items };
    return items;
  }

  /** Host-injected offscreen-canvas factory. When set, the static pass is layer-cached (see
   *  `StaticLayerCache`); when null (headless default / plain tests) the static pass paints directly. */
  private layerCache: StaticLayerCache | null = null;

  /** Snapshot of the last static paint used to plan a drag frame's dirty region: the params the static
   *  bitmap depends on except scene version (`prefix`), and the visible `RenderItem`s painted then (by
   *  id). Only reused when `prefix` matches, so a pan/zoom/resize/theme swap forces a full repaint. */
  private lastStatic: { prefix: string; items: Map<Id, RenderItem> } | null = null;

  /** Provide an offscreen-canvas factory to enable the static-layer cache (a host wires this to
   *  `OffscreenCanvas`/`<canvas>` in the browser or `@napi-rs/canvas` headless), or `null` to disable
   *  it and paint directly. The cache is transparent: output is pixel-identical to a direct paint. */
  setOffscreenFactory(create: CreateOffscreen | null): void {
    this.layerCache = create ? new StaticLayerCache(create) : null;
    this.lastStatic = null;
  }

  /** Diagnostic counters for the static-layer cache (hits / full repaints / drag-region repaints), or
   *  `null` when no cache is installed. Does not affect rendering — for perf tests and dev tooling. */
  layerCacheStats(): LayerCacheStats | null {
    return this.layerCache?.stats ?? null;
  }

  /** The static bitmap's cache key WITHOUT the scene version: everything else the static pass depends
   *  on. Two frames sharing this prefix differ (if at all) only by scene mutations — exactly when the
   *  drag fast path applies. Selection/hover/marquee/flow live in other passes, so they are absent (that
   *  is what makes those frames a cache hit). Theme is keyed by identity (themes are swapped, not mutated). */
  private staticPrefix(cssW: number, cssH: number, dpr: number): string {
    const cam = this.camera;
    const themeId = this.layerCache?.idOf(this.themeAtom.peek()) ?? 0;
    return `${themeId}|${cam.x}|${cam.y}|${cam.z}|${cssW}|${cssH}|${dpr}`;
  }

  paintStatic(ctx: Ctx2D, cssW: number, cssH: number, dpr: number): void {
    const cache = this.layerCache;
    if (!cache) {
      this.paintStaticInto(ctx, cssW, cssH, dpr);
      return;
    }
    const dw = Math.max(1, Math.round(cssW * dpr));
    const dh = Math.max(1, Math.round(cssH * dpr));
    const prefix = this.staticPrefix(cssW, cssH, dpr);
    const key = `${prefix}|${this.sceneIndex.version.peek()}`;
    const items = this.visibleItems();

    // Drag fast path: same static params as last frame and a resident layer → repaint only the region
    // that changed (moved/reflowed items + whatever they overlap) over the retained bitmap. Skipped when
    // the "dirty" region would be most of the canvas (no win) or a record is corrupt (`plan === null`).
    const last = this.lastStatic;
    if (last && last.prefix === prefix && cache.hasValidLayer(dw, dh)) {
      const plan = planDirtyRegion(last.items, items, this.camera, dpr, dw, dh);
      if (plan && plan.area <= dw * dh * STATIC_INCREMENTAL_MAX_AREA) {
        cache.repaint(ctx, key, plan.rects, (lctx) =>
          this.paintStaticInto(lctx, cssW, cssH, dpr, plan.repaint),
        );
        this.lastStatic = { prefix, items: snapshotVisible(items) };
        return;
      }
    }

    // Cold / non-drag change / camera or theme change: full static repaint (or a plain blit on a hit).
    cache.draw(ctx, key, dw, dh, (lctx) => this.paintStaticInto(lctx, cssW, cssH, dpr));
    this.lastStatic = { prefix, items: snapshotVisible(items) };
  }

  /** The actual static paint (background + grid + `items` in paint order; defaults to the full visible
   *  set). Rendered straight to the frame, into the whole offscreen layer, or — for the drag fast path,
   *  with `items` pared to the dirty set — into the cache's scratch buffer, from which the changed rects
   *  are copied back. Identical draw calls either way. */
  private paintStaticInto(
    ctx: Ctx2D,
    cssW: number,
    cssH: number,
    dpr: number,
    items: Iterable<RenderItem> = this.visibleItems(),
  ): void {
    const theme = this.themeAtom.peek();
    const cam = this.camera;
    fillBackground(ctx, theme, cssW * dpr, cssH * dpr);
    drawAmbient(ctx, theme, cam, cssW * dpr, cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGrid(ctx, theme, cam, cssW, cssH);
    this.setWorldTransform(ctx, dpr);
    for (const item of items) {
      const override = item.kind === 'edge' ? this.edgeGradientOverride(item, theme) : undefined;
      paintItem(ctx, item, this.nodes, this.edges, theme, this.presentationFor(item.id), override, cam.z);
    }
  }

  /** Source→target stroke-gradient override for an edge item, or `undefined` (flat — today's behavior)
   *  when either endpoint isn't a resolvable node (a `'point'` endpoint, or a dangling `nodeId` the
   *  scene index doesn't have an item for). This is the ONE place both endpoint colors are reachable —
   *  `paintItem`/the edge util only ever see the single edge record, never its neighbors — so the
   *  gradient is computed here and threaded through as `paintItem`'s `override` param. Recomputed on
   *  every static repaint; a node's color changing bumps `sceneIndex.version`, which already invalidates
   *  the static layer-cache bitmap, so no extra cache-key plumbing is needed. */
  private edgeGradientOverride(item: RenderItem, theme: Theme): Partial<ResolvedTokens> | undefined {
    const route = item.route;
    if (!route || route.length < 2) return undefined;
    const rec = item.record as EdgeRecord;
    const srcId = endpointNodeId(rec.from);
    const tgtId = endpointNodeId(rec.to);
    if (!srcId || !tgtId) return undefined;
    const srcRec = this.sceneIndex.getItem(srcId)?.record;
    const tgtRec = this.sceneIndex.getItem(tgtId)?.record;
    if (!srcRec || !tgtRec) return undefined;
    let src: string;
    let tgt: string;
    try {
      src = resolveTokensCached(theme, srcRec).stroke;
      tgt = resolveTokensCached(theme, tgtRec).stroke;
    } catch {
      return undefined; // a corrupt endpoint record must fall back to flat, not break the frame
    }
    const a = route[0]!;
    const b = route[route.length - 1]!;
    const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    return { strokeGradient: { stops: [{ at: 0, color: src }, { at: 1, color: tgt }], angle } };
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
        const locked = (item.record as NodeRecord).locked === true;
        const box = padBox(item.aabb, px(3));
        // glowing accent halo, drawn UNDER the crisp selection stroke below. Static for now — the
        // animated pulse is a later (S2) task.
        ctx.save();
        ctx.shadowColor = accent;
        ctx.shadowBlur = px(12);
        strokeWorldBox(ctx, box, accent, px(2));
        ctx.restore();
        // locked nodes get a dashed outline + a padlock badge; canResizeNode already returns false
        // for them, so the resize-handle loop is skipped without an extra guard.
        strokeWorldBox(ctx, box, accent, px(1.5), locked ? [px(5), px(4)] : undefined);
        if (single && this.canResizeNode(id)) {
          // handles drawn on the RAW aabb so they coincide with the hit-test box (hitResizeHandle)
          const hs = px(6);
          for (const c of Object.values(this.resizeHandlePoints(item.aabb))) {
            fillHandle(ctx, c, hs, '#ffffff', accent);
          }
        }
        // rotate handle: a round dot 24px above the box top-center, coinciding with SelectTool's
        // hit-test (which reads the same raw item.aabb). Round shape distinguishes it from the square
        // resize handles. Gated identically to editor.rotate(): unlocked + canRotate !== false.
        if (
          single &&
          !locked &&
          this.nodes.get((item.record as NodeRecord).type)?.capabilities?.canRotate !== false
        ) {
          const cx = item.aabb.x + item.aabb.w / 2;
          const top = item.aabb.y;
          const hy = top - px(24);
          ctx.save();
          ctx.strokeStyle = accent;
          ctx.lineWidth = px(1);
          ctx.beginPath();
          ctx.moveTo(cx, top);
          ctx.lineTo(cx, hy);
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.lineWidth = px(1.5);
          ctx.beginPath();
          ctx.arc(cx, hy, px(4.5), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        if (locked) drawLockBadge(ctx, box.x, box.y, px(13), accent);
      } else if (single && item.route && item.route.length >= 2) {
        // selected edge: draggable endpoint handles at the route ends
        const hs = px(6);
        fillHandle(ctx, item.route[0]!, hs, '#ffffff', accent);
        fillHandle(ctx, item.route[item.route.length - 1]!, hs, '#ffffff', accent);
        // waypoint (bend) handles: hollow dots at each segment midpoint, coinciding with SelectTool's
        // waypoint hit-test. Grab one to add/move a bend. Smaller + ring-only to read as "optional".
        ctx.save();
        ctx.strokeStyle = accent;
        ctx.lineWidth = px(1.25);
        ctx.globalAlpha = 0.85;
        for (let i = 0; i < item.route.length - 1; i++) {
          const a = item.route[i]!;
          const b = item.route[i + 1]!;
          ctx.beginPath();
          ctx.arc((a.x + b.x) / 2, (a.y + b.y) / 2, px(3.5), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      } else {
        strokeWorldBox(ctx, padBox(item.aabb, px(3)), accent, px(1));
      }
    }

    // Group affordance: a single dashed, low-emphasis box enclosing a multi-selection (in addition
    // to the per-node rings above), matching Figma/Excalidraw's union bounds.
    if (this.selectedAtom.peek().size > 1) {
      const gb = this.selectionBounds();
      if (gb) {
        ctx.save();
        ctx.globalAlpha = 0.7;
        strokeWorldBox(ctx, padBox(gb, px(6)), accent, px(1), [px(6), px(4)]);
        ctx.restore();
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
      // drop-target affordance: highlight the candidate port under the cursor
      if (cd.targetPort) {
        const c = cd.targetPort.valid ? '#10b981' : accent;
        ctx.save();
        ctx.strokeStyle = c;
        ctx.fillStyle = c;
        ctx.lineWidth = px(1.5);
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.arc(cd.targetPort.point.x, cd.targetPort.point.y, px(6), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(cd.targetPort.point.x, cd.targetPort.point.y, px(6), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    const cp = this.createPreviewAtom.peek();
    if (cp) strokeWorldBox(ctx, cp, accent, px(1), [px(4), px(4)]);

    // port dots on the hovered node — drag from one to connect (create a node if dropped in space).
    // Shown during a connect draft too, so the node under the cursor reveals its ports as drop targets.
    const hoverId = this.hoveredAtom.peek();
    if (hoverId && !mq && !cp) {
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

  /** Ids of edges that currently carry a flow spec. Maintained incrementally on every mutation so the
   *  rAF gate (`hasFlow`/`isFlowAnimating`) is O(1) rather than allocating + scanning all edges each
   *  animated frame. Rebuilt wholesale after a bulk `load`/restore (which bypasses the change channel). */
  private readonly flowingEdges = new Set<Id>();

  /** Reconcile the flow index against a batch of applied changes (called post-commit): for each
   *  touched id, it belongs in the set iff the record still exists and has `flow != null`. Runs in
   *  O(changes), not O(all edges). */
  private reconcileFlowIndex(changes: Change[]): void {
    for (const c of changes) {
      const id = c.op === 'add' ? c.record.id : c.id;
      const rec = this.store.peek(id);
      if (rec && isEdge(rec) && rec.flow != null) this.flowingEdges.add(id);
      else this.flowingEdges.delete(id);
    }
  }

  /** Recompute the flow index from scratch (after a bulk load/restore that skips the change channel). */
  private rebuildFlowIndex(): void {
    this.flowingEdges.clear();
    for (const e of this.store.edges()) if (e.flow != null) this.flowingEdges.add(e.id);
  }

  /** True if any edge is flowing. The host keeps the rAF loop ticking while this holds (else idle). O(1). */
  hasFlow(): boolean {
    return this.flowingEdges.size > 0;
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
   *  Returns a `Dispose` that unbinds. EPHEMERAL — not serialized, not undoable. Binding is permissive
   *  (any id, even one with no live edge record, is accepted), but a source bound to an id with no live
   *  edge record is auto-unbound on the next store change — so bind AFTER the edge exists. */
  bindFlowSource(id: Id, source: FlowSource): Dispose {
    this.unbindFlowSource(id);
    let stopped = false;
    const emit = (value: number): void => {
      if (!stopped && Number.isFinite(value)) this.setFlowMetric(id, value);
    };
    const reportError = (err: unknown): void => {
      if (source.onError) { try { source.onError(err); } catch { /* a bad onError must not break the feed */ } }
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
          reportError(err); // keep last metric, keep polling
        } finally {
          inFlight = false;
        }
      };
      void tick(); // immediate first poll
      const handle = setInterval(() => void tick(), source.intervalMs);
      teardown = () => { stopped = true; clearInterval(handle); };
    } else {
      let unsub: () => void = () => {};
      try {
        const u = source.subscribe(emit);
        if (typeof u === 'function') unsub = u;
      } catch (err) {
        reportError(err);
      }
      teardown = () => {
        stopped = true;
        try { unsub(); } catch (err) { reportError(err); }
      };
    }
    this.flowSources.set(id, teardown);
    return () => { if (this.flowSources.get(id) === teardown) this.unbindFlowSource(id); };
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
  /** Bumped on every `animate()` call. Plain-field tween state (`animClock`/`presentation`) isn't
   *  itself reactive, so a host repaint `effect` that reads this atom wakes an idle rAF loop when a
   *  standalone animation starts on an otherwise-quiet canvas. Not serialized; value is inert. */
  readonly animationEpochAtom: Atom<number> = atom(0);
  /** Integrated flow time (ms), advanced by paintFlow only while animating. */
  private flowClock = 0;
  private flowPrevTime: number | null = null;
  /** Shared tween engine for one-shot presentation animations (distinct from the flow clock). */
  private animClock = new AnimationClock();
  /** Ephemeral per-item paint modifiers written by tween `onTick` callbacks. Never serialized.
   *  Keyed by plain string id (not the branded `Id` type) — presentation targets need not be
   *  live record ids (e.g. transient overlay elements), so this stays deliberately loose. */
  private presentation = new Map<string, Presentation>();

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

  /** Register a tween on the shared animation clock. Returns a cancel fn. Ephemeral — no undo entry.
   *  Bumps `animationEpochAtom` so a signal-subscribed host repaint reaction wakes an idle rAF loop. */
  animate(spec: TweenSpec): () => void {
    const cancel = this.animClock.add(spec);
    this.animationEpochAtom.set(this.animationEpochAtom.peek() + 1);
    return cancel;
  }
  /** True while any tween is unfinished — the second rAF gate (OR-ed with `isFlowAnimating()`). */
  isAnimating(): boolean {
    return this.animClock.isActive();
  }
  /** Ephemeral per-item paint modifier (alpha/scale/offset). `undefined` = identity. Never serialized. */
  presentationFor(id: string): Presentation | undefined {
    return this.presentation.get(id);
  }
  /** Merge a presentation patch for `id` (defaults: alpha 1, scale 1, dx/dy 0). Ephemeral. */
  setPresentation(id: string, patch: Partial<Presentation>): void {
    const cur = this.presentation.get(id) ?? { alpha: 1, scale: 1, dx: 0, dy: 0 };
    this.presentation.set(id, { ...cur, ...patch });
  }
  clearPresentation(id: string): void {
    this.presentation.delete(id);
  }
  /** Test-only: advance the animation clock with the current reduced-motion state, without a full
   *  `render()` call (which needs a real Ctx2D). Lets unit tests drive tween ticks deterministically. */
  animClockStep(now: number): void {
    this.animClock.step(now, this.reducedMotionAtom.peek());
  }

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
    this.drawFlowEdges(ctx, this.visibleItems(), theme, this.flowClock);
  }

  /** Shared per-edge flow draw: resolve each edge's spec against its live metric, paint the neon glow
   *  underlay, then paint markers at `time`. Caller has already set the world transform and computed
   *  the effective (scaled) time. */
  private drawFlowEdges(ctx: Ctx2D, items: Iterable<RenderItem>, theme: Theme, time: number): void {
    for (const item of items) {
      if (item.kind !== 'edge') continue;
      const flow = (item.record as EdgeRecord).flow;
      if (!flow) continue;
      const resolved = resolveFlow(flow, this.flowMetrics.get(item.id));
      this.drawFlowGlow(ctx, item, theme, resolved);
      paintFlowMarkers(ctx, item, theme, time, resolved);
    }
  }

  /** Neon bloom underlay for a flowing edge: a wide, translucent, glowing stroke along the edge's
   *  route, drawn under the packet markers. Purely a styling pass — gated on flow being *enabled*
   *  (not on motion), so it stays visible while paused / under reduced-motion. */
  private drawFlowGlow(ctx: Ctx2D, item: RenderItem, theme: Theme, flow: FlowSpec): void {
    const route = item.route;
    if (!route || route.length < 2) return;
    const tokens = resolveTokensCached(theme, item.record as EdgeRecord);
    const color = flow.color ?? tokens.stroke;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.lineWidth = tokens.strokeWidth * 1.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(route[0]!.x, route[0]!.y);
    for (let i = 1; i < route.length; i++) ctx.lineTo(route[i]!.x, route[i]!.y);
    ctx.stroke();
    ctx.restore();
  }

  /** Convenience: paint the full frame (static + flow + overlays + optional interactive) onto one ctx.
   *  Pass `time` (ms) to animate flow; the host keeps calling frames while `isFlowAnimating()` is true. */
  render(ctx: Ctx2D, cssW: number, cssH: number, dpr = 1, interactive = false, time = 0): void {
    this.setViewport(cssW, cssH);
    this.animClock.step(time, this.reducedMotionAtom.peek());
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
