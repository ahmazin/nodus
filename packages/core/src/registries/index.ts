/**
 * Type registries (extensibility Axis 1). A `NodeUtil`/`EdgeUtil` teaches the engine everything
 * type-specific: geometry (one declarative source for hit-test/bounds/cull), ports, and how to
 * paint. The engine owns the maps; presets and third parties register through the public API.
 */

import type { DrawApi } from '../renderer/draw-api.js';
import type { Geometry2d } from '../geometry/index.js';
import type { Box, EdgeRecord, Endpoint, NodeRecord, Vec2 } from '../model.js';
import type { Router } from '../routing/index.js';
import type { ResolvedTokens, Theme } from '../theme/index.js';
import { NodusError } from '../errors/index.js';

export interface Port {
  id: string;
  kind: 'source' | 'target' | 'both';
  /** Normalized anchor within the node box (0..1). World position is derived from the node rect. */
  anchor: Vec2;
  isValidConnection?: (from: Endpoint, to: Endpoint) => boolean;
}

export interface NodeCapabilities {
  canConnect: boolean;
  canResize: boolean;
  canEdit: boolean;
  canRotate: boolean;
  /** Label editing is multi-line (Enter inserts a newline; blur/Esc commits). */
  multiline: boolean;
}

export const DEFAULT_CAPABILITIES: NodeCapabilities = {
  canConnect: true,
  canResize: true,
  canEdit: true,
  canRotate: false,
  multiline: false,
};

/** Per-type edge behavior toggles. */
export interface EdgeCapabilities {
  /** Whether the edge's label is user-editable (default true). */
  canEdit: boolean;
}

export const DEFAULT_EDGE_CAPABILITIES: EdgeCapabilities = {
  canEdit: true,
};

/**
 * An ordered, up-only, pure props transform carrying a stable `id`. A type with `migrations = [m1, m2]`
 * is at version 2; a record stored at version `v` runs steps `v … length-1` (`.migrate`) to reach
 * `length`. The `id` sequence is APPEND-ONLY across re-registration — a step's id may never change or
 * reorder, or a record migrated one way on save would migrate differently on load. See the migration
 * design spec.
 */
export interface Migration<P extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable, unique-within-the-type identifier for this step. Append-only across re-registration. */
  id: string;
  migrate(props: P): P;
}

export interface NodeUtil<P extends Record<string, unknown> = Record<string, unknown>> {
  /** The type key this util is registered under (`node.type`). */
  readonly type: string;
  /** Default `props` for a freshly-created node of this type. `createNode` merges the caller's partial
   *  props OVER these (defaults survive unless explicitly overridden). */
  getDefaultProps(): P;
  /** Default size for a new node (used when the caller doesn't pass w/h). Default 120×56 if absent. */
  getDefaultSize?(props: P): { w: number; h: number };
  /** The ONE declarative geometry (world coords) — the single source for bounds, culling, hit-testing,
   *  and snapping. Everything spatial derives from it, so it must be deterministic per record. */
  getGeometry(node: NodeRecord): Geometry2d;
  /** Named connection ports (anchors) for this node, for port-to-port edges. Absent ⇒ no fixed ports. */
  getPorts?(node: NodeRecord): Port[];
  /** Paint the node via the `Ctx2D`-abstracting {@link DrawApi} using the resolved theme tokens. A
   *  throw here is isolated per-item (the frame continues; see the paint-error channel). */
  draw(api: DrawApi, node: NodeRecord, tokens: ResolvedTokens): void;
  /** Per-type behavior toggles, merged over {@link DEFAULT_CAPABILITIES} by `editor.capabilitiesOf`.
   *  Unset flags resolve to the default (notably `canRotate` defaults to FALSE). */
  readonly capabilities?: Partial<NodeCapabilities>;
  /** Ordered up-migrations for this type's `props`. `version === migrations.length`; a record stored at
   *  version `v` runs steps `v … length-1`. Step ids are stable + APPEND-ONLY across re-registration. */
  readonly migrations?: Migration[];
  /** Normalize-or-throw validation for this type's `props`, run synchronously by the façade
   *  (createNode/updateNode/updateRecord) and by the built-in before-apply guard. Return the
   *  normalized props, or THROW to reject the write (the façade surfaces it as
   *  `NodusError('invalid-props')`; a raw store write is vetoed + reported). Must be PURE and
   *  IDEMPOTENT (`f(f(x)) === f(x)`) — the façade and the guard may both run it on one write. */
  validateProps?(props: P): P;
}

