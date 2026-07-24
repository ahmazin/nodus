/**
 * Pluggable auto-layout (extensibility Axis 3). Async-first so sync (dagre/tree) and async
 * (elk/force) engines share one signature. Engines live in their own packages; the engine
 * canonicalizes results to world-space top-left. Invoked via `editor.layout(engineId, opts)`.
 */

import type { Id, Vec2 } from '../model.js';

export type LayoutDirection = 'LR' | 'RL' | 'TB' | 'BT';

export interface LayoutGraphNode {
  id: Id;
  w: number;
  h: number;
  /** Current position (top-left). Engines may seed from this. */
  x?: number;
  y?: number;
  /** If true, the engine must not move this node. */
  fixed?: boolean;
  parentId?: Id;
}

export interface LayoutGraphEdge {
  id: Id;
  source: Id;
  target: Id;
}

export interface LayoutGraph {
  nodes: LayoutGraphNode[];
  edges: LayoutGraphEdge[];
  direction?: LayoutDirection;
}

export interface LayoutOptions {
  direction?: LayoutDirection;
  /** Gap between ranks / rows. */
  rankGap?: number;
  /** Gap between nodes in the same rank. */
  nodeGap?: number;
  /** Cancels a long-running (async) layout; the engine should honor it and the editor discards a
   *  superseded result. */
  signal?: AbortSignal;
  [key: string]: unknown;
}

export interface LayoutResult {
  /** New top-left position per node id, in world coordinates. */
  positions: Record<Id, Vec2>;
}

export interface LayoutEngine {
  readonly id: string;
  readonly supportsIncremental?: boolean;
  layout(graph: LayoutGraph, opts?: LayoutOptions): Promise<LayoutResult>;
}
