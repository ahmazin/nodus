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

/** A per-record-type migration: transform props authored at `from` up to the next version. */
export interface Migration {
  from: number;
  up: (props: Record<string, unknown>) => Record<string, unknown>;
}

export interface NodeUtil<P extends Record<string, unknown> = Record<string, unknown>> {
  readonly type: string;
  /** Current schema version for this type's `props`. Defaults to 0. */
  readonly version?: number;
  getDefaultProps(): P;
  getDefaultSize?(props: P): { w: number; h: number };
  /** Compute intrinsic size (e.g. from a label). Canvas has no DOM autosize; layout needs sizes. */
  measure?(node: NodeRecord, theme: Theme): { w: number; h: number };
  /** The one declarative geometry (world coords) — serves bounds, culling, hit-test, snapping. */
  getGeometry(node: NodeRecord): Geometry2d;
  getPorts?(node: NodeRecord): Port[];
  draw(api: DrawApi, node: NodeRecord, tokens: ResolvedTokens): void;
  readonly capabilities?: Partial<NodeCapabilities>;
  readonly migrations?: Migration[];
  /** Validate/normalize persisted props; throw or coerce. */
  validate?(props: unknown): P;
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
  /** The router resolved from `edge.props.router` (undefined -> the util's default). */
  router?: Router;
}

export interface EdgeUtil<P extends Record<string, unknown> = Record<string, unknown>> {
  readonly type: string;
  readonly version?: number;
  getDefaultProps?(): P;
  /** Compute the polyline route (world coords) from resolved endpoints. */
  getRoute(edge: EdgeRecord, ctx: EdgeRouteContext): Vec2[];
  /** Hit tolerance (world units) around the polyline. */
  readonly hitWidth?: number;
  draw(api: DrawApi, edge: EdgeRecord, tokens: ResolvedTokens, route: Vec2[]): void;
  readonly migrations?: Migration[];
}

/** A generic type-keyed registry. */
export class Registry<T extends { readonly type: string }> {
  private readonly map = new Map<string, T>();

  register(util: T): void {
    this.map.set(util.type, util);
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
