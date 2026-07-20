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

/**
 * An ordered, up-only, pure props transform. A type with `migrations = [m1, m2]` is at version 2;
 * a record stored at version `v` runs steps `v … length-1` to reach `length`. See the migration
 * design spec.
 */
export type Migration<P extends Record<string, unknown> = Record<string, unknown>> = (props: P) => P;

export interface NodeUtil<P extends Record<string, unknown> = Record<string, unknown>> {
  readonly type: string;
  getDefaultProps(): P;
  getDefaultSize?(props: P): { w: number; h: number };
  /** Compute intrinsic size (e.g. from a label). Canvas has no DOM autosize; layout needs sizes. */
  measure?(node: NodeRecord, theme: Theme): { w: number; h: number };
  /** The one declarative geometry (world coords) — serves bounds, culling, hit-test, snapping. */
  getGeometry(node: NodeRecord): Geometry2d;
  getPorts?(node: NodeRecord): Port[];
  draw(api: DrawApi, node: NodeRecord, tokens: ResolvedTokens): void;
  readonly capabilities?: Partial<NodeCapabilities>;
  /** Ordered up-migrations for this type's `props`. Version === migrations.length. */
  readonly migrations?: Migration[];
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
  /** Ordered up-migrations for this type's `props`. Version === migrations.length. */
  readonly migrations?: Migration[];
}

/** Render a value for an error message: strings quoted, everything else stringified. */
function describe(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** Throw if `util[method]` is not a function — the missing/invalid-method half of util validation. */
function requireMethod(util: { readonly type: string }, label: string, method: string): void {
  if (typeof (util as unknown as Record<string, unknown>)[method] !== 'function') {
    throw new Error(`Cannot register ${label} ${describe(util.type)}: '${method}' must be a function.`);
  }
}

/** Throw if `util.migrations` is present but not an array of functions. */
function validateMigrations(util: { readonly type: string; migrations?: unknown }, label: string): void {
  const m = util.migrations;
  if (m === undefined) return;
  if (!Array.isArray(m) || !m.every((fn) => typeof fn === 'function')) {
    throw new Error(`Cannot register ${label} ${describe(util.type)}: 'migrations' must be an array of functions.`);
  }
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
      throw new Error(
        `Cannot register ${label}: expected a util object, but got ${candidate === null ? 'null' : typeof candidate}.`,
      );
    }
    const type = (candidate as { type?: unknown }).type;
    if (typeof type !== 'string' || type.length === 0) {
      throw new Error(`Cannot register ${label}: 'type' must be a non-empty string (got ${describe(type)}).`);
    }
    this.opts.validate?.(util);
    if (this.map.has(type)) this.opts.onOverride?.(type);
    this.map.set(type, util);
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
