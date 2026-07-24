/**
 * The serializable domain model — flat, tagged-union POJO records that are the single source
 * of truth. Grouping and connectivity are expressed by id-reference, never by nesting.
 */

import type { StateTokens } from './theme/index.js';

/** A branded, type-tagged identifier, e.g. `"node:abc123"`. */
export type Id<T extends string = string> = `${T}:${string}`;

export interface Vec2 {
  x: number;
  y: number;
}

/** An axis-aligned box in world space. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A 2D affine matrix `[a, b, c, d, e, f]` (column-major like the Canvas2D API). */
export type Mat2D = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

/** Pan (`x`, `y` = world point at the viewport's top-left) + zoom (`z`). */
export interface Camera {
  x: number;
  y: number;
  z: number;
}

/**
 * Visual status of a record. `state` is an open union so presets can add their own; the four
 * built-in states come from the seed spec. `overlay` and `focused` compose on top of `state`.
 */
export type NodeState = 'accent' | 'solid' | 'ghost' | 'locked' | (string & {});

export interface VisualState {
  state: NodeState;
  overlay?: string;
  focused?: boolean;
}

/** A color stop for a data-driven flow scale, at a metric value in the scale's domain units. */
export interface FlowColorStop {
  at: number;
  color: string;
}

/**
 * Maps a scalar metric (throughput, health, utilization, latency…) to flow visuals, so an edge's
 * animation reflects live data. `domain` is the metric's [min, max]; each visual range is interpolated
 * across it. `colors` are stepped threshold bands by default (green/amber/red); set `gradient` to blend.
 */
export interface FlowScale {
  domain: [number, number];
  /** Packet speed (world u/s) across the domain — e.g. healthy links flow faster. */
  speed?: [number, number];
  /** Packet count across the domain. */
  count?: [number, number];
  /** Dot size across the domain. */
  size?: [number, number];
  /** Color stops in domain units (stepped bands unless `gradient`). */
  colors?: FlowColorStop[];
  gradient?: boolean;
}

/**
 * Animated flow along an edge — moving "packets" (dots) or marching dashes, to visualize data/traffic
 * direction. Rendered on a gated animation pass so it never dirties the static layer (idle = 0 paints).
 * For DATA-DRIVEN flow, set `scale` and feed live values via `editor.setFlowMetric` (ephemeral), or a
 * static `data` value; the effective speed/count/size/color are then derived from the metric each frame.
 */
export interface FlowSpec {
  /** World units per second the markers travel (default 70). */
  speed?: number;
  /** Marker color; defaults to the edge's resolved stroke token. */
  color?: string;
  /** 'dots' = discrete packets (default); 'dash' = a marching-ants dashed overlay. */
  style?: 'dots' | 'dash';
  /** Dot radius / dash width in world units (default 3). */
  size?: number;
  /** Number of packets spaced along the edge (default derived from its length). */
  count?: number;
  /** Flow target→source instead of the default source→target. */
  reverse?: boolean;
  /** Data-driven mapping from a metric to the visuals above. */
  scale?: FlowScale;
  /** Static metric value used when no live metric is set for the edge. */
  data?: number;
}

/**
 * A declarative live feed for a data-driven edge's flow metric — bound via `editor.bindFlowSource`.
 * EPHEMERAL: never serialized or historied. Two shapes:
 *  - pull: `poll` every `intervalMs` (engine-owned timer); overlapping in-flight polls are skipped.
 *  - push: `subscribe(emit)` returns an unsubscribe; the source pushes values on its own cadence.
 * A poll/subscribe error is swallowed (last metric kept, feed keeps running) and reported to `onError`.
 */
export type FlowSource =
  | { poll: () => number | Promise<number>; intervalMs: number; onError?: (err: unknown) => void }
  | { subscribe: (emit: (value: number) => void) => (() => void); onError?: (err: unknown) => void };

/**
 * Global, EPHEMERAL runtime knobs for the flow animation — owned by the editor, NOT serialized and
 * NOT undoable (session/runtime state, like the camera). Per-edge `FlowSpec`/`FlowScale` are separate.
 */
export interface FlowRuntimeConfig {
  /** false = draw NO flow markers (edges look static); loop idle. */
  enabled: boolean;
  /** true = freeze markers in place (still drawn, no motion); loop idle. */
  paused: boolean;
  /** Global multiplier applied to every edge's flow speed (clamped >= 0). */
  speedScale: number;
  /** Honor OS prefers-reduced-motion by freezing to a static frame. */
  respectReducedMotion: boolean;
  /** Optional cap (fps) on the self-perpetuating flow ticks; undefined = display refresh. */
  maxFps?: number;
}

