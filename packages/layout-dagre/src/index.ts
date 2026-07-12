/**
 * @nodus/layout-dagre — a `LayoutEngine` adapter over dagre's layered layout. Converts dagre's
 * center-based coordinates to Nodus's world-space top-left. Register with `editor.registerLayout`.
 */

import dagre from '@dagrejs/dagre';
import type { Id, LayoutEngine, LayoutGraph, LayoutOptions, LayoutResult } from '@nodus/core';

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
