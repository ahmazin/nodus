import { describe, expect, it } from 'vitest';
import { Editor, type NodeRecord } from '../index.js';

describe('snapping', () => {
  it('computeSnap snaps a box to the grid', () => {
    const ed = new Editor();
    ed.snap.grid = 10;
    ed.snap.toObjects = false;
    const snap = ed.computeSnap({ x: 3, y: 3, w: 50, h: 50 }, new Set());
    expect(snap.dx).toBeCloseTo(-3);
    expect(snap.dy).toBeCloseTo(-3);
  });

  it('computeSnap aligns to another node edge and emits a guide', () => {
    const ed = new Editor();
    ed.snap.grid = 0;
    ed.snap.toObjects = true;
    ed.createNode({ type: 'rect', x: 100, y: 100, w: 130, h: 56 });
    const snap = ed.computeSnap({ x: 104, y: 300, w: 50, h: 50 }, new Set());
    expect(snap.dx).toBeCloseTo(-4); // left edges align at x=100
    expect(snap.guides.length).toBeGreaterThan(0);
  });

  it('a drag snaps the dropped node to the grid', () => {
    const ed = new Editor({ viewport: { w: 800, h: 600 } });
    ed.snap.grid = 10;
    ed.snap.toObjects = false;
    const n = ed.createNode({ type: 'rect', x: 0, y: 0, w: 130, h: 56 }); // center (65,28)
    ed.pointerDown({ x: 65, y: 28 });
    ed.pointerMove({ x: 137, y: 28 }); // world dx = 72 -> snaps to 70
    ed.pointerUp({ x: 137, y: 28 });
    expect((ed.store.peek(n) as NodeRecord).x).toBe(70);
    // one undo reverts the whole drag
    ed.undo();
    expect((ed.store.peek(n) as NodeRecord).x).toBe(0);
  });
});
