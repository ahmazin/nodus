import { describe, expect, it } from 'vitest';
import { Editor } from '@nodus/core';
import { treeLayout } from './index.js';

/**
 * A small tree laid out by the adapter:
 *   a → b, a → c, b → d, c → e
 * All nodes start stacked at the origin so a real layout has to move them apart.
 */
function graphEditor(): Editor {
  const ed = new Editor();
  const ids = ['a', 'b', 'c', 'd', 'e'].map((k) => ed.createNode({ type: 'rect', x: 0, y: 0, label: k }));
  ed.connect({ kind: 'node', nodeId: ids[0]!, portId: 'out' }, { kind: 'node', nodeId: ids[1]!, portId: 'in' });
  ed.connect({ kind: 'node', nodeId: ids[0]!, portId: 'out' }, { kind: 'node', nodeId: ids[2]!, portId: 'in' });
  ed.connect({ kind: 'node', nodeId: ids[1]!, portId: 'out' }, { kind: 'node', nodeId: ids[3]!, portId: 'in' });
  ed.connect({ kind: 'node', nodeId: ids[2]!, portId: 'out' }, { kind: 'node', nodeId: ids[4]!, portId: 'in' });
  return ed;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const boxes = (ed: Editor): Box[] => ed.store.nodes().map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));

/** Positions keyed by label (a…e) — stable across editors, unlike generated ids. */
function positionsByLabel(ed: Editor): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of ed.store.nodes()) out[n.label ?? n.id] = { x: n.x, y: n.y };
  return out;
}

const spread = (ed: Editor): number => {
  const bs = boxes(ed);
  const xs = bs.map((b) => b.x);
  const ys = bs.map((b) => b.y);
  return Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys));
};

/** Largest rectangle-overlap between any pair of nodes, per axis (0 = touching/apart). */
function maxPairOverlap(ed: Editor): { x: number; y: number } {
  const bs = boxes(ed);
  let ox = 0;
  let oy = 0;
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i]!;
      const b = bs[j]!;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 0 && iy > 0) {
        ox = Math.max(ox, ix);
        oy = Math.max(oy, iy);
      }
    }
  }
  return { x: ox, y: oy };
}

async function layouted(dir?: 'TB' | 'LR'): Promise<Editor> {
  const ed = graphEditor();
  ed.registerLayout(treeLayout);
  await ed.layout(treeLayout.id, dir ? { direction: dir } : {});
  return ed;
}

describe('tree layout adapter', () => {
  it('positions every node with finite coordinates', async () => {
    const ed = await layouted('TB');
    for (const b of boxes(ed)) {
      expect(Number.isFinite(b.x)).toBe(true);
      expect(Number.isFinite(b.y)).toBe(true);
    }
    expect(ed.store.nodes()).toHaveLength(5);
  });

  it('spreads the tree apart from its stacked origin', async () => {
    const ed = await layouted('TB');
    expect(spread(ed)).toBeGreaterThan(50);
  });

  it('places deeper nodes on later ranks (TB grows downward)', async () => {
    const ed = await layouted('TB');
    const p = positionsByLabel(ed);
    // root a is above its children b/c, which are above their children d/e
    expect(p.a!.y).toBeLessThan(p.b!.y);
    expect(p.a!.y).toBeLessThan(p.c!.y);
    expect(p.b!.y).toBeLessThan(p.d!.y);
    expect(p.c!.y).toBeLessThan(p.e!.y);
  });

  it('produces no gross node overlaps', async () => {
    const ed = await layouted('TB');
    const o = maxPairOverlap(ed);
    expect(Math.min(o.x, o.y)).toBeLessThanOrEqual(1);
  });

  it('is deterministic for a fixed input', async () => {
    const a = await layouted('TB');
    const b = await layouted('TB');
    expect(positionsByLabel(a)).toEqual(positionsByLabel(b));
  });

  it('collapses into a single undo entry', async () => {
    const ed = await layouted('TB');
    expect(spread(ed)).toBeGreaterThan(50);
    ed.undo();
    expect(spread(ed)).toBeLessThan(1);
  });
});
