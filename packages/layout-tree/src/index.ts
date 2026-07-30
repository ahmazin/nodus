/**
 * @ahmazin/layout-tree — a dependency-free tidy-tree layout. Builds a hierarchy from edge direction
 * (source -> target), places leaves along the main axis and centers each parent over its children.
 * Great for org charts, mind maps, and file trees. Supports TB / BT / LR / RL direction.
 */

import type { Id, LayoutEngine, LayoutGraph, LayoutGraphNode, LayoutOptions, LayoutResult } from '@ahmazin/core';

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

    // Assign a leaf its main-axis center and advance the shared cursor past it.
    const placeLeaf = (id: Id): number => {
      const n = nodeById.get(id)!;
      const center = cursor + mainSize(n) / 2;
      cursor += mainSize(n) + siblingGap;
      main.set(id, center);
      return center;
    };

    // Iterative post-order placement. A recursive `place` would descend one stack frame per tree
    // level, so a deep/degenerate tree (e.g. a linear chain of N nodes) overflowed the call stack
    // around N≈2500. This explicit-stack walk reproduces the recursion exactly — leaves advance the
    // cursor in left-to-right order; each parent centers over its first and last child — but scales
    // to arbitrary depth. Frames represent internal nodes only (kids.length ≥ 1); leaves and
    // already-seen nodes are folded into their parent inline, mirroring the recursive return value.
    interface Frame {
      id: Id;
      depth: number;
      kids: Id[];
      i: number;
      first: number;
      last: number;
      has: boolean;
    }
    const place = (rootId: Id, rootDepth: number): void => {
      if (seen.has(rootId)) return; // guard cycles
      seen.add(rootId);
      depthOf.set(rootId, rootDepth);
      const rootKids = children.get(rootId) ?? [];
      if (rootKids.length === 0) {
        placeLeaf(rootId);
        return;
      }
      const stack: Frame[] = [{ id: rootId, depth: rootDepth, kids: rootKids, i: 0, first: 0, last: 0, has: false }];
      while (stack.length) {
        const f = stack[stack.length - 1]!;
        if (f.i < f.kids.length) {
          const kid = f.kids[f.i++]!;
          let center: number;
          if (seen.has(kid)) {
            center = main.get(kid) ?? cursor; // guard cycles: already-placed or in-progress ancestor
          } else {
            seen.add(kid);
            depthOf.set(kid, f.depth + 1);
            const kkids = children.get(kid) ?? [];
            if (kkids.length > 0) {
              stack.push({ id: kid, depth: f.depth + 1, kids: kkids, i: 0, first: 0, last: 0, has: false });
              continue; // descend; this child's center is folded into f when the child frame pops
            }
            center = placeLeaf(kid);
          }
          if (!f.has) {
            f.first = center;
            f.has = true;
          }
          f.last = center;
        } else {
          stack.pop();
          const center = (f.first + f.last) / 2;
          main.set(f.id, center);
          const parent = stack[stack.length - 1];
          if (parent) {
            if (!parent.has) {
              parent.first = center;
              parent.has = true;
            }
            parent.last = center;
          }
        }
      }
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
