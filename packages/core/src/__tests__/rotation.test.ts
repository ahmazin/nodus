import { describe, expect, it } from 'vitest';
import { Editor, Rectangle2d, type NodeRecord, type Vec2 } from '../index.js';

/**
 * Rotation correctness (PRR Fix 2 + Fix A). The record stores the un-rotated x/y/w/h; rotation is a
 * render-time transform about the box center `(x+w/2, y+h/2)`, radians clockwise (Canvas2D +y-down).
 * Default camera is identity, so screen == world.
 */

/** Local mirror of geometry.rotateAbout (which is intentionally not exported from the barrel). */
function rot(p: Vec2, rad: number, c: Vec2): Vec2 {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

function editorWithRotType(): Editor {
  const ed = new Editor({ viewport: { w: 800, h: 600 } });
  ed.snap.toObjects = false;
  ed.registerNodeType({
    type: 'rot',
    getDefaultProps: () => ({}),
    getGeometry: (n) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
    draw: () => {},
    getPorts: () => [
      { id: 'out', kind: 'both', anchor: { x: 1, y: 0.5 } },
      { id: 'in', kind: 'both', anchor: { x: 0, y: 0.5 } },
    ],
    capabilities: { canRotate: true, canConnect: true },
  });
  return ed;
}

describe('rotation — Fix A (resize in the local frame)', () => {
  it('resizing a rotated node with no pointer movement keeps its size (was 100×100 → 161×161)', () => {
    const ed = editorWithRotType();
    const id = ed.createNode({ type: 'rot', x: 0, y: 0, w: 100, h: 100 });
    ed.rotate([id], Math.PI / 4);
    ed.select([id]);
    // rotated SE handle world position = rotateAbout((100,100), π/4, (50,50)) = (50, 120.71)
    const seHandle = rot({ x: 100, y: 100 }, Math.PI / 4, { x: 50, y: 50 });
    expect(seHandle.x).toBeCloseTo(50, 3);
    expect(seHandle.y).toBeCloseTo(120.7107, 3);
    ed.pointerDown(seHandle);
    ed.pointerMove(seHandle); // no real motion
    ed.pointerUp(seHandle);
    const r = ed.store.peek(id) as NodeRecord;
    expect(r.w).toBeCloseTo(100, 3);
    expect(r.h).toBeCloseTo(100, 3);
  });

  it('dragging the SE handle grows the box by the local delta and keeps the NW world corner fixed', () => {
    const ed = editorWithRotType();
    const id = ed.createNode({ type: 'rot', x: 0, y: 0, w: 100, h: 100 });
    const angle = Math.PI / 4;
    ed.rotate([id], angle);
    ed.select([id]);
    const center0 = { x: 50, y: 50 };
    // NW world corner before the resize — must be invariant (it is the anchor opposite the SE handle).
    const nwBefore = rot({ x: 0, y: 0 }, angle, center0);

    const seHandle = rot({ x: 100, y: 100 }, angle, center0); // (50, 120.71)
    // move the grab so it corresponds to local (150,150) → box grows to 150×150
    const seTarget = rot({ x: 150, y: 150 }, angle, center0);
    ed.pointerDown(seHandle);
    ed.pointerMove(seTarget);
    ed.pointerUp(seTarget);

    const r = ed.store.peek(id) as NodeRecord;
    expect(r.w).toBeCloseTo(150, 2);
    expect(r.h).toBeCloseTo(150, 2);
    const center1 = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    const nwAfter = rot({ x: r.x, y: r.y }, r.rotation ?? 0, center1);
    expect(nwAfter.x).toBeCloseTo(nwBefore.x, 2);
    expect(nwAfter.y).toBeCloseTo(nwBefore.y, 2);
  });

  it('an unrotated resize is byte-for-byte the historical behavior (Δ=0 path)', () => {
    const ed = editorWithRotType();
    const id = ed.createNode({ type: 'rot', x: 0, y: 0, w: 130, h: 56 });
    ed.select([id]);
    ed.pointerDown({ x: 130, y: 56 });
    ed.pointerMove({ x: 200, y: 100 });
    ed.pointerUp({ x: 200, y: 100 });
    const r = ed.store.peek(id) as NodeRecord;
    expect(r.w).toBe(200);
    expect(r.h).toBe(100);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });
});

describe('rotation — Fix 2 (ports and edges honor rotation)', () => {
  it('portHandleAt / nearestPort resolve a port at its rotated position, not the unrotated one', () => {
    const ed = editorWithRotType();
    const id = ed.createNode({ type: 'rot', x: 0, y: 0, w: 100, h: 100 });
    ed.rotate([id], Math.PI / 2);
    // out anchor (1,0.5) → unrotated (100,50); rotated by π/2 about (50,50) → (50,100)
    const hit = ed.portHandleAt({ x: 50, y: 100 });
    expect(hit?.portId).toBe('out');
    expect(hit?.point.x).toBeCloseTo(50, 3);
    expect(hit?.point.y).toBeCloseTo(100, 3);
    // the unrotated location is now empty space
    expect(ed.portHandleAt({ x: 100, y: 50 })).toBeNull();
    const near = ed.nearestPort({ x: 50, y: 100 }, 'both');
    expect(near?.point.x).toBeCloseTo(50, 3);
    expect(near?.point.y).toBeCloseTo(100, 3);
  });

  it('an edge bound to a rotated port routes its endpoint to the rotated port position', () => {
    const ed = editorWithRotType();
    const a = ed.createNode({ type: 'rot', x: 0, y: 0, w: 100, h: 100 });
    ed.rotate([a], Math.PI / 2);
    const edge = ed.connect({ kind: 'node', nodeId: a, portId: 'out' }, { kind: 'point', x: 400, y: 400 });
    const item = ed.sceneIndex.getItem(edge);
    const route = item?.route;
    expect(route && route.length >= 2).toBe(true);
    // route[0] == the resolved `from` point (the straight router trims only the target end)
    expect(route![0]!.x).toBeCloseTo(50, 3);
    expect(route![0]!.y).toBeCloseTo(100, 3);
  });
});