export interface EdgeRouteContext {
  from: Vec2;
  to: Vec2;
  fromGeom?: Geometry2d;
  toGeom?: Geometry2d;
  fromNode?: NodeRecord;
  toNode?: NodeRecord;
  fromBox?: Box;
  toBox?: Box;
  /** User waypoints from `edge.props.waypoints`. */
  waypoints?: Vec2[];
  /** Padded boxes of nearby non-endpoint nodes the route should avoid (orthogonal router only). */
  obstacles?: Box[];
  /** The router resolved from `edge.props.router` (undefined -> the util's default). */
  router?: Router;
}

export interface EdgeUtil<P extends Record<string, unknown> = Record<string, unknown>> {
  readonly type: string;
  getDefaultProps?(): P;
  /** Compute the polyline route (world coords) from resolved endpoints. */
  getRoute(edge: EdgeRecord, ctx: EdgeRouteContext): Vec2[];
  /** Hit tolerance (world units) around the polyline. */
  readonly hitWidth?: number;
  draw(api: DrawApi, edge: EdgeRecord, tokens: ResolvedTokens, route: Vec2[]): void;
  readonly capabilities?: Partial<EdgeCapabilities>;
  /** Ordered up-migrations for this type's `props`. Version === migrations.length. */
  readonly migrations?: Migration[];
  /** Normalize-or-throw validation for this type's `props` (see {@link NodeUtil.validateProps}). */
  validateProps?(props: P): P;
}

