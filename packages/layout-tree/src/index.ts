/**
 * @nodus/layout-tree — a dependency-free tidy-tree layout. Builds a hierarchy from edge direction
 * (source -> target), places leaves along the main axis and centers each parent over its children.
 * Great for org charts, mind maps, and file trees. Supports TB / BT / LR / RL direction.
 */

import type { Id, LayoutEngine, LayoutGraph, LayoutGraphNode, LayoutOptions, LayoutResult } from '@nodus/core';

function isHorizontal(dir: string): boolean {
  return dir === 'LR' || dir === 'RL';
}

export const treeLayout: LayoutEngine = {
  id: 'tree',
  async layout(graph: LayoutGraph, opts?: LayoutOptions): Promise<LayoutResult> {
    const dir = opts?.direction ?? graph.direction ?? 'TB';
    const horizontal = isHorizontal(dir);
    const nodeById = new Map<Id, LayoutGraphNode>(graph.nodes.map((n) => [n.id, n]));
    const children = new Map<Id, Id[]>();
    const hasParent = new Set<Id>();
    for (const e of graph.edges) {
      if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
      if (hasParent.has(e.target)) continue; // tree: one parent
      (children.get(e.source) ?? children.set(e.source, []).get(e.source)!).push(e.target);
      hasParent.add(e.target);
    }
    const roots = graph.nodes.filter((n) => !hasParent.has(n.id));

    const siblingGap = opts?.nodeGap ?? 34;
    const rankGap = opts?.rankGap ?? 90;
    const mainSize = (n: LayoutGraphNode) => (horizontal ? n.h : n.w);

    const main = new Map<Id, number>();
    const depthOf = new Map<Id, number>();
    let cursor = 0;
    const seen = new Set<Id>();

    const place = (id: Id, depth: number): number => {
      if (seen.has(id)) return main.get(id) ?? cursor; // guard cycles
      seen.add(id);
      depthOf.set(id, depth);
      const n = nodeById.get(id)!;
      const kids = children.get(id) ?? [];
      let center: number;
      if (kids.length === 0) {
        center = cursor + mainSize(n) / 2;
        cursor += mainSize(n) + siblingGap;
      } else {
        const cs = kids.map((k) => place(k, depth + 1));
        center = (cs[0]! + cs[cs.length - 1]!) / 2;
      }
      main.set(id, center);
      return center;
    };
    for (const r of roots) place(r.id, 0);
    // any nodes left (disconnected / cyclic islands) get appended
    for (const n of graph.nodes) if (!seen.has(n.id)) place(n.id, 0);

    const positions: LayoutResult['positions'] = {};
    for (const n of graph.nodes) {
      const m = main.get(n.id) ?? 0;
      const d = depthOf.get(n.id) ?? 0;
      let cross = d * rankGap;
      if (dir === 'BT' || dir === 'RL') cross = -cross;
      positions[n.id] = horizontal
        ? { x: cross, y: m - n.h / 2 }
        : { x: m - n.w / 2, y: cross };
    }
    return { positions };
  },
};

export default treeLayout;
