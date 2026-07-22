import { describe, expect, it } from 'vitest';
import { Editor, type Id, type LayoutEngine, type LayoutGraph } from '@nodus/core';
import { treeLayout } from '@nodus/layout-tree';
import { forceLayout } from '@nodus/layout-force';
import { elkLayout, ELK_MAX_NODES } from '@nodus/layout-elk';

function graphEditor(): Editor {
  const ed = new Editor();
  const ids = ['a', 'b', 'c', 'd', 'e'].map((k) => ed.createNode({ type: 'rect', x: 0, y: 0, label: k }));
  // a -> b, a -> c, b -> d, c -> e
  ed.connect({ kind: 'node', nodeId: ids[0]!, portId: 'out' }, { kind: 'node', nodeId: ids[1]!, portId: 'in' });
  ed.connect({ kind: 'node', nodeId: ids[0]!, portId: 'out' }, { kind: 'node', nodeId: ids[2]!, portId: 'in' });
  ed.connect({ kind: 'node', nodeId: ids[1]!, portId: 'out' }, { kind: 'node', nodeId: ids[3]!, portId: 'in' });
  ed.connect({ kind: 'node', nodeId: ids[2]!, portId: 'out' }, { kind: 'node', nodeId: ids[4]!, portId: 'in' });
  return ed;
}

function spread(ed: Editor): number {
  const xs = ed.store.nodes().map((n) => n.x);
  const ys = ed.store.nodes().map((n) => n.y);
  return Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys));
}

async function check(engine: LayoutEngine, dir?: 'LR' | 'TB'): Promise<void> {
  const ed = graphEditor();
  ed.registerLayout(engine);
  await ed.layout(engine.id, dir ? { direction: dir } : {});
  expect(spread(ed)).toBeGreaterThan(50); // nodes got spread out
  // single undo reverts the layout
  ed.undo();
  expect(spread(ed)).toBeLessThan(1);
}

describe('layout adapters', () => {
  it('tree layout hierarchically positions nodes', async () => {
    await check(treeLayout, 'TB');
  });
  it('force layout spreads nodes apart', async () => {
    await check(forceLayout);
  });
  it('elk layered layout positions nodes', async () => {
    await check(elkLayout, 'LR');
  });

  // Regression: elkjs's layout kernel overflowed the call stack (`RangeError`) around N≈10000. That
  // recursion is inside elkjs, so the adapter fails fast above a safe ceiling with a clear, catchable
  // error. The guard trips *before* elk.layout() runs, so this never invokes the heavy async kernel
  // — no thousands of nodes are actually laid out.
  it('elk rejects a graph above ELK_MAX_NODES with a clear error, not a raw RangeError', async () => {
    const n = ELK_MAX_NODES + 1;
    const nodes = Array.from({ length: n }, (_, i) => ({ id: `n:${i}` as Id, w: 40, h: 30 }));
    const graph: LayoutGraph = { nodes, edges: [] };
    await expect(elkLayout.layout(graph)).rejects.toThrow(/elk layout: graph too large/);
    await expect(elkLayout.layout(graph)).rejects.toThrow(String(ELK_MAX_NODES));
  });
});
