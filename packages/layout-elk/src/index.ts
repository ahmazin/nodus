/**
 * @nodus/layout-elk — an ELK (Eclipse Layout Kernel) adapter via elkjs. Supports layered,
 * orthogonal, and nested layouts. Uses the bundled build (async, runs everywhere incl. Node); in a
 * browser you can pass `{ workerUrl }` to offload to a Web Worker.
 */

import ELK from 'elkjs/lib/elk.bundled.js';
import type { Id, LayoutEngine, LayoutGraph, LayoutOptions, LayoutResult } from '@nodus/core';

function elkDirection(dir: string | undefined): string {
  switch (dir) {
    case 'LR': return 'RIGHT';
    case 'RL': return 'LEFT';
    case 'TB': return 'DOWN';
    case 'BT': return 'UP';
    default: return 'RIGHT';
  }
}

export interface ElkLayoutOptions extends LayoutOptions {
  /** ELK algorithm: 'layered' (default), 'force', 'mrtree', 'stress', 'radial', ... */
  algorithm?: string;
  /** Browser-only: URL of elk-worker.js to run layout off the main thread. */
  workerUrl?: string;
}

export function createElkLayout(defaults?: ElkLayoutOptions): LayoutEngine {
  return {
    id: 'elk',
    async layout(graph: LayoutGraph, opts?: ElkLayoutOptions): Promise<LayoutResult> {
      const o = { ...defaults, ...opts };
      const elk = new ELK(o.workerUrl ? { workerUrl: o.workerUrl } : {});
      const elkGraph = {
        id: 'root',
        layoutOptions: {
          'elk.algorithm': o.algorithm ?? 'layered',
          'elk.direction': elkDirection(o.direction ?? graph.direction),
          'elk.spacing.nodeNode': String(o.nodeGap ?? 40),
          'elk.layered.spacing.nodeNodeBetweenLayers': String(o.rankGap ?? 70),
        },
        children: graph.nodes.map((n) => ({ id: n.id, width: n.w, height: n.h })),
        edges: graph.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
      };
      const res = await elk.layout(elkGraph);
      const positions: LayoutResult['positions'] = {};
      for (const c of res.children ?? []) {
        positions[c.id as Id] = { x: c.x ?? 0, y: c.y ?? 0 }; // ELK gives top-left
      }
      return { positions };
    },
  };
}

/** Default layered ELK engine. */
export const elkLayout: LayoutEngine = createElkLayout();

export default elkLayout;