export interface BaseRecord<TN extends string = string> {
  id: Id<TN>;
  typeName: TN;
  /** Per-record mutation counter — drives `diff()` and render caches only. */
  version: number;
  /** Per-element style overrides, merged last (highest priority) in `resolveTokens`. */
  style?: Partial<StateTokens>;
}

export interface NodeRecord extends BaseRecord<'node'> {
  /** Registry key selecting the `NodeUtil` (e.g. `"rect"`, `"infra.db"`). */
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  /** Fractional z-index string for stable ordering. */
  z: string;
  /**
   * Edit-lock: when true the node can't be moved/resized/rotated/deleted by interaction (it stays
   * selectable so it can be unlocked). Distinct from the `'locked'` VISUAL state in `visual.state`,
   * which is a theme skin, not an interaction guard.
   */
  locked?: boolean;
  /**
   * Visibility: when true the node is HIDDEN — it stays in the document (so a layers/outline tree can
   * still list it) but is excluded from rendering, hit-testing, and marquee selection (see SceneIndex).
   * Optional and omit-when-false: absent ⇒ visible, so a never-hidden node serializes byte-identically
   * to today. Distinct from the `'ghost'` VISUAL state, which draws the node faintly rather than not at all.
   */
  hidden?: boolean;
  /** Group/frame parent, by id-reference. */
  parentId?: Id;
  /**
   * Page membership, by id-reference to a `PageRecord`. Optional and omit-when-implicit: a document
   * with NO `PageRecord` is a single implicit page and records carry no `pageId` (so a pre-pages
   * diagram serializes byte-identically); once any `PageRecord` exists, every node/edge carries an
   * explicit `pageId` resolving to a real page. Distinct from `parentId`, which is a group/frame
   * parent (a low-z container node), never a page.
   */
  pageId?: Id<'page'>;
  visual: VisualState;
  label?: string;
  /** Type-specific data interpreted by the node's registered `NodeUtil`. */
  props: Record<string, unknown>;
  /** Host scratch space; the core never interprets this. */
  meta?: Record<string, unknown>;
}

/**
 * An edge endpoint:
 *  - `node`    — bound to a fixed port/anchor on a node,
 *  - `outline` — bound to a node but attaching at the nearest point on its outline (slides as it moves),
 *  - `point`   — pinned to a free world point (a floating/unbound endpoint).
 */
export type Endpoint =
  | { kind: 'node'; nodeId: Id<'node'>; portId?: string; anchor?: Vec2 }
  | { kind: 'outline'; nodeId: Id<'node'> }
  | { kind: 'point'; x: number; y: number };