/** Render a value for an error message: strings quoted, everything else stringified. */
function describe(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** Throw if `util[method]` is not a function — the missing/invalid-method half of util validation. */
function requireMethod(util: { readonly type: string }, label: string, method: string): void {
  if (typeof (util as unknown as Record<string, unknown>)[method] !== 'function') {
    throw new NodusError('invalid-util', `Cannot register ${label} ${describe(util.type)}: '${method}' must be a function.`, {
      context: { label, type: util.type, method },
    });
  }
}

/** Read `m.id` when `m` is a `{ id: string }`-shaped step, else `undefined`. */
function migrationId(m: unknown): string | undefined {
  return m !== null && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'string'
    ? (m as { id: string }).id
    : undefined;
}

/** Throw if `util.migrations` is present but not an array of `{ id: string; migrate(props) }` steps
 *  with ids unique within the type. */
function validateMigrations(util: { readonly type: string; migrations?: unknown }, label: string): void {
  const m = util.migrations;
  if (m === undefined) return;
  const bad = (reason: string): never => {
    throw new NodusError('invalid-migrations', `Cannot register ${label} ${describe(util.type)}: ${reason}.`, {
      context: { label, type: util.type },
    });
  };
  if (!Array.isArray(m)) bad("'migrations' must be an array");
  const seen = new Set<string>();
  for (const step of m as unknown[]) {
    const id = migrationId(step);
    if (id === undefined || typeof (step as { migrate?: unknown }).migrate !== 'function') {
      bad("'migrations' entries must each be a { id: string; migrate(props) } object");
    }
    if (seen.has(id!)) bad(`'migrations' has a duplicate migration id ${JSON.stringify(id)}`);
    seen.add(id!);
  }
}

/** The ordered migration ids declared by a util (empty when it has none). */
function migrationIds(util: { migrations?: unknown }): string[] {
  const m = util.migrations;
  return Array.isArray(m) ? (m as unknown[]).map((s) => migrationId(s) ?? '') : [];
}

/** Structural validator for a `NodeUtil` — the geometry + paint methods the engine will call. */
export function validateNodeUtil(util: NodeUtil): void {
  requireMethod(util, 'node type', 'getGeometry');
  requireMethod(util, 'node type', 'draw');
  validateMigrations(util, 'node type');
}

/** Structural validator for an `EdgeUtil` — the routing + paint methods the engine will call. */
export function validateEdgeUtil(util: EdgeUtil): void {
  requireMethod(util, 'edge type', 'getRoute');
  requireMethod(util, 'edge type', 'draw');
  validateMigrations(util, 'edge type');
}

/** Tuning for how a `Registry` validates and reports registrations. */
export interface RegistryOptions<T extends { readonly type: string }> {
  /** Human label used in error/warning messages (e.g. `'node type'`). Defaults to `'type'`. */
  label?: string;
  /** Type-specific structural check; throws a contextual `Error` when `util` is malformed. */
  validate?: (util: T) => void;
  /** Notified when a registration overwrites an existing `type` — a soft, non-fatal warning. */
  onOverride?: (type: string) => void;
}

/** A generic type-keyed registry. */
export class Registry<T extends { readonly type: string }> {
  private readonly map = new Map<string, T>();
  /** Prior migration-id sequence per type, for the append-only check on re-registration. */
  private readonly migrationSeqs = new Map<string, string[]>();

  constructor(private readonly opts: RegistryOptions<T> = {}) {}

  /**
   * Register a util under its `type`. Fails fast (throws) on a malformed util — a non-object, an
   * empty/non-string `type`, or (via `opts.validate`) a missing required method — turning a cryptic
   * later crash into an obvious registration-time error. Re-registering an existing `type` overrides
   * it (presets legitimately do this) but fires `opts.onOverride` so the override stays observable.
   */
  register(util: T): void {
    const label = this.opts.label ?? 'type';
    const candidate = util as unknown;
    if (candidate === null || typeof candidate !== 'object') {
      throw new NodusError(
        'invalid-util',
        `Cannot register ${label}: expected a util object, but got ${candidate === null ? 'null' : typeof candidate}.`,
        { context: { label, got: candidate === null ? 'null' : typeof candidate } },
      );
    }
    const type = (candidate as { type?: unknown }).type;
    if (typeof type !== 'string' || type.length === 0) {
      throw new NodusError('invalid-util', `Cannot register ${label}: 'type' must be a non-empty string (got ${describe(type)}).`, {
        context: { label, type },
      });
    }
    this.opts.validate?.(util);
    // Migrations are APPEND-ONLY across re-registration: the prior id sequence for this type must be a
    // PREFIX of the new one. Reordering or changing a step would migrate a record differently on load
    // than on save (silent data corruption), so refuse it at registration time.
    const nextIds = migrationIds(util as { migrations?: unknown });
    const priorIds = this.migrationSeqs.get(type);
    if (priorIds) {
      for (let i = 0; i < priorIds.length; i++) {
        if (nextIds[i] !== priorIds[i]) {
          throw new NodusError(
            'invalid-migrations',
            `Cannot re-register ${label} ${describe(type)}: migration step ${i} changed from ${describe(priorIds[i])} to ${describe(nextIds[i])} (migrations are append-only).`,
            { context: { label, type, step: i, was: priorIds[i], now: nextIds[i] } },
          );
        }
      }
    }
    if (this.map.has(type)) this.opts.onOverride?.(type);
    this.map.set(type, util);
    this.migrationSeqs.set(type, nextIds);
  }
  unregister(type: string): void {
    this.map.delete(type);
  }
  get(type: string): T | undefined {
    return this.map.get(type);
  }
  has(type: string): boolean {
    return this.map.has(type);
  }
  list(): T[] {
    return [...this.map.values()];
  }
  get size(): number {
    return this.map.size;
  }
}

export type NodeRegistry = Registry<NodeUtil>;
export type EdgeRegistry = Registry<EdgeUtil>;
