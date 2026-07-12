import { describe, expect, it } from 'vitest';
import { Editor, type NodeRecord } from '../index.js';

describe('resize', () => {
  it('drags a corner handle to resize, as one undo entry', () => {
    const ed = new Editor({ viewport: { w: 800, h: 600 } });
    const n = ed.createNode({ type: 'rect', x: 0, y: 0, w: 130, h: 56 });
    ed.select([n]);
    // grab the SE handle (at 130,56) and drag to (200,100)
    ed.pointerDown({ x: 130, y: 56 });
    ed.pointerMove({ x: 200, y: 100 });
    ed.pointerUp({ x: 200, y: 100 });
    const r = ed.store.peek(n) as NodeRecord;
    expect(r.w).toBe(200);
    expect(r.h).toBe(100);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    ed.undo();
    const back = ed.store.peek(n) as NodeRecord;
    expect(back.w).toBe(130);
    expect(back.h).toBe(56);
  });

  it('resizing from the NW handle moves the origin and keeps SE fixed', () => {
    const ed = new Editor({ viewport: { w: 800, h: 600 } });
    const n = ed.createNode({ type: 'rect', x: 100, y: 100, w: 100, h: 100 });
    ed.select([n]);
    ed.pointerDown({ x: 100, y: 100 }); // NW handle
    ed.pointerMove({ x: 60, y: 70 });
    ed.pointerUp({ x: 60, y: 70 });
    const r = ed.store.peek(n) as NodeRecord;
    expect(r.x).toBe(60);
    expect(r.y).toBe(70);
    expect(r.x + r.w).toBe(200); // SE corner unchanged
    expect(r.y + r.h).toBe(200);
  });

  it('tracks the grab offset — grabbing off-corner does not jump the edge (review #1/#5)', () => {
    const ed = new Editor({ viewport: { w: 800, h: 600 } });
    const n = ed.createNode({ type: 'rect', x: 0, y: 0, w: 130, h: 56 });
    ed.select([n]);
    ed.pointerDown({ x: 128, y: 54 }); // 2px inside the SE corner (still within handle tolerance)
    ed.pointerMove({ x: 128, y: 54 }); // no real motion -> size must be unchanged (no snap-to-pointer)
    let r = ed.store.peek(n) as NodeRecord;
    expect(r.w).toBe(130);
    expect(r.h).toBe(56);
    ed.pointerMove({ x: 178, y: 94 }); // move by exactly (50,40) -> grows by exactly (50,40)
    r = ed.store.peek(n) as NodeRecord;
    expect(r.w).toBe(180);
    expect(r.h).toBe(96);
    ed.pointerUp({ x: 178, y: 94 });
  });

  it('min-size clamp keeps the fixed edge (west handle) (review #2)', () => {
    const ed = new Editor({ viewport: { w: 800, h: 600 } });
    const n = ed.createNode({ type: 'rect', x: 100, y: 100, w: 50, h: 50 });
    ed.select([n]);
    ed.pointerDown({ x: 100, y: 125 }); // west handle (left edge, mid)
    ed.pointerMove({ x: 200, y: 125 }); // drag left edge past the right edge (150)
    const r = ed.store.peek(n) as NodeRecord;
    expect(r.w).toBe(8); // clamped
    expect(r.x + r.w).toBe(150); // right (fixed) edge held — no overshoot
    ed.pointerUp({ x: 200, y: 125 });
  });

  it('a normal drag (not on a handle) still moves, not resizes', () => {
    const ed = new Editor({ viewport: { w: 800, h: 600 } });
    const n = ed.createNode({ type: 'rect', x: 0, y: 0, w: 130, h: 56 });
    ed.select([n]);
    ed.pointerDown({ x: 65, y: 28 }); // center, not a handle
    ed.pointerMove({ x: 105, y: 28 });
    ed.pointerUp({ x: 105, y: 28 });
    const r = ed.store.peek(n) as NodeRecord;
    expect(r.w).toBe(130); // unchanged size
    expect(r.x).toBe(40); // moved
  });
});

describe('z-order', () => {
  it('bringToFront / sendToBack reorder paint order', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 10, y: 0 });
    const c = ed.createNode({ type: 'rect', x: 20, y: 0 });
    const order = () => ed.sceneIndex.paintOrder().map((i) => i.id);
    expect(order()).toEqual([a, b, c]); // creation order (ascending z)

    ed.bringToFront([a]);
    expect(order().at(-1)).toBe(a); // a now on top

    ed.sendToBack([c]);
    expect(order()[0]).toBe(c); // c now at the back

    ed.undo(); // undo sendToBack
    expect(order()[0]).not.toBe(c);
  });

  it('keeps a group frame behind its children when reordering (review #4)', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 200, y: 0 });
    const g = ed.group([a, b])!;
    ed.sendToBack([a]);
    const nodeOrder = ed.sceneIndex.paintOrder().filter((i) => i.kind === 'node').map((i) => i.id);
    expect(nodeOrder[0]).toBe(g); // group stays pinned at the very back
    expect(nodeOrder.indexOf(a)).toBeGreaterThan(nodeOrder.indexOf(g));
  });

  it('seeds the z counter from the largest loaded z so new nodes land on top (review #3)', () => {
    const ed = new Editor();
    ed.loadSnapshot({
      schemaVersion: 1,
      document: {
        records: [
          { id: 'node:x', typeName: 'node', version: 0, type: 'rect', x: 0, y: 0, w: 50, h: 50, z: '000000000z', visual: { state: 'solid' }, props: {} } as never,
        ],
      },
    });
    const nu = ed.createNode({ type: 'rect', x: 60, y: 0 });
    const nodeOrder = ed.sceneIndex.paintOrder().filter((i) => i.kind === 'node').map((i) => i.id);
    expect(nodeOrder.at(-1)).toBe(nu); // new node above the loaded (higher-z) one
  });
});