export interface EdgeRecord extends BaseRecord<'edge'> {
  type: string;
  from: Endpoint;
  to: Endpoint;
  /**
   * Page membership — same contract as `NodeRecord.pageId`. Required to resolve a `point` endpoint
   * (which has no node to inherit a page from); for a node-bound edge it must match its endpoints'
   * page (an editor-enforced invariant).
   */
  pageId?: Id<'page'>;
  visual: VisualState;
  label?: string;
  /** Optional animated flow (packets/dashes) traveling along the edge. */
  flow?: FlowSpec;
  /** Route points are *derived* from endpoints, never stored here. */
  props: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface PageRecord extends BaseRecord<'page'> {
  name: string;
  index: string;
}

export type NodusRecord = NodeRecord | EdgeRecord | PageRecord;

// ---- change channel ----

/** The only mutation vocabulary the store accepts. */
export type Change =
  | { op: 'add'; record: NodusRecord }
  | { op: 'update'; id: Id; patch: Record<string, unknown> }
  | { op: 'remove'; id: Id };

/**
 * When a change is recorded into undo history:
 * - `'immediately'` — its own undo entry (a discrete action: create, delete, one drag commit).
 * - `'later'` — accumulate into the open group until `editor.mark()` closes it, so a continuous gesture
 *   (drag, slider scrub) collapses into ONE entry. `editor.transaction(fn)` sets this ambiently.
 * - `'never'` — not recorded (load, remote replay, the undo/redo re-apply itself).
 */
export type CapturePolicy = 'immediately' | 'later' | 'never';

/**
 * Who originated a change, which decides whether it enters undo history:
 * - `'user'` — a direct local edit (create/move/style). Recorded.
 * - `'program'` — a local edit made on the user's behalf (undo/redo replay, layout, importers).
 *   Recorded when `capture` allows, so e.g. a programmatic layout is undoable as one step.
 * - `'remote'` — a change applied from another peer via `applyRemote`. NOT recorded: a remote edit is
 *   authoritative history from elsewhere, not a local action the user can undo (undoing it would
 *   diverge the shared document). Remote applies also bypass before-apply interception.
 */
export type ChangeSource = 'user' | 'remote' | 'program';

export interface ApplyOptions {
  capture?: CapturePolicy;
  source?: ChangeSource;
  /**
   * Run the store's registered before-apply interceptors (default `true`). Undo/redo and remote
   * replays pass `false` — they apply recorded/authoritative deltas verbatim, and re-transforming
   * them would double-apply constraints and corrupt the recorded inverse.
   */
  intercept?: boolean;
}

// ---- id helpers ----

let idCounter = 0;
const ID_HASH_MULT = 2654435761;
const ID_HASH_MASK = 0xffffff;

/**
 * The default auto-generated suffix for counter value `n`: `<n b36>x<hash b36>`. The hash is derived
 * from `n + 1` to stay byte-identical to the historical inline form (`idCounter++` incremented the
 * counter before the hash term read it), so ids serialize exactly as before.
 */
function autoIdSuffix(n: number): string {
  return `${n.toString(36)}x${(((n + 1) * ID_HASH_MULT) % ID_HASH_MASK).toString(36)}`;
}

/**
 * Generate a stable, collision-resistant id for a record type. Not time/random dependent.
 *
 * @internal Backs `deterministicIdFactory()` and is scheduled to leave the public barrel (B5). Prefer
 * `editor.ids.make(...)` (an instance {@link IdFactory}) — the module-global counter this reads is
 * shared by every editor in the process, which is exactly the cross-instance collision A6 removes.
 */
export function makeId<T extends string>(typeName: T, seed?: string): Id<T> {
  const suffix = seed ?? autoIdSuffix(idCounter++);
  return `${typeName}:${suffix}` as Id<T>;
}

/**
 * Recover the counter value from an auto-generated id, or `null` if it wasn't produced by the default
 * scheme. Keyed/custom-seeded ids (e.g. `node:s3-prod`, stencil `node:n0`) are rejected via an exact
 * round-trip check, so they never perturb the counter. Because the `x` separator is itself a base-36
 * digit (33 = `"x"`), the counter head can contain `x` — so we try every `x` position and accept the
 * one whose reconstruction matches exactly (at most one can).
 */
function autoIdCounterValue(id: string): number | null {
  const suffix = id.slice(id.indexOf(':') + 1);
  for (let x = suffix.indexOf('x'); x >= 0; x = suffix.indexOf('x', x + 1)) {
    if (x === 0) continue; // head must be non-empty
    const head = suffix.slice(0, x);
    if (!/^[0-9a-z]+$/.test(head)) continue;
    const n = Number.parseInt(head, 36);
    if (Number.isSafeInteger(n) && n >= 0 && autoIdSuffix(n) === suffix) return n;
  }
  return null;
}

/**
 * Advance the module id counter past every auto-generated id in `ids`, so ids minted *after* a load
 * can't collide with loaded records. The counter is a module global that resets to 0 each JS context
 * and is otherwise never seeded — without this, draw → save → reopen → draw regenerates a loaded node's
 * id, which the store then refuses as a duplicate `add` (see `Store.apply`). Called from `Store.load`.
 * Covers every record type (node/edge/page share this one counter).
 *
 * @internal Backs `deterministicIdFactory()` and is scheduled to leave the public barrel (B5). The
 * instance path is `editor.ids.seed(...)` / `StoreOptions.idFactory`.
 */
export function seedIdCounter(ids: Iterable<string>): void {
  for (const id of ids) {
    const n = autoIdCounterValue(id);
    if (n !== null && n >= idCounter) idCounter = n + 1;
  }
}

export function isNode(r: NodusRecord): r is NodeRecord {
  return r.typeName === 'node';
}
/** Type guard: `r` is an {@link EdgeRecord}. */
export function isEdge(r: NodusRecord): r is EdgeRecord {
  return r.typeName === 'edge';
}
/** Type guard: `r` is a {@link PageRecord}. */
export function isPage(r: NodusRecord): r is PageRecord {
  return r.typeName === 'page';
}
