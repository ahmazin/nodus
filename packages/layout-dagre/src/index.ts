/**
 * @nodus-dev/layout-dagre — a `LayoutEngine` adapter over dagre's layered layout. Converts dagre's
 * center-based coordinates to Nodus's world-space top-left. Register with `editor.registerLayout`.
 */

import dagre from '@dagrejs/dagre';
import type { Id, LayoutEngine, LayoutGraph, LayoutOptions, LayoutResult } from '@nodus-dev/core';

/**
 * Above this node count, dagre's internal layered layout (its recursive acyclic cycle-break and
 * normalize passes) overflows the call stack with a cryptic `RangeError` — empirically around
 * N≈2000, and lower on smaller-stack runtimes. That recursion lives inside `@dagrejs/dagre`, not in
 * this adapter, so we can't rewrite it iteratively; instead we fail fast above a safe ceiling with a
 * clear, catchable error rather than letting the raw `RangeError` escape mid-layout. Callers hitting
 * this should use the `force` engine (which scales) or lay out a subgraph.
 */
export const DAGRE_MAX_NODES = 1500;

function rankdir(dir: LayoutGraph['direction']): string {
  switch (dir) {
    case 'RL':
      return 'RL';
    case 'TB':
      return 'TB';
    case 'BT':
      return 'BT';
    default:
      return 'LR';
  }
}

export const dagreLayout: LayoutEngine = {
  id: 'dagre',
  async layout(graph: LayoutGraph, opts?: LayoutOptions): Promise<LayoutResult> {
    if (graph.nodes.length > DAGRE_MAX_NODES) {
      throw new Error(
        `dagre layout: graph too large (${graph.nodes.length} nodes exceeds the ${DAGRE_MAX_NODES}-node limit). ` +
          `dagre's recursive layout overflows the call stack at this scale; use the 'force' layout engine or lay out a subgraph.`,
      );
    }
    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: rankdir(opts?.direction ?? graph.direction),
      nodesep: opts?.nodeGap ?? 44,
      ranksep: opts?.rankGap ?? 90,
      marginx: 20,
      marginy: 20,
    });
    g.setDefaultEdgeLabel(() => ({}));

    const known = new Set<Id>();
    for (const n of graph.nodes) {
      g.setNode(n.id, { width: n.w, height: n.h });
      known.add(n.id);
    }
    for (const e of graph.edges) {
      if (known.has(e.source) && known.has(e.target)) g.setEdge(e.source, e.target);
    }

    dagre.layout(g);

    const positions: LayoutResult['positions'] = {};
    for (const n of graph.nodes) {
      const gn = g.node(n.id) as { x: number; y: number } | undefined;
      if (gn) positions[n.id] = { x: gn.x - n.w / 2, y: gn.y - n.h / 2 };
    }
    return { positions };
  },
};

export default dagreLayout;
