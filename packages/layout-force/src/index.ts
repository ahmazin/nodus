/**
 * @ahmazin/layout-force — a force-directed layout (d3-force) with rectangular collision, tuned for
 * general graphs where hierarchy isn't meaningful. Runs the simulation to convergence synchronously
 * inside an async call, then returns world-space top-left positions.
 */

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { Id, LayoutEngine, LayoutGraph, LayoutOptions, LayoutResult } from '@ahmazin/core';

interface FNode extends SimulationNodeDatum {
  id: Id;
  w: number;
  h: number;
}

export const forceLayout: LayoutEngine = {
  id: 'force',
  async layout(graph: LayoutGraph, opts?: LayoutOptions): Promise<LayoutResult> {
    const nodes: FNode[] = graph.nodes.map((n, i) => ({
      id: n.id,
      w: n.w,
      h: n.h,
      x: n.x ?? Math.cos(i) * 120,
      y: n.y ?? Math.sin(i) * 120,
      ...(n.fixed ? { fx: n.x ?? 0, fy: n.y ?? 0 } : {}),
    }));
    const links: SimulationLinkDatum<FNode>[] = graph.edges.map((e) => ({ source: e.source, target: e.target }));

    const linkDistance = (opts?.linkDistance as number) ?? 150;
    const charge = (opts?.charge as number) ?? -700;
    const iterations = (opts?.iterations as number) ?? 320;

    const sim = forceSimulation<FNode>(nodes)
      .force('link', forceLink<FNode, SimulationLinkDatum<FNode>>(links).id((d) => d.id).distance(linkDistance).strength(0.6))
      .force('charge', forceManyBody().strength(charge))
      .force('collide', forceCollide<FNode>().radius((d) => Math.hypot(d.w, d.h) / 2 + 10).iterations(2))
      .force('x', forceX(0).strength(0.04))
      .force('y', forceY(0).strength(0.04))
      .stop();

    for (let i = 0; i < iterations; i++) sim.tick();

    const positions: LayoutResult['positions'] = {};
    for (const n of nodes) positions[n.id] = { x: (n.x ?? 0) - n.w / 2, y: (n.y ?? 0) - n.h / 2 };
    return { positions };
  },
};

export default forceLayout;
